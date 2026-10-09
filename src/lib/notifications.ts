import "server-only";
import { createAdminClient } from "./supabase/admin";
import type { RoleId } from "./roles";

/** Every kind of notification the system can send. Later phases add their own. */
export const NOTIFICATION_TYPES: { type: string; label: string; locked?: boolean }[] = [
  { type: "approval_opened", label: "Customer opened the approval link", locked: true },
  { type: "approval_approved", label: "Customer approved the job card", locked: true },
  { type: "approval_reminder", label: "Approval link not opened in time", locked: true },
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
  { type: "po_approval", label: "A purchase order needs approval (owner or head accountant)", locked: true },
  { type: "po_decided", label: "Your purchase order was approved or refused", locked: true },
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
  { type: "payment_received", label: "Payment received", locked: true },
  { type: "cheque_bounced", label: "A cheque bounced", locked: true },
  { type: "credit_note_approval", label: "A credit note needs the owner's approval", locked: true },
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
  { type: "scan_approval", label: "A technician asks to skip the pre-scan", locked: true },
  { type: "planning", label: "Planning: your turn (Parts, workshop manager, advisor)", locked: true },
  { type: "work_done", label: "A technician pressed Job finished; confirm or send back", locked: true },
  { type: "work_sendback", label: "The manager sent the work back to you", locked: true },
  { type: "pause", label: "A technician paused waiting for parts or the manager", locked: true },
  { type: "left_job", label: "A technician left a job", locked: true },
  { type: "handover", label: "Parts handed over or returned", locked: true },
  { type: "job_summary", label: "Job summary after QC (owner and manager)", locked: true },
  { type: "comeback", label: "A comeback job needs a cause or the owner's decision", locked: true },
  { type: "payment_void", label: "A receipt was voided or an overpayment approved (owner)", locked: true },
  { type: "payment_verify", label: "A payment recorded by an advisor to verify (accounts)", locked: true },
  { type: "overpayment_approval", label: "A payment above the balance needs the owner's approval", locked: true },
  { type: "wash", label: "Car ready for the wash, or wash done", locked: true },
];

export type NotificationInput = { type: string; title: string; body?: string | null; jobId?: string | null; href?: string | null };

/** Sends a notification to specific people, respecting their preferences. */
export async function notifyStaff(staffIds: string[], n: NotificationInput) {
  const ids = Array.from(new Set(staffIds.filter(Boolean)));
  if (ids.length === 0) return;
  const admin = createAdminClient();
  const locked = NOTIFICATION_TYPES.find((t) => t.type === n.type)?.locked ?? false;
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
