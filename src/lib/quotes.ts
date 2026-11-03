/** Quotations and estimates: line types, the maths, what blocks sending, and plain-word statuses. Safe for the browser. */

import type { WorkingTime } from "./working-time";
import { roundHalfUp } from "./bank-fees";
import { customerAvailabilityWords, daysFromDate, isPlaceholderSupplier } from "./parts-rows";
import { unpricedEstimateParts, waitingWords } from "./estimate-parts";
import { positionsQtyMismatch, positionsWords } from "./parts-list";
import { packageItemLabels, packageLineCost, plainPpfFilm, type PackageCosting } from "./package-cost";
import { lineIsPpf } from "./ppf-cut";
import { unitSuffix, type PartUnit } from "./part-units";

export const LINE_TYPES = [
  { value: "labour", label: "Labour" },
  { value: "part", label: "Part" },
  { value: "package", label: "Service (fixed price)" },
  { value: "other", label: "Other" },
  { value: "recovery", label: "Recovery" },
  { value: "fee", label: "Fee" },
] as const;
export type LineType = (typeof LINE_TYPES)[number]["value"];
export const LINE_TYPE_LABELS: Record<LineType, string> = Object.fromEntries(LINE_TYPES.map((t) => [t.value, t.label])) as Record<LineType, string>;

export type QuoteStatus = "draft" | "pending_owner" | "sent" | "opened" | "approved" | "urgent_requested" | "declined" | "expired" | "superseded" | "cancelled";
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Being prepared",
  pending_owner: "Waiting for the owner's approval",
  sent: "Sent to the customer",
  opened: "Opened by the customer",
  approved: "Approved",
  urgent_requested: "Customer asked for urgent work only",
  declined: "Declined",
  expired: "Expired",
  superseded: "Replaced by a newer version",
  cancelled: "Cancelled",
};

export type QuoteKind = "quotation" | "estimate";
export type Urgency = "urgent" | "recommended";
export const URGENCY_LABELS: Record<Urgency, string> = { urgent: "Urgent", recommended: "" };

export type QuoteLine = {
  id: string;
  quotation_id: string;
  position: number;
  line_type: LineType;
  title: string;
  details: string | null;
  /** A bodyshop package: the key in Settings and the snapshot of what the customer gets (one price). */
  package_key?: string | null;
  package_items?: unknown;
  group_label: string | null;
  source_type: "request" | "item" | "tyre" | "manual" | "estimate" | "package" | "service" | null;
  source_key: string | null;
  quantity: number;
  unit_cost: number | null;
  markup_percent: number | null;
  /** 22 October 2026: a part's markup as a percentage of the cost ("percent", the default) or a fixed AED amount per unit ("aed"). */
  markup_mode?: MarkupMode | null;
  /** The fixed markup per unit when the mode is "aed": cost 955.80 + AED 300 = selling 1,255.80. */
  markup_aed?: number | null;
  unit_price: number | null;
  hours: number | null;
  labour_rate: number | null;
  discount_percent: number;
  discount_reason: string | null;
  line_total: number;
  part_item_id: string | null;
  package_id: string | null;
  service_id: string | null;
  /** Fixed-price services: what the price is per (job, tyre, wheel, injector, cylinder, axle, unit or a word of the owner's). */
  price_per: string | null;
  visible_to_customer: boolean;
  urgency: Urgency | null;
  advisor_added: boolean;
  customer_approved: boolean | null;
  is_active: boolean;
  /** The part's type (Genuine, OEM, Aftermarket, Used) and brand follow the part onto the customer's page and the documents. */
  part_type: string | null;
  brand: string | null;
  /** Parts can offer several options for the same part; the advisor picks one. Unchosen options count for nothing. */
  option_group: string | null;
  chosen: boolean;
  /** The automatic bank-charge line: hidden, one per quotation, never edited by advisors. */
  fee_kind: "bank_charge" | null;
  recovery_trips: number | null;
  recovery_provider: string | null;
  /** A dangerous finding: forced Urgent, with a safety warning for the customer. */
  dangerous: boolean;
  /** A part belongs to the labour line of the finding it came from. */
  parent_line_id: string | null;
  recovery_provider_kind: "ours" | "external" | "customer" | null;
  /** The owner set this markup below the minimum on purpose (the floor check lets it through). */
  markup_confirmed: boolean;
  /** "Front", "Rear", "Front left"...: one job on several positions is one row, with the quantity to match. */
  positions?: string[] | null;
  /** A part left off this quotation: stays on the car's list, greyed, counts for nothing, is not ordered. */
  left_off?: boolean;
  /** A service done outside (lathe work, the Bosch injector service): its cost is typed, it never takes the labour discount. */
  outside_work?: boolean;
  /** Normal / Full down / Closed box, from Settings. */
  recovery_type?: string | null;
  /** Who pays for the recovery: us (cost only, internal) or the customer (priced on the quotation). */
  recovery_paid_by?: "us" | "customer" | null;
  /** A recovery we pay for, shown to the customer at AED 0 as "free of charge". */
  recovery_mention_free?: boolean;
  /** Labour lines: the workshop's estimate of the hours (labour at cost), beside the quoted hours the customer pays. */
  hours_estimate?: number | null;
  /** On a revised quotation: the line of the earlier version this one was copied from (work lines follow it). */
  revised_from_line_id?: string | null;
  /** Bodyshop lines: the film colour and code (coloured PPF), or the tint shade. */
  /** Section 10: the PPF cutting method (hand / machine / mixed) and the note for Mixed. */
  /** Section 7 (23 October 2026): a bodyshop line on a mixed job (from the inspection's bodyshop findings). */
  side?: "mechanical" | "bodyshop" | null;
  /** Estimate parts (30 October 2026): the line carries its own price. The note for the parts desk, when it was sent to
   *  be priced, who priced it (the parts desk, or the advisor with a price he had - checked later by the parts desk), and
   *  the parts desk's supplier, part number and availability (internal: never on a customer document). */
  parts_note?: string | null;
  price_requested_at?: string | null;
  price_requested_by?: string | null;
  priced_at?: string | null;
  priced_by?: string | null;
  priced_by_advisor?: boolean;
  price_checked_at?: string | null;
  price_checked_by?: string | null;
  supplier_text?: string | null;
  part_number?: string | null;
  availability?: "in_stock" | "to_order" | null;
  delivery_days?: number | null;
  cut_method?: "hand" | "machine" | "mixed" | null;
  cut_note?: string | null;
  film_colour?: string | null;
  film_code?: string | null;
  tint_percent?: number | null;
  /** Sold at 0 on purpose: 'complimentary' or 'included' prints the word instead of a price; cost still counts. */
  price_display?: "normal" | "complimentary" | "included" | null;
  /** Bodyshop services: the estimated installer hours (internal), from the service's default, editable. */
  installer_hours?: number | null;
  /** 2 November 2026: the owner's approval of this line selling BELOW its cost, with the figures he saw (migration
   *  20261203090000; read once the columns exist). A lower price or a higher cost later is no longer covered. */
  below_cost_reason?: string | null;
  below_cost_by?: string | null;
  below_cost_at?: string | null;
  below_cost_sell_aed?: number | null;
  below_cost_cost_aed?: number | null;
  /** The approver's name, filled in by the loader for the screen. */
  below_cost_by_name?: string | null;
  /** Section 9 (3 November 2026, migration 20261203160000): a part's unit (pieces, litres, sets; the cost is per unit),
   *  the quantity the advisor asked for before the parts desk changed it, and when and by whom it changed; an estimate
   *  part's list price and supplier discount (the shared Parts row). Read once the columns exist (attachPartLineExtras). */
  unit?: PartUnit | null;
  asked_quantity?: number | null;
  quantity_changed_at?: string | null;
  quantity_changed_by?: string | null;
  list_price_aed?: number | null;
  supplier_discount_percent?: number | null;
};

export type QuoteRow = {
  id: string;
  kind: QuoteKind;
  number: string;
  version: number;
  /** Section 5 (30 October 2026): why the complimentary part is free and the owner's decision (read once the migration is in). */
  comp_reason?: string | null;
  comp_original_job_id?: string | null;
  comp_original_job_number?: string | null;
  comp_note?: string | null;
  comp_status?: string | null;
  comp_decided_by?: string | null;
  comp_decided_at?: string | null;
  comp_decision_note?: string | null;
  comp_normal_aed?: number | null;
  comp_cost_aed?: number | null;
  comp_cost_detail?: string | null;
  parent_id: string | null;
  job_id: string | null;
  customer_id: string;
  vehicle_id: string | null;
  estimate_id: string | null;
  /** An additional estimate: the open estimate of the same car it adds to (30 October 2026). */
  additional_to_id?: string | null;
  /** An estimate carried over to this job at gate-in (30 October 2026). */
  carried_job_id?: string | null;
  status: QuoteStatus;
  token: string | null;
  discount_percent: number;
  vat_percent: number;
  subtotal_aed: number;
  discount_aed: number;
  vat_aed: number;
  total_aed: number;
  approved_total_aed: number | null;
  deposit_aed: number;
  promised_at: string | null;
  validity_days: number;
  valid_until: string | null;
  customer_note: string | null;
  customer_request_note: string | null;
  payment_by_card: boolean;
  owner_approval_reason: string | null;
  owner_approved_by: string | null;
  /** Who gave the labour discount and when (B3). */
  discount_set_by?: string | null;
  discount_set_at?: string | null;
  owner_approved_at: string | null;
  sent_at: string | null;
  sent_by: string | null;
  sent_method: string | null;
  sent_to_name: string | null;
  sent_to_phone: string | null;
  opened_at: string | null;
  responded_at: string | null;
  approver_name: string | null;
  approver_phone: string | null;
  decline_reason: string | null;
  reminded_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  parts_reminded_at: string | null;
  parts_escalated_at: string | null;
  danger_acknowledged_at: string | null;
  danger_acknowledged_by: string | null;
  /** Findings the advisor is not quoting, by finding key, with the reason. */
  not_quoted: Record<string, string>;
  /** The whole-dirham total chosen when sending; the pre-VAT amount takes the difference. */
  rounded_total_aed: number | null;
  estimated_days: number | null;
  declined_note: string | null;
  /** When the customer opened the full document; compared with responded_at it says whether it was read before approving. */
  viewed_full_at: string | null;
  /** Set when the advisor marked it declined after talking to the customer. */
  declined_by: string | null;
  /** Parts changed a price after this version was sent. */
  parts_price_changed_at: string | null;
  /** How the customer is expected to pay (internal): sets the estimated bank charge. */
  expected_payment_method: "card" | "link" | "cash" | "cheque" | "transfer" | "not_sure";
  /** One person edits at a time: who holds the quotation and the last heartbeat. */
  editing_by: string | null;
  editing_at: string | null;
  /** "Continue anyway" on the markup reminder: who left the parts at the minimum markup, and when (owner's summary). */
  markup_skipped_at?: string | null;
  markup_skipped_by?: string | null;
  /** The deposit asked for: none, a fixed amount (aed), a percentage of the parts or of the total. */
  deposit_mode?: "none" | "aed" | "percent_parts" | "percent_total" | null;
  deposit_value?: number | null;
  deposit_set_by?: string | null;
  deposit_set_at?: string | null;
  deposit_skipped_at?: string | null;
  deposit_skipped_by?: string | null;
  /** Revising after the customer's approval: the request and the owner's one-time permission. */
  revision_requested_at?: string | null;
  revision_requested_by?: string | null;
  revision_request_reason?: string | null;
  revision_request_kind?: "advisor" | "parts" | null;
  revision_allowed_at?: string | null;
  revision_allowed_by?: string | null;
  revision_declined_at?: string | null;
  revision_declined_by?: string | null;
  revision_decision_note?: string | null;
  /** The labour discount (our own labour lines only): a percentage or a fixed amount. Null kind = the old rule (labour and services). */
  discount_kind?: "percent" | "aed" | null;
  discount_value?: number | null;
  /** What the discount comes off: our labour lines only (default), or labour and our own services as well. Outside work is never discounted. */
  discount_scope?: "labour" | "labour_services" | null;
  /** Commission we pay someone: internal, never shown to a customer. */
  commission_to?: string | null;
  commission_kind?: "aed" | "percent" | null;
  commission_value?: number | null;
  commission_aed?: number;
  /** Bodyshop: film, paint and consumables, typed in the internal box; counts against profit. */
  materials_cost_aed?: number;
  removal_ack_at?: string | null;
  removal_ack_name?: string | null;
  commission_paid_at?: string | null;
  commission_paid_by?: string | null;
  /** Every commission needs the owner's approval (his own are approved at once); a pending one already counts as a cost and only a decline removes it. */
  commission_status?: "pending" | "approved" | "declined" | null;
  commission_decision_note?: string | null;
  /** Section 7: the owner per-job film rolls for the package cost estimate (1 or 1.5 usually). */
  film_rolls_est?: number | null;
  /** Section 11: the tint specification per window (see src/lib/tint.ts) and the customer's above-the-limit tick. */
  tint_spec?: unknown;
  tint_ack_at?: string | null;
  tint_ack_name?: string | null;
  /** Section 4 (23 October 2026): a sent estimate withdrawn with its reason; a copy remembers its source. */
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  copied_from_id?: string | null;
  commission_set_by?: string | null;
  commission_set_at?: string | null;
  commission_decided_by?: string | null;
  commission_decided_at?: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
};

