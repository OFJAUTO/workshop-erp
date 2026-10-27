import "server-only";
import { clearingOpenAt, loadUnsettled } from "@/lib/card-settlements";
import { payableCommissions } from "@/lib/commissions";
import { PAYMENT_SELECT, invoiceBalance, toPayment, type PaymentRow } from "@/lib/invoice-data";
import { round2 } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { zohoBooksNow, zohoTestOrgId } from "@/lib/zoho";
import { reconOrgFor, type ReconDetails } from "@/lib/zoho-reconcile";
import { billErpFigures, pageAll, poForZoho } from "@/lib/zoho-sync";

/**
 * The monthly close (phase 4): everything Mathew ticks before calling a month done, each line green or red.
 * The per-method month totals come from the STORED daily reconciliation rows (the same figures the daily check
 * proved), so closing a month needs no new Zoho calls — only full day coverage.
 */

export type CloseLine = { key: string; label: string; ok: boolean; detail: string; amount?: number };
export type CloseData = {
  month: string;
  lines: CloseLine[];
  byMode: Record<string, { erp: number; zoho: number; ok: boolean }>;
  daysCovered: number;
  daysInMonth: number;
  unpaidInvoices: { number: string; total: number; balance: number }[];
  unpaidBills: { lpo: string; supplier: string; invoice: string; amount: number }[];
};

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

