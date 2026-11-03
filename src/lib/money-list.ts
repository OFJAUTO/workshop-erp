/**
 * Invoices and payments: every job with money paid or owed (3 November 2026, section 4). THE rows' shape, THE filters
 * (chips), THE tiles and THE "collected" rule, in one pure module (no database), so a tile is always the sum of the list
 * it opens and the counts on the chips are the counts of the rows.
 *
 * A row is a job (its money now: the live proforma or tax invoice, or before it the approved total less every advance),
 * a customer's credit not allocated yet, or a pending charge with its own proforma.
 */
import type { MoneyInvoice, MoneyState } from "./money-steps";

export type MoneyRowKind = "job" | "credit" | "charge";

export type MoneyRowData = {
  kind: MoneyRowKind;
  /** The row's own key: the job id for a job, "credit:<customer id>", "charge:<entry id>". */
  key: string;
  /** Where the row opens: the money page, the customer's page (credit) or the pending charges list. */
  href: string;
  /** The job (job rows only; "" otherwise). */
  jobId: string;
  jobNumber: string;
  jobStatus: string;
  isOpen: boolean;
  plate: string;
  car: string;
  customer: string;
  customerId: string;
  pictureUrl: string | null;
  proforma: (MoneyInvoice & { total_aed: number }) | null;
  taxInvoice: (MoneyInvoice & { total_aed: number }) | null;
  /** The document a pending charge is billed on ("PRO-00012" or its tax invoice). */
  docNumber: string | null;
  /** The approved total incl. VAT (the live document's once there is one); null while nothing is approved. */
  total: number | null;
  /** Cleared money in so far: the live document's payments, or before it every advance on the job. */
  paid: number;
  /** What is still to pay; null while there is no total to measure against (and on credit rows). */
  balance: number | null;
  pendingCheque: number;
  /** What credit notes took off the live tax invoice (0 when none): the balance already counts it. */
  credited: number;
  /** A car that left paid in full, on the list without dates only for RECENT_PAID_DAYS (counts in no tile, not on the dashboard). */
  recentPaidOnly: boolean;
  /** Money in before any proforma or tax invoice (0 once a document stands). */
  advance: number;
  /** Money collected today on this row (the Collected today rule) and how many payments. */
  paidToday: number;
  paidTodayCount: number;
  /** Tax invoices issued today on this row (never a deposit's), by number. */
  taxToday: string[];
  state: MoneyState;
  /** When the live document was issued, and the last money movement, for sorting. */
  issuedAt: string;
  lastAt: string;
  paidAt: string | null;
  /** An advisor sent a payment to accounts that waits to be recorded: his first name (2 November 2026, section 3). */
  reportedBy: string | null;
  /** Credit rows: days since the oldest payment not allocated. Charge rows: what the charge is for. */
  ageDays: number;
  what: string | null;
};

export const MONEY_FILTERS = [
  { key: "", label: "All" },
  { key: "awaiting", label: "Awaiting payment" },
  { key: "says_paid", label: "Customer says paid / reported" },
  { key: "part", label: "Part paid" },
  { key: "advance", label: "Advance, no proforma yet" },
  { key: "today", label: "Collected today" },
  { key: "tax_today", label: "Tax invoices today" },
  { key: "credit", label: "Customer credit" },
  { key: "paid", label: "Paid" },
  { key: "proforma", label: "Proformas" },
  { key: "tax", label: "Tax invoices" },
  { key: "released", label: "Released" },
] as const;
export type MoneyFilterKey = (typeof MONEY_FILTERS)[number]["key"];

/**
 * The list with no dates (3 November 2026, review): money paid or owed now, and the cars that left paid in full in the
 * last RECENT_PAID_DAYS days (last money in, or their document, inside it), so Paid, Tax invoices and Released keep
 * the recent ones. They count in no tile (nothing owed, nothing today). Older ones: the search box or the dates.
 */
export const RECENT_PAID_DAYS = 30;
export const RECENT_PAID_HINT = `Without dates: money paid or owed now, and cars that left paid in full in the last ${RECENT_PAID_DAYS} days. For older ones, search or enter dates.`;

/** A car that left paid in full, still shown on the list without dates: its last money or its document is recent. */
export function recentlyPaid(lastAt: string | null, nowMs: number, days = RECENT_PAID_DAYS): boolean {
  return !!lastAt && Date.parse(lastAt) >= nowMs - days * 86400000;
}

