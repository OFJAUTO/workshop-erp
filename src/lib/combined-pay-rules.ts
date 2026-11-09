/*
 * ONE PAYMENT FOR SEVERAL CARS, THE RULES (9 November 2026, Section 3; AL ALI PROPERTY INVESTMENTS LLC paid two Corollas
 * with ONE cheque, Emirates NBD 019383, AED 4,368.00). Pure, no imports.
 * - Receive payment from the customer: the one amount is spread over their open proformas and invoices OLDEST FIRST
 *   (accounts may change each share); what is left over becomes an advance on the customer.
 * - Each car's share is a receipt that says "Part of cheque 019383 (AED 4,368.00 total)".
 */

export type OpenDoc = { invoiceId: string; number: string; issuedAt: string | null; due: number };
export type Share = { invoiceId: string; amount: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
const m = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The payment spread over the open documents, oldest first; the rest is left over (an advance). */
export function splitPayment(amount: number, docs: OpenDoc[]): { shares: Share[]; leftover: number } {
  let left = r2(Math.max(0, amount));
  const shares: Share[] = [];
  const sorted = [...docs].sort((a, b) => String(a.issuedAt ?? "9999").localeCompare(String(b.issuedAt ?? "9999")) || a.number.localeCompare(b.number));
  for (const d of sorted) {
    if (left <= 0.004) break;
    const due = r2(Math.max(0, d.due));
    if (due <= 0.004) continue;
    const take = r2(Math.min(due, left));
    shares.push({ invoiceId: d.invoiceId, amount: take });
    left = r2(left - take);
  }
  return { shares, leftover: r2(left) };
}

/** A typed spread: never more on a document than it owes, never more in total than the payment. Null = fine. */
export function checkShares(amount: number, shares: Share[], docs: OpenDoc[]): string | null {
  if (!(amount > 0)) return "Type the amount received.";
  const byId = new Map(docs.map((d) => [d.invoiceId, d]));
  for (const s of shares) {
    const d = byId.get(s.invoiceId);
    if (!d) return "One of the documents is no longer open. Reload the page.";
    if (!(s.amount > 0)) return `${d.number}: the amount must be above zero (or leave it out).`;
    if (s.amount > d.due + 0.004) return `${d.number} owes AED ${m(d.due)}: not more than that on it (the rest becomes an advance).`;
  }
  const total = r2(shares.reduce((a, s) => a + s.amount, 0));
  if (total > amount + 0.004) return `The shares come to AED ${m(total)}, more than the AED ${m(amount)} received.`;
  return null;
}

/** "cheque 019383" / "transfer TT123" / "card payment": what the one payment was. */
export function payWhat(method: string, chequeNumber?: string | null, reference?: string | null): string {
  if (method === "cheque") return `cheque ${chequeNumber ?? ""}`.trim();
  if (method === "transfer") return `transfer${reference ? ` ${reference}` : ""}`;
  if (method === "card") return "card payment";
  if (method === "link") return "payment link";
  return "cash payment";
}

/** On each car's receipt: "Part of cheque 019383 (AED 4,368.00 total)". */
export function partOfWords(method: string, total: number, chequeNumber?: string | null, reference?: string | null): string {
  return `Part of ${payWhat(method, chequeNumber, reference)} (AED ${m(total)} total)`;
}

/** What the window says under the shares. */
export function leftoverWords(leftover: number): string | null {
  return leftover > 0.004 ? `AED ${m(leftover)} left over becomes an advance on the customer's account.` : null;
}
