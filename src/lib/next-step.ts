/** Plain words for where a job is: what just finished, what happens next, and whose move it is. */

import type { InspectionStatus } from "./inspection";
import type { JobStatus } from "./jobs";
import type { RoadTestRow } from "./road-test";

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
  roadTest: Pick<RoadTestRow, "status"> | null;
  approval: { sent_at: string | null; opened_at: string | null; approved_at: string | null; approver_name: string | null } | null;
  gateInComplete: boolean;
};

export type NextStep = {
  /** What just finished, shown with a green tick. */
  done: { label: string; by: string | null } | null;
  /** What happens next and who it is waiting on. */
  next: string;
  waitingOn: string;
  /** Who should act: a role, to decide whether to show the main button to the viewer. */
  actorRole: "gate_in" | "customer" | "workshop_manager" | "technician" | "qc_inspector" | "service_advisor" | "owner" | "accounts" | null;
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
    return { done: { label: "Customer approved the job card", by: j.approval?.approver_name ?? null }, next: "Assign a technician.", waitingOn: j.managerLabel, actorRole: "workshop_manager", action: { label: "Assign", href: "/assign" }, since: j.first_approval_at ?? j.stage_entered_at, line: `Waiting on ${j.managerLabel} to assign` };
  }
  if (j.status === "pending_inspection" || (j.status === "in_inspection" && (!insp || insp.status === "not_started"))) {
    return { done: { label: `Assigned to ${tech}`, by: null }, next: "Start the inspection on the tablet.", waitingOn: tech, actorRole: "technician", action: { label: "Open on the tablet", href: `/my-jobs/${jobId}` }, since: j.stage_entered_at, line: `Pending inspection, waiting on ${tech}` };
  }
  if (j.status === "in_inspection" && insp) {
    if (insp.status === "in_progress" || insp.status === "returned") {
      const roadWait = road && road.status === "not_started" ? " and the QC road test" : "";
      return { done: { label: insp.status === "returned" ? "Report sent back for changes" : "Inspection started", by: tech }, next: `${tech} finishes the inspection report${roadWait}.`, waitingOn: tech, actorRole: "technician", action: { label: "Open the report", href: `/my-jobs/${jobId}` }, since: j.stage_entered_at, line: `In inspection, waiting on ${tech}` };
    }
    if (insp.status === "submitted") {
      if (road && road.status === "not_started") return { done: { label: "Report submitted", by: tech }, next: "The QC inspector does the road test, then the workshop manager reviews.", waitingOn: "the QC inspector", actorRole: "qc_inspector", action: { label: "Road test", href: `/road-tests/${jobId}` }, since: insp.submitted_at ?? j.stage_entered_at, line: "Report submitted, waiting on the QC road test" };
      return { done: { label: "Report submitted", by: tech }, next: "The workshop manager reviews and approves the report.", waitingOn: j.managerLabel, actorRole: "workshop_manager", action: { label: "Review the report", href: `/jobs/${jobId}/inspection` }, since: insp.submitted_at ?? j.stage_entered_at, line: `Report submitted, waiting on ${j.managerLabel}` };
    }
  }
  if (j.status === "pending_quote") {
    return { done: { label: "Inspection report approved", by: null }, next: "Prepare the quotation (next phase) and send the report to the customer.", waitingOn: advisor, actorRole: "service_advisor", action: { label: "Open the report", href: `/jobs/${jobId}/inspection` }, since: insp?.approved_at ?? j.stage_entered_at, line: `Pending quote, waiting on ${advisor}` };
  }
  if (j.status === "pending_customer_approval") return { done: { label: "Quotation sent", by: j.advisorName }, next: "The customer approves the quotation.", waitingOn: "the customer", actorRole: "customer", action: null, since: j.stage_entered_at, line: "Waiting on the customer to approve the quotation" };
  if (j.status === "approved" || j.status === "waiting_parts") return { done: { label: "Quotation approved by the customer", by: null }, next: "Parts are ordered and received.", waitingOn: "parts", actorRole: null, action: null, since: j.stage_entered_at, line: `${j.status === "approved" ? "Approved" : "Waiting for parts"}, waiting on parts` };
  if (j.status === "in_work") return { done: { label: "Parts ready", by: null }, next: `${tech} does the work.`, waitingOn: tech, actorRole: "technician", action: null, since: j.stage_entered_at, line: `In work, waiting on ${tech}` };
  if (j.status === "pending_qc") return { done: { label: "Work finished", by: tech }, next: "QC checks the car.", waitingOn: "the QC inspector", actorRole: "qc_inspector", action: null, since: j.stage_entered_at, line: "Pending QC, waiting on the QC inspector" };
  if (j.status === "pending_wash") return { done: { label: "QC passed", by: null }, next: "Car wash.", waitingOn: "the wash", actorRole: null, action: null, since: j.stage_entered_at, line: "Pending car wash" };
  if (j.status === "ready") return { done: { label: "Car ready", by: null }, next: "The customer collects; invoice and payment.", waitingOn: advisor, actorRole: "service_advisor", action: { label: "Gate out", href: `/jobs/${jobId}/gate-out` }, since: j.stage_entered_at, line: `Ready, waiting on ${advisor}` };
  if (j.status === "pending_payment") return { done: { label: "Job done", by: null }, next: "Payment, then gate out.", waitingOn: "accounts", actorRole: "accounts", action: { label: "Gate out", href: `/jobs/${jobId}/gate-out` }, since: j.stage_entered_at, line: "Pending payment, waiting on accounts" };
  return { done: null, next: "", waitingOn: "", actorRole: null, action: null, since: j.stage_entered_at, line: "" };
}

/** "2 h 10 min" or "3 days" since a moment. */
export function waitedText(sinceIso: string, now = new Date()) {
  const min = Math.max(0, Math.round((now.getTime() - Date.parse(sinceIso)) / 60000));
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h ${min % 60} min`;
  return `${Math.round(min / 1440)} days`;
}