/** A chip's count: rows, except "Tax invoices today", which counts the tax invoices (as its tile does). */
export function chipCountOf(key: string, rows: MoneyRowData[]): number {
  const list = rows.filter((r) => inFilter(key, r));
  return key === "tax_today" ? list.reduce((a, r) => a + r.taxToday.length, 0) : list.length;
}

const owes =(r: MoneyRowData) => r.kind !== "credit" && r.total !== null && r.balance !== null && r.balance > 0.005;

/** THE filter rules: one per chip, the same for the chips' counts, the lists and the tiles. */
export function inFilter(key: string, r: MoneyRowData): boolean {
  switch (key) {
    // Every balance due on approved work, whatever the step: in work, proforma to prepare or send, sent, part paid,
    // tax invoice unpaid, on credit terms, left owing, a pending charge.
    case "awaiting": return owes(r);
    case "says_paid": return !!r.proforma?.customer_says_paid_at || !!r.reportedBy;
    case "part": return owes(r) && r.paid > 0.005;
    case "advance": return r.kind === "job" && r.advance > 0.005;
    case "today": return r.paidToday > 0.005;
    case "tax_today": return r.taxToday.length > 0;
    case "credit": return r.kind === "credit";
    case "paid": return r.kind !== "credit" && r.total !== null && r.balance !== null && r.balance <= 0.005 && r.paid > 0.005;
    case "proforma": return !!r.proforma && !r.taxInvoice;
    case "tax": return !!r.taxInvoice;
    case "released": return r.kind === "job" && r.state.current === "released" && !r.isOpen;
    default: return true;
  }
}

/** Where an awaiting row stands, for the accounts dashboard's groups (due now first). */
export type AwaitingGroup = "due_now" | "to_send" | "wip_advance" | "wip_nothing";
export const AWAITING_GROUPS: { key: AwaitingGroup; label: string }[] = [
  { key: "due_now", label: "Due now: proforma or invoice sent" },
  { key: "to_send", label: "Proforma to send or prepare" },
  { key: "wip_advance", label: "In work, advance received" },
  { key: "wip_nothing", label: "In work, nothing paid" },
];

export function awaitingGroupOf(r: MoneyRowData): AwaitingGroup {
  // A pending charge has its proforma from the start; a car that left owes now; a sent document is due now.
  if (r.kind === "charge" || r.taxInvoice || r.proforma?.sent_at || !r.isOpen) return "due_now";
  if (r.proforma || ["ready", "pending_payment", "in_delivery"].includes(r.jobStatus)) return "to_send";
  return r.paid > 0.005 ? "wip_advance" : "wip_nothing";
}