/** The header fields the totals need, as the editor and the server both hold them. */
export type QuoteHeaderForTotals = {
  discount_percent: number;
  vat_percent: number;
  payment_by_card?: boolean;
  rounded_total_aed?: number | null;
  discount_kind?: "percent" | "aed" | null;
  discount_value?: number | null;
  discount_scope?: "labour" | "labour_services" | null;
  commission_kind?: "aed" | "percent" | null;
  commission_value?: number | null;
  commission_status?: string | null;
  materials_cost_aed?: number | null;
  /** The deposit the advisor asked for: a fixed amount, a share of the parts, or a share of the total. */
  deposit_mode?: string | null;
  deposit_value?: number | null;
};

export type PartItem = {
  id: string;
  job_id: string;
  part_request_id: string | null;
  /** The name on customer documents; empty falls back to the supplier name (description). */
  customer_name?: string | null;
  /** Battery lines: the warranty months the advisor picked (12, 24, 36); null means the Settings default. */
  warranty_months?: number | null;
  part_number: string | null;
  description: string;
  /** What the technician wrote, kept when Parts correct the name. */
  original_description?: string | null;
  /** The supplier's list price and the discount behind the net cost. */
  list_price_aed?: number | null;
  discount_percent?: number | null;
  quantity_changed_at?: string | null;
  /** "Remove: not needed" before the order: kept greyed with the reason, Put back possible. */
  removed_at?: string | null;
  removed_by?: string | null;
  removed_reason?: string | null;
  /** A supplier discount above the owner's limit waits for his one-tap approval. */
  discount_approval_status?: "pending" | "approved" | "refused" | null;
  client_key?: string | null;
  /** The supplier's own words on availability when they do not fit a date ("Back order", "Supplier to confirm"). */
  availability_note?: string | null;
  quantity: number;
  diagram_path: string | null;
  supplier: string | null;
  cost_aed: number | null;
  availability: "in_stock" | "to_order" | null;
  delivery_date: string | null;
  priced_by: string | null;
  priced_at: string | null;
  confirm_status: "pending" | "confirmed" | "rejected";
  confirmed_quantity: number | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  reject_note: string | null;
  order_status: "none" | "to_order" | "ordered" | "partly_received" | "received";
  added_by_role: string | null;
  is_active: boolean;
  created_at: string;
  part_type: string | null;
  brand: string | null;
  option_group: string | null;
  question_text: string | null;
  question_at: string | null;
  question_by: string | null;
  answer_text: string | null;
  answered_at: string | null;
  answered_by: string | null;
  /** "Front left", "Rear"... carried from the technician's parts list. */
  positions?: string[] | null;
  /** Section 9: pieces, litres or sets (the cost is per unit); read once the column exists. */
  unit?: PartUnit | null;
};

export const PART_TYPE_LABELS: Record<string, string> = { genuine: "Genuine", oem: "OEM", aftermarket: "Aftermarket", used: "Used" };
/** "Aftermarket - Bosch", or just the type. */
export function partTypeText(l: { part_type?: string | null; brand?: string | null }): string | null {
  if (!l.part_type) return null;
  const t = PART_TYPE_LABELS[l.part_type] ?? l.part_type;
  return l.brand && l.part_type !== "genuine" ? `${t} - ${l.brand}` : t;
}

export type PartRequest = {
  id: string;
  job_id: string;
  inspection_id: string | null;
  source_type: "item" | "request" | "tyre" | "manual";
  source_key: string;
  label: string;
  requested_text: string | null;
  status: "open" | "listed" | "done" | "rejected" | "unavailable";
  is_active: boolean;
  created_at: string;
  quantity: number | null;
  unit: string | null;
  closed_reason: string | null;
  positions?: string[] | null;
  note?: string | null;
  catalogue_id?: string | null;
  /** "Remove: not needed" on a request with no part yet: kept greyed with the reason, Put back possible. */
  removed_at?: string | null;
  removed_by?: string | null;
  removed_reason?: string | null;
};

export type Service = { id: string; category_id: string; name: string; department: string; price_aed: number | null; default_hours: number | null; /** "labour" (hours typed) or "service" (fixed price, typed when there is no default); null keeps the old rule: a price means a service. */ line_kind?: "labour" | "service" | null; /** A bodyshop package: the stages it brings; the advisor types the price. */ bodyshop_kind?: string | null; price_per?: string | null; usual_quantity?: number | null; time_allowance_hours?: number | null; includes_oil_change?: boolean; description: string | null; parts_requests: string[]; position: number; is_active: boolean; /** Asks "Front, rear or both?" when added. */ position_ask?: boolean; /** The report keys (item keys, "tyre:<pos>", "measure:battery_health") this job answers: it comes first under Suggested. */ suggest_for?: string[] | null; /** Outside work: the "our cost" box shows for everyone, never in the labour discount. */ outside_work?: boolean; /** Bodyshop costing: the default estimated installer hours copied onto new lines. */ installer_hours?: number | null };
export type ServiceCategory = { id: string; name: string; position: number; is_active: boolean };

export const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
export const round1 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 10) / 10;
/** The quote's profit colour: red below the red margin (or a loss), yellow below the yellow one, green otherwise. */
export function marginToneOf(profit: number, net: number, limits: { yellow: number; red: number }): "green" | "amber" | "red" {
  if (profit < 0) return "red";
  const margin = net > 0 ? (profit / net) * 100 : 0;
  if (margin < limits.red) return "red";
  if (margin < limits.yellow) return "amber";
  return "green";
}

