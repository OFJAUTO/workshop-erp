/**
 * THE money rows of every customer document (31 October 2026, the owner's mockup): every amount is printed ONCE.
 * Pure: the quotation, estimate, additional quotation/estimate, proforma, tax invoice and credit note PDFs read it, and
 * so do the tests.
 *
 * - A section's subtotal only when the section has 2 or more lines AND the document has 2 or more sections (with one
 *   section the totals box carries the sum).
 * - "Subtotal" (before the discounts) only when there is a discount or round-off and 2 or more lines.
 * - "Subtotal before VAT" when there are 2 or more lines, or a discount/round-off changed the figure - and always on a
 *   tax invoice or credit note (the taxable amount is a UAE tax invoice field; docs/tax-invoice-fields-note.md).
 * - ONE total, "TOTAL INCL. VAT". After it only different numbers: the deposit asked, the payments, the balance due.
 */

export type DocSectionCount = { key: string; lines: number };
export type MoneyRow = { label: string; value: number; kind: "plain" | "green" | "net" | "vat" | "total" | "after" | "paid" | "balance" };

export function sectionSubtotalShown(sections: DocSectionCount[], key: string): boolean {
  const live = sections.filter((s) => s.lines > 0);
  const s = live.find((x) => x.key === key);
  return !!s && s.lines >= 2 && live.length >= 2;
}

export function docMoneyRows(input: {
  sections: DocSectionCount[];
  /** The sum of the amounts printed on the lines (packages at their price). */
  gross: number;
  /** Taken off after the lines: package discounts, the labour discount, warranty credit, the round-off down. */
  green: { label: string; value: number }[];
  /** A round-off UP (added before VAT). */
  roundUp?: number;
  net: number;
  vatPercent: number;
  vat: number;
  total: number;
  /** A tax invoice or a credit note: the taxable amount is always printed. */
  taxDocument?: boolean;
  totalLabel?: string;
  /** Rows after the total: "Deposit required", the payments ("Paid (RCT-00036)"). */
  after?: { label: string; value: number; kind?: "after" | "paid" }[];
  /** The balance still due on an invoice (printed when anything was paid). */
  balance?: number | null;
}): MoneyRow[] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const lines = input.sections.reduce((a, s) => a + Math.max(0, s.lines), 0);
  const green = input.green.filter((g) => Math.abs(g.value) > 0.004);
  const roundUp = r2(Math.max(0, input.roundUp ?? 0));
  const adjusted = green.length > 0 || roundUp > 0;
  const rows: MoneyRow[] = [];
  if (adjusted && lines >= 2) rows.push({ label: "Subtotal", value: r2(input.gross), kind: "plain" });
  for (const g of green) rows.push({ label: g.label, value: r2(Math.abs(g.value)), kind: "green" });
  if (roundUp > 0) rows.push({ label: "Rounding", value: roundUp, kind: "plain" });
  if (adjusted || lines >= 2 || input.taxDocument) rows.push({ label: "Subtotal before VAT", value: r2(input.net), kind: "net" });
  rows.push({ label: `VAT ${Number.isInteger(input.vatPercent) ? input.vatPercent : input.vatPercent.toFixed(2)}%`, value: r2(input.vat), kind: "vat" });
  rows.push({ label: input.totalLabel ?? "Total incl. VAT", value: r2(input.total), kind: "total" });
  for (const a of input.after ?? []) if (Math.abs(a.value) > 0.004) rows.push({ label: a.label, value: r2(Math.abs(a.value)), kind: a.kind ?? "after" });
  const paid = (input.after ?? []).some((a) => a.kind === "paid" && Math.abs(a.value) > 0.004);
  if (paid && input.balance !== null && input.balance !== undefined) rows.push({ label: input.balance > 0.004 ? "Balance due" : "Paid in full · balance due", value: r2(Math.max(0, input.balance)), kind: "balance" });
  return rows;
}

/** Quotation date + the validity days from Settings, when the quotation carries no date of its own yet. */
export function validUntilOf(q: { valid_until?: string | null; sent_at?: string | null; created_at?: string | null; validity_days?: number | null }): string | null {
  if (q.valid_until) return q.valid_until;
  const from = q.sent_at ?? q.created_at;
  if (!from) return null;
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + Math.max(0, Number(q.validity_days) || 7));
  return d.toISOString();
}
