import "server-only";
import { rowsOnDay, shiftDay } from "@/lib/zoho-sync-rules";
import { clearingOpenAt } from "@/lib/card-settlements";
import { logAppError } from "@/lib/app-errors";
import { round2 } from "@/lib/money";
import { notifyRoles } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { ZOHO_REAL_ORG_ID, zohoBooksNow, zohoFetch, zohoTestOrgId } from "@/lib/zoho";
import { beforeGoLiveStart, billErpFigures, poForZoho, zohoClearingAccounts } from "@/lib/zoho-sync";
import { SENDS_ON_PRESS_FILTER, RECON_LOOKBACK_DAYS, dayWaitsForSync, reconDaysDue, reconDue } from "@/lib/zoho-sync-rules";

// PURE, kept importable from here (the e2e route and older callers): the rule itself lives in zoho-sync-rules.
export { reconDue };

/**
 * Daily reconciliation (phase 4, 27 October 2026): every morning, yesterday per the ERP next to yesterday per
 * Zoho — tax invoices, payments by method (deposits shown inside them: Zoho cannot tell a deposit from a
 * payment), credit notes, supplier bills, supplier payments and expenses. One row per day in zoho_reconciliation:
 * green when identical, red with the exact difference, and one bell to accounts and the owner when a day turns
 * red. Vendor credits and customer refunds are not separate lines (they show inside the bills' and credit notes'
 * balances); that is written on the page.
 *
 * Each day is compared against the book that OWNS it: OFJ TEST before go-live, and after it OFJ TEST for days
 * before the start date (their documents stay there) and the REAL organization from the start date on.
 */

export type ReconSide = { count: number; total: number };
export type ReconSection = { label: string; erp: ReconSide; zoho: ReconSide; ok: boolean; diff?: string };
export type ReconDetails = {
  sections: ReconSection[];
  paymentsByMode: Record<string, { erp: number; zoho: number; ok: boolean }>;
  deposits: ReconSide;
  /** Which organization the day was compared against. */
  org?: string;
  orgLabel?: string;
  note?: string;
  /** Card/link money still in the clearing accounts at the end of the day (ERP side; returns to zero as the bank settles). */
  clearing?: { card: { count: number; total: number; oldest: string | null }; link: { count: number; total: number; oldest: string | null } };
};
export type ReconRow = { day: string; status: "green" | "red"; details: ReconDetails; checked_at: string };

const near = (a: number, b: number, tolerance = 0.009) => Math.abs(a - b) < tolerance;
const normMode = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const aed = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DAY = 24 * 3600 * 1000;