export const aed = (n: number | null | undefined) => `AED ${round2(n ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "1.5 h", always one decimal. */
/** "2.0 h", "10.25 h": one decimal, two when the figure needs them. */
export const hoursText = (h: number | null | undefined) => {
  const n = round2(h ?? 0);
  return `${Math.abs(n * 10 - Math.round(n * 10)) < 1e-9 ? n.toFixed(1) : n.toFixed(2)} h`;
};
/** The hours a labour line is estimated at: the Est. h box, else the quoted hours. Never the rate. */
export const estimateOf = (l: Pick<QuoteLine, "hours" | "hours_estimate">) => l.hours_estimate ?? l.hours ?? 0;
/** No single job takes more than this: an estimate above it is not hours (the rate was typed in the box once). */
export const ESTIMATE_MAX_LINE_HOURS = 50;
/** Estimates totalling more than this many times the quoted hours are not trusted either. */
export const ESTIMATE_TOTAL_FACTOR = 3;
/** An estimate over ESTIMATE_MAX_LINE_HOURS on one line: shown amber, the quoted hours stand in for it in labour at cost. */
export const estimateLineSuspect = (l: Pick<QuoteLine, "hours" | "hours_estimate" | "line_type">) =>
  l.line_type === "labour" && l.hours_estimate !== null && l.hours_estimate !== undefined && l.hours_estimate > ESTIMATE_MAX_LINE_HOURS;
/** Hours typed with a full stop or a comma, one decimal place, at least 0.1. Null when empty. */
export function parseHours(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined || text === "") return null;
  const n = Number(String(text).replace(",", ".").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return null;
  // Two decimals: "10.25" stays 10.25 (the hours columns take two decimals since 12 October 2026).
  return Math.max(0.1, round2(n));
}

/** Lines whose price comes from a cost plus markup, with the minimum markup as a floor on the final price. */
export function hasCostFloor(l: Pick<QuoteLine, "line_type" | "unit_cost">) {
  return (l.line_type === "part" || l.line_type === "other") && l.unit_cost !== null && l.unit_cost !== undefined;
}
/**
 * A line the customer never sees and pays nothing for - "Internal cost only – hide from customer" (section 13): any
 * labour, service, part, other or recovery line, and the automatic bank-charge fee. Its cost still counts against
 * profit; it never appears on a customer document.
 */
export function isHidden(l: Pick<QuoteLine, "line_type" | "visible_to_customer"> & { fee_kind?: string | null }) {
  if (l.fee_kind === "bank_charge") return true;
  return l.line_type !== "fee" && l.visible_to_customer === false;
}

/** The one name for the option, on the line menus and the Other charges row. */
export const INTERNAL_ONLY_LABEL = "Internal cost only – hide from customer";

/** A name that says nothing: blank, or just "PART" / "PARTS" (section 13, flagged in Before sending). */
export function isNamelessTitle(title: string | null | undefined): boolean {
  const t = String(title ?? "").trim();
  return !t || /^parts?$/i.test(t);
}
/** A line given free on purpose (one priced package line + its included items): sells for nothing,
 *  passes "Before sending", keeps its internal cost, and prints the word instead of a price. */
export function isComplimentary(l: { price_display?: string | null }) {
  return l.price_display === "complimentary" || l.price_display === "included";
}
/** The word on the customer's documents: "Complimentary" or "Included". */
export function complimentaryWord(l: { price_display?: string | null }) {
  return l.price_display === "included" ? "Included" : "Complimentary";
}
/** Document titles lose trailing dashes and stray separators: "PPF - EXTERIOR -" prints "PPF - EXTERIOR". */
export function cleanDocTitle(t: string | null | undefined) {
  return String(t ?? "").replace(/[\s\-–—·,;:]+$/g, "").trim();
}
/** The line's own discount in dirhams (the green "Discount 22%: −AED 4,840.00" under the line). */
export function lineDiscountAmount(l: Pick<QuoteLine, "line_type" | "quantity" | "unit_cost" | "markup_percent" | "unit_price" | "hours" | "labour_rate" | "discount_percent" | "visible_to_customer"> & { price_display?: string | null; markup_mode?: MarkupMode | string | null; markup_aed?: number | null }) {
  return round2(linePrice(l) * ((l.discount_percent ?? 0) / 100));
}
/** An option the advisor did not pick: it counts for nothing and the customer never sees it. */
export function isUnchosen(l: { option_group?: string | null; chosen?: boolean; left_off?: boolean }) {
  return (!!l.option_group && l.chosen === false) || !!l.left_off;
}
/** The quotation-wide discount applies to labour and services only, never to anything with a cost. */
export function takesTotalDiscount(l: Pick<QuoteLine, "line_type" | "unit_cost" | "visible_to_customer">) {
  return !isHidden(l) && (l.line_type === "labour" || l.line_type === "package" || l.line_type === "fee" || (l.line_type === "other" && (l.unit_cost === null || l.unit_cost === undefined)));
}

export type MarkupMode = "percent" | "aed";
type MarkupFields = Pick<QuoteLine, "unit_cost" | "markup_percent"> & { markup_mode?: MarkupMode | string | null; markup_aed?: number | null };

/** The markup of a line with a cost, for the quantity: a percentage of the cost, or the fixed AED per unit × quantity. */
function costPlusMarkup(l: MarkupFields, qty: number): number {
  const cost = l.unit_cost ?? 0;
  if (l.markup_mode === "aed") return round2((cost + (l.markup_aed ?? 0)) * qty);
  return round2(cost * (1 + (l.markup_percent ?? 0) / 100) * qty);
}

/**
 * The markup of a part in both forms, whatever mode it is kept in: the AED added per unit and the percentage of the
 * cost (null when the cost is 0). The parts list shows both on every line.
 */
export function markupBoth(l: MarkupFields): { percent: number | null; aed: number; sell: number } {
  const cost = l.unit_cost ?? 0;
  const sell = costPlusMarkup(l, 1);
  const aedPart = round2(sell - cost);
  return { percent: cost > 0 ? Math.round((aedPart / cost) * 10000) / 100 : null, aed: aedPart, sell };
}

/** The markup as a percentage of the cost, from either mode (the minimum and the reminders read this). */
export function effectiveMarkupPercent(l: MarkupFields): number {
  const cost = l.unit_cost ?? 0;
  if (!(cost > 0)) return l.markup_mode === "aed" ? ((l.markup_aed ?? 0) > 0 ? Number.POSITIVE_INFINITY : 0) : (l.markup_percent ?? 0);
  if (l.markup_mode === "aed") return ((l.markup_aed ?? 0) / cost) * 100;
  return l.markup_percent ?? 0;
}

/** A typed SELLING price per unit, turned into the markup in the line's own mode (the percent keeps six decimals so it lands exactly). */
export function markupFromSell(l: MarkupFields, sell: number): { markup_percent?: number; markup_aed?: number } {
  const cost = l.unit_cost ?? 0;
  if (l.markup_mode === "aed") return { markup_aed: round2(sell - cost) };
  if (!(cost > 0)) return {};
  return { markup_percent: Math.round(((sell / cost - 1) * 100) * 1e6) / 1e6 };
}

/** The smallest AED markup per unit that still meets the minimum percentage (rounded up to the fils). */
export function minimumMarkupAed(cost: number | null | undefined, minMarkup: number): number {
  return Math.ceil(Math.max(0, (cost ?? 0) * minMarkup) - 1e-9) / 100;
}

/** The selling price of one line before its own discount. Hidden and complimentary lines sell for nothing. */
export function linePrice(l: Pick<QuoteLine, "line_type" | "quantity" | "unit_cost" | "markup_percent" | "unit_price" | "hours" | "labour_rate" | "visible_to_customer"> & { price_display?: string | null; markup_mode?: MarkupMode | string | null; markup_aed?: number | null }): number {
  if (isHidden(l)) return 0;
  if (isComplimentary(l)) return 0;
  switch (l.line_type) {
    case "part":
      return costPlusMarkup(l, l.quantity || 1);
    case "other":
      return hasCostFloor(l) ? costPlusMarkup(l, l.quantity || 1) : round2((l.unit_price ?? 0) * (l.quantity || 1));
    case "labour":
      return round2((l.hours ?? 0) * (l.labour_rate ?? 0));
    default:
      return round2((l.unit_price ?? 0) * (l.quantity || 1));
  }
}

/** After the line's own discount, before VAT. */
export function lineTotal(l: Pick<QuoteLine, "line_type" | "quantity" | "unit_cost" | "markup_percent" | "unit_price" | "hours" | "labour_rate" | "discount_percent" | "visible_to_customer"> & { price_display?: string | null; markup_mode?: MarkupMode | string | null; markup_aed?: number | null }): number {
  return round2(linePrice(l) * (1 - (l.discount_percent ?? 0) / 100));
}

/** What the line cost us: parts, other with a cost, recovery, and the "our cost" of work done outside (fixed-price services). */
export function lineCost(l: Pick<QuoteLine, "line_type" | "quantity" | "unit_cost"> & { fee_kind?: string | null }): number {
  if (l.line_type === "part" || l.line_type === "other" || l.line_type === "recovery") return round2((l.unit_cost ?? 0) * (l.quantity || 1));
  if (l.line_type === "fee" && l.fee_kind === "bank_charge") return round2(l.unit_cost ?? 0);
  if (l.line_type === "package" || l.line_type === "fee") return round2((l.unit_cost ?? 0) * (l.quantity || 1));
  return 0;
}

/** Work another company does for us (lathe work, an authorised injector service): only a line MARKED
 *  outside work. Our own fixed-price services (film, tint, ceramic...) carry their own materials cost
 *  instead - never "Outside work" (section 4, 21 October 2026). */
export function isOutsideWork(l: Pick<QuoteLine, "line_type"> & { fee_kind?: string | null; outside_work?: boolean }) {
  return (l.line_type === "package" && l.outside_work === true) || (l.line_type === "fee" && l.fee_kind !== "bank_charge");
}

/** The lowest net price allowed for a line with a cost: cost plus the minimum markup, after every discount. */
export function floorPrice(l: Pick<QuoteLine, "unit_cost" | "quantity">, minMarkup: number) {
  return round2((l.unit_cost ?? 0) * (1 + minMarkup / 100) * (l.quantity || 1));
}
/** Why a line with a cost breaks the floor, or null. A markup the owner set below the minimum (confirmed) is allowed.
 *  A line below its COST is the below-cost rule's (belowCostOf): refused, or approved by the owner with a reason. */
export function floorProblem(l: QuoteLine, minMarkup: number): string | null {
  if (!hasCostFloor(l) || isHidden(l) || isComplimentary(l)) return null;
  if (belowCostOf(l)) return null;
  if (l.markup_confirmed && effectiveMarkupPercent(l) < minMarkup) return null;
  const net = lineTotal(l);
  const floor = floorPrice(l, minMarkup);
  if (net + 0.005 < floor) return `net price ${aed(net)} is below cost plus the minimum markup of ${minMarkup}% (${aed(floor)})`;
  return null;
}

/* ------------------------------------------------------------------------------------------------------------------
 * NOTHING BELOW COST (2 November 2026, Q-00039). THE price of a line is costPlusMarkup / linePrice / lineTotal above;
 * THE cost is lineCost (plus a package's computed cost). No line on a quotation, estimate, revision or package sells
 * below its cost unless the owner approved that line with a reason; his approval covers the figures he saw only.
 * ---------------------------------------------------------------------------------------------------------------- */

type BelowCostLine = Pick<QuoteLine, "line_type" | "quantity" | "unit_cost" | "markup_percent" | "unit_price" | "hours" | "labour_rate" | "discount_percent" | "visible_to_customer" | "title"> & {
  price_display?: string | null; markup_mode?: MarkupMode | string | null; markup_aed?: number | null; fee_kind?: string | null; is_active?: boolean;
  option_group?: string | null; chosen?: boolean; left_off?: boolean; package_key?: string | null; package_items?: unknown; installer_hours?: number | null;
  outside_work?: boolean; hours_estimate?: number | null;
  below_cost_reason?: string | null; below_cost_at?: string | null; below_cost_sell_aed?: number | string | null; below_cost_cost_aed?: number | string | null; below_cost_by_name?: string | null;
};

/** A line sold below its cost: the figures, and whether the owner's approval covers them. */
export type BelowCost = { cost: number; sell: number; short: number; approved: boolean; reason: string | null; byName: string | null };

/**
 * What a line is judged with: a package's costing figures (film, tint, ceramic, consumables, installer hours), the
 * bodyshop cost rate for a plain bodyshop service's installer hours, and the line's share of the quotation's header
 * (labour / package) discount - what the line really sells for once that discount comes off.
 */
export type BelowCostOpts = { packageCosting?: PackageCosting | null; bodyshopRate?: number | null; headerDiscount?: number | null };

/**
 * THE cost a line's selling price is held against - the same figures the internal box counts for it: what the line
 * costs us (lineCost: parts, other charges with a cost, recovery, a service's "our cost"); on a bodyshop service its
 * installer hours at the bodyshop rate and, on a plain PPF line, its share of the film; a package's computed cost (film,
 * tint, ceramic, consumables and installer hours) when the costing is given. Labour has its own floor (the standard rate).
 */
export function costOfLine(l: BelowCostLine, opts: BelowCostOpts = {}): number {
  let cost = lineCost(l);
  if (l.line_type === "package") {
    const c = opts.packageCosting ?? null;
    if (l.package_key && c) {
      cost += packageLineCost({ title: l.title, itemLabels: packageItemLabels(l.package_items), installerHours: l.installer_hours ?? null }, c).total;
    } else {
      // quoteTotals: installer hours on a service line (or a package without the costing) cost the bodyshop rate.
      cost += (Number(l.installer_hours) || 0) * Math.max(0, opts.bodyshopRate ?? c?.ratePerHour ?? 0);
      // quoteTotals: a plain PPF line with no typed cost of its own uses its share of a whole car's film.
      if (!l.package_key && c && !isOutsideWork(l) && !(lineCost(l) > 0) && lineIsPpf(l)) cost += plainPpfFilm(l, c);
    }
  }
  return round2(cost);
}

/** Whether the quotation needs the package costing figures to judge its lines: a package, or a plain PPF service, that
 *  is judged at all (not free, hidden or left out). */
export function needsPackageCosting(lines: (Pick<QuoteLine, "is_active" | "line_type" | "package_key" | "left_off" | "option_group" | "chosen" | "title" | "package_items" | "visible_to_customer"> & { price_display?: string | null; fee_kind?: string | null })[]): boolean {
  return lines.some((l) => l.is_active && !isUnchosen(l) && !isHidden(l) && !isComplimentary(l) && l.line_type === "package" && (!!l.package_key || lineIsPpf(l)));
}

/**
 * Is the line selling below its cost? Null when it is not (or it is not judged: labour, a hidden or complimentary line,
 * an option not used, a part left off, or a line still without its price - "enter the price" catches that one). The
 * selling price is the line's own total LESS its share of the header discount (headerDiscountShares): a package
 * discount can take a package below its cost as surely as a typed price.
 */
export function belowCostOf(l: BelowCostLine, opts: BelowCostOpts = {}): BelowCost | null {
  if (l.line_type === "labour" || l.is_active === false) return null;
  if (isHidden(l) || isComplimentary(l) || isUnchosen(l)) return null;
  const costed = l.line_type === "part" || hasCostFloor(l);
  if (costed ? l.unit_cost === null || l.unit_cost === undefined : !(Number(l.unit_price) > 0)) return null;
  const cost = costOfLine(l, opts);
  if (!(cost > 0)) return null;
  const sell = round2(lineTotal(l) - Math.max(0, Number(opts.headerDiscount) || 0));
  if (sell + 0.005 >= cost) return null;
  const okSell = l.below_cost_sell_aed === null || l.below_cost_sell_aed === undefined ? null : Number(l.below_cost_sell_aed);
  const okCost = l.below_cost_cost_aed === null || l.below_cost_cost_aed === undefined ? null : Number(l.below_cost_cost_aed);
  // The owner's approval covers what he saw: never a lower price, never a higher cost.
  const approved = !!l.below_cost_at && okSell !== null && sell + 0.005 >= okSell && (okCost === null || cost <= okCost + 0.005);
  return { cost, sell, short: round2(cost - sell), approved, reason: approved ? (l.below_cost_reason ?? null) : null, byName: approved ? (l.below_cost_by_name ?? null) : null };
}

/**
 * The header discount (labour / package discount) shared over the lines it comes off, in proportion to their price, the
 * remainder on the largest: what each line really sells for once it is taken off. Empty when there is no discount.
 */
export function headerDiscountShares(lines: QuoteLine[], q: QuoteHeaderForTotals): Map<string, number> {
  const out = new Map<string, number>();
  const counted = lines.filter((l) => l.is_active && !isUnchosen(l) && !l.left_off);
  const { base, discount } = labourDiscountOf(counted, q);
  if (!(discount > 0) || !(base > 0)) return out;
  const takers = counted.filter((l) => (q.discount_kind ? takesLabourDiscount(l, q.discount_scope) : takesTotalDiscount(l)) && lineTotal(l) > 0);
  let given = 0;
  let largest: QuoteLine | null = null;
  for (const l of takers) {
    const share = round2((discount * lineTotal(l)) / base);
    out.set(l.id, share);
    given = round2(given + share);
    if (!largest || lineTotal(l) > lineTotal(largest)) largest = l;
  }
  if (largest) out.set(largest.id, round2((out.get(largest.id) ?? 0) + discount - given));
  return out;
}

/** Every line of a quotation below its cost (approved or not), each judged after its share of the header discount. */
export function belowCostAll(lines: QuoteLine[], q: QuoteHeaderForTotals | null, opts: Omit<BelowCostOpts, "headerDiscount"> = {}): Map<string, BelowCost> {
  const shares = q ? headerDiscountShares(lines, q) : new Map<string, number>();
  const out = new Map<string, BelowCost>();
  for (const l of lines) {
    const b = belowCostOf(l, { ...opts, headerDiscount: shares.get(l.id) ?? 0 });
    if (b) out.set(l.id, b);
  }
  return out;
}

/** Below cost now with no approval covering it, and worse than before (a lower price or a higher cost), else null. */
export function worseBelowCost(was: BelowCost | null, now: BelowCost | null): BelowCost | null {
  if (!now || now.approved) return null;
  if (was && now.sell + 0.005 >= was.sell && now.cost <= was.cost + 0.005) return null;
  return now;
}

/**
 * A change that puts a line below its cost, or deeper below it, with no approval covering it: what the save refuses for
 * everyone but the owner (who gives a reason). A line already below its cost (Parts raised the cost) can still be
 * changed in any way that does not make it worse - the urgency, a note, a higher price.
 */
export function belowCostChange(before: BelowCostLine | null, after: BelowCostLine, opts: BelowCostOpts & { headerDiscountBefore?: number | null } = {}): BelowCost | null {
  const was = before ? belowCostOf(before, { ...opts, headerDiscount: opts.headerDiscountBefore ?? opts.headerDiscount }) : null;
  return worseBelowCost(was, belowCostOf(after, opts));
}

/**
 * THE check of a change to a quotation (a line, a new line, the header discount): every line it puts below its cost or
 * deeper below it, with no approval covering it - each line judged after its share of the header discount, so lowering
 * a labour line under an AED discount can take a package below cost too. Empty when the change is fine.
 */
export function belowCostChangesIn(before: { lines: QuoteLine[]; q: QuoteHeaderForTotals | null }, after: { lines: QuoteLine[]; q: QuoteHeaderForTotals | null }, opts: Omit<BelowCostOpts, "headerDiscount"> = {}): { line: QuoteLine; below: BelowCost }[] {
  const was = belowCostAll(before.lines, before.q, opts);
  const now = belowCostAll(after.lines, after.q, opts);
  const out: { line: QuoteLine; below: BelowCost }[] = [];
  for (const l of after.lines) {
    const w = worseBelowCost(was.get(l.id) ?? null, now.get(l.id) ?? null);
    if (w) out.push({ line: l, below: w });
  }
  return out;
}

/**
 * The fields of a line change that can never be refused for selling below cost: what the line COSTS (a cost is a fact -
 * a typed "our cost", the installer hours, the package's items, the name a package is costed by) and plain words
 * (notes, urgency, positions...). A change touching only these is saved; a line it puts below cost is written down and
 * stops the send until the price is raised or the owner approves it. Every other field is price-side: refused when it
 * makes a line sell below its cost (the owner: with his reason).
 */
export const NOT_PRICE_KEYS = new Set([
  // cost-side
  "unit_cost", "installer_hours", "package_items", "hours_estimate", "title",
  // plain words and settings that never change a price or a cost
  "details", "urgency", "positions", "group_label", "source_type", "source_key", "parent_line_id", "dangerous", "cut_method", "cut_note", "film_colour", "film_code", "tint_percent", "parts_note", "discount_reason", "recovery_provider", "service_id", "price_per",
  // the request itself
  "id", "below_cost_reason",
]);
export const priceSideKeys = (patch: Record<string, unknown>) => Object.keys(patch).filter((k) => !NOT_PRICE_KEYS.has(k));

/** "FRONT RH HEAD LIGHT would sell at AED 5,000.00, below its cost of AED 5,502.73 (AED 502.73 under)". */
export function belowCostWords(title: string | null | undefined, b: Pick<BelowCost, "cost" | "sell" | "short">): string {
  return `${(title ?? "").trim() || "This line"} would sell at ${aed(b.sell)}, below its cost of ${aed(b.cost)} (${aed(b.short)} under)`;
}

/** The left/right words of a part name ("FRONT LH LIGHT"), for finding the same part on the other SIDE. Front and rear stay:
 *  a front and a rear part are different parts (a rear brake disc is not the front one's twin). */
const LEFT_RIGHT_WORDS = /\b(left|right|lh|rh|l\/h|r\/h|pair|both|all\s*4|all four)\b/gi;
/** A part's name without its left/right side: "FRONT LH LIGHT" and "FRONT RH LIGHT" are both "front light"; "REAR
 *  BRAKE DISCS" stays "rear brake discs". FL/FR read as front, RL/RR as rear. */
export function sidelessName(title: string | null | undefined): string {
  return String(title ?? "")
    .toLowerCase()
    .replace(/\b(fl|fr)\b/g, "front")
    .replace(/\b(rl|rr)\b/g, "rear")
    .replace(LEFT_RIGHT_WORDS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** The markup a part gets when it joins a quotation after the first version, and why. */
export type MarkupPick = { markup_mode: MarkupMode; markup_percent: number; markup_aed: number | null; source: "twin" | "quotation" | "minimum"; from: string | null };

type MarkupSource = { title: string; partNumber?: string | null; unit_cost: number | null; markup_mode?: MarkupMode | string | null; markup_percent: number | null; markup_aed?: number | null };

/** A cost under this is a placeholder (AED 1.00 typed to hold a line), never a figure a markup is learnt from. */
export const REAL_COST_MIN_AED = 10;

/**
 * A part added after approval or by a revision takes the quotation's own markup, never silently the bare minimum: the
 * matching part's (the same part number, or the same name on the other side), else the percentage markup used most on
 * the quotation's parts (a tie goes to the LOWER one), else the minimum. Only parts with a real cost teach a markup: a
 * placeholder cost (AED 1.00 + AED 870 is "87,000%") and AED markups never set the percentage for another part. Never
 * below the minimum (so never below cost). Part numbers come compacted.
 */
export function markupForAddedPart(others: MarkupSource[], part: { title: string; partNumber?: string | null; cost: number | null }, minMarkup: number): MarkupPick {
  const cost = Number(part.cost) || 0;
  const costed = others.filter((o) => Number(o.unit_cost) >= REAL_COST_MIN_AED);
  const pn = (part.partNumber ?? "").trim();
  const name = sidelessName(part.title);
  const twin = costed.find((o) => pn.length >= 4 && (o.partNumber ?? "").trim() === pn) ?? (name ? costed.find((o) => sidelessName(o.title) === name) : undefined);
  if (twin) {
    if (twin.markup_mode === "aed") {
      const amt = Math.max(Number(twin.markup_aed) || 0, minimumMarkupAed(cost, minMarkup));
      return { markup_mode: "aed", markup_percent: Number(twin.markup_percent) || minMarkup, markup_aed: round2(amt), source: "twin", from: twin.title };
    }
    return { markup_mode: "percent", markup_percent: Math.max(minMarkup, Number(twin.markup_percent) || 0), markup_aed: null, source: "twin", from: twin.title };
  }
  const counts = new Map<number, number>();
  for (const o of costed) {
    if (o.markup_mode === "aed") continue;
    const p = Math.round(effectiveMarkupPercent(o) * 100) / 100;
    if (Number.isFinite(p)) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  if (best && best[0] > minMarkup) return { markup_mode: "percent", markup_percent: best[0], markup_aed: null, source: "quotation", from: null };
  return { markup_mode: "percent", markup_percent: minMarkup, markup_aed: null, source: "minimum", from: null };
}

/** "80% (same as FRONT LH LIGHT)", "30% (most used on this quotation)", "5% (the minimum)". */
export function markupPickWords(p: MarkupPick, cost?: number | null): string {
  const what = p.markup_mode === "aed" ? `AED ${round2(p.markup_aed ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2 })} each` : `${Math.round(p.markup_percent * 100) / 100}%`;
  void cost;
  return `${what} ${p.source === "twin" ? `(same as ${p.from})` : p.source === "quotation" ? "(most used on this quotation)" : "(the minimum)"}`;
}

/**
 * A cost far under what the same part cost elsewhere (its twin on the job, the last price for the same part number):
 * the first reference it is under HALF of, in words; null when none. The supplier's discount taken twice (Q-00039:
 * list 12,228.30 already net, less 55% again) shows up here.
 */
export function cheapCostWarning(cost: number | null | undefined, refs: { label: string; cost: number | null | undefined }[], /** Below this share of a reference it is flagged (0.5 = under half; Settings > Money). */ share = 0.5): string | null {
  const c = Number(cost);
  if (!(c > 0)) return null;
  for (const r of refs) {
    const rc = Number(r.cost);
    if (rc > 0 && c < rc * share) return `cost ${aed(c)} is ${Math.round((1 - c / rc) * 100)}% under ${r.label} (${aed(rc)})`;
  }
  return null;
}

export type LineForDiff = { unit_cost: number | string | null; quantity: number | string | null; part_type?: string | null; brand?: string | null; positions?: string[] | null };
type PartForDiff = Pick<PartItem, "cost_aed" | "quantity" | "confirmed_quantity" | "part_type" | "brand" | "positions" | "is_active" | "confirm_status">;
const posKey = (p: string[] | null | undefined) => (p ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean).sort().join(",");
const typeWord = (t: string | null | undefined) => (t ? (PART_TYPE_LABELS[t] ?? t).toUpperCase() : "NONE");

/**
 * How a part's line differs from the part itself: taken off (the line goes), the cost or quantity (money), and the
 * type, brand or side the customer sees (in words). The owner's box and the new version follow the same answer. The
 * name is left out: a line's customer name may be the owner's own words.
 */
export function partLineChanges(l: LineForDiff, p: PartForDiff): { gone: boolean; money: boolean; words: string[] } {
  const gone = p.confirm_status === "rejected" || p.is_active === false;
  const qty = Number(p.confirmed_quantity ?? p.quantity) || 1;
  const money = Number(p.cost_aed ?? -1) !== Number(l.unit_cost ?? -1) || qty !== (Number(l.quantity) || 1);
  const words: string[] = [];
  if ((p.part_type ?? null) !== (l.part_type ?? null)) words.push(`type ${typeWord(l.part_type)} → ${typeWord(p.part_type)}`);
  if (String(p.brand ?? "").trim().toLowerCase() !== String(l.brand ?? "").trim().toLowerCase()) words.push(`brand ${String(l.brand ?? "").trim().toUpperCase() || "NONE"} → ${String(p.brand ?? "").trim().toUpperCase() || "NONE"}`);
  if (posKey(p.positions) !== posKey(l.positions)) words.push(`side ${(l.positions ?? []).join(", ").toUpperCase() || "NONE"} → ${(p.positions ?? []).join(", ").toUpperCase() || "NONE"}`);
  return { gone, money, words };
}

/** One part (or early charge) the owner would let into a revised quotation: what it costs and what it would sell for (his box). */
export type RevisionPreviewRow = {
  /** The part's id, or the early charge's id for a charge row. */
  partId: string;
  kind: "added" | "changed" | "removed" | "charge";
  /** For a changed part: what changed besides the cost and quantity, in words ("type OEM → GENUINE"). */
  changes?: string[];
  title: string;
  supplier: string | null;
  list: number | null;
  discount: number | null;
  cost: number | null;
  /** The cost on the approved quotation, for a changed part. */
  oldCost: number | null;
  qty: number;
  sell: number | null;
  markupWords: string | null;
  below: BelowCost | null;
  cheap: string | null;
};
/** Red on the owner's box: it would sell below cost, or its cost is far under the same part elsewhere. */
export const revisionRowRed = (r: Pick<RevisionPreviewRow, "below" | "cheap">) => !!(r.below && !r.below.approved) || !!r.cheap;
/** The red words of a row, for the box, the bell and the event. */
export function revisionRowWarning(r: Pick<RevisionPreviewRow, "title" | "below" | "cheap">): string | null {
  if (r.below && !r.below.approved) return belowCostWords(r.title, r.below);
  if (r.cheap) return `${r.title}: ${r.cheap} – check the Parts price before allowing`;
  return null;
}

export type QuoteTotals = {
  subtotal: number;
  /** The sum of the lines' own discounts (already inside subtotal), for the green rows on the documents. */
  lineDiscounts: number;
  discountBase: number;
  /** The labour discount (our own labour lines), or the old labour-and-services discount on older quotations. */
  discount: number;
  /** The round-off: the adjustment to the pre-VAT amount so the grand total lands on a whole number. Negative = off. */
  rounding: number;
  net: number;
  vat: number;
  total: number;
  partsCost: number;
  partsSell: number;
  partsMargin: number;
  /** Part lines still without a price from Parts: the parts margin is incomplete while any remain. */
  partsUnpriced: number;
  labourSell: number;
  /** The hours the customer pays for. */
  labourHours: number;
  /** The workshop's estimate of the hours (per line, defaulting to the quoted hours), after the sanity checks. */
  labourEstimateHours: number;
  /** The Est. h boxes as typed, before the sanity checks (for the warning text). */
  labourEstimateEntered: number;
  /** Labour lines whose Est. h is over ESTIMATE_MAX_LINE_HOURS: shown amber, the quoted hours stand in for them. */
  estimateSuspectLineIds: string[];
  /** The estimates total more than ESTIMATE_TOTAL_FACTOR times the quoted hours: shown amber, the quoted hours stand in. */
  estimateTotalSuspect: boolean;
  /** Bodyshop materials (film, paint, consumables) from the internal box. */
  materialsCost: number;
  /** The suppliers' own charges on the job's parts (courier, freight): an internal cost from the Parts page. */
  supplierCharges: number;
  /** The hours labour at cost is worked out from: the clocked hours once the work is done, else the estimate. */
  labourCostHours: number;
  labourCostBasis: "estimate" | "clocked";
  labourCost: number;
  /** Fixed-price work done outside (lathe, injector service...): its internal "our cost". */
  outsideCost: number;
  /** Our OWN fixed-price services' typed cost (film, tint, ceramic materials): never "outside work". */
  ownServiceCost: number;
  /** The estimated installer hours on the bodyshop/service lines (internal), and their cost at the bodyshop rate. */
  installerHours: number;
  bodyshopLabourCost: number;
  /** Recovery, Other and fee lines the customer pays for. */
  otherSell: number;
  /** What those lines, hidden or shown, cost us. */
  otherCost: number;
  hiddenCost: number;
  /** What the recovery lines cost us (part of otherCost). */
  recoveryCost: number;
  bankCharge: number;
  /** Commission we pay someone: internal only, counted once the owner approved it. */
  commission: number;
  /** 30 October 2026: the packages' materials (film, tint, ceramic, consumables) - zero without the costing figures. */
  packageMaterials: { film: number; filmRolls: number; tint: number; ceramic: number; consumables: number; total: number };
  /** The packages' selling price (before the discount). */
  packageSell: number;
  /** A commission waits for the owner: not counted yet, profit shows "(commission pending)". */
  commissionPending: boolean;
  totalCost: number;
  profit: number;
  labourMargin: number;
  /** The deposit the advisor asked for (0 when none). */
  deposit: number;
  /** What the old rule would suggest: a share of the parts above the Settings threshold. */
  depositSuggested: number;
};

/** Which block of the quotation a line sits in: labour and services, parts, or other charges. */
export function blockOf(l: Pick<QuoteLine, "line_type">): "labour" | "parts" | "other" {
  if (l.line_type === "labour" || l.line_type === "package") return "labour";
  if (l.line_type === "part") return "parts";
  return "other";
}

/** A fixed-price service of our own (minor service, major service...): a service line with no "our cost" typed on it. Outside work carries its cost. */
export function isOwnService(l: Pick<QuoteLine, "line_type" | "visible_to_customer" | "unit_cost"> & { fee_kind?: string | null; outside_work?: boolean }) {
  return l.line_type === "package" && !isHidden(l) && !(Number(l.unit_cost) > 0) && !l.outside_work;
}
/** The discount's base: our own labour lines (hours); with the "labour and services" scope our own services too. Never outside work, parts or other charges. */
export function takesLabourDiscount(l: Pick<QuoteLine, "line_type" | "visible_to_customer" | "unit_cost"> & { fee_kind?: string | null; outside_work?: boolean; package_key?: string | null }, scope: "labour" | "labour_services" | null | undefined = "labour") {
  // Section 8 (21 October): a bodyshop PACKAGE always takes the header discount (it is the "Package
  // discount"), whatever the scope - a package-only quotation has no labour lines to discount.
  return (l.line_type === "labour" && !isHidden(l)) || ((scope === "labour_services" || !!l.package_key) && isOwnService(l));
}
/** "Labour discount (10%)", "Labour and services discount", or the old "Discount (10%)": the same words on the screen, the link, the PDF and the invoice. */
export function discountLabelOf(q: Pick<QuoteHeaderForTotals, "discount_kind" | "discount_value" | "discount_percent" | "discount_scope">, opts: { hasPackage?: boolean } = {}): string {
  // Section 8 (21 October): a quotation built around a package calls its discount a PACKAGE discount
  // on every document (the same helper serves the editor, the link, the PDFs and the invoice).
  const words = opts.hasPackage ? "Package discount" : q.discount_scope === "labour_services" ? "Labour and services discount" : "Labour discount";
  if (q.discount_kind === "percent") return `${words} (${q.discount_value}%)`;
  if (q.discount_kind === "aed") return words;
  return `${opts.hasPackage ? "Package discount" : "Discount"} (${q.discount_percent ?? 0}%)`;
}

/** Whether the quotation carries a chosen package line (the Package discount wording follows it). */
export function hasPackageLine(lines: Pick<QuoteLine, "is_active" | "package_key" | "left_off" | "option_group" | "chosen">[]): boolean {
  return lines.some((l) => l.is_active && !!l.package_key && !isUnchosen(l));
}
/** A service with an explicit kind follows it; otherwise a price means a fixed-price service and no price means labour by the hour. */
export function isFixedService(s: Pick<Service, "price_aed" | "line_kind">) {
  return s.line_kind ? s.line_kind === "service" : s.price_aed !== null;
}
/** Pinned to the top of the pickers and of Most used: the one standard labour line, and the two services. */
export const PINNED_LABOUR = ["labour charges"];
export const PINNED_SERVICES = ["minor service", "major service"];
export const pinnedRank = (name: string) => { const i = [...PINNED_LABOUR, ...PINNED_SERVICES].indexOf(name.trim().toLowerCase()); return i < 0 ? 99 : i; };

/**
 * The labour discount before the round-off: a percentage or a fixed amount of our own labour lines. Quotations
 * from before the rule (no discount kind) keep the old percentage of labour and services.
 */
export function labourDiscountOf(counted: QuoteLine[], q: QuoteHeaderForTotals): { base: number; discount: number } {
  if (q.discount_kind) {
    const base = round2(counted.filter((l) => takesLabourDiscount(l, q.discount_scope)).reduce((a, l) => a + lineTotal(l), 0));
    const v = Number(q.discount_value) || 0;
    const discount = q.discount_kind === "percent" ? round2(base * (Math.min(100, Math.max(0, v)) / 100)) : round2(Math.min(base, Math.max(0, v)));
    return { base, discount };
  }
  const base = round2(counted.filter(takesTotalDiscount).reduce((a, l) => a + lineTotal(l), 0));
  return { base, discount: round2(base * ((q.discount_percent ?? 0) / 100)) };
}

export function quoteTotals(
  lines: QuoteLine[],
  q: QuoteHeaderForTotals,
  opts: { onlyApproved?: boolean; technicianCostRate?: number; depositThreshold?: number; depositPercent?: number; bankChargePercent?: number; /** The bank's fixed fee per transaction (AED, before VAT) on top of the percentage. */ bankChargeFixed?: number; /** The hours the technicians clocked on the job, once the work is done: labour at cost switches to them. */ clockedHours?: number | null; /** The bodyshop labour rate (AED/h): installer-hour estimates cost this. Leave unset where real clockings are counted instead (profit.ts). */ bodyshopRate?: number | null; /** The job's supplier charges (courier, freight) from the Parts page: an internal cost. */ supplierCharges?: number; /** 30 October 2026: the figures every package line is costed with (film, tint, ceramic, consumables, installer hours) - ONE profit calculation. */ packageCosting?: PackageCosting | null } = {},
): QuoteTotals {
  const counted = lines.filter((l) => l.is_active && !isUnchosen(l) && !l.left_off && (!opts.onlyApproved || l.customer_approved === true));
  const subtotal = round2(counted.reduce((a, l) => a + lineTotal(l), 0));
  // The lines' own discounts (line 1's 22%), shown in green on every customer document.
  const lineDiscounts = round2(counted.reduce((a, l) => a + lineDiscountAmount(l), 0));
  const { base: discountBase, discount } = labourDiscountOf(counted, q);
  const pct = (q.vat_percent ?? 5) / 100;
  let net = round2(subtotal - discount);
  let vat = round2(net * pct);
  let total = round2(net + vat);
  let rounding = 0;
  if (q.rounded_total_aed && q.rounded_total_aed > 0 && net > 0) {
    total = round2(q.rounded_total_aed);
    net = round2(total / (1 + pct));
    vat = round2(total - net);
    rounding = round2(net - (subtotal - discount));
  }
  const parts = counted.filter((l) => blockOf(l) === "parts");
  const partsCost = round2(parts.reduce((a, l) => a + lineCost(l), 0));
  const partsSell = round2(parts.reduce((a, l) => a + lineTotal(l), 0));
  const partsUnpriced = parts.filter((l) => l.unit_cost === null || l.unit_cost === undefined).length;
  const labour = counted.filter((l) => blockOf(l) === "labour");
  const labourLines = labour.filter((l) => l.line_type === "labour");
  const labourHours = round2(labourLines.reduce((a, l) => a + (l.hours ?? 0), 0));
  // Labour at cost is worked out from the Est. h boxes (never the rate or the quoted hours), with two sanity checks: an
  // estimate over ESTIMATE_MAX_LINE_HOURS on a line, or estimates totalling more than ESTIMATE_TOTAL_FACTOR times the
  // quoted hours, are flagged on the screen and the quoted hours stand in for them.
  const labourEstimateEntered = round2(labourLines.reduce((a, l) => a + estimateOf(l), 0));
  const estimateSuspectLineIds = labourLines.filter(estimateLineSuspect).map((l) => l.id);
  const estimateChecked = round2(labourLines.reduce((a, l) => a + (estimateLineSuspect(l) ? (l.hours ?? 0) : estimateOf(l)), 0));
  const estimateTotalSuspect = labourHours > 0 && estimateChecked > ESTIMATE_TOTAL_FACTOR * labourHours;
  const labourEstimateHours = estimateTotalSuspect ? labourHours : estimateChecked;
  const clocked = opts.clockedHours !== undefined && opts.clockedHours !== null && opts.clockedHours > 0 ? round2(opts.clockedHours) : null;
  const labourCostHours = clocked ?? labourEstimateHours;
  const labourSell = round2(labour.reduce((a, l) => a + lineTotal(l), 0));
  const labourCost = round2(labourCostHours * (opts.technicianCostRate ?? 0));
  const outsideCost = round2(labour.filter((l) => isOutsideWork(l)).reduce((a, l) => a + lineCost(l), 0));
  // Our own fixed-price services (film, tint, ceramic...): their typed cost is OUR materials cost,
  // and their estimated installer hours cost bodyshop labour - complimentary lines included.
  const ownServiceCost = round2(labour.filter((l) => l.line_type === "package" && !isOutsideWork(l)).reduce((a, l) => a + lineCost(l), 0));
  // 30 October 2026: ONE profit calculation. With the costing figures, every package line is costed - film (rolls x
  // the finish's roll price), tint (the windows included), ceramic (what is included), consumables and its installer
  // hours - the same everywhere a profit is shown. Without them a package costs only what its line carries.
  const pkgCosts = opts.packageCosting ? labour.filter((l) => !!l.package_key).map((l) => packageLineCost({ title: l.title, itemLabels: packageItemLabels(l.package_items), installerHours: l.installer_hours ?? null }, opts.packageCosting!)) : [];
  const sumOf = (k: "film" | "filmRolls" | "tint" | "ceramic" | "consumables" | "hours") => round2(pkgCosts.reduce((a, c) => a + c[k], 0));
  // Section 5.3 (30 October 2026): PPF on a line that is not a package (a mirror housing, a bumper) uses film too - its
  // share of a whole car's film by its hours - unless the line carries its own typed cost. Never materials of 0.
  const plainFilm = opts.packageCosting ? round2(labour.filter((l) => !l.package_key && !isOutsideWork(l) && !(lineCost(l) > 0) && lineIsPpf(l)).reduce((a, l) => a + plainPpfFilm(l, opts.packageCosting!), 0)) : 0;
  const packageMaterials = { film: round2(sumOf("film") + plainFilm), filmRolls: sumOf("filmRolls"), tint: sumOf("tint"), ceramic: sumOf("ceramic"), consumables: sumOf("consumables"), total: round2(sumOf("film") + plainFilm + sumOf("tint") + sumOf("ceramic") + sumOf("consumables")) };
  const installerHours = round2(labour.filter((l) => l.line_type === "package" && !(opts.packageCosting && l.package_key)).reduce((a, l) => a + (Number(l.installer_hours) || 0), 0) + sumOf("hours"));
  const bodyshopLabourCost = round2(installerHours * Math.max(0, opts.bodyshopRate ?? opts.packageCosting?.ratePerHour ?? 0));
  const packageSell = round2(labour.filter((l) => !!l.package_key).reduce((a, l) => a + lineTotal(l), 0));
  const other = counted.filter((l) => blockOf(l) === "other" && !l.fee_kind);
  const otherSell = round2(other.filter((l) => !isHidden(l)).reduce((a, l) => a + lineTotal(l), 0));
  const otherCost = round2(other.reduce((a, l) => a + lineCost(l), 0));
  const feeLine = counted.find((l) => l.fee_kind === "bank_charge");
  const recoveryCost = round2(other.filter((l) => l.line_type === "recovery").reduce((a, l) => a + lineCost(l), 0));
  // The bank charge: the rate times the total including VAT when a rate is given (live, on the screen); otherwise
  // the automatic hidden Fee line the server keeps, or the old estimate from the card tick.
  // The bank's fee before VAT (the VAT on it is reclaimable): MSF % of the total plus the fee per transaction, rounded like the bank.
  const fixedFee = total > 0 ? Math.max(0, opts.bankChargeFixed ?? 0) : 0;
  const bankCharge = opts.bankChargePercent !== undefined ? (opts.bankChargePercent > 0 || fixedFee > 0 ? round2(roundHalfUp((total * opts.bankChargePercent) / 100) + fixedFee) : 0) : feeLine ? round2(feeLine.unit_cost ?? 0) : q.payment_by_card ? 0 : 0;
  // Commission: a fixed amount, or a percentage of the total before VAT. Internal only. It counts in the
  // costs the moment it is set (shown as "pending owner approval"); it leaves the costs only when the
  // owner declines it. The profit, the team target and the advisor bonus all see the same figure.
  const cv = Number(q.commission_value) || 0;
  const commissionAsked = q.commission_kind === "percent" ? round2(net * (Math.max(0, cv) / 100)) : q.commission_kind === "aed" ? round2(Math.max(0, cv)) : 0;
  const commissionPending = commissionAsked > 0 && q.commission_status === "pending";
  const commission = q.commission_status === "declined" ? 0 : commissionAsked;
  const materialsCost = round2(Math.max(0, Number(q.materials_cost_aed) || 0));
  const supplierCharges = round2(Math.max(0, Number(opts.supplierCharges) || 0));
  const totalCost = round2(partsCost + labourCost + outsideCost + ownServiceCost + bodyshopLabourCost + otherCost + bankCharge + commission + materialsCost + supplierCharges + packageMaterials.total);
  const profit = round2(net - totalCost);
  // The deposit is the advisor's choice on the quotation; the old rule (a share of the parts above a threshold) only suggests.
  const threshold = opts.depositThreshold ?? 0;
  const depositSuggested = threshold > 0 && partsSell > threshold ? round2(partsSell * ((opts.depositPercent ?? 50) / 100)) : 0;
  const dv = Math.max(0, Number(q.deposit_value) || 0);
  const depositRaw = q.deposit_mode === "aed" ? dv : q.deposit_mode === "percent_parts" ? partsSell * (Math.min(100, dv) / 100) : q.deposit_mode === "percent_total" ? total * (Math.min(100, dv) / 100) : 0;
  const deposit = round2(Math.min(total, Math.max(0, depositRaw)));
  return {
    subtotal, lineDiscounts, discountBase, discount, rounding, net, vat, total,
    partsCost, partsSell, partsMargin: round2(partsSell - partsCost), partsUnpriced,
    labourSell, labourHours, labourEstimateHours, labourEstimateEntered, estimateSuspectLineIds, estimateTotalSuspect, labourCostHours, labourCostBasis: clocked !== null ? "clocked" : "estimate", labourCost, outsideCost,
    otherSell, otherCost, hiddenCost: otherCost, recoveryCost, bankCharge, commission, commissionPending, materialsCost, supplierCharges, ownServiceCost, installerHours, bodyshopLabourCost, totalCost, profit,
    packageMaterials, packageSell,
    labourMargin: round2(labourSell - discount - labourCost - outsideCost - ownServiceCost - bodyshopLabourCost - packageMaterials.total),
    deposit,
    depositSuggested,
  };
}

/**
 * THE profit list (30 October 2026, night batch section 3): the same lines on the quotation and estimate, the locked
 * quotation, the job card and everywhere a profit is broken down. The lines always add up to totals.totalCost.
 */
export type ProfitLine = { key: "parts" | "labour" | "materials" | "outside" | "recovery" | "commission" | "bank" | "other"; label: string; detail: string | null; amount: number };

export function profitLines(t: QuoteTotals, rates: { technician: number; bodyshop: number }): ProfitLine[] {
  const h = (n: number) => `${Math.round(n * 10) / 10} h`;
  const a = (n: number) => `AED ${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
  const pm = t.packageMaterials;
  const labourDetail = [
    t.labourCostHours > 0 || t.labourCost > 0 ? `${h(t.labourCostHours)} ${t.labourCostBasis === "clocked" ? "clocked" : "estimate"} × AED ${rates.technician}` : null,
    t.installerHours > 0 ? `${h(t.installerHours)} × AED ${rates.bodyshop}` : null,
  ].filter(Boolean).join(" + ");
  const materialsDetail = [
    pm.film ? (pm.filmRolls ? `PPF film ${pm.filmRolls} roll${pm.filmRolls === 1 ? "" : "s"} ${a(pm.film)}` : `PPF film ${a(pm.film)}`) : null,
    pm.tint ? `tint ${a(pm.tint)}` : null,
    pm.ceramic ? `ceramic ${a(pm.ceramic)}` : null,
    pm.consumables ? `consumables ${a(pm.consumables)}` : null,
    t.ownServiceCost ? `our services' cost ${a(t.ownServiceCost)}` : null,
    t.materialsCost ? `typed materials ${a(t.materialsCost)}` : null,
  ].filter(Boolean).join(" · ");
  const lines: ProfitLine[] = [
    { key: "parts", label: "Parts at cost", detail: null, amount: t.partsCost },
    { key: "labour", label: "Labour at cost", detail: labourDetail || null, amount: round2(t.labourCost + t.bodyshopLabourCost) },
    { key: "materials", label: "Materials", detail: materialsDetail || null, amount: round2(pm.total + t.ownServiceCost + t.materialsCost) },
    { key: "outside", label: "Outside work (another company)", detail: null, amount: t.outsideCost },
    { key: "recovery", label: "Recovery", detail: null, amount: t.recoveryCost },
    { key: "commission", label: "Commission", detail: t.commissionPending ? "pending owner approval" : null, amount: t.commission },
    { key: "bank", label: "Bank fee (excl. VAT)", detail: null, amount: t.bankCharge },
    { key: "other", label: "Other internal costs", detail: t.supplierCharges ? "incl. supplier charges" : null, amount: round2(t.otherCost - t.recoveryCost + t.supplierCharges) },
  ];
  return lines;
}

