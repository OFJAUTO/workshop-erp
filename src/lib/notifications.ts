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
