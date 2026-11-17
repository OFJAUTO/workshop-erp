/*
 * ONE SUPPLIER INVOICE FOR SEVERAL LPOs (17 November 2026, Section 2; the AL TAYER case: LPO-00039-1 and LPO-00039-3,
 * one invoice for both). Pure rules, no server imports (the unit tests run them):
 *  - the invoice number compared without spaces, dashes or case (the same paper typed twice the same way);
 *  - the typed total split across the LPOs it covers, by their approved totals, landing on the typed total to the fils;
 *  - the words of the "Together" line.
 * Each LPO keeps its own share and its own parts, so every part sits on exactly one invoice (the 15 November rule).
 */

/** "INV 262817342", "inv-262817342" and "262817342 " are the same paper only when typed the same way: compare like this. */
export function compactInvoiceNumber(n: string | null | undefined): string {
  return String(n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The invoice's before-VAT total shared across the LPOs it covers, in proportion to each LPO's own total; the fils left
 * over go on the largest share, so the shares add up to the typed total exactly. All totals 0 = equal shares.
 */
export function splitInvoiceTotal(total: number, parts: { id: string; total: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!parts.length) return out;
  const t = r2(total);
  const base = parts.reduce((a, p) => a + Math.max(0, Number(p.total) || 0), 0);
  for (const p of parts) out.set(p.id, base > 0 ? r2((t * Math.max(0, Number(p.total) || 0)) / base) : r2(t / parts.length));
  const sum = r2(Array.from(out.values()).reduce((a, v) => a + v, 0));
  const left = r2(t - sum);
  if (Math.abs(left) > 0.004) {
    const largest = parts.reduce((a, p) => ((out.get(p.id) ?? 0) > (out.get(a.id) ?? 0) ? p : a), parts[0]);
    out.set(largest.id, r2((out.get(largest.id) ?? 0) + left));
  }
  return out;
}

/** "Together: AED 3,861.00 before VAT (LPO-00039-1 3,224.00 + LPO-00039-3 637.00)". */
export function togetherWords(parts: { number: string; total: number }[]): string {
  const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sum = r2(parts.reduce((a, p) => a + (Number(p.total) || 0), 0));
  return `Together: AED ${fmt(sum)} before VAT (${parts.map((p) => `${p.number} AED ${fmt(Number(p.total) || 0)}`).join(" + ")})`;
}

/** The LPOs an invoice covers, oldest first: the first one carries the Zoho bill for all of them. */
export function leadOf<T extends { id: string; created_at?: string | null }>(group: T[]): T | null {
  if (!group.length) return null;
  return [...group].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.id.localeCompare(b.id))[0];
}