export type SendBlocker = { key: string; label: string };

/** What stops a quotation from being completed and sent. Empty means it can go. */
export function sendBlockers(
  q: Pick<QuoteRow, "kind" | "status"> & Partial<QuoteHeaderForTotals>,
  lines: QuoteLine[],
  parts: PartItem[],
  settings: { minMarkup: number; openRequests?: number; workshopEstimate?: { hours: number | null; agreed: boolean } | null; unquotedFindings?: number; /** A package's computed cost (the below-cost check). */ packageCosting?: PackageCosting | null; /** The bodyshop cost rate: a service's installer hours (the below-cost check). */ bodyshopRate?: number | null; /** Placeholder costs (2 November 2026): the parts whose cost question still waits for Parts' answer, by part id. */ costAsks?: Record<string, string> },
): SendBlocker[] {
  const out: SendBlocker[] = [];
  // Nothing below cost: every line judged after its share of the header discount (THE rule, belowCostAll).
  const belows = belowCostAll(lines, { discount_percent: Number(q.discount_percent) || 0, vat_percent: q.vat_percent ?? 5, discount_kind: q.discount_kind ?? null, discount_value: q.discount_value ?? null, discount_scope: q.discount_scope ?? null }, { packageCosting: settings.packageCosting, bodyshopRate: settings.bodyshopRate });
  const active = lines.filter((l) => l.is_active && !isUnchosen(l) && !l.fee_kind);
  if (active.length === 0) out.push({ key: "lines", label: "Add at least one line" });
  if (settings.openRequests) out.push({ key: "parts", label: `${settings.openRequests} part request${settings.openRequests === 1 ? "" : "s"} still with Parts` });
  if (q.kind === "quotation" && settings.workshopEstimate && settings.workshopEstimate.hours !== null && !settings.workshopEstimate.agreed) out.push({ key: "estimate", label: "The workshop manager has not agreed the technician's estimated hours" });
  if (q.kind === "quotation" && settings.unquotedFindings) out.push({ key: "findings", label: `${settings.unquotedFindings} finding${settings.unquotedFindings === 1 ? "" : "s"} not quoted: add the labour or mark "Not quoting this"` });
  for (const l of active) {
    const short = (l.title || "Line without a description").length > 30 ? (l.title || "Line without a description").slice(0, 28) + "…" : l.title || "Line without a description";
    // Section 13: a line the customer sees must say what it is - never blank, never just "PART".
    if (!isHidden(l) && isNamelessTitle(l.title) && !(!(l.title ?? "").trim() && (l.line_type === "labour" || l.line_type === "other"))) out.push({ key: `line-${l.id}`, label: (l.title ?? "").trim() ? `A line is named just "${l.title.trim()}": write what it is` : "A line has no name: write what it is" });
    if (l.line_type === "part") {
      const p = l.part_item_id ? parts.find((x) => x.id === l.part_item_id) ?? null : null;
      if (p) {
        if (p.confirm_status === "rejected") out.push({ key: `line-${l.id}`, label: `${short}: rejected, remove the line` });
        if (p.cost_aed === null || p.cost_aed === undefined) out.push({ key: `line-${l.id}`, label: `${short}: waiting for the parts price` });
        // Placeholder costs (2 November 2026): a stand-in supplier or an unanswered cost question never goes out - but
        // only while the part is still being priced. A part the customer already approved (to order, ordered, received)
        // is past pricing: nobody can change it here, so it never stops a revision (the LPO gate and Prices to fix hold it).
        else if (!isUnchosen(l) && !l.left_off && (p.order_status ?? "none") === "none" && isPlaceholderSupplier(p.supplier)) out.push({ key: `line-${l.id}`, label: `${short}: "${String(p.supplier).trim()}" is not a supplier – Parts to put the real supplier and price` });
        else if (!isUnchosen(l) && !l.left_off && (p.order_status ?? "none") === "none" && settings.costAsks?.[p.id]) out.push({ key: `line-${l.id}`, label: `${short}: ${settings.costAsks[p.id]} – Parts to confirm the real price` });
      } else if (q.kind === "quotation") out.push({ key: `line-${l.id}`, label: `${short}: not a part from the Parts desk. Remove the line and use "+ Add a part"` });
      // An estimate's unpriced parts are counted once below (30 October 2026); a stand-in supplier never goes out.
      else if (!l.left_off && l.unit_cost !== null && l.unit_cost !== undefined && isPlaceholderSupplier(l.supplier_text)) out.push({ key: `line-${l.id}`, label: `${short}: "${String(l.supplier_text).trim()}" is not a supplier – the real supplier and price first` });
    }
    const comp = isComplimentary(l);
    if (l.line_type === "labour" && !l.title.trim()) out.push({ key: `line-${l.id}`, label: "A labour line has no description: what are we doing?" });
    if (l.line_type === "labour" && !comp && !(l.hours && l.hours > 0)) out.push({ key: `line-${l.id}`, label: `${short}: enter the hours` });
    // Section 6.6 (30 October 2026): a protection package at AED 0.00 never goes out - its price is typed, never left blank.
    if (l.package_key && !comp && !(l.unit_price && l.unit_price > 0)) out.push({ key: `line-${l.id}`, label: `${short}: set the package price first` });
    else if ((l.line_type === "package" || l.line_type === "fee") && !comp && !isHidden(l) && !(l.unit_price && l.unit_price > 0)) out.push({ key: `line-${l.id}`, label: `${short}: enter the price` });
    if (l.line_type === "other" && !(l.title ?? "").trim()) out.push({ key: `line-${l.id}`, label: "An Other charge has no description" });
    if (l.line_type === "other" && !comp && !hasCostFloor(l) && !isHidden(l) && !(l.unit_price && l.unit_price > 0)) out.push({ key: `line-${l.id}`, label: `${short}: enter the price` });
    if (l.line_type === "recovery" && l.recovery_provider_kind !== "customer" && (l.unit_cost === null || l.unit_cost === undefined)) out.push({ key: `line-${l.id}`, label: `${short}: enter the cost per trip` });
    if (l.line_type === "recovery" && l.recovery_provider_kind !== "customer" && !comp && !isHidden(l) && !(l.unit_price && l.unit_price > 0)) out.push({ key: `line-${l.id}`, label: `${short}: enter the price per trip, or hide the line` });
    const floor = floorProblem(l, settings.minMarkup);
    if (floor) out.push({ key: `line-${l.id}`, label: `${short}: ${floor}` });
    // Nothing goes out below its cost without the owner's approval of that line (2 November 2026).
    const below = belows.get(l.id);
    if (below && !below.approved) out.push({ key: `line-${l.id}`, label: `${short}: sells at ${aed(below.sell)}, below its cost of ${aed(below.cost)} – raise the price, or the owner approves it` });
  }
  // An estimate is never sent with a part still unpriced: "2 parts still waiting for the parts desk", the tap goes to
  // the first of them (send it, price it yourself, or remove the line).
  if (q.kind === "estimate") {
    const { notSent, withDesk } = unpricedEstimateParts(active);
    if (withDesk.length) out.push({ key: `line-${withDesk[0].id}`, label: waitingWords(withDesk.length, true) });
    if (notSent.length) out.push({ key: `line-${notSent[0].id}`, label: `${waitingWords(notSent.length, false)}: send to the parts desk, type the price you have, or remove the line` });
  }
  return out;
}

