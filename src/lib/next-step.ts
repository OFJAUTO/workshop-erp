/** Plain words for where a job is: what just finished, what happens next, and whose move it is. */

import type { InspectionStatus } from "./inspection";
import { formatWait, workingMinutesSince, type JobStatus } from "./jobs";
import { roadTestWaiting, type RoadTestRow } from "./road-test";
import type { QuoteState } from "./quotes";
import type { WorkingTime } from "./working-time";

export type NextStepInput = {
  status: JobStatus;
  is_open: boolean;
  assigned_to: string | null;
  first_approval_at: string | null;
  gated_in_at: string;
  stage_entered_at: string;
  assigneeName: string | null;
  advisorName: string | null;
  managerLabel: string;
  inspection: { status: InspectionStatus; technician_id: string | null; submitted_at: string | null; approved_at: string | null } | null;
  roadTest: Pick<RoadTestRow, "status" | "decision"> | null;
  approval: { sent_at: string | null; opened_at: string | null; approved_at: string | null; approver_name: string | null } | null;
  gateInComplete: boolean;
  /** The quotation's plain-word state, when the job is at or past the quote. */
  quote?: QuoteState | null;
  /** Later stages: parts, work, QC, wash, invoice, delivery. */
  extra?: { partsState?: string; partsLate?: number; workDone?: number; workTotal?: number; qcRound?: number; readyToInvoice?: boolean; invoiced?: boolean; invoiceKind?: "proforma" | "tax_invoice" | "credit_note" | null; invoiceSent?: boolean; balanceDue?: number; readySent?: boolean; deliveryAddress?: string | null; planningOn?: "parts" | "workshop" | "advisor" | null; workFinishedAt?: string | null; washSentAt?: string | null; technicianNames?: string[] } | null;
};

export type NextStep = {
  /** What just finished, shown with a green tick. */
  done: { label: string; by: string | null } | null;
  /** What happens next and who it is waiting on. */
  next: string;
  waitingOn: string;
  /** Who should act: a role, to decide whether to show the main button to the viewer. */
  actorRole: "gate_in" | "customer" | "workshop_manager" | "technician" | "qc_inspector" | "service_advisor" | "owner" | "accounts" | "parts" | null;
  /** Main action for the person whose move it is. */
  action: { label: string; href: string } | null;
  /** The moment the wait started. */
  since: string;
  /** Short line for list cards: "Pending quote, waiting on Adarsh". */
  line: string;
};

