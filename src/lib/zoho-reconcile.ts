import "server-only";
import { logAppError } from "@/lib/app-errors";
import { round2 } from "@/lib/money";
import { notifyRoles } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { zohoFetch } from "@/lib/zoho";
import { billErpFigures, poForZoho, zohoWriteOrg } from "@/lib/zoho-sync";

/**
 * Daily reconciliation (phase 4, 27 October 2026): every morning, yesterday per the ERP next to yesterday per
 * Zoho — tax invoices, payments by method (deposits shown inside them: Zoho cannot tell a deposit from a
 * payment), credit notes, supplier bills, supplier payments and expenses. One row per day in zoho_reconciliation:
 * green when identical, red with the exact difference, and one bell to accounts and the owner when a day turns
 * red. Vendor credits and customer refunds are not separate lines (they show inside the bills' and credit notes'
 * balances); that is written on the page.
 */

export type ReconSide = { count: number; total: number };
export type ReconSection = { label: string; erp: ReconSide; zoho: ReconSide; ok: boolean; diff?: string };
export type ReconDetails = {
  sections: ReconSection[];
  paymentsByMode: Record<string, { erp: number; zoho: number; ok: boolean }>;
  deposits: ReconSide;
  note?: string;
};
export type ReconRow = { day: string; status: "green" | "red"; details: ReconDetails; checked_at: string };

