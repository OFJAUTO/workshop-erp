import "server-only";
import { createAdminClient } from "./supabase/admin";
import type { RoleId } from "./roles";

/** Every kind of notification the system can send. Later phases add their own. */
export const NOTIFICATION_TYPES: { type: string; label: string; locked?: boolean }[] = [
  { type: "clock_overnight", label: "Clock left running overnight" },
  { type: "bodyshop_assessment", label: "Bodyshop findings in an inspection: a bodyshop assessment is needed (bodyshop managers)" },
  { type: "proforma_sent", label: "A proforma was sent: awaiting payment (accounts)", locked: true },
  { type: "customer_says_paid", label: "The customer says they have paid: check the bank (accounts)", locked: true },
  { type: "invoice_paid", label: "Paid in full: the tax invoice is created and ready to send", locked: true },
  { type: "payment_waiting_long", label: "A proforma has waited too long for payment (owner)", locked: true },
  { type: "stock_low", label: "A stock item is below its minimum (Parts)" },
  { type: "deposit_to_collect", label: "A deposit to collect after the customer's approval (advisor, accounts)", locked: true },
  { type: "deposit_received", label: "Deposit received: the LPO can be approved (Parts, owner)", locked: true },
  { type: "lpo_waiting_deposit", label: "An LPO waits for a deposit that has not arrived (owner)", locked: true },
  { type: "deposit_overdue", label: "A deposit still not received after the waiting limit (advisor, accounts)" },
  { type: "revision_request", label: "Someone asks to revise an approved quotation (owner)", locked: true },
  { type: "fixed_asset", label: "A tools and equipment order counts as a fixed asset (accounts)", locked: true },
  { type: "sticker_prompt", label: "A sticker or label to print (labels at receipt, battery warranty, oil service)", locked: true },
  { type: "supplier_invoice_mismatch", label: "A supplier invoice price differs from the LPO (accounts)", locked: true },
  { type: "supplier_invoice_missing", label: "A supplier invoice is still missing (Parts, daily)", locked: true },
  { type: "task_overdue", label: "A red task waited over 30 minutes (one bell)", locked: true },
  { type: "quote_revised_by_parts", label: "Parts changed: revised quotation to send" },
  { type: "job_declined_out", label: "Declined job going out" },
  { type: "approval_opened", label: "Customer opened the approval link", locked: true },
  { type: "approval_approved", label: "Customer approved the job card", locked: true },
  { type: "approval_reminder", label: "Approval link not opened in time", locked: true },
  { type: "doc_not_sent", label: "A document not sent in time: report, quotation, proforma or invoice", locked: true },
  { type: "loose_gated_in", label: "Loose items gated in, quotation needed" },
  { type: "owner_report", label: "Owner's report after gate-out" },
  { type: "monthly_summary", label: "Monthly summary on the 1st" },
  { type: "job_awaiting_assignment", label: "Car approved and waiting to be assigned" },
  { type: "assignment_note", label: "An advisor left you a note about a car waiting to be assigned" },
  { type: "assignment_reminder", label: "Reminder: a car is still waiting for a technician", locked: true },
  { type: "assignment_overdue", label: "A car has waited too long for a technician (owner)", locked: true },
  { type: "road_test_decided", label: "The road test choice on your car changed", locked: true },
  { type: "inspection_open", label: "Road test done, your inspection can start", locked: true },
  { type: "owner_approval_needed", label: "Something needs the owner's approval", locked: true },
  { type: "catalog_review", label: "New make or model added during gate-in" },
  { type: "appointment_booked", label: "An appointment was booked for you" },
  { type: "appointment_reminder", label: "Booking reminders: the day before, an hour before, the evening before a collection" },
  { type: "appointment_missed", label: "Booking missed: not arrived or not collected" },
  { type: "job_gated_in", label: "Car gated in (workshop manager heads-up)" },
  { type: "job_assigned", label: "A car was assigned to you", locked: true },
  { type: "inspection_submitted", label: "Inspection report ready to approve", locked: true },
  { type: "inspection_returned", label: "Inspection report sent back to you", locked: true },
  { type: "inspection_approved", label: "Inspection report approved, ready for the quote", locked: true },
  { type: "inspection_overdue", label: "Inspection taking too long", locked: true },
  { type: "inspection_change_requested", label: "A change to an approved report needs the owner's approval", locked: true },
  { type: "inspection_change_decided", label: "Your change request was decided", locked: true },
  { type: "move_requested", label: "A special move needs the owner's approval", locked: true },
  { type: "move_decided", label: "A special move was decided", locked: true },
  { type: "road_test_assigned", label: "A car needs a road test", locked: true },
  { type: "road_test_done", label: "Road test done", locked: true },
  { type: "report_opened", label: "Customer opened the inspection report", locked: true },
  { type: "parts_request", label: "Parts to price on a new report (Parts)", locked: true },
  { type: "parts_priced", label: "Every part on your quotation is priced and confirmed", locked: true },
  { type: "parts_confirm_needed", label: "Parts listed for your car: confirm what you need", locked: true },
  { type: "parts_confirmed", label: "The technician confirmed or rejected parts", locked: true },
  { type: "quote_owner_approval", label: "A quotation needs the owner's approval", locked: true },
  { type: "quote_opened", label: "Customer opened the quotation", locked: true },
  { type: "quote_approved", label: "Customer approved a quotation", locked: true },
  { type: "quote_declined", label: "Customer declined a quotation", locked: true },
  { type: "quote_urgent_requested", label: "Customer asked for a quotation with the urgent work only", locked: true },
  { type: "quote_expired", label: "A quotation expired without a reply", locked: true },
  { type: "parts_to_order", label: "Approved parts to order (Parts)", locked: true },
  { type: "estimate_accepted", label: "Customer accepted an estimate", locked: true },
  { type: "estimate_followup", label: "Estimate with no reply: follow up", locked: true },
  { type: "quote_target", label: "Parts pricing or quotation past its target", locked: true },
  { type: "po_approval", label: "An LPO needs approval (owner or head accountant)", locked: true },
  { type: "po_decided", label: "Your LPO was approved or refused", locked: true },
  { type: "parts_arrived", label: "Parts arrived for your car", locked: true },
  { type: "parts_late", label: "A part is past its expected date", locked: true },
  { type: "supplier_invoice_pending", label: "A supplier invoice is still to follow", locked: true },
  { type: "parts_issued", label: "Parts issued to the technician", locked: true },
  { type: "work_ready", label: "Work order ready to assign", locked: true },
  { type: "work_assigned", label: "Work assigned to you", locked: true },
  { type: "additional_work", label: "A technician found additional work", locked: true },
  { type: "additional_work_decided", label: "Additional work approved or refused", locked: true },
  { type: "work_complete", label: "Work confirmed complete, car to QC", locked: true },
  { type: "qc_result", label: "QC passed or failed", locked: true },
  { type: "wash_ready", label: "Car ready for the wash", locked: true },
  { type: "car_ready", label: "Car ready: send the customer the message", locked: true },
  { type: "ready_to_invoice", label: "Ready to invoice (accounts)", locked: true },
  { type: "invoice_issued", label: "Invoice issued", locked: true },
  { type: "payment_link_opened", label: "Customer opened the payment link", locked: true },
  { type: "payment_received", label: "Payment received", locked: true },
  { type: "cheque_bounced", label: "A cheque bounced", locked: true },
  { type: "credit_note_approval", label: "A credit note needs the owner's approval", locked: true },
  { type: "commission_approval", label: "A commission needs the owner's approval", locked: true },
  { type: "low_profit", label: "A low-profit quotation was sent anyway (owner)", locked: true },
  { type: "release_approval", label: "A car with a balance due needs release approval", locked: true },
  { type: "delivery", label: "A delivery was booked, left or delivered", locked: true },
  { type: "gate_out_followup", label: "Follow-up call due after gate-out", locked: true },
  { type: "parts_question", label: "Parts asked the workshop manager about a part", locked: true },
  { type: "parts_answer", label: "The workshop manager answered a parts question", locked: true },
  { type: "parts_reminder", label: "The advisor is waiting for parts prices", locked: true },
  { type: "parts_escalation", label: "Parts prices are late (owner)", locked: true },
  { type: "quote_complete", label: "A quotation is complete and ready to send", locked: true },
  { type: "dangerous_found", label: "A technician marked a finding as dangerous", locked: true },
  { type: "big_job", label: "A technician flagged a big job", locked: true },
  { type: "estimate_hours", label: "The technician's estimated hours need the manager's agreement", locked: true },
  { type: "scan_received", label: "An Autel scan report arrived for your car", locked: true },
  { type: "scan_unmatched", label: "An Autel scan report could not be matched to a car", locked: true },
  { type: "scan_mailbox_problem", label: "The scans mailbox needs to be connected again", locked: true },
  { type: "film_waste", label: "A film roll finished with too many metres unaccounted", locked: true },
  { type: "aftercare_due", label: "A 10-day after-care check due or missed", locked: true },
  { type: "scan_approval", label: "A technician asks to skip the pre-scan", locked: true },
  { type: "planning", label: "Planning: your turn (Parts, workshop manager, advisor)", locked: true },
  { type: "work_done", label: "A technician pressed Job finished; confirm or send back", locked: true },
  { type: "work_sendback", label: "The manager sent the work back to you", locked: true },
  { type: "pause", label: "A technician paused waiting for parts or the manager", locked: true },
  { type: "left_job", label: "A technician left a job", locked: true },
  { type: "handover", label: "Parts handed over or returned", locked: true },
  { type: "job_summary", label: "Job summary after QC (owner and manager)", locked: true },
  { type: "bodyshop_heads_up", label: "Bodyshop: a car is coming to your section, or is with you now", locked: true },
  { type: "bodyshop_late", label: "Bodyshop: a stage ran late and the handover moved", locked: true },
  { type: "bodyshop_due_out", label: "Bodyshop: a car is due out tomorrow", locked: true },
  { type: "bodyshop_signoff", label: "Bodyshop: the release sign-off is needed, or complete", locked: true },
  { type: "bodyshop_not_ready", label: "Bodyshop: a car was sent back as not ready", locked: true },
  { type: "bodyshop_handover_moved", label: "Bodyshop: the handover date changed", locked: true },
  { type: "bodyshop_left", label: "Bodyshop: a car has left the workshop", locked: true },
  { type: "bodyshop_electrical", label: "Bodyshop: an electrical reset for the electricians", locked: true },
  { type: "bodyshop_booked", label: "Bodyshop: a quotation was approved before the car arrived", locked: true },
  { type: "comeback", label: "A comeback job needs a cause or the owner's decision", locked: true },
  { type: "inspection_fee_request", label: "An inspection fee below AED 750 asked (owner decides)", locked: true },
  { type: "payment_void", label: "A receipt was voided or an overpayment approved (owner)", locked: true },
  { type: "payment_verify", label: "A payment recorded by an advisor to verify (accounts)", locked: true },
  { type: "overpayment_approval", label: "A payment above the balance needs the owner's approval", locked: true },
  { type: "wash", label: "Car ready for the wash, or wash done", locked: true },
  { type: "parts_not_received", label: "The technician did not receive some parts", locked: true },
  { type: "parts_exchange", label: "A wrong or faulty part needs exchanging", locked: true },
  { type: "parts_no_home", label: "A part has no home: not needed, wrong, or back with Parts (owner)", locked: true },
  { type: "quote_other_editor", label: "Another advisor changed or sent your quotation", locked: true },
  { type: "advisor_change", label: "A car was put under your name (advisor in charge)", locked: true },
];

