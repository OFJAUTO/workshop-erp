/*
 * Pure rules for changing an approved part's quantity (Section 1 of 9 November 2026). No server imports: the unit
 * tests read this file directly.
 */
import { qtyWithUnit, type PartUnit } from "./part-units";

export const QTY_REASONS = [
  { key: "bought_fewer", words: "bought fewer" },
  { key: "used_fewer", words: "used fewer" },
  { key: "supplier_short", words: "supplier short" },
  { key: "returned", words: "returned" },
] as const;
export type QtyReason = (typeof QTY_REASONS)[number]["key"];

/** Litres to two decimals, everything else whole. */
export function roundQty(n: number, unit: PartUnit | null | undefined): number {
  if (!Number.isFinite(n)) return NaN;
  return unit === "l" ? Math.round(n * 100) / 100 : Math.round(n * 1000) / 1000;
}

export function qtyDirection(was: number, now: number): "down" | "up" {
  return now < was ? "down" : "up";
}

/** "REAR DIFFERENTIAL OIL: 3 → 2 by Peter, 9 Nov 14:05: bought fewer" (the history line, the LPO's notes, the bell). */
export function qtyChangeLine(a: { name: string; was: number; now: number; unit: PartUnit | null; by: string; when: string; reason: string; note?: string | null }): string {
  const u = a.unit && a.unit !== "pc" ? ` ${a.unit === "l" ? "L" : a.unit}` : "";
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(n));
  return `${a.name.toUpperCase()}: ${fmt(a.was)}${u} → ${fmt(a.now)}${u} by ${a.by}, ${a.when}: ${a.reason}${a.note && a.note.trim() ? ` (${a.note.trim()})` : ""}`;
}

/** The reduced line's money: what the customer saves, before VAT (unit price × the pieces no longer charged). */
export function reducedBy(unitPrice: number, was: number, now: number): number {
  return Math.round(unitPrice * Math.max(0, was - now) * 100) / 100;
}

/** The words on the "Reduce the customer's price" card for one line. */
export function reduceLineWords(l: { title: string; quoted: number; now: number; unit: PartUnit | null; unitPrice: number }): string {
  const save = reducedBy(l.unitPrice, l.quoted, l.now);
  return `${l.title.toUpperCase()}: approved ${qtyWithUnit(l.quoted, l.unit)}, now ${qtyWithUnit(l.now, l.unit)} – AED ${save.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} less before VAT`;
}

/** After the reduction the customer may have paid more than the new total: an advance (kept) or a refund due. */
export function overpaidWords(paid: number, newTotal: number): string | null {
  const over = Math.round((paid - newTotal) * 100) / 100;
  if (over <= 0.004) return null;
  return `The customer has paid AED ${over.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} more than the new total: it stays as an advance, or refund it from the money page.`;
}

export const REDUCED_MARK = "Reduced after approval – no customer approval needed";
