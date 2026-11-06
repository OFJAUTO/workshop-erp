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