/** The customer's wording for a recovery line: "Recovery, closed box, two ways". */
export function recoveryTitle(typeLabel: string | null | undefined, trips: number | null | undefined, free = false): string {
  // A free recovery reads as a gift, not as a logistics code ("RECOVERY, NORMAL, TWO WAYS: FREE OF CHARGE").
  if (free) return "Complimentary pick-up & drop-off";
  const t = Math.max(1, Math.round(Number(trips) || 1));
  const way = t === 1 ? "one way" : t === 2 ? "two ways" : `${t} trips`;
  return `Recovery${typeLabel ? `, ${typeLabel.toLowerCase()}` : ""}, ${way}`;
}

/** Whole-dirham totals to offer when sending: the nearest ten below (the default) and above. */
export function roundingChoices(total: number): { down: number; up: number } {
  const down = Math.floor(total / 10) * 10;
  const up = Math.ceil(total / 10) * 10;
  return { down: down > 0 ? down : Math.round(total), up: up === down ? down + 10 : up };
}

/** How long the work takes once approved: the latest part delivery, then the labour in working days. */
export function estimatedDaysAfterApproval(lines: QuoteLine[], parts: PartItem[], today: string, wt: WorkingTime): number {
  const hours = lines.filter((l) => l.is_active && !isUnchosen(l) && l.line_type === "labour").reduce((a, l) => a + (l.hours ?? 0), 0);
  const dayHours = wt.closeHour > wt.openHour ? wt.closeHour - wt.openHour : 8;
  const labourDays = Math.max(1, Math.ceil(hours / dayHours));
  const latest = latestDelivery(lines, parts);
  const deliveryDays = latest && latest > today ? Math.max(0, Math.round((Date.parse(latest) - Date.parse(today)) / 86400000)) : 0;
  return deliveryDays + labourDays;
}

