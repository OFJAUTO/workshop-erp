/**
 * THE stock report (16 November 2026, Section 1): the stock count and value as of any date, per item, rebuilt from the
 * movements (in from LPOs, out to jobs, counts, adjustments, returns). Pure: no server imports, so tests run it.
 *
 * Each movement stores the quantity on the shelf after it (`quantity_after`) and the cost it moved at. The count on a
 * date is the last movement's `quantity_after` on or before the end of that day (an item with no movement yet: what it
 * held before its first movement, from the day it was made). The cost is the weighted average, replayed in order: an
 * "in" or "return" averages its cost into what was on the shelf; an "out", a count or an adjustment keeps the average.
 */

export type StockItemFacts = { id: string; name: string; part_number: string | null; item_type: string | null; unit: string | null; created_at: string; quantity: number; unit_cost: number; is_active: boolean };
export type StockMovementFacts = { id: string; stock_item_id: string; kind: string; quantity: number; unit_cost: number | null; quantity_after: number; created_at: string; job_id?: string | null; po_id?: string | null; note?: string | null };
export type StockRow = { itemId: string; name: string; partNumber: string | null; itemType: string | null; unit: string | null; quantity: number; unitCost: number; value: number };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The end of a Dubai calendar day as an instant ("2026-10-31" -> 2026-10-31T20:00:00Z). */
export const endOfDubaiDay = (day: string) => new Date(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) + 20 * 3600000).toISOString();

/** The last day of the month before a Dubai day ("2026-11-16" -> "2026-10-31"). */
export function lastMonthEnd(today: string): string {
  const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  return new Date(d.getTime() - 86400000).toISOString().slice(0, 10);
}

/** One item's count and average cost as of an instant. */
export function itemAsOf(item: StockItemFacts, moves: StockMovementFacts[], asOf: string): { quantity: number; unitCost: number } {
  const mine = moves.filter((m) => m.stock_item_id === item.id).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  if (!mine.length) return { quantity: item.created_at > asOf ? 0 : r2(item.quantity), unitCost: r2(item.unit_cost) };
  // What was on the shelf before the first movement (an item made with a quantity), at the first known cost.
  const first = mine[0];
  let qty = r2(Number(first.quantity_after) - Number(first.quantity));
  if (first.created_at > asOf) return { quantity: item.created_at > asOf ? 0 : qty, unitCost: r2(Number(first.unit_cost ?? item.unit_cost) || 0) };
  let avg = Number(first.unit_cost ?? item.unit_cost) || 0;
  for (const m of mine) {
    if (m.created_at > asOf) break;
    const q = Number(m.quantity) || 0;
    if ((m.kind === "in" || m.kind === "return") && q > 0 && m.unit_cost !== null) {
      const base = Math.max(0, qty);
      avg = base + q > 0 ? (base * avg + q * Number(m.unit_cost)) / (base + q) : Number(m.unit_cost);
    }
    qty = Number(m.quantity_after);
  }
  return { quantity: r2(qty), unitCost: r2(avg) };
}

/** Every item's count, cost and value as of a Dubai day (items holding nothing are left out). */
export function stockAsOf(items: StockItemFacts[], moves: StockMovementFacts[], day: string): { rows: StockRow[]; totalQuantity: number; totalValue: number } {
  const asOf = endOfDubaiDay(day);
  const rows: StockRow[] = [];
  for (const it of items) {
    const { quantity, unitCost } = itemAsOf(it, moves, asOf);
    if (Math.abs(quantity) < 0.005) continue;
    rows.push({ itemId: it.id, name: it.name, partNumber: it.part_number, itemType: it.item_type, unit: it.unit, quantity, unitCost, value: r2(quantity * unitCost) });
  }
  rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return { rows, totalQuantity: r2(rows.reduce((a, r) => a + r.quantity, 0)), totalValue: r2(rows.reduce((a, r) => a + r.value, 0)) };
}

export const MOVEMENT_WORDS: Record<string, string> = { in: "In (from an LPO or put on the shelf)", out: "Out to a job", count: "Count correction", adjust: "Adjustment", return: "Back on the shelf" };

/** The movements of a period with their value (signed: in positive, out negative). */
export function movementValue(m: Pick<StockMovementFacts, "quantity" | "unit_cost">): number {
  return r2((Number(m.quantity) || 0) * (Number(m.unit_cost) || 0));
}
