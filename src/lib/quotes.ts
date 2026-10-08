/** Quotations and estimates: line types, the maths, what blocks sending, and plain-word statuses. Safe for the browser. */

import type { WorkingTime } from "./working-time";

export const LINE_TYPES = [
  { value: "labour", label: "Labour" },
  { value: "part", label: "Part" },
  { value: "package", label: "Fixed-price package" },
  { value: "outside", label: "Outside work" },
  { value: "fee", label: "Fee" },
] as const;
export type LineType = (typeof LINE_TYPES)[number]["value"];
export const LINE_TYPE_LABELS: Record<LineType, string> = Object.fromEntries(LINE_TYPES.map((t) => [t.value, t.label])) as Record<LineType, string>;

export type QuoteStatus = "draft" | "pending_owner" | "sent" | "opened" | "approved" | "partly_approved" | "declined" | "expired" | "superseded" | "cancelled";
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Being prepared",
  pending_owner: "Waiting for the owner's approval",
  sent: "Sent to the customer",
  opened: "Opened by the customer",
  approved: "Approved by the customer",
  partly_approved: "Partly approved by the customer",
  declined: "Declined by the customer",
  expired: "Expired",
  superseded: "Replaced by a newer version",
  cancelled: "Cancelled",
};

export type QuoteKind = "quotation" | "estimate";

export type QuoteLine = {
  id: string;
  quotation_id: string;
  position: number;
  line_type: LineType;
  title: string;
  details: string | null;
  group_label: string | null;
  source_type: "request" | "item" | "tyre" | "manual" | "estimate" | "package" | null;
  source_key: string | null;
  quantity: number;
  unit_cost: number | null;
  markup_percent: number | null;
  unit_price: number | null;
  hours: number | null;
  labour_rate: number | null;
  discount_percent: number;
  line_total: number;
  part_item_id: string | null;
  package_id: string | null;
  customer_approved: boolean | null;
  is_active: boolean;
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
  owner_approval_reason: string | null;
  owner_approved_by: string | null;
  owner_approved_at: string | null;
  sent_at: string | null;
  sent_by: string | null;
  sent_method: string | null;
  opened_at: string | null;
  responded_at: string | null;
  approver_name: string | null;
  approver_phone: string | null;
  decline_reason: string | null;
  reminded_at: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
};

export type PartItem = {
  id: string;
  job_id: string;
  part_request_id: string | null;
  part_number: string | null;
  description: string;
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
  order_status: "none" | "to_order" | "ordered" | "received";
  added_by_role: string | null;
  is_active: boolean;
  created_at: string;
};

export type PartRequest = {
  id: string;
  job_id: string;
  inspection_id: string | null;
  source_type: "item" | "request" | "tyre" | "manual";
  source_key: string;
  label: string;
  requested_text: string | null;
  status: "open" | "listed" | "done" | "rejected";
  is_active: boolean;
  created_at: string;
};

