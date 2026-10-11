/** One row of the Parts pricing table, as typed; shared by the table (browser) and the page (server). */
export type RowValues = { part_number: string; part_type: string; brand: string; cost_aed: string; supplier: string; availability: string; days: string };

/** A row is priced when the part exists with a type, a cost, a supplier and its availability (in stock, or to order with the days). */
export function rowComplete(v: RowValues, hasPart: boolean) {
  return hasPart && !!v.part_type && v.cost_aed.trim() !== "" && !!v.supplier.trim() && (v.availability === "in_stock" || (v.availability === "to_order" && Number(v.days) > 0));
}