/** PURE: a real month (2026-10, never 2026-13 or 2026-00). */
export function validMonth(month: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return !!m && Number(m[1]) >= 2000 && Number(m[1]) <= 2100 && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

export async function loadMonthlyClose(month: string): Promise<CloseData> {
  if (!validMonth(month)) throw new Error(`"${month}" is not a month: pick one as yyyy-mm.`);
  const admin = createAdminClient();
  const monthStart = `${month}-01`;
  const nextMonth = new Date(new Date(`${monthStart}T00:00:00Z`).getTime());
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const monthEnd = nextMonth.toISOString().slice(0, 10);
  const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
  const lastDay = monthEnd <= today ? monthEnd : today;
  const daysInMonth = Math.round((Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${monthStart}T00:00:00Z`)) / 86400000);
  const lines: CloseLine[] = [];

  // 1. Per-method totals, summed from the stored daily reconciliation.
  const { data: reconRows } = await admin.from("zoho_reconciliation").select("day, status, details").gte("day", monthStart).lt("day", monthEnd);
  // A day counts only when it was compared with the book that OWNS it (a row checked against OFJ TEST for a day the
  // REAL book owns proves nothing about the REAL book). Rows from before the book was recorded were all OFJ TEST.
  const [books, settings, testOrg] = await Promise.all([zohoBooksNow(), getSettings(), zohoTestOrgId()]);
  const ownerOf = (day: string) => reconOrgFor(day, books.live || books.wentLive, String(settings.zoho_golive_start_date ?? ""), testOrg);
  const allRows = ((reconRows ?? []) as { day: string; status: string; details: ReconDetails }[]).map((r) => ({ ...r, day: String(r.day).slice(0, 10) }));
  const recon = allRows.filter((r) => (r.details?.org ?? testOrg) === ownerOf(r.day));
  const otherBook = allRows.filter((r) => !recon.includes(r)).map((r) => r.day);
  const byMode: Record<string, { erp: number; zoho: number; ok: boolean }> = {};
  for (const r of recon) {
    for (const [mode, m] of Object.entries(r.details?.paymentsByMode ?? {})) {
      const cur = byMode[mode] ?? { erp: 0, zoho: 0, ok: true };
      byMode[mode] = { erp: round2(cur.erp + m.erp), zoho: round2(cur.zoho + m.zoho), ok: cur.ok && m.ok };
    }
  }
  const daysCovered = recon.length;
  const redDays = recon.filter((r) => r.status !== "green").map((r) => r.day);
  lines.push({
    key: "days",
    label: "Every day of the month reconciled, all green",
    ok: daysCovered >= daysInMonth && !redDays.length,
    detail: daysCovered < daysInMonth ? `${daysCovered} of ${daysInMonth} day${daysInMonth === 1 ? "" : "s"} checked — backfill on the Reconciliation page${otherBook.length ? ` (${otherBook.join(", ")} were compared with the other book: press Re-check)` : ""}.` : redDays.length ? `Red: ${redDays.join(", ")}` : `${daysCovered} day${daysCovered === 1 ? "" : "s"}, all green.`,
  });
  const modesOk = Object.values(byMode).every((m) => m.ok);
  lines.push({
    key: "methods",
    label: "Month totals per method match Zoho (cash, card, link, bank, cheque)",
    ok: daysCovered >= daysInMonth && modesOk,
    detail: Object.entries(byMode).map(([mode, m]) => `${mode}: ${aed(m.erp)}${m.ok ? " ✓" : ` vs ${aed(m.zoho)} in Zoho`}`).join(" · ") || "No payments this month.",
  });

  // 2. Unpaid tax invoices, as of now.
  // Every row, page by page: PostgREST answers at most 1,000 rows, and a silently shorter list would read "all paid".
  const invoices = await pageAll<{ id: string; number: string; total_aed: number }>((a, b) =>
    admin.from("invoices").select("id, number, total_aed").eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true).is("deposit_for_quotation_id", null).order("id").range(a, b),
  );
  const payRaw = await pageAll<Record<string, unknown>>((a, b) => admin.from("payments").select(PAYMENT_SELECT).not("invoice_id", "is", null).eq("is_active", true).order("id").range(a, b));
  const paysByInvoice = new Map<string, PaymentRow[]>();
  for (const raw of payRaw) {
    const p = toPayment(raw) as PaymentRow;
    if (!p.invoice_id) continue;
    paysByInvoice.set(p.invoice_id, [...(paysByInvoice.get(p.invoice_id) ?? []), p]);
  }
  const unpaidInvoices: CloseData["unpaidInvoices"] = [];
  for (const inv of invoices) {
    const bal = invoiceBalance({ total_aed: Number(inv.total_aed) }, paysByInvoice.get(inv.id) ?? []);
    if (bal.balance > 0.005) unpaidInvoices.push({ number: inv.number, total: Number(inv.total_aed), balance: bal.balance });
  }
  lines.push({
    key: "unpaid_invoices",
    label: "Unpaid tax invoices",
    ok: unpaidInvoices.length === 0,
    detail: unpaidInvoices.length ? `${unpaidInvoices.length}: ${unpaidInvoices.map((i) => `${i.number} (${aed(i.balance)})`).join(", ").slice(0, 300)}` : "Everything issued is paid.",
    amount: round2(unpaidInvoices.reduce((a, i) => a + i.balance, 0)),
  });

  // 3. Deposits held on open jobs (money received before the tax invoice).
  const depRaw = await pageAll<Record<string, unknown>>((a, b) => admin.from("payments").select("id, amount_aed, method, cheque_status, job:jobs!payments_job_id_fkey(is_open)").eq("is_deposit", true).eq("status", "recorded").eq("is_active", true).order("id").range(a, b));
  const heldRows = (depRaw as unknown as { amount_aed: number; method: string; cheque_status: string | null; job: { is_open: boolean } | null }[]).filter((p) => p.job?.is_open && (p.method !== "cheque" || p.cheque_status === "cleared"));
  lines.push({
    key: "deposits_held",
    label: "Deposits held on open jobs",
    ok: true,
    detail: heldRows.length ? `${heldRows.length} deposit${heldRows.length === 1 ? "" : "s"} · ${aed(round2(heldRows.reduce((a, p) => a + Number(p.amount_aed), 0)))} (informational — they settle into the final invoices).` : "None.",
    amount: round2(heldRows.reduce((a, p) => a + Number(p.amount_aed), 0)),
  });

  // 4. Supplier bills unpaid.
  const poRaw = await pageAll<Record<string, unknown>>((a, b) =>
    admin.from("purchase_orders").select("id, number, supplier_name, supplier_invoice_number").neq("kind", "main").eq("is_active", true).eq("supplier_invoice_status", "received").not("supplier_invoice_number", "is", null).is("supplier_paid_at", null).order("id").range(a, b),
  );
  const unpaidPos = (poRaw as unknown as { id: string; number: string; supplier_name: string; supplier_invoice_number: string }[]).filter((p) => !/^our stock$/i.test(p.supplier_name.trim()));
  const unpaidBills: CloseData["unpaidBills"] = [];
  for (const p of unpaidPos) {
    const gross = (await billErpFigures(await poForZoho(p.id))).gross;
    unpaidBills.push({ lpo: p.number, supplier: p.supplier_name, invoice: p.supplier_invoice_number, amount: gross });
  }
  lines.push({
    key: "unpaid_bills",
    label: "Supplier bills unpaid",
    ok: unpaidBills.length === 0,
    detail: unpaidBills.length ? `${unpaidBills.length}: ${unpaidBills.map((b) => `${b.supplier} ${b.invoice} (${aed(b.amount)})`).join(", ").slice(0, 300)}` : "Every entered invoice is paid.",
    amount: round2(unpaidBills.reduce((a, b) => a + b.amount, 0)),
  });

  // 5. Commissions unpaid (approved, customer settled, voucher not yet paid).
  const payable = await payableCommissions();
  lines.push({
    key: "commissions",
    label: "Commissions unpaid",
    ok: payable.length === 0,
    detail: payable.length ? `${payable.length} waiting: ${payable.map((c) => `${c.recipient} (${aed(c.amount)})`).join(", ").slice(0, 300)}` : "Nothing waiting.",
    amount: round2(payable.reduce((a, c) => a + c.amount, 0)),
  });

  // 6. Recovery: the month's trips all approved/paid and each driver's month marked paid.
  const tripRaw = await pageAll<Record<string, unknown>>((a, b) => admin.from("recovery_trips").select("id, company, driver_name, status, delivered_at, created_at, price_aed").eq("is_active", true).order("id").range(a, b));
  const whoOf = (t: { company: string | null; driver_name: string | null }) => t.company ?? (t.driver_name ? `Our truck · ${t.driver_name}` : "Our truck");
  const inMonth = ((tripRaw as unknown) as { company: string | null; driver_name: string | null; status: string; delivered_at: string | null; created_at: string; price_aed: number | null }[]).filter((t) => String(t.delivered_at ?? t.created_at).slice(0, 7) === month);
  const byWho = new Map<string, { open: number; total: number }>();
  for (const t of inMonth) {
    const g = byWho.get(whoOf(t)) ?? { open: 0, total: 0 };
    if (t.status !== "approved" && t.status !== "paid") g.open++;
    g.total = round2(g.total + (Number(t.price_aed) || 0));
    byWho.set(whoOf(t), g);
  }
  const { data: payouts } = await admin.from("recovery_payouts").select("who").eq("month", month);
  const paidWho = new Set(((payouts ?? []) as { who: string }[]).map((p) => p.who));
  const openWho = [...byWho.entries()].filter(([who, g]) => g.open > 0 || (g.total > 0 && !paidWho.has(who)));
  lines.push({
    key: "recovery",
    label: "Recovery month settled (every driver/company paid)",
    ok: byWho.size === 0 || openWho.length === 0,
    detail: openWho.length ? `Open: ${openWho.map(([who, g]) => `${who} (${g.open ? `${g.open} trip${g.open === 1 ? "" : "s"} not approved` : "month not marked paid"})`).join(", ")}` : byWho.size ? "Every month is marked paid." : "No trips this month.",
  });

  // 6b. Card and payment-link clearing: every payment of the month paid out by the bank (the clearing returns to zero).
  const lastOfMonth = new Date(Date.parse(`${monthEnd}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const [atEnd, unsettledNow] = await Promise.all([clearingOpenAt(lastOfMonth), loadUnsettled()]);
  const dayOf = (iso: string) => new Date(Date.parse(iso) + 4 * 3600 * 1000).toISOString().slice(0, 10);
  const stillOpen = unsettledNow.filter((p) => dayOf(p.receivedAt) < monthEnd);
  const endTotal = round2(atEnd.card.total + atEnd.link.total);
  lines.push({
    key: "card_clearing",
    label: "Card and payment-link clearing settled",
    ok: stillOpen.length === 0,
    amount: round2(stillOpen.reduce((a, p) => a + p.amount, 0)),
    detail: stillOpen.length
      ? `${stillOpen.length} payment${stillOpen.length === 1 ? "" : "s"} (${aed(round2(stillOpen.reduce((a, p) => a + p.amount, 0)))}) still not settled by the bank: record them on Card settlements.`
      : endTotal > 0 ? `${aed(endTotal)} was in clearing at month end; every payment is settled since.` : "Clearing was at zero at month end.",
  });

  // 7. "Invoice to follow" still open.
  const { count: toFollow } = await admin.from("purchase_orders").select("id", { count: "exact", head: true }).eq("supplier_invoice_status", "to_follow").eq("is_active", true).neq("status", "cancelled");
  lines.push({ key: "to_follow", label: '"Invoice to follow" still open', ok: (toFollow ?? 0) === 0, detail: toFollow ? `${toFollow} LPO${toFollow === 1 ? "" : "s"} still wait for the supplier's paper.` : "None." });

  // 8. Failed syncs = 0.
  const { count: failed } = await admin.from("zoho_outbox").select("id", { count: "exact", head: true }).eq("status", "failed");
  lines.push({ key: "failed", label: "Failed syncs", ok: (failed ?? 0) === 0, detail: failed ? `${failed} red row${failed === 1 ? "" : "s"} on the sync page.` : "The queue is clean." });

  return { month, lines, byMode, daysCovered, daysInMonth, unpaidInvoices, unpaidBills };
}