export type MoneyListTiles = {
  awaitingCount: number;
  awaitingAed: number;
  /** Of it: the pending charges (bills of cars not in the workshop, each with its own proforma). */
  awaitingChargeCount: number;
  awaitingChargeAed: number;
  /** Of it: due now (a document sent, a car gone, a pending charge) and the rest (work in progress, proforma to send). */
  dueNowAed: number;
  wipAed: number;
  partCount: number;
  partAed: number;
  /** Rows with money in today, the money and the number of payments. */
  todayCount: number;
  todayAed: number;
  todayPayments: number;
  taxTodayCount: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** THE money tiles, from the rows themselves: each one is the sum of the list behind its link. */
export function moneyTilesOf(rows: MoneyRowData[]): MoneyListTiles {
  const awaiting = rows.filter((r) => inFilter("awaiting", r));
  const part = rows.filter((r) => inFilter("part", r));
  const today = rows.filter((r) => inFilter("today", r));
  const dueNow = awaiting.filter((r) => awaitingGroupOf(r) === "due_now");
  const sum = (list: MoneyRowData[], f: (r: MoneyRowData) => number) => r2(list.reduce((a, r) => a + f(r), 0));
  const awaitingAed = sum(awaiting, (r) => r.balance ?? 0);
  const dueNowAed = sum(dueNow, (r) => r.balance ?? 0);
  const charges = awaiting.filter((r) => r.kind === "charge");
  return {
    awaitingCount: awaiting.length,
    awaitingAed,
    awaitingChargeCount: charges.length,
    awaitingChargeAed: sum(charges, (r) => r.balance ?? 0),
    dueNowAed,
    wipAed: r2(awaitingAed - dueNowAed),
    partCount: part.length,
    partAed: sum(part, (r) => r.balance ?? 0),
    todayCount: today.length,
    todayAed: sum(today, (r) => r.paidToday),
    todayPayments: today.reduce((a, r) => a + r.paidTodayCount, 0),
    taxTodayCount: rows.reduce((a, r) => a + r.taxToday.length, 0),
  };
}

/** A credit note as `creditTakenOff` reads it. */
export type CreditNoteFacts = { kind: string; status: string; is_active?: boolean | null; credit_of: string | null; total_aed: number | string; refund_amount_aed?: number | string | null; refund_paid_at?: string | null };

/**
 * THE credit-note rule (3 November 2026): what the issued credit notes of a tax invoice take off what the customer still
 * owes on it - each one's total with VAT, less what of it was paid back to the customer in money (a refund settles the
 * credit instead of the invoice). Read by the job money rule, the money list, the money and invoice pages and settling.
 */
export function creditTakenOff(docId: string, notes: CreditNoteFacts[]): number {
  return r2(
    notes
      .filter((c) => c.kind === "credit_note" && c.status === "issued" && c.is_active !== false && c.credit_of === docId)
      .reduce((a, c) => a + Math.max(0, Number(c.total_aed) - (c.refund_paid_at ? Number(c.refund_amount_aed ?? 0) : 0)), 0),
  );
}

/** A payment as the collected rule reads it. */
export type CollectedPayment = { status: string; is_active?: boolean | null; method: string; cheque_status: string | null; received_at: string; cleared_at: string | null };

/**
 * When money counts as collected (rule B, 3 November 2026, the same as the Zoho daily reconciliation): a recorded
 * payment on the day it was received; a cheque only once cleared, on the day it cleared. Null = not collected (yet).
 */
export function collectedAt(p: CollectedPayment): string | null {
  if (p.status !== "recorded" || p.is_active === false) return null;
  if (p.method === "cheque") return p.cheque_status === "cleared" ? (p.cleared_at ?? p.received_at) : null;
  return p.received_at;
}

/** THE collected rule: counted between two instants (from included, to excluded; no end = up to now). */
export function countsAsCollected(p: CollectedPayment, fromIso: string, toIso?: string | null): boolean {
  const at = collectedAt(p);
  if (!at) return false;
  const t = Date.parse(at);
  return t >= Date.parse(fromIso) && (!toIso || t < Date.parse(toIso));
}

/** The search box: plate, job number, customer, car, the documents' numbers. */
export function rowMatches(r: MoneyRowData, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  const compact = n.replace(/[^a-z0-9]/g, "");
  return [r.plate, r.jobNumber, r.customer, r.car, r.proforma?.number, r.taxInvoice?.number, r.docNumber, r.what].some((v) => {
    const s = (v ?? "").toLowerCase();
    return s.includes(n) || (!!compact && compact.length >= 3 && s.replace(/[^a-z0-9]/g, "").includes(compact));
  });
}

/**
 * "Paid so far AED 30,000.00 · Balance AED 7,930.00", "Paid in full", "No approved total yet": the one wording. A credit
 * note on the tax invoice reads "credit note AED 1,050.00 off" (3 November 2026), so a balance below the total less the
 * money paid is never a mystery.
 */
export function paidSoFarParts(m: { total: number | null; paid: number; balance: number | null; pendingCheque?: number; credited?: number }): { total: string | null; paid: string; balance: string | null; balanceTone: "due" | "paid" | null; cheque: string | null; credit: string | null } {
  const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return {
    total: m.total !== null ? `Total ${aed(m.total)}` : null,
    paid: `Paid so far ${aed(m.paid)}`,
    balance: m.balance === null ? (m.total === null ? "No approved total yet" : null) : m.balance > 0.005 ? `Balance ${aed(m.balance)}` : "Paid in full",
    balanceTone: m.balance === null ? null : m.balance > 0.005 ? "due" : "paid",
    cheque: m.pendingCheque ? `cheque ${aed(m.pendingCheque)} clearing` : null,
    credit: m.credited && m.credited > 0.005 ? `credit note ${aed(m.credited)} off` : null,
  };
}
