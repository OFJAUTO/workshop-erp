/**
 * Exactly one state per part, in plain words, from the part's columns. Used wherever a part is listed
 * after the customer approved it: the handover page, the parts trail, the technician's screen, the
 * owner's "Parts with no home" list. Safe for the browser.
 */
export type PartStateInput = {
  order_status?: string | null;
  issue_status?: string | null;
  return_status?: string | null;
  pending_handover_id?: string | null;
  not_received_at?: string | null;
  exchange_status?: string | null;
  exchange_reason?: string | null;
  not_needed_at?: string | null;
  disposition?: string | null;
  expected_date?: string | null;
  cost_aed?: number | string | null;
  received_qty?: number | string | null;
  availability?: string | null;
  replaced_part_id?: string | null;
};

export type PartState = { key: string; label: string; tone: "neutral" | "green" | "amber" | "red" | "ink" | "outline" };

export const EXCHANGE_REASONS: { value: string; label: string }[] = [
  { value: "wrong_part", label: "Wrong part" },
  { value: "damaged", label: "Damaged" },
  { value: "does_not_fit", label: "Does not fit" },
  { value: "faulty", label: "Faulty" },
];

export const DISPOSITIONS: { value: string; label: string }[] = [
  { value: "returned", label: "Returned to supplier with credit note" },
  { value: "stock", label: "Moved to stock" },
  { value: "fit_pending", label: "Fit on this car with approval" },
];

export function exchangeReasonLabel(v: string | null | undefined) {
  return EXCHANGE_REASONS.find((r) => r.value === v)?.label ?? "Wrong or faulty";
}

export function partState(p: PartStateInput): PartState {
  if (p.disposition === "returned") return { key: "returned_supplier", label: "Returned to supplier", tone: "neutral" };
  if (p.disposition === "stock") return { key: "stock", label: "Moved to stock", tone: "neutral" };
  if (p.disposition === "fit_approved") return { key: "fit_approved", label: "Fitted as goodwill, approved by the owner", tone: "green" };
  if (p.disposition === "fit_pending") return { key: "fit_pending", label: "Fit on this car: waiting for the owner", tone: "amber" };
  if (p.exchange_status === "needed") return { key: "exchange", label: `${exchangeReasonLabel(p.exchange_reason)}: waiting for the correct part`, tone: "red" };
  if (p.exchange_status === "ordered") return { key: "exchange_ordered", label: `${exchangeReasonLabel(p.exchange_reason)}: correct part ordered`, tone: "amber" };
  if (p.exchange_status === "done") return { key: "exchanged", label: "Exchanged", tone: "neutral" };
  if (p.not_needed_at) return { key: "not_needed", label: "Not needed: ending to decide", tone: "amber" };
  if (p.return_status === "returned") return { key: "back", label: "Back with Parts", tone: "amber" };
  if (p.issue_status === "confirmed") return { key: "with_tech", label: "With the technician", tone: "green" };
  if (p.pending_handover_id) return { key: "pin", label: "Waiting for the technician's PIN", tone: "amber" };
  if (p.not_received_at) return { key: "not_received", label: "Not received by the technician", tone: "amber" };
  const received = p.order_status === "received" || (p.availability === "in_stock" && Number(p.received_qty ?? 0) > 0);
  if (received) return { key: "here", label: "Here, with Parts", tone: "ink" };
  if (p.order_status === "ordered" || p.order_status === "partly_received") return { key: "ordered", label: p.expected_date ? `Ordered, expected ${p.expected_date}` : "Ordered", tone: "neutral" };
  if (p.order_status === "to_order") return { key: "to_order", label: "To order", tone: "neutral" };
  if (p.cost_aed === null || p.cost_aed === undefined || p.cost_aed === "") return { key: "unpriced", label: "Waiting for the price", tone: "amber" };
  return { key: "priced", label: "Priced", tone: "neutral" };
}

/** A part that still needs an ending: not needed, wrong or faulty, or back with Parts, with nothing decided yet. */
export function hasNoHome(p: PartStateInput): boolean {
  if (p.disposition) return false;
  return !!p.not_needed_at || p.exchange_status === "needed" || p.exchange_status === "ordered" || p.return_status === "returned";
}

/** A part the technician still has to receive before the job can be finished. */
export function stillToReceive(p: PartStateInput): boolean {
  if (!p.order_status || p.order_status === "none") return false;
  if (p.issue_status === "confirmed") return false;
  if (p.return_status === "returned") return false;
  if (p.not_needed_at && p.disposition !== "fit_approved") return false;
  if (p.exchange_status === "needed" || p.exchange_status === "ordered") return false;
  return true;
}