/** Every hand-over of a car from one person to the next: these always arrive, whatever the person's preferences. */
export const HANDOVER_TYPES = new Set(["bodyshop_signoff", "bodyshop_due_out", "bodyshop_left", "bodyshop_not_ready", "bodyshop_handover_moved", "parts_not_received", "parts_exchange", "job_awaiting_assignment", "assignment_overdue", "job_assigned", "road_test_assigned", "road_test_decided", "inspection_open", "inspection_submitted", "inspection_returned", "parts_request", "parts_priced", "quote_owner_approval", "quote_approved", "quote_declined", "quote_urgent_requested", "planning", "parts_to_order", "parts_arrived", "handover", "work_done", "work_complete", "work_sendback", "work_ready", "qc_result", "wash", "car_ready", "invoice_issued", "payment_received", "release_approval", "delivery", "owner_report", "loose_gated_in", "dangerous_found"]);

export type NotificationInput = { type: string; title: string; body?: string | null; jobId?: string | null; href?: string | null };

/**
 * Section 4 (21 October): the OWNER's bell carries only what matters to him - approvals waiting for him,
 * red or urgent items, and money. These informational types never ring his bell (the dashboards and
 * lists still show everything); everyone else receives them as before.
 */
export const OWNER_QUIET_TYPES = new Set([
  "owner_report", "job_summary", "job_gated_in", "approval_opened", "approval_approved", "approval_reminder",
  "report_opened", "quote_opened", "quote_complete", "proforma_sent", "scan_received", "appointment_booked",
  "appointment_reminder", "wash", "wash_ready", "parts_arrived", "parts_issued", "work_assigned", "work_ready",
  "catalog_review", "estimate_followup", "road_test_done", "inspection_open",
]);