/** Dubai day bounds as ISO instants: [day 00:00+04:00, next day). */
function dayBounds(day: string): { from: string; to: string } {
  const from = new Date(`${day}T00:00:00+04:00`);
  const to = new Date(from.getTime() + DAY);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** PURE: the book that owns a day — REAL from the start date on once the books went live (posting or stopped), OFJ TEST for everything else. */
export function reconOrgFor(day: string, wentLive: boolean, startDate: string, testOrg: string | null): string | null {
  return wentLive && !beforeGoLiveStart(day, wentLive, startDate) ? ZOHO_REAL_ORG_ID : testOrg;
}

/** The organization for a day, with the go-live switch read fresh. */
async function orgForDay(day: string): Promise<string | null> {
  const [state, settings, testOrg] = await Promise.all([zohoBooksNow(), getSettings(), zohoTestOrgId()]);
  return reconOrgFor(day, state.live || state.wentLive, String(settings.zoho_golive_start_date ?? ""), testOrg);
}

type ZohoListRow = Record<string, unknown> & { status?: string; total?: number; amount?: number; payment_mode?: string };

/** Every row of a date-filtered Zoho list, page by page. */
async function zohoList(org: string, path: string, listKey: string, day: string): Promise<ZohoListRow[]> {
  const out: ZohoListRow[] = [];
  for (let page = 1; page <= 20; page++) {
    const j = await zohoFetch<Record<string, unknown> & { page_context?: { has_more_page?: boolean } }>(`${path}${path.includes("?") ? "&" : "?"}date=${day}&per_page=200&page=${page}`, { org });
    const rows = (j[listKey] as ZohoListRow[] | undefined) ?? [];
    out.push(...rows);
    if (!j.page_context?.has_more_page) break;
  }
  return out;
}

const sum = (rows: ZohoListRow[], field: "total" | "amount") => round2(rows.reduce((a, r) => a + (Number(r[field]) || 0), 0));
const live = (rows: ZohoListRow[]) => rows.filter((r) => r.status !== "void" && r.status !== "draft");

/** The whole comparison for one Dubai day against one organization. Pure data in, one row out; does NOT write or notify. */
export async function compareDay(org: string, day: string): Promise<{ status: "green" | "red"; details: ReconDetails }> {
  const admin = createAdminClient();
  const { from, to } = dayBounds(day);
  // The outbox rows of the organization being compared: the live queue for the current book, the archive for the other.
  // After go-live the current queue holds the REAL book's rows (posting or stopped).
  const books = await zohoBooksNow();
  const currentOrg = books.live || books.wentLive ? ZOHO_REAL_ORG_ID : await zohoTestOrgId();
  const outboxRow = async (kind: string, recordId: string): Promise<{ status: string; zoho_result: Record<string, unknown> | null } | null> => {
    const q = org === currentOrg ? admin.from("zoho_outbox").select("status, zoho_result") : admin.from("zoho_outbox_archive").select("status, zoho_result").eq("org", org);
    const { data } = await q.eq("kind", kind).eq("record_id", recordId).maybeSingle();
    return (data as { status: string; zoho_result: Record<string, unknown> | null } | null) ?? null;
  };

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

  // Bills by the supplier's invoice date, at the ONE shared computation; Our-stock LPOs never bill. Zoho works
  // the 5% out line by line while the ERP rounds once per bill, so each bill line may differ by a fils.
  const { data: poRows } = await admin.from("purchase_orders").select("id, supplier_name").neq("kind", "main").eq("is_active", true).eq("supplier_invoice_status", "received").not("supplier_invoice_number", "is", null).eq("supplier_invoice_date", day);
  const billPos = ((poRows ?? []) as { id: string; supplier_name: string }[]).filter((p) => !/^our stock$/i.test(p.supplier_name.trim()));
  let erpBillsTotal = 0;
  let billLines = 0;
  for (const p of billPos) {
    const f = await billErpFigures(await poForZoho(p.id));
    erpBillsTotal = round2(erpBillsTotal + f.gross);
    billLines += (f.partsRate > 0.005 || f.lines.length ? 1 : 0) + f.charges.length;
  }
  const erpBills: ReconSide = { count: billPos.length, total: erpBillsTotal };

  // Supplier payments by the day they were marked paid; the amount is what the sync recorded posting (else the
  // bill's worth) — a missing sync then shows as a difference, which is the point. A payment the sync found
  // already settled in Zoho posted nothing, so it is not counted.
  const { data: paidPos } = await admin.from("purchase_orders").select("id, supplier_name").neq("kind", "main").eq("is_active", true).gte("supplier_paid_at", from).lt("supplier_paid_at", to);
  const paidList = ((paidPos ?? []) as { id: string; supplier_name: string }[]).filter((p) => !/^our stock$/i.test(p.supplier_name.trim()));
  let erpVpTotal = 0;
  let erpVpCount = 0;
  for (const p of paidList) {
    const ob = await outboxRow("billpayment", p.id);
    if (ob?.status === "synced" && typeof ob.zoho_result?.skipped === "string") continue;
    const recorded = Number((ob?.zoho_result as { amount?: number } | null)?.amount);
    erpVpCount++;
    erpVpTotal = round2(erpVpTotal + (Number.isFinite(recorded) && recorded > 0 ? recorded : (await billErpFigures(await poForZoho(p.id))).gross));
  }
  const erpVendorPayments: ReconSide = { count: erpVpCount, total: erpVpTotal };

  // Expenses: commission vouchers by paid_on, recovery months by paid_at, card/link settlement fees by settled_on.
  const [{ data: commRows }, { data: recRows }, { data: feeRows }] = await Promise.all([
    admin.from("commission_payments").select("amount_aed").eq("is_active", true).eq("paid_on", day),
    admin.from("recovery_payouts").select("total_aed").gte("paid_at", from).lt("paid_at", to),
    admin.from("card_settlements").select("fee_aed").eq("is_active", true).eq("settled_on", day).gt("fee_aed", 0),
  ]);
  const erpExpenses: ReconSide = {
    count: (commRows ?? []).length + (recRows ?? []).length + (feeRows ?? []).length,
    total: round2((commRows ?? []).reduce((a, r) => a + Number(r.amount_aed), 0) + (recRows ?? []).reduce((a, r) => a + Number(r.total_aed), 0) + (feeRows ?? []).reduce((a, r) => a + Number(r.fee_aed), 0)),
  };
  const clearing = await clearingOpenAt(day);
  // Card/link settlements: the transfers clearing -> bank for what the bank paid in (an undone one is not counted).
  const { data: stlRows } = await admin.from("card_settlements").select("received_aed").eq("is_active", true).eq("settled_on", day).gt("received_aed", 0);
  const erpSettlements: ReconSide = { count: (stlRows ?? []).length, total: round2((stlRows ?? []).reduce((a, r) => a + Number(r.received_aed), 0)) };

  /* ---------------- Zoho's side ---------------- */
  const [zInv, zCn, zPay, zBill, zVp, zExp] = [
    live(await zohoList(org, "/invoices", "invoices", day)),
    live(await zohoList(org, "/creditnotes", "creditnotes", day)),
    await zohoList(org, "/customerpayments", "customerpayments", day),
    live(await zohoList(org, "/bills", "bills", day)),
    await zohoList(org, "/vendorpayments", "vendorpayments", day),
    await zohoList(org, "/expenses", "expenses", day),
  ];
  // The settlement transfers out of the two clearing accounts (only when the ERP has settlements or the accounts resolve).
  let zSettle: ZohoListRow[] = [];
  let settleNote: string | null = null;
  const clearingIds = await zohoClearingAccounts(org);
  if ("error" in clearingIds) settleNote = `The clearing accounts could not be read in Zoho: ${clearingIds.error}`;
  else {
    // Audit H3 (6 November 2026): Zoho's `date=` filter on bank transactions drifts around midnight with the org's own
    // clock (STL-00006, posted for 3 Nov, was listed under 2 Nov), so a day is read with its neighbours and each
    // transfer counts on ITS OWN date - the date the sync posted it with.
    for (const id of [clearingIds.card, clearingIds.link]) {
      for (const d of [shiftDay(day, -1), day, shiftDay(day, 1)]) {
        const rows = await zohoList(org, `/banktransactions?account_id=${encodeURIComponent(id)}`, "banktransactions", d);
        zSettle.push(...rowsOnDay(rows, day).filter((r) => String(r.transaction_type ?? "") === "transfer_fund" && String(r.reference_number ?? "").startsWith("STL-")));
      }
    }
    zSettle = zSettle.filter((r, i, all) => all.findIndex((x) => x.transaction_id === r.transaction_id) === i);
  }
  const zohoByMode: Record<string, number> = {};
  for (const r of zPay) {
    const mode = normMode(String(r.payment_mode ?? "others")) || "others";
    zohoByMode[mode] = round2((zohoByMode[mode] ?? 0) + (Number(r.amount) || 0));
  }

  /* ---------------- side by side ---------------- */
  const section = (label: string, erp: ReconSide, zoho: ReconSide, tolerance = 0.009): ReconSection => {
    const ok = erp.count === zoho.count && near(erp.total, zoho.total, tolerance);
    const bits: string[] = [];
    if (erp.count !== zoho.count) bits.push(`${erp.count} in the ERP vs ${zoho.count} in Zoho`);
    if (!near(erp.total, zoho.total, tolerance)) bits.push(`AED ${aed(erp.total)} in the ERP vs AED ${aed(zoho.total)} in Zoho (off by ${aed(round2(erp.total - zoho.total))})`);
    return { label, erp, zoho, ok, ...(bits.length ? { diff: bits.join("; ") } : {}) };
  };
  const sections: ReconSection[] = [
    section("Tax invoices", erpInvoices, { count: zInv.length, total: sum(zInv, "total") }),
    section("Payments (deposits included)", erpPayments, { count: zPay.length, total: sum(zPay, "amount") }),
    section("Credit notes", erpCns, { count: zCn.length, total: sum(zCn, "total") }),
    section("Supplier bills", erpBills, { count: zBill.length, total: sum(zBill, "total") }, Math.max(0.009, 0.01 * billLines)),
    section("Supplier payments", erpVendorPayments, { count: zVp.length, total: sum(zVp, "amount") }),
    section("Expenses", erpExpenses, { count: zExp.length, total: sum(zExp, "total") }),
    ...(settleNote ? [] : [section("Card/link settlement transfers", erpSettlements, { count: zSettle.length, total: sum(zSettle, "amount") })]),
  ];
  const paymentsByMode: Record<string, { erp: number; zoho: number; ok: boolean }> = {};
  for (const mode of new Set([...Object.keys(erpByMode), ...Object.keys(zohoByMode)])) {
    const e = erpByMode[mode] ?? 0;
    const z = zohoByMode[mode] ?? 0;
    paymentsByMode[mode] = { erp: e, zoho: z, ok: near(e, z) };
  }
  const modesOk = Object.values(paymentsByMode).every((m) => m.ok);
  const status: "green" | "red" = sections.every((s) => s.ok) && modesOk ? "green" : "red";
  return {
    status,
    details: {
      sections,
      paymentsByMode,
      deposits,
      org,
      orgLabel: org === ZOHO_REAL_ORG_ID ? "the REAL book" : "OFJ TEST",
      clearing,
      note: `Deposits are ordinary payments in Zoho (shown inside Payments). Supplier credits and customer refunds show inside the bills' and credit notes' balances.${settleNote ? ` ${settleNote}` : ""}`,
    },
  };
}

/** Compare a day against the book that owns it, store the row, and ring accounts + the owner ONCE when it turns red. */
export async function reconcileDay(day: string): Promise<{ status: "green" | "red"; org: string }> {
  const org = await orgForDay(day);
  if (!org) throw new Error("No organization to reconcile against: pick OFJ TEST on Settings > Zoho Books.");
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
  return { status, org };
}

/**
 * MANUAL SYNC (3 November 2026): while the sync waits for someone to press Sync to Zoho, a day whose documents have
 * not been sent yet would compare "the ERP has it, Zoho does not" and turn red for nothing. The oldest row still
 * waiting that a press would send (sendsOnPress: never tried, or waiting only on Zoho's own allowance) — a day ending
 * after it is not compared yet; it gets its check once the documents went (reconcileDueDays walks back to it). A row
 * that WAS tried and waits for something else (a red bill, a cheque) is a true difference.
 * Null when nothing unsent stands in the way (or the sync is automatic).
 */
export async function firstUnsentAt(): Promise<string | null> {
  if ((await zohoBooksNow()).auto) return null;
  const { data } = await createAdminClient().from("zoho_outbox").select("enqueued_at").eq("status", "pending").or(SENDS_ON_PRESS_FILTER).order("enqueued_at").limit(1).maybeSingle();
  return (data as { enqueued_at?: string } | null)?.enqueued_at ?? null;
}

/**
 * The automatic, read-only comparison, from the five-minute cron and after every Sync to Zoho (review of 3 November
 * 2026): every recent day that is due (reconDaysDue: no row, or a row written before the day ended, and no longer
 * waiting for Sync to Zoho; yesterday also hourly while red), oldest first, a few per run — not only yesterday, so a
 * day held back over a day off is still compared once its documents went. Stops at the first problem (logged; the
 * next run tries again).
 */
export async function reconcileDueDays(opts: { drainSaturated: boolean }): Promise<{ day: string; status: string }[]> {
  const done: { day: string; status: string }[] = [];
  try {
    if (opts.drainSaturated) return done;
    const now = Date.now();
    const from = new Date(now + 4 * 3600 * 1000 - RECON_LOOKBACK_DAYS * DAY).toISOString().slice(0, 10);
    const { data } = await createAdminClient().from("zoho_reconciliation").select("day, status, checked_at").gte("day", from);
    const rows: Record<string, { status: string; checked_at: string }> = {};
    for (const r of (data ?? []) as { day: string; status: string; checked_at: string }[]) rows[String(r.day).slice(0, 10)] = { status: r.status, checked_at: r.checked_at };
    const days = reconDaysDue({ nowMs: now, rows, firstUnsent: await firstUnsentAt(), drainSaturated: false });
    for (const day of days) {
      const { status } = await reconcileDay(day);
      done.push({ day, status });
    }
  } catch (e) {
    await logAppError("zoho_reconcile", e, { detail: { compared: done.map((d) => d.day) } });
  }
  return done;
}

/** The first Dubai day any document carries — the reconciliation covers its whole month from there. */
async function firstDocumentDay(): Promise<string | null> {
  const admin = createAdminClient();
  const [inv, pay, bill, paid, comm, rec] = await Promise.all([
    admin.from("invoices").select("issued_at").in("kind", ["tax_invoice", "credit_note"]).eq("status", "issued").order("issued_at").limit(1).maybeSingle(),
    admin.from("payments").select("received_at").eq("status", "recorded").order("received_at").limit(1).maybeSingle(),
    admin.from("purchase_orders").select("supplier_invoice_date").not("supplier_invoice_date", "is", null).order("supplier_invoice_date").limit(1).maybeSingle(),
    admin.from("purchase_orders").select("supplier_paid_at").not("supplier_paid_at", "is", null).order("supplier_paid_at").limit(1).maybeSingle(),
    admin.from("commission_payments").select("paid_on").not("paid_on", "is", null).order("paid_on").limit(1).maybeSingle(),
    admin.from("recovery_payouts").select("paid_at").not("paid_at", "is", null).order("paid_at").limit(1).maybeSingle(),
  ]);
  const asDay = (stamp: unknown, isDay = false) => (stamp ? (isDay ? String(stamp).slice(0, 10) : new Date(Date.parse(String(stamp)) + 4 * 3600 * 1000).toISOString().slice(0, 10)) : null);
  const days = [
    asDay((inv.data as { issued_at?: string } | null)?.issued_at),
    asDay((pay.data as { received_at?: string } | null)?.received_at),
    asDay((bill.data as { supplier_invoice_date?: string } | null)?.supplier_invoice_date, true),
    asDay((paid.data as { supplier_paid_at?: string } | null)?.supplier_paid_at),
    asDay((comm.data as { paid_on?: string } | null)?.paid_on, true),
    asDay((rec.data as { paid_at?: string } | null)?.paid_at),
  ].filter(Boolean) as string[];
  return days.length ? days.sort()[0] : null;
}

/** The backfill: every missing day from the first of the month of the first document to yesterday, oldest first, capped per call. */
export async function reconcileMissingDays(cap = 40): Promise<{ done: string[]; remaining: number; waitingForSync: number }> {
  const admin = createAdminClient();
  const first = await firstDocumentDay();
  if (!first) return { done: [], remaining: 0, waitingForSync: 0 };
  const start = `${first.slice(0, 7)}-01`;
  const yesterday = new Date(Date.now() + 4 * 3600 * 1000 - DAY).toISOString().slice(0, 10);
  const { data: haveRows } = await admin.from("zoho_reconciliation").select("day").gte("day", start);
  const have = new Set(((haveRows ?? []) as { day: string }[]).map((r) => String(r.day).slice(0, 10)));
  // Manual sync: the days whose documents still wait for Sync to Zoho are left for after the next sync.
  const unsent = await firstUnsentAt();
  const days: string[] = [];
  let waitingForSync = 0;
  for (let d = new Date(`${start}T00:00:00Z`); ; d = new Date(d.getTime() + DAY)) {
    const day = d.toISOString().slice(0, 10);
    if (day > yesterday) break;
    if (have.has(day)) continue;
    if (dayWaitsForSync(day, unsent)) waitingForSync++;
    else days.push(day);
  }
  const done: string[] = [];
  for (const day of days.slice(0, cap)) {
    await reconcileDay(day);
    done.push(day);
  }
  return { done, remaining: Math.max(0, days.length - done.length), waitingForSync };
}
