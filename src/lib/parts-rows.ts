/**
 * The Parts pricing row and its one state. Pure functions shared by the table in the browser and by the server
 * (the page, Pricing done, the advisor's counts, the quotation), so the counter, the filter, the bottom bar, the
 * notification and the quotation can never disagree.
 */
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
  /** "in_stock" or "to_order"; "to_order" with days "0" is "Same day": ordered today, here today. */
  availability: string;
  /** Whole days until the ordered part arrives ("0" same day, "1" next day). */
  days: string;
  /** A tyre row: brand and a full size are needed before it counts as priced; no part number is asked for. */
  tyre_row?: boolean;
  tyre_brand?: string;
  tyre_size?: string;
  /** The Parts quantity (the technician's stays on the row for the note). */
  qty: string;
};

export type SupplierOption = { id: string; name: string; discount: number; byType: Record<string, number> };
/** The supplier Parts pick for a part on our own shelf: in stock, never on an LPO. */
export const OUR_STOCK = "Our stock";
/** The saved supplier text is tidied into title case ("Our Stock"), so the check ignores case. */
export const isOurStock = (name: string | null | undefined) => (name ?? "").trim().toLowerCase() === OUR_STOCK.toLowerCase();

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

/* ---------------------------------------------------------------------------
   The one definition of a part's state (evening of 12 October 2026).
   --------------------------------------------------------------------------- */

export type RowState = "priced" | "not_available" | "removed" | "waiting_approval" | "not_finished";
export type RowFlags = { unavailable?: boolean; removed?: boolean; waitingApproval?: boolean };

export const ROW_STATE_WORDS: Record<RowState, string> = {
  priced: "priced",
  not_available: "not available",
  removed: "removed",
  waiting_approval: "waiting for owner approval",
  not_finished: "not finished",
};

export type MissingField = "part_number" | "part_type" | "cost_aed" | "supplier" | "availability" | "days" | "tyre";
export type Missing = { field: MissingField; short: string; long: string };

/** Whole days typed: "0", "1", "12". Anything else means the days are still missing. */
export const daysComplete = (days: string | null | undefined) => /^\d+$/.test(String(days ?? "").trim());

/** What a row still needs before it counts as priced: part number, type, a net price above 0, a supplier and its availability. */
export function rowMissing(v: RowValues): Missing[] {
  const out: Missing[] = [];
  if (v.tyre_row) {
    if (!(v.tyre_brand ?? "").trim() || !/^\d{3}\/\d{2} R\d{2}$/.test(v.tyre_size ?? "")) out.push({ field: "tyre", short: "Tyre size and brand needed", long: "tyre size and brand needed" });
  } else if (!v.part_number.trim()) out.push({ field: "part_number", short: "No part number", long: "no part number" });
  if (!v.part_type.trim()) out.push({ field: "part_type", short: "No type", long: "no type" });
  const netText = v.cost_aed.trim();
  const net = netText === "" ? null : Number(netText.replace(",", "."));
  if (net === null || !Number.isFinite(net)) out.push({ field: "cost_aed", short: "No price", long: "no net price" });
  else if (net <= 0) out.push({ field: "cost_aed", short: "Net price is 0", long: "net price is 0" });
  if (!v.supplier.trim()) out.push({ field: "supplier", short: "No supplier", long: "no supplier" });
  if (v.availability !== "in_stock" && v.availability !== "to_order") out.push({ field: "availability", short: "No availability", long: "no availability" });
  else if (v.availability === "to_order" && !daysComplete(v.days)) out.push({ field: "days", short: "No days", long: "days to arrive missing" });
  return out;
}

/** Removed, then Not available, then Waiting for owner approval, else Priced or Not finished from what is typed. */
export function rowState(v: RowValues, flags: RowFlags = {}): RowState {
  if (flags.removed) return "removed";
  if (flags.unavailable) return "not_available";
  if (flags.waitingApproval) return "waiting_approval";
  return rowMissing(v).length ? "not_finished" : "priced";
}

export type PricingSummary = {
  counts: Record<RowState, number>;
  /** Every row that still counts (removed ones do not). */
  total: number;
  /** Priced or not available: nothing more to do. */
  done: number;
  /** Not finished or waiting for owner approval: what "Send what you have?" asks about. */
  open: number;
  /** "15 priced, 1 not available, 2 not finished". */
  text: string;
};

