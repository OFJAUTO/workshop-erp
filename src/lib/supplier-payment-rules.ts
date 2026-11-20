/**
 * SUPPLIER PAYMENTS, THE RULES (6 November 2026, Section 4, Mathew). Pure.
 * - One payment can settle several invoices of the same supplier: it is spread oldest first (accounts may change it).
 * - Paid less than the invoices: the last one is part paid ("Part paid · balance AED X").
 * - Paid more: the rest is an ADVANCE with the supplier (default; offered on that supplier's next invoice) or a FEE /
 *   charge (an expense, e.g. a payment-link surcharge). Never silently.
 * - THE supplier balance = invoices − what the payments put on them; an advance not used yet is shown on its own.
 */

export const SUPPLIER_PAY_METHOD_KEYS = ["transfer", "card", "cash", "cheque", "link"] as const;
export type SupplierPayMethod = (typeof SUPPLIER_PAY_METHOD_KEYS)[number];
export const SUPPLIER_PAY_METHOD_LABELS: Record<SupplierPayMethod, string> = { transfer: "Bank transfer", card: "Card", cash: "Cash", cheque: "Cheque", link: "Payment link" };

export type OpenInvoice = { poId: string; label: string; date: string | null; due: number };
export type Allocation = { poId: string; amount: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The payment spread over the invoices, oldest first. What is left over is the excess. */
export function splitOldestFirst(amount: number, invoices: OpenInvoice[]): { lines: Allocation[]; excess: number } {
  let left = r2(Math.max(0, amount));
  const lines: Allocation[] = [];
  const sorted = [...invoices].sort((a, b) => String(a.date ?? "9999").localeCompare(String(b.date ?? "9999")) || a.label.localeCompare(b.label));
  for (const inv of sorted) {
    if (left <= 0.004) break;
    const due = r2(Math.max(0, inv.due));
    if (due <= 0.004) continue;
    const take = r2(Math.min(due, left));
    lines.push({ poId: inv.poId, amount: take });
    left = r2(left - take);
  }
  return { lines, excess: r2(left) };
}

/** A typed spread is checked: never more on an invoice than it owes, never more in total than the payment. */
export function checkAllocations(amount: number, lines: Allocation[], invoices: OpenInvoice[]): string | null {
  if (!(amount > 0)) return "Type the amount paid.";
  const dueOf = new Map(invoices.map((i) => [i.poId, i.due]));
  for (const l of lines) {
    if (!(l.amount > 0)) return "Each invoice needs an amount above zero (or untick it).";
    const due = dueOf.get(l.poId);
    if (due === undefined) return "One of the invoices is no longer open.";
    if (l.amount > due + 0.004) return `AED ${l.amount.toFixed(2)} is more than that invoice still owes (AED ${due.toFixed(2)}).`;
  }
  const put = r2(lines.reduce((a, l) => a + l.amount, 0));
  if (put > amount + 0.004) return `The invoices take AED ${put.toFixed(2)}, more than the AED ${amount.toFixed(2)} paid.`;
  return null;
}

/** What one invoice shows after the payments: paid, part paid with the balance, or still to pay. */
/* ROUNDING ON SUPPLIER PAYMENTS (20 November 2026, Section 3; LPO-00111-2: AED 243.60 invoiced, 243.50 paid in cash).
 * The invoice is never changed. A payment that pays an invoice short says what the difference is (nothing picked):
 * ROUNDING closes it (up to the limit, AED 1.00 by default), STILL OWED leaves it open, a DISCOUNT FROM THE SUPPLIER
 * closes it with a reason. Above the limit rounding is greyed: discount or still owed, with a reason. */
export type DifferenceKind = "rounding" | "owed" | "discount";
export const DIFFERENCE_KINDS: DifferenceKind[] = ["rounding", "owed", "discount"];
export const DIFFERENCE_LABELS: Record<DifferenceKind, string> = { rounding: "ROUNDING", owed: "STILL OWED", discount: "DISCOUNT FROM THE SUPPLIER" };
export const DEFAULT_ROUNDING_LIMIT = 1;

export function differenceChoices(diff: number, limit: number): { key: DifferenceKind; label: string; help: string; allowed: boolean; why: string | null; needsReason: boolean }[] {
  const d = r2(diff);
  const over = d > limit + 0.004;
  return [
    { key: "rounding", label: DIFFERENCE_LABELS.rounding, help: `AED ${d.toFixed(2)} closes the invoice as rounding (booked to the rounding account).`, allowed: !over, why: over ? `More than the rounding limit (AED ${limit.toFixed(2)}): a discount or still owed.` : null, needsReason: false },
    { key: "owed", label: DIFFERENCE_LABELS.owed, help: `AED ${d.toFixed(2)} stays open on the invoice, to pay later.`, allowed: true, why: null, needsReason: over },
    { key: "discount", label: DIFFERENCE_LABELS.discount, help: `The supplier gave AED ${d.toFixed(2)} off: the invoice closes, the discount is booked.`, allowed: true, why: null, needsReason: true },
  ];
}

/** The server's check of the choice: null when it may be saved. */
export function checkDifference(kind: string, diff: number, limit: number, reason: string): string | null {
  const c = differenceChoices(diff, limit).find((x) => x.key === kind);
  if (!(diff > 0.004)) return "There is no difference on that invoice.";
  if (!c) return "Say what the difference is: rounding, still owed, or a discount from the supplier.";
  if (!c.allowed) return c.why;
  if (c.needsReason && reason.trim().length < 5) return `Write why (${c.label.toLowerCase()}, 5 characters at least).`;
  return null;
}

export function invoicePaidWords(due: number, paid: number): { state: "paid" | "part" | "open"; words: string } {
  const left = r2(due - paid);
  if (left <= 0.004) return { state: "paid", words: "Paid" };
  if (paid > 0.004) return { state: "part", words: `Part paid · balance AED ${left.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` };
  return { state: "open", words: "To pay" };
}

/** A payment's advance still unused: what it paid minus what its lines put on invoices minus its fee. */
export function advanceLeft(p: { amount: number; excessKind: string | null; fee: number; status: string }, linesTotal: number): number {
  if (p.status !== "recorded" || p.excessKind !== "advance") return 0;
  return r2(Math.max(0, p.amount - p.fee - linesTotal));
}

export function advanceWords(supplier: string, amount: number): string {
  return `Advance with ${supplier} AED ${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ---------------------------------------------------------------------------------------------- */
/* APPLY AN ADVANCE WITHOUT A NEW PAYMENT (11 November 2026, Section 3, Mathew: GARGASH advances).  */
/* Accounts tick invoices and advances and say how much of each advance goes on each invoice. One   */
/* advance may be split over several invoices; several advances may go on one invoice. Only what   */
/* the advances leave unpaid needs a new payment (amount and method).                              */
/* ---------------------------------------------------------------------------------------------- */

export type AdvanceHeld = { paymentId: string; number: string; left: number; /** The LPOs its earlier lines touched (the likely invoice is on the same LPO). */ poIds?: string[] };
export type AdvanceUse = { paymentId: string; poId: string; amount: number };

/** The invoice an advance most likely belongs to: one on the same LPO, else the one whose due is closest to what is left. */
export function likelyInvoiceOf(adv: AdvanceHeld, invoices: { poId: string; due: number }[]): string | null {
  const open = invoices.filter((i) => i.due > 0.004);
  if (!open.length) return null;
  const sameLpo = open.find((i) => (adv.poIds ?? []).includes(i.poId.split("~")[0]));
  if (sameLpo) return sameLpo.poId;
  return [...open].sort((a, b) => Math.abs(a.due - adv.left) - Math.abs(b.due - adv.left))[0].poId;
}

/**
 * THE suggestion: each ticked advance goes first on its likely invoice, then on the other ticked invoices oldest first,
 * never more than an invoice still owes after the advances before it, never more than the advance holds.
 */
export function suggestAdvanceUses(advances: AdvanceHeld[], invoices: { poId: string; due: number; date?: string | null }[]): AdvanceUse[] {
  const owed = new Map(invoices.map((i) => [i.poId, r2(i.due)]));
  const byDate = [...invoices].sort((a, b) => String(a.date ?? "9999").localeCompare(String(b.date ?? "9999")));
  const out: AdvanceUse[] = [];
  for (const a of advances) {
    let left = r2(a.left);
    const likely = likelyInvoiceOf(a, invoices.map((i) => ({ poId: i.poId, due: owed.get(i.poId) ?? 0 })));
    const order = [...(likely ? [likely] : []), ...byDate.map((i) => i.poId).filter((id) => id !== likely)];
    for (const poId of order) {
      if (left <= 0.004) break;
      const due = owed.get(poId) ?? 0;
      if (due <= 0.004) continue;
      const take = r2(Math.min(due, left));
      out.push({ paymentId: a.paymentId, poId, amount: take });
      owed.set(poId, r2(due - take));
      left = r2(left - take);
    }
  }
  return out;
}

/** What is still left on each advance after the uses typed so far. */
export function advanceLeftAfter(advances: AdvanceHeld[], uses: AdvanceUse[]): Map<string, number> {
  const m = new Map(advances.map((a) => [a.paymentId, r2(a.left)]));
  for (const u of uses) m.set(u.paymentId, r2((m.get(u.paymentId) ?? 0) - u.amount));
  return m;
}

/** The typed uses checked: never more than an advance holds, never more on an invoice than it owes (with any new payment on it). */
export function checkAdvanceUses(uses: AdvanceUse[], advances: AdvanceHeld[], invoices: { poId: string; due: number }[], newOn: Allocation[] = []): string | null {
  const known = new Map(advances.map((a) => [a.paymentId, a]));
  for (const u of uses) {
    if (!(u.amount > 0)) return "Each advance line needs an amount above zero (or untick the advance).";
    if (!known.has(u.paymentId)) return "One of the advances is no longer held.";
  }
  for (const [id, left] of advanceLeftAfter(advances, uses)) if (left < -0.004) return `More than ${known.get(id)?.number ?? "the advance"} holds (AED ${r2(known.get(id)?.left ?? 0).toFixed(2)}).`;
  const dueOf = new Map(invoices.map((i) => [i.poId, i.due]));
  const onInv = new Map<string, number>();
  for (const u of uses) onInv.set(u.poId, r2((onInv.get(u.poId) ?? 0) + u.amount));
  for (const l of newOn) onInv.set(l.poId, r2((onInv.get(l.poId) ?? 0) + l.amount));
  for (const [poId, put] of onInv) {
    const due = dueOf.get(poId);
    if (due === undefined) return "One of the invoices is no longer open.";
    if (put > due + 0.004) return `AED ${put.toFixed(2)} on one invoice is more than it still owes (AED ${due.toFixed(2)}).`;
  }
  return null;
}

/** "Left on this advance: AED 570.94" */
export const advanceLeftWords = (left: number) => `Left on this advance: AED ${Math.max(0, left).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * THE supplier invoice date check (11 November 2026, Section 3): a date in the future, or long before the LPO's own
 * date (likely the day and month swapped: 2026-05-11 typed for 5 November). Words, or null when it looks right.
 */
export const INVOICE_DATE_BEFORE_LPO_DAYS = 45;
export function invoiceDateWarning(invoiceDate: string | null | undefined, lpoDate: string | null | undefined, today: string): string | null {
  if (!invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return null;
  const d = invoiceDate.slice(0, 10);
  const swapped = (() => {
    const [y, m, dd] = d.split("-").map(Number);
    if (dd > 12 || m === dd) return null;
    const alt = `${y}-${String(dd).padStart(2, "0")}-${String(m).padStart(2, "0")}`;
    return alt;
  })();
  const fmt = (x: string) => new Date(`${x}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const hint = (alt: string | null) => (alt && alt <= today && (!lpoDate || Math.abs(daysBetween(alt, lpoDate.slice(0, 10))) <= INVOICE_DATE_BEFORE_LPO_DAYS) ? ` Did you mean ${fmt(alt)}? (day and month swapped)` : "");
  if (d > today) return `The invoice date ${fmt(d)} is in the future.${hint(swapped)}`;
  // 20 November 2026 (Section 3, LPO-00111-2): ANY invoice dated before its LPO is flagged (it never blocks).
  if (lpoDate && daysBetween(d, lpoDate.slice(0, 10)) < 0) return `The invoice date ${fmt(d)} is ${Math.round(-daysBetween(d, lpoDate.slice(0, 10)))} day${Math.round(-daysBetween(d, lpoDate.slice(0, 10))) === 1 ? "" : "s"} before the LPO (${fmt(lpoDate.slice(0, 10))}).${hint(swapped)}`;
  return null;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
}