/** Why the owner must approve before sending: a discount above the advisor's limit, a part discount, or a total above the optional threshold. */
/**
 * Why a quotation needs the owner before it can go out. The advisor's discount limit (Settings, default
 * 10%) is measured as a share of the LABOUR the discount applies to, and the round-off given at sending
 * counts toward it; within the limit the advisor sends it himself, above it the quotation waits as
 * pending_owner ("Waiting for the owner: discount 18% of labour (limit 10%)"). The owner is never limited.
 */
/**
 * The discount against the advisor's limit, in one place: the amount exactly as given, the share of the labour to
 * one decimal (information only - never used to recalculate the amount), the round-off at sending shown on its own
 * but counted toward the limit.
 */
export function discountAgainstLimit(totals: { discountBase: number; discount: number; rounding?: number | null }, limit: number): { amount: number; roundOff: number; pct: number; over: boolean; words: string } {
  const amount = round2(totals.discount ?? 0);
  const roundOff = round2(Math.max(0, -(totals.rounding ?? 0)));
  const pct = totals.discountBase > 0 ? ((amount + roundOff) / totals.discountBase) * 100 : 0;
  const over = limit > 0 && pct > limit + 0.049;
  return { amount, roundOff, pct, over, words: `${aed(amount)}${roundOff > 0 ? ` + round-off ${aed(roundOff)}` : ""} = ${pct.toFixed(1)}% of labour` };
}