/** Sends a notification to specific people, respecting their preferences. */
export async function notifyStaff(staffIds: string[], n: NotificationInput) {
  let ids = Array.from(new Set(staffIds.filter(Boolean)));
  if (ids.length === 0) return;
  const admin = createAdminClient();
  if (OWNER_QUIET_TYPES.has(n.type)) {
    // Quiet for the owner's bell only; the rest of the list keeps it.
    const { data: owners } = await admin.from("staff").select("id").eq("role_id", "owner").in("id", ids);
    const ownerIds = new Set((owners ?? []).map((o) => o.id));
    ids = ids.filter((id) => !ownerIds.has(id));
    if (ids.length === 0) return;
  }
  const locked = HANDOVER_TYPES.has(n.type) || (NOTIFICATION_TYPES.find((t) => t.type === n.type)?.locked ?? false);
  let recipients = ids;
  if (!locked) {
    const { data: prefs } = await admin
      .from("notification_preferences")
      .select("staff_id, enabled")
      .eq("type", n.type)
      .in("staff_id", ids);
    const off = new Set((prefs ?? []).filter((p) => !p.enabled).map((p) => p.staff_id));
    recipients = ids.filter((id) => !off.has(id));
  }
  if (recipients.length === 0) return;
  await admin.from("notifications").insert(
    recipients.map((staff_id) => ({
      staff_id,
      type: n.type,
      title: n.title,
      body: n.body ?? null,
      job_id: n.jobId ?? null,
      href: n.href ?? null,
    })),
  );
}

