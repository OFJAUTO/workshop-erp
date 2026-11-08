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
  /** Added after the customer's approval and not approved yet (on no approved quotation, order status "none"):
   *  the flow is open again until it is approved, ordered, received and handed over (5 November 2026, J-00985). */
  after_approval?: boolean;
  /** Has a real cost (an unpriced new part holds the Pricing step). */
  priced?: boolean;
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

/** The statuses from the Parts step on (STATUS_STAGE in jobs.ts at "parts" or later): the customer has approved the work. */
export const PAST_QUOTE = ["approved", "waiting_parts", "in_work", "pending_qc", "pending_wash", "ready", "pending_payment", "in_delivery", "closed"];
const NO_PARTS = "No parts on this car";
/** True when the steps say the car needs no parts at all (approved, nothing to order). */
export const noPartsNeeded = (steps: PartsStep[]) => steps[0]?.detail === NO_PARTS;
const ORDERED = ["ordered", "partly_received", "received"];

export const STEP_LABELS: Record<PartsStepKey, string> = { pricing: "Pricing", approval: "Request approval", lpo: "LPO for vendor", received: "Parts received", handover: "Handover" };

export function partsSteps(i: PartsStepsInput): PartsStep[] {
  const approved = i.parts.filter((p) => p.is_active && !!p.order_status && p.order_status !== "none" && p.return_status !== "returned");
  // THE J-00985 CAUSE (5 November 2026): only approved parts were counted, so parts added after the customer's
  // approval (waiting for an approval that never came) counted nowhere - every step green, "No parts on this car".
  // They now hold the flow open from the first step they affect until they are approved, ordered, received and
  // handed over.
  const pending = i.parts.filter((p) => p.is_active && !!p.after_approval);
  const pendingUnpriced = pending.filter((p) => p.priced === false).length;
  const all = [...approved, ...pending];
  const nonStock = approved.filter((p) => !p.from_stock);
  const nonStockAll = all.filter((p) => !p.from_stock);
  const pastQuote = PAST_QUOTE.includes(i.jobStatus);
  const pricingDone = !i.pricingReopenedAt && pendingUnpriced === 0 && (!!i.pricingDoneAt || approved.length > 0 || pastQuote);
  const needLpo = nonStockAll.length > 0;
  const toOrder = i.toOrder ?? nonStock.filter((p) => !p.po_id && !ORDERED.includes(p.order_status ?? "")).length;
  const orderedCount = nonStock.filter((p) => ORDERED.includes(p.order_status ?? "")).length;
  const settled = pending.length === 0;
  const approvalDone = settled && approved.length > 0 && (nonStock.length === 0 || (i.mainLpoStatus === "approved" && toOrder === 0) || (orderedCount === nonStock.length && toOrder === 0));
  // "x of y parts on LPO" (8 November 2026): the desk sends only the parts it ticks, so part of a car can wait.
  const onLpoCount = nonStock.filter((p) => !!p.po_id || ORDERED.includes(p.order_status ?? "")).length;
  const onLpoWords = nonStock.length && onLpoCount < nonStock.length ? ` · ${onLpoCount} of ${nonStock.length} parts on LPO` : "";
  const orderedDone = settled && approved.length > 0 && (nonStock.length === 0 || (orderedCount === nonStock.length && toOrder === 0));
  const receivedCount = approved.filter((p) => p.from_stock || p.order_status === "received" || p.received_qty + 0.005 >= p.quantity).length;
  const receivedDone = settled && approved.length > 0 && receivedCount === approved.length;
  const handedCount = approved.filter((p) => p.issue_status === "confirmed").length;
  const handedDone = settled && approved.length > 0 && handedCount === approved.length;
  // A car with no parts at all once the customer approved: nothing to do on any step.
  const noParts = pastQuote && all.length === 0 && pricingDone;
  const done = noParts ? [true, true, true, true, true] : [pricingDone, approvalDone, orderedDone, receivedDone, handedDone];
  const newWords = `${pending.length} new part${pending.length === 1 ? "" : "s"}`;
  const details: (string | null)[] = noParts
    ? [NO_PARTS, null, null, null, null]
    : [
        pricingDone ? "Priced" : pendingUnpriced ? `${pendingUnpriced} new part${pendingUnpriced === 1 ? "" : "s"} to price` : "Price every part, then Pricing done",
        approvalDone
          ? (nonStock.length ? "LPO approved" : "From stock, no LPO needed")
          : i.mainLpoStatus === "pending_approval"
            ? `Waiting for the owner or accounts${onLpoWords}`
            : pending.length
              ? `${newWords} need${pending.length === 1 ? "s" : ""} approval – Resend for approval`
              : approved.length ? (onLpoCount ? `${onLpoCount} of ${nonStock.length} parts on LPO – send the rest` : "Send the LPO for approval") : "Waiting for the customer's approval",
        needLpo ? `${orderedCount} of ${nonStockAll.length} ordered` : all.length ? "Our stock, nothing to order" : null,
        all.length ? `${receivedCount} of ${all.length} received` : null,
        all.length ? `Handover ${handedCount} of ${all.length}` : null,
      ];
  // A done step stays green whatever happens around it; the current step is the FIRST unfinished one.
  const firstUndone = done.findIndex((d) => !d);
  const keys: PartsStepKey[] = ["pricing", "approval", "lpo", "received", "handover"];
  return keys.map((key, idx) => ({ key, label: STEP_LABELS[key], state: done[idx] ? "done" as const : idx === firstUndone ? "current" as const : "later" as const, detail: details[idx] }));
}

/**
 * The parts of a job in the shape the rule reads, from any row that carries the usual columns. `approvedIds` = the part
 * ids on the job's APPROVED quotations (left-off and option lines included); with it and a job past the quote, a live
 * part on none of them that is not approved for ordering reads as "added after approval" (parts-changes.ts).
 */
export function stepPartOf(
  p: { id?: string; is_active?: boolean | null; order_status?: string | null; received_qty?: number | string | null; quantity?: number | string | null; confirmed_quantity?: number | string | null; issue_status?: string | null; availability?: string | null; supplier?: string | null; po_id?: string | null; return_status?: string | null; cost_aed?: number | string | null; removed_at?: string | null; disposition?: string | null },
  ctx?: { pastQuote: boolean; approvedIds: Set<string> | null },
): StepPart {
  const live = p.is_active !== false && !p.removed_at && !p.disposition;
  const afterApproval = !!ctx?.pastQuote && !!ctx.approvedIds && !!p.id && live && (p.order_status ?? "none") === "none" && !ctx.approvedIds.has(p.id);
  return {
    is_active: p.is_active !== false,
    order_status: p.order_status ?? null,
    received_qty: Number(p.received_qty) || 0,
    quantity: Number(p.confirmed_quantity ?? p.quantity) || 1,
    issue_status: p.issue_status ?? null,
    from_stock: p.availability === "in_stock" || /^our stock$/i.test(String(p.supplier ?? "").trim()),
    po_id: p.po_id ?? null,
    return_status: p.return_status ?? null,
    after_approval: afterApproval,
    priced: p.cost_aed !== null && p.cost_aed !== undefined && Number(p.cost_aed) > 0,
  };
}