const near = (a: number, b: number) => Math.abs(a - b) < 0.009;
const normMode = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const aed = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Dubai day bounds as ISO instants: [day 00:00+04:00, next day). */
function dayBounds(day: string): { from: string; to: string } {
  const from = new Date(`${day}T00:00:00+04:00`);
  const to = new Date(from.getTime() + 24 * 3600 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

type ZohoListRow = Record<string, unknown> & { status?: string; total?: number; amount?: number; payment_mode?: string };

/** Every row of a date-filtered Zoho list, page by page. */
async function zohoList(org: string, path: string, listKey: string, day: string): Promise<ZohoListRow[]> {
  const out: ZohoListRow[] = [];
  for (let page = 1; page <= 20; page++) {
    const j = await zohoFetch<Record<string, unknown> & { page_context?: { has_more_page?: boolean } }>(`${path}?date=${day}&per_page=200&page=${page}`, { org });
    const rows = (j[listKey] as ZohoListRow[] | undefined) ?? [];
    out.push(...rows);
    if (!j.page_context?.has_more_page) break;
  }
  return out;
}

const sum = (rows: ZohoListRow[], field: "total" | "amount") => round2(rows.reduce((a, r) => a + (Number(r[field]) || 0), 0));
const live = (rows: ZohoListRow[]) => rows.filter((r) => r.status !== "void" && r.status !== "draft");

/** The whole comparison for one Dubai day. Pure data in, one row out; does NOT write or notify. */
export async function compareDay(org: string, day: string): Promise<{ status: "green" | "red"; details: ReconDetails }> {
  const admin = createAdminClient();
  const { from, to } = dayBounds(day);

  /* ---------------- the ERP's side ---------------- */
  const { data: invRows } = await admin.from("invoices").select("total_aed").eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true).is("deposit_for_quotation_id", null).gte("issued_at", from).lt("issued_at", to);
  const erpInvoices: ReconSide = { count: (invRows ?? []).length, total: round2((invRows ?? []).reduce((a, r) => a + Number(r.total_aed), 0)) };

  const { data: cnRows } = await admin.from("invoices").select("total_aed").eq("kind", "credit_note").eq("status", "issued").eq("is_active", true).gte("issued_at", from).lt("issued_at", to);
  const erpCns: ReconSide = { count: (cnRows ?? []).length, total: round2((cnRows ?? []).reduce((a, r) => a + Number(r.total_aed), 0)) };

  // Payments count on the day they count in Zoho: non-cheques when received, cheques when cleared.
  const MODE: Record<string, string> = { cash: "cash", card: "creditcard", link: "others", transfer: "banktransfer", cheque: "check" };
  const [{ data: payA }, { data: payB }] = await Promise.all([
    admin.from("payments").select("method, amount_aed, is_deposit").eq("status", "recorded").eq("is_active", true).neq("method", "cheque").gte("received_at", from).lt("received_at", to),
    admin.from("payments").select("method, amount_aed, is_deposit").eq("status", "recorded").eq("is_active", true).eq("method", "cheque").eq("cheque_status", "cleared").gte("cleared_at", from).lt("cleared_at", to),
  ]);
  const payRows = [...(payA ?? []), ...(payB ?? [])] as { method: string; amount_aed: number; is_deposit: boolean }[];
  const erpByMode: Record<string, number> = {};
  for (const p of payRows) {
    const mode = MODE[p.method] ?? "others";
    erpByMode[mode] = round2((erpByMode[mode] ?? 0) + Number(p.amount_aed));
  }
  const erpPayments: ReconSide = { count: payRows.length, total: round2(payRows.reduce((a, p) => a + Number(p.amount_aed), 0)) };
  const depositRows = payRows.filter((p) => p.is_deposit);
  const deposits: ReconSide = { count: depositRows.length, total: round2(depositRows.reduce((a, p) => a + Number(p.amount_aed), 0)) };

  // Bills by the supplier's invoice date, at the ONE shared computation; Our-stock LPOs never bill.
  const { data: poRows } = await admin.from("purchase_orders").select("id, supplier_name").neq("kind", "main").eq("is_active", true).eq("supplier_invoice_status", "received").not("supplier_invoice_number", "is", null).eq("supplier_invoice_date", day);
  const billPos = ((poRows ?? []) as { id: string; supplier_name: string }[]).filter((p) => !/^our stock$/i.test(p.supplier_name.trim()));
  let erpBillsTotal = 0;
  for (const p of billPos) erpBillsTotal = round2(erpBillsTotal + (await billErpFigures(await poForZoho(p.id))).gross);
  const erpBills: ReconSide = { count: billPos.length, total: erpBillsTotal };

  // Supplier payments by the day they were marked paid; the amount is what settled the bill (the synced figure,
  // else the bill's worth) — a missing sync then shows as a difference, which is the point.
  const { data: paidPos } = await admin.from("purchase_orders").select("id, supplier_name").neq("kind", "main").eq("is_active", true).gte("supplier_paid_at", from).lt("supplier_paid_at", to);
  const paidList = ((paidPos ?? []) as { id: string; supplier_name: string }[]).filter((p) => !/^our stock$/i.test(p.supplier_name.trim()));
  let erpVpTotal = 0;
  for (const p of paidList) {
    const { data: ob } = await admin.from("zoho_outbox").select("zoho_result").eq("kind", "billpayment").eq("record_id", p.id).maybeSingle();
    const recorded = Number((ob?.zoho_result as { amount?: number } | null)?.amount);
    erpVpTotal = round2(erpVpTotal + (Number.isFinite(recorded) && recorded > 0 ? recorded : (await billErpFigures(await poForZoho(p.id))).gross));
  }
  const erpVendorPayments: ReconSide = { count: paidList.length, total: erpVpTotal };

  // Expenses: commission vouchers by paid_on, recovery months by paid_at.
  const [{ data: commRows }, { data: recRows }] = await Promise.all([
    admin.from("commission_payments").select("amount_aed").eq("is_active", true).eq("paid_on", day),
    admin.from("recovery_payouts").select("total_aed").gte("paid_at", from).lt("paid_at", to),
  ]);
  const erpExpenses: ReconSide = {
    count: (commRows ?? []).length + (recRows ?? []).length,
    total: round2((commRows ?? []).reduce((a, r) => a + Number(r.amount_aed), 0) + (recRows ?? []).reduce((a, r) => a + Number(r.total_aed), 0)),
  };

  /* ---------------- Zoho's side ---------------- */
  const [zInv, zCn, zPay, zBill, zVp, zExp] = [
    live(await zohoList(org, "/invoices", "invoices", day)),
    live(await zohoList(org, "/creditnotes", "creditnotes", day)),
    await zohoList(org, "/customerpayments", "customerpayments", day),
    live(await zohoList(org, "/bills", "bills", day)),
    await zohoList(org, "/vendorpayments", "vendorpayments", day),
    await zohoList(org, "/expenses", "expenses", day),
  ];
  const zohoByMode: Record<string, number> = {};
  for (const r of zPay) {
    const mode = normMode(String(r.payment_mode ?? "others")) || "others";
    zohoByMode[mode] = round2((zohoByMode[mode] ?? 0) + (Number(r.amount) || 0));
  }

  /* ---------------- side by side ---------------- */
  const section = (label: string, erp: ReconSide, zoho: ReconSide): ReconSection => {
    const ok = erp.count === zoho.count && near(erp.total, zoho.total);
    const bits: string[] = [];
    if (erp.count !== zoho.count) bits.push(`${erp.count} in the ERP vs ${zoho.count} in Zoho`);
    if (!near(erp.total, zoho.total)) bits.push(`AED ${aed(erp.total)} in the ERP vs AED ${aed(zoho.total)} in Zoho (off by ${aed(round2(erp.total - zoho.total))})`);
    return { label, erp, zoho, ok, ...(bits.length ? { diff: bits.join("; ") } : {}) };
  };
  const sections: ReconSection[] = [
    section("Tax invoices", erpInvoices, { count: zInv.length, total: sum(zInv, "total") }),
    section("Payments (deposits included)", erpPayments, { count: zPay.length, total: sum(zPay, "amount") }),
    section("Credit notes", erpCns, { count: zCn.length, total: sum(zCn, "total") }),
    section("Supplier bills", erpBills, { count: zBill.length, total: sum(zBill, "total") }),
    section("Supplier payments", erpVendorPayments, { count: zVp.length, total: sum(zVp, "amount") }),
    section("Expenses", erpExpenses, { count: zExp.length, total: sum(zExp, "total") }),
  ];
  const paymentsByMode: Record<string, { erp: number; zoho: number; ok: boolean }> = {};
  for (const mode of new Set([...Object.keys(erpByMode), ...Object.keys(zohoByMode)])) {
    const e = erpByMode[mode] ?? 0;
    const z = zohoByMode[mode] ?? 0;
    paymentsByMode[mode] = { erp: e, zoho: z, ok: near(e, z) };
  }
  const modesOk = Object.values(paymentsByMode).every((m) => m.ok);
  const status: "green" | "red" = sections.every((s) => s.ok) && modesOk ? "green" : "red";
  return { status, details: { sections, paymentsByMode, deposits, note: "Deposits are ordinary payments in Zoho (shown inside Payments). Supplier credits and customer refunds show inside the bills' and credit notes' balances." } };
}

/** Compare, store the day's row, and ring accounts + the owner ONCE when a day turns red. */
export async function reconcileDay(org: string, day: string): Promise<{ status: "green" | "red" }> {
  const admin = createAdminClient();
  const { data: prev } = await admin.from("zoho_reconciliation").select("status").eq("day", day).maybeSingle();
  const { status, details } = await compareDay(org, day);
  const { error } = await admin.from("zoho_reconciliation").upsert({ day, status, details: details as unknown as Record<string, unknown>, checked_at: new Date().toISOString() }, { onConflict: "day" });
  if (error) throw new Error(error.message);
  if (status === "red" && (prev as { status?: string } | null)?.status !== "red") {
    const firstDiff = details.sections.find((s) => !s.ok)?.diff ?? Object.entries(details.paymentsByMode).find(([, m]) => !m.ok)?.[0] ?? "see the page";
    await notifyRoles(["owner", "accounts"], {
      type: "zoho_reconciliation",
      title: `Zoho reconciliation differs · ${day}`,
      body: `${details.sections.find((s) => !s.ok)?.label ?? "Payments"}: ${firstDiff}`,
      href: "/zoho/reconciliation",
    }).catch(() => null);
  }
  return { status };
}

/** The morning run: the first cron after midnight checks yesterday once (re-checks go through the page). */
export async function reconcileYesterdayIfDue(): Promise<{ day: string; status: string } | null> {
  try {
    const org = await zohoWriteOrg();
    if (!org) return null;
    const day = new Date(Date.now() + 4 * 3600 * 1000 - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const admin = createAdminClient();
    const { data: exists } = await admin.from("zoho_reconciliation").select("day").eq("day", day).maybeSingle();
    if (exists) return null;
    const { status } = await reconcileDay(org, day);
    return { day, status };
  } catch (e) {
    await logAppError("zoho_reconcile", e, {});
    return null;
  }
}

/** The backfill: every missing day from the first synced document to yesterday, oldest first, capped per call. */
export async function reconcileMissingDays(cap = 40): Promise<{ done: string[]; remaining: number }> {
  const org = await zohoWriteOrg();
  if (!org) throw new Error("No organization to reconcile against.");
  const admin = createAdminClient();
  const { data: first } = await admin.from("zoho_outbox").select("synced_at").eq("status", "synced").order("synced_at", { ascending: true }).limit(1).maybeSingle();
  if (!first?.synced_at) return { done: [], remaining: 0 };
  const start = new Date(Date.parse(String(first.synced_at)) + 4 * 3600 * 1000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() + 4 * 3600 * 1000 - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: haveRows } = await admin.from("zoho_reconciliation").select("day");
  const have = new Set(((haveRows ?? []) as { day: string }[]).map((r) => String(r.day).slice(0, 10)));
  const days: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); ; d = new Date(d.getTime() + 24 * 3600 * 1000)) {
    const day = d.toISOString().slice(0, 10);
    if (day > yesterday) break;
    if (!have.has(day)) days.push(day);
  }
  const done: string[] = [];
  for (const day of days.slice(0, cap)) {
    await reconcileDay(org, day);
    done.push(day);
  }
  return { done, remaining: Math.max(0, days.length - done.length) };
}