export function ownerApprovalReasons(q: Pick<QuoteRow, "discount_percent">, lines: QuoteLine[], totals: { total: number; discountBase: number; discount: number; rounding: number }, settings: { discountLimit: number; approvalAbove: number }, opts: { discountByOwner?: boolean } = {}): string[] {
  void q;
  const out: string[] = [];
  const d = discountAgainstLimit(totals, settings.discountLimit);
  if (!opts.discountByOwner && d.over) out.push(`discount ${d.words} (limit ${settings.discountLimit}%)`);
  for (const l of lines) {
    if (!l.is_active) continue;
    if (hasCostFloor(l) && (l.discount_percent ?? 0) > 0) out.push(`${l.title}: part discount of ${l.discount_percent}%${l.discount_reason ? ` (${l.discount_reason})` : ""}`);
    else if ((l.discount_percent ?? 0) > settings.discountLimit) out.push(`${l.title}: discount of ${l.discount_percent}% is above the ${settings.discountLimit}% limit`);
  }
  if (settings.approvalAbove > 0 && totals.total > settings.approvalAbove) out.push(`Total of ${aed(totals.total)} is above ${aed(settings.approvalAbove)}`);
  return out;
}

/**
 * Does the owner's approval (the reasons he saw, joined by "; ") still cover the reasons the quotation has now? A
 * reason he saw word for word is covered, and so is a total or a labour discount that has only gone DOWN since. Anything
 * new or bigger goes back to him (B3 review: an approval is for what was approved, never a blank cheque).
 */