export function pricingSummary(states: RowState[]): PricingSummary {
  const counts: Record<RowState, number> = { priced: 0, not_available: 0, removed: 0, waiting_approval: 0, not_finished: 0 };
  for (const s of states) counts[s]++;
  const total = states.length - counts.removed;
  const parts = [`${counts.priced} priced`];
  if (counts.not_available) parts.push(`${counts.not_available} not available`);
  if (counts.waiting_approval) parts.push(`${counts.waiting_approval} waiting for owner approval`);
  if (counts.not_finished) parts.push(`${counts.not_finished} not finished`);
  return { counts, total, done: counts.priced + counts.not_available, open: counts.not_finished + counts.waiting_approval, text: total ? parts.join(", ") : "No parts on this job yet" };
}

/* ---------------------------------------------------------------------------
   Availability: one compact choice on the row, words for Parts and for the customer.
   --------------------------------------------------------------------------- */

export type AvailabilityChoice = "" | "in_stock" | "d0" | "d1" | "d2" | "d3" | "other";
export const AVAILABILITY_CHOICES: { value: Exclude<AvailabilityChoice, "">; label: string }[] = [
  { value: "in_stock", label: "In stock" },
  { value: "d0", label: "Same day" },
  { value: "d1", label: "Next day" },
  { value: "d2", label: "2 days" },
  { value: "d3", label: "3 days" },
  { value: "other", label: "Other…" },
];

/** The dropdown's value for a row; "Other…" while the days box is open or holds a number outside 0 to 3. */
export function availabilityChoice(v: Pick<RowValues, "availability" | "days">, otherMode = false): AvailabilityChoice {
  if (v.availability === "in_stock") return "in_stock";
  if (v.availability !== "to_order") return "";
  if (otherMode) return "other";
  const d = String(v.days).trim();
  return d === "0" || d === "1" || d === "2" || d === "3" ? (`d${d}` as AvailabilityChoice) : "other";
}

/** The row's values for a dropdown choice; "Other…" keeps the days typed so far unless they were one of the fixed ones. */
export function availabilityFromChoice(choice: AvailabilityChoice, currentDays: string): Pick<RowValues, "availability" | "days"> {
  if (choice === "in_stock") return { availability: "in_stock", days: "" };
  if (choice === "") return { availability: "", days: "" };
  if (choice === "other") return { availability: "to_order", days: ["0", "1", "2", "3"].includes(currentDays.trim()) ? "" : currentDays };
  return { availability: "to_order", days: choice.slice(1) };
}

/** Parts wording: "In stock", "Same day", "Next day", "2 days", "7 days"; "" when nothing is chosen. */
export function availabilityWords(availability: string | null | undefined, days: string | number | null | undefined): string {
  if (availability === "in_stock") return "In stock";
  if (availability !== "to_order") return "";
  const d = String(days ?? "").trim();
  if (!daysComplete(d)) return "Order";
  const n = Number(d);
  return n === 0 ? "Same day" : n === 1 ? "Next day" : `${n} days`;
}

/** The customer's wording: "In stock", "Today", "Tomorrow", "In 3 days"; "To order" when the days are not known. */
export function customerAvailabilityWords(availability: string | null | undefined, days: string | number | null | undefined): string | null {
  if (availability === "in_stock") return "In stock";
  if (availability !== "to_order") return null;
  const d = String(days ?? "").trim();
  if (!daysComplete(d)) return "To order";
  const n = Number(d);
  return n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`;
}

/** Days from today to a delivery date, both YYYY-MM-DD (Dubai), never below 0; "" when there is no date. */
export function daysFromDate(date: string | null | undefined, today: string): string {
  if (!date) return "";
  const diff = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  return Number.isFinite(diff) ? String(Math.max(0, diff)) : "";
}

/** The delivery date for a number of days from today (YYYY-MM-DD, Dubai); null when the days are not a whole number. */
export function dateFromDays(days: string | number, today: string): string | null {
  const d = String(days).trim();
  if (!daysComplete(d)) return null;
  return new Date(Date.parse(today) + Number(d) * 86400000).toISOString().slice(0, 10);
}