/** Sends a notification to everyone with one of the given roles. */
export async function notifyRoles(roles: RoleId[], n: NotificationInput) {
  const admin = createAdminClient();
  const { data } = await admin.from("staff").select("id").in("role_id", roles).eq("is_active", true);
  await notifyStaff((data ?? []).map((s) => s.id), n);
}

/**
 * Section 4 (21 October): a car's notifications go to its ADVISOR IN CHARGE (jobs.advisor_id, falling
 * back to whoever gated it in) plus anyone who pressed Follow on the car - never to every advisor.
 * `except` leaves out the person who did the thing.
 */
export async function jobAdvisorIds(jobId: string | null | undefined): Promise<string[]> {
  if (!jobId) return [];
  const admin = createAdminClient();
  const [{ data: job }, { data: follows }] = await Promise.all([
    admin.from("jobs").select("advisor_id, gated_in_by").eq("id", jobId).maybeSingle(),
    admin.from("job_followers").select("staff_id").eq("job_id", jobId).eq("is_active", true),
  ]);
  if (!job) return [];
  return Array.from(new Set([job.advisor_id ?? job.gated_in_by, ...(follows ?? []).map((f) => f.staff_id)].filter((x): x is string => !!x)));
}

export async function notifyJobAdvisors(jobId: string | null | undefined, n: NotificationInput, opts: { except?: string | null } = {}) {
  if (!jobId) return;
  const ids = (await jobAdvisorIds(jobId)).filter((x) => x !== opts.except);
  await notifyStaff(ids, { ...n, jobId });
}

/** The workshop managers of a department: mechanical, bodyshop (incl. paint and PPF), or all for "both" and unknown. */
export async function notifyManagers(jobDepartment: string | null | undefined, n: NotificationInput) {
  const admin = createAdminClient();
  const { data } = await admin.from("staff").select("id, department_id").eq("role_id", "workshop_manager").eq("is_active", true);
  const side = (d: string | null) => (d === "mechanical" ? "mechanical" : d === "bodyshop" || d === "paint" || d === "ppf_tint" ? "bodyshop" : null);
  const ids = (data ?? [])
    .filter((m) => !jobDepartment || jobDepartment === "both" || !side(m.department_id) || side(m.department_id) === jobDepartment)
    .map((m) => m.id);
  await notifyStaff(ids, n);
}