export const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
export const aed = (n: number | null | undefined) => `AED ${round2(n ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The selling price of one line before its own discount (parts and outside work: cost plus markup; labour: hours by rate). */
export function linePrice(l: Pick<QuoteLine, "line_type" | "quantity" | "unit_cost" | "markup_percent" | "unit_price" | "hours" | "labour_rate">): number {
  switch (l.line_type) {
    case "part":
    case "outside":
      return round2((l.unit_cost ?? 0) * (1 + (l.markup_percent ?? 0) / 100) * (l.quantity || 1));
    case "labour":
      return round2((l.hours ?? 0) * (l.labour_rate ?? 0));
    default:
      return round2((l.unit_price ?? 0) * (l.quantity || 1));
  }
}

/** After the line's own discount, before VAT. */
export function lineTotal(l: Pick<QuoteLine, "line_type" | "quantity" | "unit_cost" | "markup_percent" | "unit_price" | "hours" | "labour_rate" | "discount_percent">): number {
  return round2(linePrice(l) * (1 - (l.discount_percent ?? 0) / 100));
}

export type QuoteTotals = {
  subtotal: number;
  discount: number;
  net: number;
  vat: number;
  total: number;
  partsCost: number;
  partsSell: number;
  partsMargin: number;
  labourSell: number;
  labourHours: number;
  labourCost: number;
  deposit: number;
};

/**
 * Totals for the lines that count (all of them while building; only the approved ones after the
 * customer answered). Labour cost uses the technician cost rate, which only owner and accounts see.
 */
export function quoteTotals(
  lines: QuoteLine[],
  q: { discount_percent: number; vat_percent: number },
  opts: { onlyApproved?: boolean; technicianCostRate?: number; depositThreshold?: number; depositPercent?: number } = {},
): QuoteTotals {
  const counted = lines.filter((l) => l.is_active && (!opts.onlyApproved || l.customer_approved === true));
  const subtotal = round2(counted.reduce((a, l) => a + lineTotal(l), 0));
  const discount = round2(subtotal * ((q.discount_percent ?? 0) / 100));
  const net = round2(subtotal - discount);
  const vat = round2(net * ((q.vat_percent ?? 5) / 100));
  const total = round2(net + vat);
  const parts = counted.filter((l) => l.line_type === "part" || l.line_type === "outside");
  const partsCost = round2(parts.reduce((a, l) => a + (l.unit_cost ?? 0) * (l.quantity || 1), 0));
  const partsSell = round2(parts.reduce((a, l) => a + lineTotal(l), 0));
  const labour = counted.filter((l) => l.line_type === "labour");
  const labourHours = round2(labour.reduce((a, l) => a + (l.hours ?? 0), 0));
  const labourSell = round2(labour.reduce((a, l) => a + lineTotal(l), 0));
  const labourCost = round2(labourHours * (opts.technicianCostRate ?? 0));
  const threshold = opts.depositThreshold ?? 0;
  const deposit = threshold > 0 && partsSell > threshold ? round2(partsSell * ((opts.depositPercent ?? 50) / 100)) : 0;
  return { subtotal, discount, net, vat, total, partsCost, partsSell, partsMargin: round2(partsSell - partsCost), labourSell, labourHours, labourCost, deposit };
}

export type SendBlocker = { key: string; label: string };

/** What stops a quotation from being sent. Empty means it can go. */
export function sendBlockers(q: Pick<QuoteRow, "kind" | "promised_at" | "status">, lines: QuoteLine[], parts: PartItem[], settings: { minMarkup: (line: QuoteLine) => number }): SendBlocker[] {
  const out: SendBlocker[] = [];
  const active = lines.filter((l) => l.is_active);
  if (active.length === 0) out.push({ key: "lines", label: "Add at least one line" });
  for (const l of active) {
    const short = l.title.length > 30 ? l.title.slice(0, 28) + "…" : l.title;
    if (l.line_type === "part") {
      const p = l.part_item_id ? parts.find((x) => x.id === l.part_item_id) : null;
      if (p) {
        if (p.confirm_status === "pending") out.push({ key: `line-${l.id}`, label: `${short}: waiting for the technician to confirm` });
        else if (p.confirm_status === "rejected") out.push({ key: `line-${l.id}`, label: `${short}: rejected by the technician, remove the line` });
        if (p.cost_aed === null || p.cost_aed === undefined) out.push({ key: `line-${l.id}`, label: `${short}: waiting for the parts price` });
      } else if (l.unit_cost === null || l.unit_cost === undefined) out.push({ key: `line-${l.id}`, label: `${short}: no cost yet` });
      const min = settings.minMarkup(l);
      if ((l.markup_percent ?? 0) < min) out.push({ key: `line-${l.id}`, label: `${short}: markup below the minimum of ${min}%` });
    }
    if (l.line_type === "labour" && !(l.hours && l.hours > 0)) out.push({ key: `line-${l.id}`, label: `${short}: enter the hours` });
    if ((l.line_type === "package" || l.line_type === "fee") && !(l.unit_price && l.unit_price > 0)) out.push({ key: `line-${l.id}`, label: `${short}: enter the price` });
    if (l.line_type === "outside" && (l.unit_cost === null || l.unit_cost === undefined)) out.push({ key: `line-${l.id}`, label: `${short}: enter the cost` });
  }
  if (q.kind === "quotation" && !q.promised_at) out.push({ key: "promised", label: "Set the promised date" });
  return out;
}

/** Why the owner must approve before sending: a discount above the advisor's limit, or a total above the optional threshold. */
export function ownerApprovalReasons(q: Pick<QuoteRow, "discount_percent">, lines: QuoteLine[], totals: { total: number }, settings: { discountLimit: number; approvalAbove: number }): string[] {
  const out: string[] = [];
  if ((q.discount_percent ?? 0) > settings.discountLimit) out.push(`Discount on the total of ${q.discount_percent}% is above the ${settings.discountLimit}% limit`);
  for (const l of lines) if (l.is_active && (l.discount_percent ?? 0) > settings.discountLimit) out.push(`${l.title}: discount of ${l.discount_percent}% is above the ${settings.discountLimit}% limit`);
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
  quotation: Pick<QuoteRow, "id" | "number" | "version" | "status" | "sent_at" | "opened_at" | "responded_at" | "approver_name" | "total_aed" | "approved_total_aed" | "valid_until" | "promised_at" | "created_at"> | null;
  waitingPrices: number;
  waitingConfirm: number;
  rejectedParts: number;
  openRequests: number;
};

export type QuoteState = { key: "none" | "pending_parts" | "pending_confirm" | "ready" | "pending_owner" | "sent" | "opened" | "approved" | "partly_approved" | "declined" | "expired"; text: string; waitingOn: "advisor" | "parts" | "technician" | "owner" | "customer" | "nobody"; tone: "neutral" | "amber" | "green" | "red" };

export function quoteState(s: QuoteSummary, hasInspectionApproved: boolean): QuoteState {
  const q = s.quotation;
  if (!q) return hasInspectionApproved ? { key: "none", text: "Pending quote", waitingOn: "advisor", tone: "neutral" } : { key: "none", text: "Not started", waitingOn: "nobody", tone: "neutral" };
  switch (q.status) {
    case "draft":
      if (s.waitingConfirm > 0) return { key: "pending_confirm", text: `Waiting for the technician to confirm ${s.waitingConfirm} part${s.waitingConfirm === 1 ? "" : "s"}`, waitingOn: "technician", tone: "amber" };
      if (s.waitingPrices > 0 || s.openRequests > 0) return { key: "pending_parts", text: `Waiting for parts prices (${s.waitingPrices + s.openRequests})`, waitingOn: "parts", tone: "amber" };
      return { key: "ready", text: "Ready to send", waitingOn: "advisor", tone: "neutral" };
    case "pending_owner":
      return { key: "pending_owner", text: "Waiting for the owner's approval", waitingOn: "owner", tone: "amber" };
    case "sent":
      return { key: "sent", text: "Sent to the customer", waitingOn: "customer", tone: "amber" };
    case "opened":
      return { key: "opened", text: "Opened by the customer", waitingOn: "customer", tone: "amber" };
    case "approved":
      return { key: "approved", text: "Approved by the customer", waitingOn: "nobody", tone: "green" };
    case "partly_approved":
      return { key: "partly_approved", text: "Partly approved by the customer", waitingOn: "nobody", tone: "green" };
    case "declined":
      return { key: "declined", text: "Declined by the customer", waitingOn: "nobody", tone: "red" };
    case "expired":
      return { key: "expired", text: "Expired, can be re-sent", waitingOn: "advisor", tone: "red" };
    default:
      return { key: "none", text: QUOTE_STATUS_LABELS[q.status], waitingOn: "nobody", tone: "neutral" };
  }
}

export const AVAILABILITY_LABELS = { in_stock: "Available now", to_order: "To order" } as const;
export const CONFIRM_LABELS = { pending: "Waiting for the technician", confirmed: "Confirmed by the technician", rejected: "Rejected by the technician" } as const;
