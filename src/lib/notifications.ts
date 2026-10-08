import "server-only";
import { createAdminClient } from "./supabase/admin";
import type { RoleId } from "./roles";

/** Every kind of notification the system can send. Later phases add their own. */
export const NOTIFICATION_TYPES: { type: string; label: string; locked?: boolean }[] = [
  { type: "approval_opened", label: "Customer opened the approval link", locked: true },
  { type: "approval_approved", label: "Customer approved the job card", locked: true },
  { type: "approval_reminder", label: "Approval link not opened in time", locked: true },
  { type: "job_awaiting_assignment", label: "Car approved and waiting to be assigned" },
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