export function nextStepOf(jobId: string, j: NextStepInput): NextStep {
  const tech = j.assigneeName ?? "the technician";
  const advisor = j.advisorName ?? "the advisor";
  const insp = j.inspection;
  const road = j.roadTest;

  if (!j.is_open) {
    return { done: { label: "Gated out", by: null }, next: "Nothing. The job is closed.", waitingOn: "nobody", actorRole: null, action: null, since: j.stage_entered_at, line: "Gated out" };
  }
  if (j.status === "gate_in_pending") {
    return { done: { label: "Gated in", by: null }, next: "Finish the gate-in photos and videos.", waitingOn: "gate-in", actorRole: "gate_in", action: { label: "Add video and photos", href: `/jobs/${jobId}/media` }, since: j.gated_in_at, line: "Gate-in incomplete, waiting on gate-in" };
  }
  if (j.status === "pending_approval") {
    if (!j.approval) return { done: { label: "Gate-in complete", by: null }, next: "Create and send the approval link to the customer.", waitingOn: advisor, actorRole: "service_advisor", action: { label: "Create the approval link", href: `/jobs/${jobId}#approval` }, since: j.stage_entered_at, line: `Waiting on ${advisor} to send the approval link` };
    if (!j.approval.sent_at) return { done: { label: "Approval link created", by: j.advisorName }, next: "Send the link to the customer on WhatsApp.", waitingOn: advisor, actorRole: "service_advisor", action: { label: "Send the link", href: `/jobs/${jobId}#approval` }, since: j.stage_entered_at, line: `Waiting on ${advisor} to send the approval link` };
    return { done: { label: "Approval link sent", by: j.advisorName }, next: "The customer approves the job card.", waitingOn: "the customer", actorRole: "customer", action: null, since: j.approval.sent_at, line: "Waiting on the customer to approve the job card" };
  }
  if (j.status === "pending_inspection" && !j.assigned_to) {
    return { done: { label: "Customer approved the job card", by: j.approval?.approver_name ?? null }, next: `${j.managerLabel} assigns a technician.`, waitingOn: j.managerLabel, actorRole: "workshop_manager", action: { label: "Assign", href: "/assign" }, since: j.first_approval_at ?? j.stage_entered_at, line: `Waiting on ${j.managerLabel} to assign a technician` };
  }
  if (j.status === "pending_inspection" && roadTestWaiting(road)) {
    return { done: { label: `Assigned to ${tech}`, by: null }, next: "The QC inspector does the road test. The inspection opens after it.", waitingOn: "the QC inspector", actorRole: "qc_inspector", action: { label: "Road test", href: `/road-tests/${jobId}` }, since: j.stage_entered_at, line: "Waiting for road test" };
  }
  if (j.status === "pending_inspection" || (j.status === "in_inspection" && (!insp || insp.status === "not_started"))) {
    return { done: { label: `Assigned to ${tech}`, by: null }, next: "Start the inspection on the tablet.", waitingOn: tech, actorRole: "technician", action: { label: "Open on the tablet", href: `/my-jobs/${jobId}` }, since: j.stage_entered_at, line: `Pending inspection, waiting on ${tech}` };
  }
  if (j.status === "in_inspection" && insp) {
    if (insp.status === "in_progress" || insp.status === "returned") {
      const roadWait = road && road.status === "not_started" && road.decision !== "not_needed" ? " and the QC road test" : "";
      return { done: { label: insp.status === "returned" ? "Report sent back for changes" : "Inspection started", by: tech }, next: `${tech} finishes the inspection report${roadWait}.`, waitingOn: tech, actorRole: "technician", action: { label: "Open the report", href: `/my-jobs/${jobId}` }, since: j.stage_entered_at, line: `In inspection, waiting on ${tech}` };
    }
    if (insp.status === "submitted") {
      return { done: { label: "Report submitted", by: tech }, next: "The workshop manager reviews and approves the report.", waitingOn: j.managerLabel, actorRole: "workshop_manager", action: { label: "Review the report", href: `/jobs/${jobId}/inspection` }, since: insp.submitted_at ?? j.stage_entered_at, line: `Report submitted, waiting on ${j.managerLabel}` };
    }
  }
  if (j.status === "pending_quote") {
    const since = insp?.approved_at ?? j.stage_entered_at;
    const qs = j.quote;
    if (!qs || qs.key === "none") return { done: { label: "Inspection report approved", by: null }, next: "Start the quotation and send the report to the customer.", waitingOn: advisor, actorRole: "service_advisor", action: { label: "Start the quotation", href: `/jobs/${jobId}#quotation` }, since, line: `Pending quote, waiting on ${advisor}` };
    if (qs.key === "pending_parts") return { done: { label: "Quotation started", by: j.advisorName }, next: "Parts price the requests from the report.", waitingOn: "Parts", actorRole: "parts", action: { label: "Price the parts", href: `/parts/${jobId}` }, since, line: "Waiting for parts prices" };
    if (qs.key === "pending_confirm") return { done: { label: "Parts listed", by: null }, next: `${tech} confirms the parts on the tablet.`, waitingOn: tech, actorRole: "technician", action: { label: "Confirm the parts", href: `/my-jobs/${jobId}` }, since, line: `Waiting for ${tech} to confirm the parts` };
    if (qs.key === "link") return { done: { label: "Quotation link created", by: j.advisorName }, next: "Send the link to the customer on WhatsApp.", waitingOn: advisor, actorRole: "service_advisor", action: { label: "Send the quotation", href: `/jobs/${jobId}#quotation` }, since, line: `Quotation link created, waiting on ${advisor} to send it` };
    if (qs.key === "pending_owner") return { done: { label: "Quotation ready", by: j.advisorName }, next: "The owner approves the quotation before it is sent.", waitingOn: "the owner", actorRole: "owner", action: { label: "Open the quotation", href: `/jobs/${jobId}#quotation` }, since, line: "Quotation waiting for the owner's approval" };
    if (qs.key === "expired") return { done: { label: "Quotation expired", by: null }, next: "Re-send or revise the quotation.", waitingOn: advisor, actorRole: "service_advisor", action: { label: "Open the quotation", href: `/jobs/${jobId}#quotation` }, since, line: `Quotation expired, waiting on ${advisor}` };
    if (qs.key === "finish") return { done: { label: "Parts priced", by: null }, next: "Finish the quotation and press Quotation complete.", waitingOn: advisor, actorRole: "service_advisor", action: { label: "Finish the quotation", href: `/jobs/${jobId}#quotation` }, since, line: `${qs.text}, waiting on ${advisor}` };
    return { done: { label: "Quotation complete", by: j.advisorName }, next: "Send the quotation to the customer.", waitingOn: advisor, actorRole: "service_advisor", action: { label: "Send the quotation", href: `/jobs/${jobId}#quotation` }, since, line: `Quotation ready to send, waiting on ${advisor}` };
  }
  if (j.status === "pending_customer_approval") {
    if (j.quote?.key === "urgent_requested") return { done: { label: "Customer asked for the urgent work only", by: null }, next: "Create the urgent-only version of the quotation and send it.", waitingOn: advisor, actorRole: "service_advisor", action: { label: "Open the quotation", href: `/jobs/${jobId}#quotation` }, since: j.stage_entered_at, line: `Urgent work only requested, waiting on ${advisor}` };
    if (j.quote?.key === "expired") return { done: { label: "Quotation sent", by: j.advisorName }, next: "The quotation expired. Re-send or revise it.", waitingOn: advisor, actorRole: "service_advisor", action: { label: "Open the quotation", href: `/jobs/${jobId}#quotation` }, since: j.stage_entered_at, line: `Quotation expired, waiting on ${advisor}` };
    return { done: { label: j.quote?.key === "opened" ? "Quotation opened by the customer" : "Quotation sent", by: j.advisorName }, next: "The customer approves the quotation.", waitingOn: "the customer", actorRole: "customer", action: null, since: j.stage_entered_at, line: j.quote?.key === "opened" ? "Quotation opened, waiting on the customer" : "Waiting on the customer to approve the quotation" };
  }
  const x = j.extra ?? {};
  if (j.status === "approved" || j.status === "waiting_parts") {
    const since = j.stage_entered_at;
    const on = x.planningOn ?? "parts";
    if (on === "workshop") return { done: { label: "Parts planned", by: null }, next: `${j.managerLabel} picks the start day and the technicians, then releases the car to the workshop.`, waitingOn: j.managerLabel, actorRole: "workshop_manager", action: { label: "Plan the work", href: `/jobs/${jobId}#planning` }, since, line: `Planning, waiting on ${j.managerLabel} to release the car` };
    if (on === "advisor") return { done: { label: "Released to the workshop", by: null }, next: `${advisor} confirms the finish date and tells the customer.`, waitingOn: advisor, actorRole: "service_advisor", action: { label: "Confirm the date", href: `/jobs/${jobId}#planning` }, since, line: `Waiting on ${advisor} to confirm the finish date` };
    if (x.partsState === "ordered" && x.partsLate) return { done: { label: "Parts ordered", by: null }, next: `${x.partsLate} part${x.partsLate === 1 ? " is" : "s are"} late. Parts chase the supplier.`, waitingOn: "the supplier", actorRole: "parts", action: { label: "LPOs", href: "/parts/orders" }, since, line: `Waiting for parts, ${x.partsLate} late` };
    return { done: { label: "Quotation approved by the customer", by: null }, next: "Parts say for each part: in stock, or to order with the date. Then \"Parts planned\".", waitingOn: "Parts", actorRole: "parts", action: { label: "Plan the parts", href: `/parts/${jobId}` }, since, line: "Planning, waiting on Parts" };
  }
  if (j.status === "in_work") {
    const techs = x.technicianNames?.length ? x.technicianNames.join(", ") : tech;
    if (x.workFinishedAt) return { done: { label: "Job finished", by: techs }, next: `${j.managerLabel} confirms the work; the car goes to QC.`, waitingOn: j.managerLabel, actorRole: "workshop_manager", action: { label: "Confirm the work", href: `/jobs/${jobId}/work` }, since: x.workFinishedAt, line: `Job finished, waiting on ${j.managerLabel} to confirm` };
    if (!j.assigned_to && !x.technicianNames?.length) return { done: { label: "Released to the workshop", by: null }, next: `${j.managerLabel} puts a technician on the car.`, waitingOn: j.managerLabel, actorRole: "workshop_manager", action: { label: "Work order", href: `/jobs/${jobId}/work` }, since: j.stage_entered_at, line: `Nobody on the car, waiting on ${j.managerLabel}` };
    return { done: { label: x.qcRound ? `Back from QC, round ${x.qcRound}` : "Released to the workshop", by: null }, next: `${techs} ${x.technicianNames && x.technicianNames.length > 1 ? "do" : "does"} the work, then presses Job finished.`, waitingOn: techs, actorRole: "technician", action: { label: "Open on the tablet", href: `/my-jobs/${jobId}` }, since: j.stage_entered_at, line: `In work, waiting on ${techs}` };
  }
  if (j.status === "pending_qc") return { done: { label: "Work confirmed complete", by: null }, next: `The QC inspector checks the car${(x.qcRound ?? 1) > 1 ? ` (recheck, round ${x.qcRound})` : ""}.`, waitingOn: "the QC inspector", actorRole: "qc_inspector", action: { label: "Start QC", href: `/qc/${jobId}` }, since: j.stage_entered_at, line: "Pending QC, waiting on the QC inspector" };
  if (j.status === "pending_wash") {
    if (!x.washSentAt) return { done: { label: "QC passed", by: null }, next: `${advisor} sends the car to the wash when it should go.`, waitingOn: advisor, actorRole: "service_advisor", action: null, since: j.stage_entered_at, line: `Ready for wash, waiting on ${advisor} to send it` };
    return { done: { label: "Sent to the wash", by: j.advisorName }, next: `At the wash. ${advisor} presses Wash done; the car is Ready.`, waitingOn: "the wash", actorRole: "service_advisor", action: null, since: x.washSentAt, line: "At the wash" };
  }
  if (j.status === "ready") {
    if (!x.invoiced) return { done: { label: "Car ready", by: null }, next: "The proforma is prepared by itself from the approved quotation. If it is not there, tap Prepare the proforma on the job card.", waitingOn: advisor, actorRole: "service_advisor", action: null, since: j.stage_entered_at, line: `Ready, proforma to prepare` };
    if (x.invoiceKind === "proforma" && !x.readySent) return { done: { label: "Proforma ready", by: null }, next: "Send the proforma to the customer on WhatsApp: the bank details and Pay now are on the page. The tax invoice is generated when it is paid in full.", waitingOn: advisor, actorRole: "service_advisor", action: { label: "Send the proforma", href: `/jobs/${jobId}#invoice` }, since: j.stage_entered_at, line: `Proforma to send, waiting on ${advisor}` };
    if (x.invoiceKind === "proforma") return { done: { label: "Proforma sent", by: j.advisorName }, next: "Awaiting payment. The tax invoice is generated the moment the balance reaches zero.", waitingOn: "the customer", actorRole: "accounts", action: null, since: j.stage_entered_at, line: "Awaiting payment" };
    if (!x.invoiceSent) return { done: { label: "Paid in full, tax invoice generated", by: null }, next: "Tax invoice ready to send: send it to the customer on WhatsApp, then gate out.", waitingOn: advisor, actorRole: "service_advisor", action: { label: "Send the tax invoice", href: `/jobs/${jobId}#invoice` }, since: j.stage_entered_at, line: `Tax invoice ready to send, waiting on ${advisor}` };
    return { done: { label: "Tax invoice sent", by: j.advisorName }, next: "The customer collects, or the car is delivered. Gate out.", waitingOn: "the customer", actorRole: "service_advisor", action: { label: "Gate out", href: `/jobs/${jobId}/gate-out` }, since: j.stage_entered_at, line: "Ready for collection" };
  }
  if (j.status === "pending_payment") return { done: { label: x.invoiceKind === "tax_invoice" ? "Tax invoice issued" : "Proforma sent", by: null }, next: `Awaiting payment of AED ${(x.balanceDue ?? 0).toLocaleString("en-GB")}. ${x.invoiceKind === "tax_invoice" ? "Then gate out." : "The tax invoice is generated the moment the balance reaches zero."}`, waitingOn: "the customer", actorRole: "accounts", action: { label: "Record a payment", href: `/jobs/${jobId}/invoice` }, since: j.stage_entered_at, line: "Awaiting payment" };
  if (j.status === "in_delivery") return { done: { label: "Left the workshop for delivery", by: null }, next: `Mark it delivered at ${x.deliveryAddress ?? "the customer's address"}.`, waitingOn: advisor, actorRole: "service_advisor", action: { label: "Mark delivered", href: `/jobs/${jobId}/gate-out` }, since: j.stage_entered_at, line: "Out for delivery" };
  return { done: null, next: "", waitingOn: "", actorRole: null, action: null, since: j.stage_entered_at, line: "" };
}

/** "2 h 10 min" or "3 days" since a moment, on the same working-hours clock as the stage timers. */
export function waitedText(sinceIso: string, wt: WorkingTime, now = new Date()) {
  return formatWait(workingMinutesSince(sinceIso, wt, now), wt);
}
