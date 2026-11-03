import { hoursQty } from "../format";
import { qtyWithUnit, type PartUnit } from "../part-units";

/**
 * The line's quantity text on every document: "1.5 h" for labour, "8 L" for litres, "2 sets" for sets, otherwise the
 * number (3 November 2026: the QTY column says litres, so the PRICE beside it reads per litre).
 */
export function qtyText(quantity: number, hours?: number | null, unit?: PartUnit | null): string {
  if (hours !== null && hours !== undefined) return hoursQty(hours);
  if (unit === "l" || unit === "set") return qtyWithUnit(quantity, unit);
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
}
