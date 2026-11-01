/**
 * Supplier invoice price different from the approved LPO (1 November 2026, LPO-00035-2): the supplier's invoice is the
 * real cost. Both figures show ("Approved 250.00 · invoiced 260.00 (+10.00 each, +20.00 total)"); a price down is
 * accepted at once; a price up is accepted at once up to a limit per LPO (the higher of 5% of the LPO or AED 100, both
 * in Settings) and above it waits for the owner's OK or "Query with supplier". Pure: no database.
 */

export type PriceLine = { description?: string; quantity: number; received_qty?: number; unit_cost: number; invoice_unit_cost: number | null };

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => r2(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`;

/** The change on one line: per unit and in total (the quantity received, else the quantity ordered). */
export function lineChange(l: PriceLine): { each: number; total: number; qty: number } | null {
  if (l.invoice_unit_cost === null || l.invoice_unit_cost === undefined) return null;
  const each = r2(Number(l.invoice_unit_cost) - Number(l.unit_cost));
  if (Math.abs(each) < 0.005) return null;
  const qty = Number(l.received_qty) > 0 ? Number(l.received_qty) : Number(l.quantity) || 1;
  return { each, total: r2(each * qty), qty };
}

/** "Approved 250.00 · invoiced 260.00 (+10.00 each, +20.00 total)". */
export function changeWords(l: PriceLine): string | null {
  const c = lineChange(l);
  if (!c) return null;
  return `Approved ${money(l.unit_cost)} · invoiced ${money(Number(l.invoice_unit_cost))} (${signed(c.each)} each, ${signed(c.total)} total)`;
}

/** The limit of an automatic acceptance on one LPO: the higher of the percent of its total and the fixed amount. */
export function autoLimit(lpoTotal: number, percent = 5, aed = 100): number {
  return r2(Math.max((Math.max(0, lpoTotal) * percent) / 100, aed));
}

export type PriceDecision = { increase: number; decrease: number; net: number; limit: number; auto: boolean };

/**
 * What happens to an LPO's invoice prices: a decrease alone is accepted; an increase up to the limit is accepted (the
 * owner is told); above it, it waits for the owner (the bill does not go to accounts before).
 */
export function priceDecision(lines: PriceLine[], lpoTotal: number, percent = 5, aed = 100): PriceDecision {
  const changes = lines.map(lineChange).filter((c): c is NonNullable<ReturnType<typeof lineChange>> => !!c);
  const increase = r2(changes.filter((c) => c.total > 0).reduce((a, c) => a + c.total, 0));
  const decrease = r2(changes.filter((c) => c.total < 0).reduce((a, c) => a + c.total, 0));
  const limit = autoLimit(lpoTotal, percent, aed);
  return { increase, decrease, net: r2(increase + decrease), limit, auto: increase <= limit + 0.005 };
}

/** "Supplier price change: −AED 20.00" on the job's profit (a price up costs the job, a price down gives back). */
export function profitChangeWords(net: number): string | null {
  if (Math.abs(net) < 0.005) return null;
  return `Supplier price change: ${net > 0 ? "−" : "+"}AED ${money(Math.abs(net))}`;
}
