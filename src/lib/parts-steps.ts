/**
 * The five steps a car's parts go through, in order: Pricing, Request approval, LPO for vendor, Parts received,
 * Handover. One pure rule, read by the parts page (the step bar), the parts desk and the job card (the dots), so
 * every screen agrees. A step is done when its work is complete; the first step not done is the current one; later
 * steps are grey, and go grey again when an earlier step goes back (Edit pricing, a revised quotation with new parts).
 */
export type PartsStepKey = "pricing" | "approval" | "lpo" | "received" | "handover";
export type PartsStep = { key: PartsStepKey; label: string; state: "done" | "current" | "later"; detail: string | null };
export type StepPart = {
  is_active: boolean;
  order_status: string | null;
  received_qty: number;
  quantity: number;
  issue_status: string | null;
  /** Our stock: no LPO, received at approval. */
  from_stock: boolean;
  po_id: string | null;
  return_status?: string | null;
};
export type PartsStepsInput = {
  jobStatus: string;
  pricingDoneAt: string | null;
  pricingReopenedAt: string | null;
  parts: StepPart[];
  /** The main LPO's status when the screen has it; otherwise the parts' own order status says enough. */
  mainLpoStatus?: string | null;
  /** Approved parts still on no LPO (the parts page knows); otherwise inferred from the parts. */
  toOrder?: number | null;
};

const QUOTE_STAGES = ["gate_in_pending", "pending_assignment", "pending_road_test", "in_inspection", "pending_approval", "pending_quote", "pending_customer_approval"];
const ORDERED = ["ordered", "partly_received", "received"];

export const STEP_LABELS: Record<PartsStepKey, string> = { pricing: "Pricing", approval: "Request approval", lpo: "LPO for vendor", received: "Parts received", handover: "Handover" };

export function partsSteps(i: PartsStepsInput): PartsStep[] {
  const approved = i.parts.filter((p) => p.is_active && !!p.order_status && p.order_status !== "none" && p.return_status !== "returned");
  const nonStock = approved.filter((p) => !p.from_stock);
  const pastQuote = !QUOTE_STAGES.includes(i.jobStatus);
  const pricingDone = !i.pricingReopenedAt && (!!i.pricingDoneAt || approved.length > 0 || pastQuote);
  const needLpo = nonStock.length > 0;
  const toOrder = i.toOrder ?? nonStock.filter((p) => !p.po_id && !ORDERED.includes(p.order_status ?? "")).length;
  const orderedCount = nonStock.filter((p) => ORDERED.includes(p.order_status ?? "")).length;
  const approvalDone = approved.length > 0 && (!needLpo || i.mainLpoStatus === "approved" || (orderedCount === nonStock.length && toOrder === 0));
  const orderedDone = approved.length > 0 && (!needLpo || (orderedCount === nonStock.length && toOrder === 0));
  const receivedCount = approved.filter((p) => p.from_stock || p.order_status === "received" || p.received_qty + 0.005 >= p.quantity).length;
  const receivedDone = approved.length > 0 && receivedCount === approved.length;
  const handedCount = approved.filter((p) => p.issue_status === "confirmed").length;
  const handedDone = approved.length > 0 && handedCount === approved.length;
  // A car with no parts at all once the customer approved: nothing to do on any step.
  const noParts = pastQuote && approved.length === 0 && pricingDone;
  const done = noParts ? [true, true, true, true, true] : [pricingDone, approvalDone, orderedDone, receivedDone, handedDone];
  const details: (string | null)[] = noParts
    ? ["No parts on this car", null, null, null, null]
    : [
        pricingDone ? "Priced" : "Price every part, then Pricing done",
        approvalDone ? (needLpo ? "LPO approved" : "From our stock, no LPO") : i.mainLpoStatus === "pending_approval" ? "Waiting for the owner or accounts" : approved.length ? "Send the LPO for approval" : "Waiting for the customer's approval",
        needLpo ? `${orderedCount} of ${nonStock.length} ordered` : approved.length ? "Our stock, nothing to order" : null,
        approved.length ? `${receivedCount} of ${approved.length} received` : null,
        approved.length ? `${handedCount} of ${approved.length} handed over` : null,
      ];
  // A done step stays green whatever happens around it; the current step is the FIRST unfinished one.
  const firstUndone = done.findIndex((d) => !d);
  const keys: PartsStepKey[] = ["pricing", "approval", "lpo", "received", "handover"];
  return keys.map((key, idx) => ({ key, label: STEP_LABELS[key], state: done[idx] ? "done" as const : idx === firstUndone ? "current" as const : "later" as const, detail: details[idx] }));
}

/** The parts of a job in the shape the rule reads, from any row that carries the usual columns. */
export function stepPartOf(p: { is_active?: boolean | null; order_status?: string | null; received_qty?: number | string | null; quantity?: number | string | null; confirmed_quantity?: number | string | null; issue_status?: string | null; availability?: string | null; supplier?: string | null; po_id?: string | null; return_status?: string | null }): StepPart {
  return {
    is_active: p.is_active !== false,
    order_status: p.order_status ?? null,
    received_qty: Number(p.received_qty) || 0,
    quantity: Number(p.confirmed_quantity ?? p.quantity) || 1,
    issue_status: p.issue_status ?? null,
    from_stock: p.availability === "in_stock" || /^our stock$/i.test(String(p.supplier ?? "").trim()),
    po_id: p.po_id ?? null,
    return_status: p.return_status ?? null,
  };
}
