/** Quotations and estimates: line types, the maths, what blocks sending, and plain-word statuses. Safe for the browser. */

import type { WorkingTime } from "./working-time";
import { customerAvailabilityWords, daysFromDate } from "./parts-rows";
import { positionsWords } from "./parts-list";

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
  /** A markup at or above the confirmation level was confirmed by the advisor, with the selling price spelled out. */
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
  film_colour?: string | null;
  film_code?: string | null;
  tint_percent?: number | null;
};

export type QuoteRow = {
  id: string;
  kind: QuoteKind;
  number: string;
  version: number;
  parent_id: string | null;
  job_id: string | null;
  customer_id: string;
  vehicle_id: string | null;
  estimate_id: string | null;
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

export type Service = { id: string; category_id: string; name: string; department: string; price_aed: number | null; default_hours: number | null; /** "labour" (hours typed) or "service" (fixed price, typed when there is no default); null keeps the old rule: a price means a service. */ line_kind?: "labour" | "service" | null; /** A bodyshop package: the stages it brings; the advisor types the price. */ bodyshop_kind?: string | null; price_per?: string | null; usual_quantity?: number | null; time_allowance_hours?: number | null; includes_oil_change?: boolean; description: string | null; parts_requests: string[]; position: number; is_active: boolean; /** Asks "Front, rear or both?" when added. */ position_ask?: boolean; /** The report keys (item keys, "tyre:<pos>", "measure:battery_health") this job answers: it comes first under Suggested. */ suggest_for?: string[] | null; /** Outside work: the "our cost" box shows for everyone, never in the labour discount. */ outside_work?: boolean };
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
/** A line the customer pays nothing for (hidden recovery or other): its cost still counts against profit. */
export function isHidden(l: Pick<QuoteLine, "line_type" | "visible_to_customer"> & { fee_kind?: string | null }) {
  if (l.fee_kind === "bank_charge") return true;
  return (l.line_type === "recovery" || l.line_type === "other") && l.visible_to_customer === false;
}
/** An option the advisor did not pick: it counts for nothing and the customer never sees it. */
export function isUnchosen(l: { option_group?: string | null; chosen?: boolean; left_off?: boolean }) {
  return (!!l.option_group && l.chosen === false) || !!l.left_off;
}
/** The quotation-wide discount applies to labour and services only, never to anything with a cost. */
export function takesTotalDiscount(l: Pick<QuoteLine, "line_type" | "unit_cost" | "visible_to_customer">) {
  return !isHidden(l) && (l.line_type === "labour" || l.line_type === "package" || l.line_type === "fee" || (l.line_type === "other" && (l.unit_cost === null || l.unit_cost === undefined)));
}

/** The selling price of one line before its own discount. Hidden lines sell for nothing. */
export function linePrice(l: Pick<QuoteLine, "line_type" | "quantity" | "unit_cost" | "markup_percent" | "unit_price" | "hours" | "labour_rate" | "visible_to_customer">): number {
  if (isHidden(l)) return 0;
  switch (l.line_type) {
    case "part":
      return round2((l.unit_cost ?? 0) * (1 + (l.markup_percent ?? 0) / 100) * (l.quantity || 1));
    case "other":
      return hasCostFloor(l) ? round2((l.unit_cost ?? 0) * (1 + (l.markup_percent ?? 0) / 100) * (l.quantity || 1)) : round2((l.unit_price ?? 0) * (l.quantity || 1));
    case "labour":
      return round2((l.hours ?? 0) * (l.labour_rate ?? 0));
    default:
      return round2((l.unit_price ?? 0) * (l.quantity || 1));
  }
}

/** After the line's own discount, before VAT. */
export function lineTotal(l: Pick<QuoteLine, "line_type" | "quantity" | "unit_cost" | "markup_percent" | "unit_price" | "hours" | "labour_rate" | "discount_percent" | "visible_to_customer">): number {
  return round2(linePrice(l) * (1 - (l.discount_percent ?? 0) / 100));
}

/** What the line cost us: parts, other with a cost, recovery, and the "our cost" of work done outside (fixed-price services). */
export function lineCost(l: Pick<QuoteLine, "line_type" | "quantity" | "unit_cost"> & { fee_kind?: string | null }): number {
  if (l.line_type === "part" || l.line_type === "other" || l.line_type === "recovery") return round2((l.unit_cost ?? 0) * (l.quantity || 1));
  if (l.line_type === "fee" && l.fee_kind === "bank_charge") return round2(l.unit_cost ?? 0);
  if (l.line_type === "package" || l.line_type === "fee") return round2((l.unit_cost ?? 0) * (l.quantity || 1));
  return 0;
}

/** A fixed-price line done outside (lathe work, an authorised injector service): its internal cost, never shown to the customer. */
export function isOutsideWork(l: Pick<QuoteLine, "line_type"> & { fee_kind?: string | null }) {
  return l.line_type === "package" || (l.line_type === "fee" && l.fee_kind !== "bank_charge");
}

/** The lowest net price allowed for a line with a cost: cost plus the minimum markup, after every discount. */
export function floorPrice(l: Pick<QuoteLine, "unit_cost" | "quantity">, minMarkup: number) {
  return round2((l.unit_cost ?? 0) * (1 + minMarkup / 100) * (l.quantity || 1));
}
/** Why a line with a cost breaks the floor, or null. A markup the owner set below the minimum (confirmed) is allowed. */
export function floorProblem(l: QuoteLine, minMarkup: number): string | null {
  if (!hasCostFloor(l) || isHidden(l)) return null;
  if (l.markup_confirmed && (l.markup_percent ?? 0) < minMarkup) return null;
  const net = lineTotal(l);
  const floor = floorPrice(l, minMarkup);
  if (net + 0.005 < floor) return `net price ${aed(net)} is below cost plus the minimum markup of ${minMarkup}% (${aed(floor)})`;
  return null;
}

export type QuoteTotals = {
  subtotal: number;
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
  /** The hours labour at cost is worked out from: the clocked hours once the work is done, else the estimate. */
  labourCostHours: number;
  labourCostBasis: "estimate" | "clocked";
  labourCost: number;
  /** Fixed-price work done outside (lathe, injector service...): its internal "our cost". */
  outsideCost: number;
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
export function takesLabourDiscount(l: Pick<QuoteLine, "line_type" | "visible_to_customer" | "unit_cost"> & { fee_kind?: string | null; outside_work?: boolean }, scope: "labour" | "labour_services" | null | undefined = "labour") {
  return (l.line_type === "labour" && !isHidden(l)) || (scope === "labour_services" && isOwnService(l));
}
/** "Labour discount (10%)", "Labour and services discount", or the old "Discount (10%)": the same words on the screen, the link, the PDF and the invoice. */
export function discountLabelOf(q: Pick<QuoteHeaderForTotals, "discount_kind" | "discount_value" | "discount_percent" | "discount_scope">): string {
  const words = q.discount_scope === "labour_services" ? "Labour and services discount" : "Labour discount";
  if (q.discount_kind === "percent") return `${words} (${q.discount_value}%)`;
  if (q.discount_kind === "aed") return words;
  return `Discount (${q.discount_percent ?? 0}%)`;
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
  opts: { onlyApproved?: boolean; technicianCostRate?: number; depositThreshold?: number; depositPercent?: number; bankChargePercent?: number; /** The hours the technicians clocked on the job, once the work is done: labour at cost switches to them. */ clockedHours?: number | null } = {},
): QuoteTotals {
  const counted = lines.filter((l) => l.is_active && !isUnchosen(l) && !l.left_off && (!opts.onlyApproved || l.customer_approved === true));
  const subtotal = round2(counted.reduce((a, l) => a + lineTotal(l), 0));
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
  const other = counted.filter((l) => blockOf(l) === "other" && !l.fee_kind);
  const otherSell = round2(other.filter((l) => !isHidden(l)).reduce((a, l) => a + lineTotal(l), 0));
  const otherCost = round2(other.reduce((a, l) => a + lineCost(l), 0));
  const feeLine = counted.find((l) => l.fee_kind === "bank_charge");
  const recoveryCost = round2(other.filter((l) => l.line_type === "recovery").reduce((a, l) => a + lineCost(l), 0));
  // The bank charge: the rate times the total including VAT when a rate is given (live, on the screen); otherwise
  // the automatic hidden Fee line the server keeps, or the old estimate from the card tick.
  const bankCharge = opts.bankChargePercent !== undefined && opts.bankChargePercent > 0 ? round2(total * (opts.bankChargePercent / 100)) : feeLine ? round2(feeLine.unit_cost ?? 0) : q.payment_by_card ? 0 : 0;
  // Commission: a fixed amount, or a percentage of the total before VAT. Internal only. It counts in the
  // costs the moment it is set (shown as "pending owner approval"); it leaves the costs only when the
  // owner declines it. The profit, the team target and the advisor bonus all see the same figure.
  const cv = Number(q.commission_value) || 0;
  const commissionAsked = q.commission_kind === "percent" ? round2(net * (Math.max(0, cv) / 100)) : q.commission_kind === "aed" ? round2(Math.max(0, cv)) : 0;
  const commissionPending = commissionAsked > 0 && q.commission_status === "pending";
  const commission = q.commission_status === "declined" ? 0 : commissionAsked;
  const materialsCost = round2(Math.max(0, Number(q.materials_cost_aed) || 0));
  const totalCost = round2(partsCost + labourCost + outsideCost + otherCost + bankCharge + commission + materialsCost);
  const profit = round2(net - totalCost);
  // The deposit is the advisor's choice on the quotation; the old rule (a share of the parts above a threshold) only suggests.
  const threshold = opts.depositThreshold ?? 0;
  const depositSuggested = threshold > 0 && partsSell > threshold ? round2(partsSell * ((opts.depositPercent ?? 50) / 100)) : 0;
  const dv = Math.max(0, Number(q.deposit_value) || 0);
  const depositRaw = q.deposit_mode === "aed" ? dv : q.deposit_mode === "percent_parts" ? partsSell * (Math.min(100, dv) / 100) : q.deposit_mode === "percent_total" ? total * (Math.min(100, dv) / 100) : 0;
  const deposit = round2(Math.min(total, Math.max(0, depositRaw)));
  return {
    subtotal, discountBase, discount, rounding, net, vat, total,
    partsCost, partsSell, partsMargin: round2(partsSell - partsCost), partsUnpriced,
    labourSell, labourHours, labourEstimateHours, labourEstimateEntered, estimateSuspectLineIds, estimateTotalSuspect, labourCostHours, labourCostBasis: clocked !== null ? "clocked" : "estimate", labourCost, outsideCost,
    otherSell, otherCost, hiddenCost: otherCost, recoveryCost, bankCharge, commission, commissionPending, materialsCost, totalCost, profit,
    labourMargin: round2(labourSell - discount - labourCost - outsideCost),
    deposit,
    depositSuggested,
  };
}

export type SendBlocker = { key: string; label: string };

/** What stops a quotation from being completed and sent. Empty means it can go. */
export function sendBlockers(
  q: Pick<QuoteRow, "kind" | "status">,
  lines: QuoteLine[],
  parts: PartItem[],
  settings: { minMarkup: number; openRequests?: number; workshopEstimate?: { hours: number | null; agreed: boolean } | null; unquotedFindings?: number; confirmPercent?: number },
): SendBlocker[] {
  const out: SendBlocker[] = [];
  const active = lines.filter((l) => l.is_active && !isUnchosen(l) && !l.fee_kind);
  if (active.length === 0) out.push({ key: "lines", label: "Add at least one line" });
  if (settings.openRequests) out.push({ key: "parts", label: `${settings.openRequests} part request${settings.openRequests === 1 ? "" : "s"} still with Parts` });
  if (q.kind === "quotation" && settings.workshopEstimate && settings.workshopEstimate.hours !== null && !settings.workshopEstimate.agreed) out.push({ key: "estimate", label: "The workshop manager has not agreed the technician's estimated hours" });
  if (q.kind === "quotation" && settings.unquotedFindings) out.push({ key: "findings", label: `${settings.unquotedFindings} finding${settings.unquotedFindings === 1 ? "" : "s"} not quoted: add the labour or mark "Not quoting this"` });
  for (const l of active) {
    const short = (l.title || "Line without a description").length > 30 ? (l.title || "Line without a description").slice(0, 28) + "…" : l.title || "Line without a description";
    if (l.line_type === "part") {
      const p = l.part_item_id ? parts.find((x) => x.id === l.part_item_id) ?? null : null;
      if (p) {
        if (p.confirm_status === "rejected") out.push({ key: `line-${l.id}`, label: `${short}: rejected, remove the line` });
        if (p.cost_aed === null || p.cost_aed === undefined) out.push({ key: `line-${l.id}`, label: `${short}: waiting for the parts price` });
      } else if (q.kind === "quotation") out.push({ key: `line-${l.id}`, label: `${short}: not a part from the Parts desk. Remove the line and use "+ Add a part"` });
      else if (l.unit_cost === null || l.unit_cost === undefined) out.push({ key: `line-${l.id}`, label: `${short}: waiting for the parts price` });
      if (settings.confirmPercent && (l.markup_percent ?? 0) >= settings.confirmPercent && !l.markup_confirmed) out.push({ key: `line-${l.id}`, label: `${short}: confirm the markup of ${l.markup_percent}%` });
    }
    if (l.line_type === "labour" && !l.title.trim()) out.push({ key: `line-${l.id}`, label: "A labour line has no description: what are we doing?" });
    if (l.line_type === "labour" && !(l.hours && l.hours > 0)) out.push({ key: `line-${l.id}`, label: `${short}: enter the hours` });
    if ((l.line_type === "package" || l.line_type === "fee") && !(l.unit_price && l.unit_price > 0)) out.push({ key: `line-${l.id}`, label: `${short}: enter the price` });
    if (l.line_type === "other" && !(l.title ?? "").trim()) out.push({ key: `line-${l.id}`, label: "An Other charge has no description" });
    if (l.line_type === "other" && !hasCostFloor(l) && !isHidden(l) && !(l.unit_price && l.unit_price > 0)) out.push({ key: `line-${l.id}`, label: `${short}: enter the price` });
    if (l.line_type === "recovery" && l.recovery_provider_kind !== "customer" && (l.unit_cost === null || l.unit_cost === undefined)) out.push({ key: `line-${l.id}`, label: `${short}: enter the cost per trip` });
    if (l.line_type === "recovery" && l.recovery_provider_kind !== "customer" && !isHidden(l) && !(l.unit_price && l.unit_price > 0)) out.push({ key: `line-${l.id}`, label: `${short}: enter the price per trip, or hide the line` });
    const floor = floorProblem(l, settings.minMarkup);
    if (floor) out.push({ key: `line-${l.id}`, label: `${short}: ${floor}` });
  }
  return out;
}

/** The customer's wording for a recovery line: "Recovery, closed box, two ways". */
export function recoveryTitle(typeLabel: string | null | undefined, trips: number | null | undefined, free = false): string {
  const t = Math.max(1, Math.round(Number(trips) || 1));
  const way = t === 1 ? "one way" : t === 2 ? "two ways" : `${t} trips`;
  return `Recovery${typeLabel ? `, ${typeLabel.toLowerCase()}` : ""}, ${way}${free ? ": free of charge" : ""}`;
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
export function ownerApprovalReasons(q: Pick<QuoteRow, "discount_percent">, lines: QuoteLine[], totals: { total: number; discountBase: number; discount: number; rounding: number }, settings: { discountLimit: number; approvalAbove: number }): string[] {
  void q;
  const out: string[] = [];
  const roundOff = Math.max(0, -(totals.rounding ?? 0));
  const givenAway = round2((totals.discount ?? 0) + roundOff);
  const pct = totals.discountBase > 0 && givenAway > 0 ? (givenAway / totals.discountBase) * 100 : 0;
  if (settings.discountLimit > 0 && pct > settings.discountLimit + 0.049) {
    out.push(`discount ${pct.toFixed(pct >= 10 ? 0 : 1)}% of labour (limit ${settings.discountLimit}%)${roundOff > 0 ? `, the round-off of ${aed(roundOff)} counted` : ""}`);
  }
  for (const l of lines) {
    if (!l.is_active) continue;
    if (hasCostFloor(l) && (l.discount_percent ?? 0) > 0) out.push(`${l.title}: part discount of ${l.discount_percent}%${l.discount_reason ? ` (${l.discount_reason})` : ""}`);
    else if ((l.discount_percent ?? 0) > settings.discountLimit) out.push(`${l.title}: discount of ${l.discount_percent}% is above the ${settings.discountLimit}% limit`);
  }
  if (settings.approvalAbove > 0 && totals.total > settings.approvalAbove) out.push(`Total of ${aed(totals.total)} is above ${aed(settings.approvalAbove)}`);
  return out;
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
export function lineUnitPrice(l: Pick<QuoteLine, "line_type" | "unit_cost" | "markup_percent" | "unit_price" | "labour_rate" | "visible_to_customer">): number {
  if (isHidden(l)) return 0;
  if (hasCostFloor(l)) return round2((l.unit_cost ?? 0) * (1 + (l.markup_percent ?? 0) / 100));
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
/** The positions a job can take on the quotation. */
export const JOB_POSITIONS = ["Front left", "Front right", "Rear left", "Rear right", "Front", "Rear", "Left", "Right"] as const;

/** "1,234.00" for the money columns of a document; the currency sits in the heading. */
export const money = (n: number | null | undefined) => round2(n ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