export function approvalCovers(approved: string | null | undefined, reasons: string[]): boolean {
  if (!reasons.length) return true;
  if (!approved) return false;
  const seen = approved.split("; ");
  const num = (s: string) => Number(s.replace(/[^\d.]/g, "")) || 0;
  const totalOf = (r: string) => { const m = /^Total of (.+?) is above /.exec(r); return m ? num(m[1]) : null; };
  // "discount AED 5,611.00 + round-off AED 1.52 = 46.8% of labour": the discount itself, and the labour it comes off
  // (worked back from the share, which includes the round-off). The round-off chosen at Send never counts as "more".
  const discountOf = (r: string) => {
    const m = /^discount (.+?) = ([\d.]+)% of labour/.exec(r);
    if (!m) return null;
    const [main, ro = ""] = m[1].split(" + round-off ");
    const pct = Number(m[2]);
    return { main: num(main), base: pct > 0 ? ((num(main) + num(ro)) * 100) / pct : 0 };
  };
  return reasons.every((r) => {
    if (seen.includes(r)) return true;
    const t = totalOf(r);
    if (t !== null) return seen.some((s) => { const st = totalOf(s); return st !== null && st + 0.005 >= t; });
    const d = discountOf(r);
    // Covered when the discount has not grown and the labour has not shrunk (0.5% slack: the share is shown to one decimal).
    if (d) return seen.some((s) => { const sd = discountOf(s); return !!sd && sd.main + 0.005 >= d.main && d.base >= sd.base * 0.995; });
    return false;
  });
}

/** The latest delivery date of the parts on the quote, if any. */
export function latestDelivery(lines: QuoteLine[], parts: PartItem[]): string | null {
  let latest: string | null = null;
  for (const l of lines) {
    if (!l.is_active || l.line_type !== "part" || !l.part_item_id) continue;
    const p = parts.find((x) => x.id === l.part_item_id);
    if (p?.availability === "to_order" && p.delivery_date && (!latest || p.delivery_date > latest)) latest = p.delivery_date;
  }
  return latest;
}

/** Adds working days to a date (YYYY-MM-DD), skipping the days the workshop is closed. */
export function addWorkingDays(from: string, days: number, wt: WorkingTime): string {
  const DAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const open = new Set(wt.workingDays.length ? wt.workingDays : DAY_IDS);
  const d = new Date(from + "T12:00:00Z");
  let left = Math.max(0, Math.ceil(days));
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (open.has(DAY_IDS[d.getUTCDay()])) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** Suggested promised date: the latest part delivery (or today) plus the working days the labour needs. */
export function suggestPromisedDate(lines: QuoteLine[], parts: PartItem[], today: string, wt: WorkingTime): { date: string; latestDelivery: string | null; labourDays: number } {
  const hours = lines.filter((l) => l.is_active && l.line_type === "labour").reduce((a, l) => a + (l.hours ?? 0), 0);
  const dayHours = wt.closeHour > wt.openHour ? wt.closeHour - wt.openHour : 8;
  const labourDays = Math.max(hours > 0 ? 1 : 0, Math.ceil(hours / dayHours));
  const latest = latestDelivery(lines, parts);
  const start = latest && latest > today ? latest : today;
  return { date: addWorkingDays(start, labourDays, wt), latestDelivery: latest, labourDays };
}

/** The plain-word state of a job's quotation for the stage card, the Next step panel and the dashboard. */
export type QuoteSummary = {
  quotation: Pick<QuoteRow, "id" | "number" | "version" | "status" | "token" | "sent_at" | "opened_at" | "responded_at" | "approver_name" | "total_aed" | "approved_total_aed" | "valid_until" | "promised_at" | "created_at"> & { completed_at?: string | null; viewed_full_at?: string | null } | null;
  waitingPrices: number;
  waitingConfirm: number;
  rejectedParts: number;
  openRequests: number;
  /** Progress for the stage card: parts priced and labour lines with hours. */
  partsTotal?: number;
  partsPriced?: number;
  labourTotal?: number;
  labourDone?: number;
};

export type QuoteState = { key: "none" | "pending_parts" | "pending_confirm" | "finish" | "ready" | "link" | "pending_owner" | "sent" | "opened" | "approved" | "urgent_requested" | "declined" | "expired"; text: string; waitingOn: "advisor" | "parts" | "technician" | "owner" | "customer" | "nobody"; tone: "neutral" | "amber" | "green" | "red" };

/** "Parts 12 of 12 priced · Labour 4 of 9 lines done", or nothing when there is nothing to count. */
export function quoteProgressText(s: QuoteSummary): string {
  const bits: string[] = [];
  if (s.partsTotal) bits.push(`Parts ${s.partsPriced ?? 0} of ${s.partsTotal} priced`);
  if (s.labourTotal) bits.push(`Labour ${s.labourDone ?? 0} of ${s.labourTotal} line${s.labourTotal === 1 ? "" : "s"} done`);
  return bits.join(" · ");
}

export function quoteState(s: QuoteSummary, hasInspectionApproved: boolean): QuoteState {
  const q = s.quotation;
  if (!q) return hasInspectionApproved ? { key: "none", text: "Pending quote", waitingOn: "advisor", tone: "neutral" } : { key: "none", text: "Not started", waitingOn: "nobody", tone: "neutral" };
  switch (q.status) {
    case "draft":
      if (q.token) return { key: "link", text: "Link created, not sent yet", waitingOn: "advisor", tone: "neutral" };
      if (q.completed_at) return { key: "ready", text: "Complete, ready to send", waitingOn: "advisor", tone: "neutral" };
      if (s.waitingPrices > 0 || s.openRequests > 0) return { key: "pending_parts", text: `Being prepared · ${quoteProgressText(s) || `waiting for parts prices (${s.waitingPrices + s.openRequests})`}`, waitingOn: "advisor", tone: "amber" };
      return { key: "finish", text: `Finish the quotation${quoteProgressText(s) ? ` · ${quoteProgressText(s)}` : ""}`, waitingOn: "advisor", tone: "neutral" };
    case "pending_owner":
      return { key: "pending_owner", text: "Waiting for the owner's approval", waitingOn: "owner", tone: "amber" };
    case "sent":
      return { key: "sent", text: "Sent to the customer", waitingOn: "customer", tone: "amber" };
    case "opened":
      return { key: "opened", text: "Opened by the customer", waitingOn: "customer", tone: "amber" };
    case "approved":
      return { key: "approved", text: "Approved by the customer", waitingOn: "nobody", tone: "green" };
    case "urgent_requested":
      return { key: "urgent_requested", text: "Customer asked for urgent work only", waitingOn: "advisor", tone: "amber" };
    case "declined":
      return { key: "declined", text: "Declined by the customer", waitingOn: "nobody", tone: "red" };
    case "expired":
      return { key: "expired", text: "Expired, can be re-sent", waitingOn: "advisor", tone: "red" };
    default:
      return { key: "none", text: QUOTE_STATUS_LABELS[q.status], waitingOn: "nobody", tone: "neutral" };
  }
}

export const AVAILABILITY_LABELS = { in_stock: "In stock", to_order: "To order" } as const;

/** What the customer reads under a part: "In stock", "Today", "Tomorrow", "In 3 days" or "To order". */
export function partAvailabilityText(p: { availability: "in_stock" | "to_order" | null; delivery_date: string | null } | null | undefined, today: string): string | null {
  if (!p) return null;
  return customerAvailabilityWords(p.availability, daysFromDate(p.delivery_date, today));
}
export const CONFIRM_LABELS = { pending: "Waiting for the technician", confirmed: "Confirmed by the technician", rejected: "Rejected by the technician" } as const;

/** The price of one unit as the customer sees it: a part's cost plus markup, labour's hourly rate, or the typed price. */
export function lineUnitPrice(l: Pick<QuoteLine, "line_type" | "unit_cost" | "markup_percent" | "unit_price" | "labour_rate" | "visible_to_customer"> & { markup_mode?: MarkupMode | string | null; markup_aed?: number | null }): number {
  if (isHidden(l)) return 0;
  if (hasCostFloor(l)) return costPlusMarkup(l, 1);
  if (l.line_type === "labour") return round2(l.labour_rate ?? 0);
  return round2(l.unit_price ?? 0);
}

/** "1.5 h" for labour, otherwise the quantity. */
export function lineQuantityText(l: Pick<QuoteLine, "line_type" | "hours" | "quantity">): string {
  if (l.line_type === "labour") return hoursText(l.hours);
  const q = l.quantity || 1;
  return Number.isInteger(q) ? String(q) : q.toFixed(2);
}

/** The positions of a job in words after its name: "Brake pads · front and rear". */
export function withPositions(title: string, positions?: string[] | null): string {
  if (!positions?.length) return title;
  return `${title} · ${positionsWords(positions)}`;
}
export const lineTitleText = (l: Pick<QuoteLine, "title" | "positions">) => withPositions(l.title, l.positions);

/** A name that already says its side ("FRONT LH LIGHT", "HEADLIGHT – FRONT LEFT"): the side is never added twice. */
const SIDE_WORDS = /\b(front|rear|left|right|lh|rh|fl|fr|rl|rr|all\s*4|all four|pair|both)\b/i;
/**
 * A part's ONE name on every document and customer page (1 November 2026, B1): "HEADLIGHT – FRONT LEFT · GENUINE".
 * The side is added only when the name does not already say it, the part type after a dot, all in capitals.
 */
export function partLineName(title: string, positions?: string[] | null, typeText?: string | null, qty?: { quantity: number; unit?: PartUnit | null } | null): string {
  const side = positions?.length && !SIDE_WORDS.test(title) ? ` – ${positionsWords(positions).toUpperCase()}` : "";
  // Section 9 (3 November 2026): litres and sets say so after the name ("ENGINE OIL – ROLLS-ROYCE GENUINE · 8 L").
  const unit = qty ? unitSuffix(qty.quantity, qty.unit) : "";
  return `${title.toUpperCase()}${side}${typeText ? ` · ${typeText.toUpperCase()}` : ""}${unit}`;
}
/** The positions a job can take on the quotation. */
export const JOB_POSITIONS = ["Front left", "Front right", "Rear left", "Rear right", "Front", "Rear", "Left", "Right"] as const;

/** "1,234.00" for the money columns of a document; the currency sits in the heading. */
export const money = (n: number | null | undefined) => round2(n ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The positions-vs-quantity warning of a quotation line ("5 positions ticked but qty is 4 – fix one"), or null.
 * Only counted per-unit lines are checked: parts, and services priced per unit (a left-off or unchosen part never
 * blocks). The editor draws it under the line; "Quotation complete" refuses on the same lines.
 */
export function positionsWarningOf(l: Pick<QuoteLine, "line_type" | "price_per" | "positions" | "quantity" | "left_off" | "option_group" | "chosen">): string | null {
  if (isUnchosen(l as QuoteLine) || l.left_off) return null;
  const perUnit = l.line_type === "part" || (l.line_type === "package" && !!l.price_per && l.price_per !== "job");
  return perUnit ? positionsQtyMismatch(l.positions, l.quantity) : null;
}
