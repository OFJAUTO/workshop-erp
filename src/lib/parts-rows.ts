/** One row of the Parts pricing table, as typed; shared by the table (browser) and the page (server). */
export type RowValues = {
  part_number: string;
  part_type: string;
  brand: string;
  /** The supplier's list price per unit. */
  list_price: string;
  /** The supplier's discount in percent; the net cost follows. */
  discount: string;
  /** The net cost per unit: what the markup, the quotation and the profit use. */
  cost_aed: string;
  supplier: string;
  availability: string;
  days: string;
  /** The Parts quantity (the technician's stays on the row for the note). */
  qty: string;
};

export type SupplierOption = { id: string; name: string; discount: number; byType: Record<string, number> };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The net cost from a list price and a discount, as text for the box; empty when there is no list price. */
export function netOf(list: string, discount: string): string {
  const l = Number(String(list).replace(",", "."));
  if (!Number.isFinite(l) || String(list).trim() === "") return "";
  const d = Number(String(discount).replace(",", ".")) || 0;
  return String(r2(l * (1 - Math.min(100, Math.max(0, d)) / 100)));
}

/** The discount implied by a net cost typed by hand against the list price. */
export function discountOf(list: string, net: string): string {
  const l = Number(String(list).replace(",", "."));
  const n = Number(String(net).replace(",", "."));
  if (!Number.isFinite(l) || l <= 0 || !Number.isFinite(n)) return "";
  return String(r2(Math.max(0, (1 - n / l) * 100)));
}

/** The supplier's discount for a part type: the per-type one when set, else the default. */
export function supplierDiscount(s: SupplierOption | undefined, partType: string): number {
  if (!s) return 0;
  const t = partType.toLowerCase();
  return t && s.byType[t] !== undefined ? s.byType[t] : s.discount;
}

/** A row is priced when the part exists with a type, a net cost, a supplier and its availability (in stock, or to order with the days). */
export function rowComplete(v: RowValues, hasPart: boolean) {
  return hasPart && !!v.part_type && v.cost_aed.trim() !== "" && !!v.supplier.trim() && (v.availability === "in_stock" || (v.availability === "to_order" && Number(v.days) > 0));
}
