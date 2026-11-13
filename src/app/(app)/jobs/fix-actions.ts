"use server";

import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobAdvisorIds, notifyRoles, notifyStaff } from "@/lib/notifications";
import type { RoleId } from "@/lib/roles";

/**
 * "Remind <name>" (13 November 2026, Section 4): the person looking at a warning they may not fix nudges the person who
 * can. One bell, with what is missing and the page it is fixed on; logged in the job's history.
 */
export async function remindToFix(jobId: string, what: string, who: "advisor" | "accounts" | "owner" | "bodyshop_manager" | "workshop_manager" | "parts", href: string): Promise<{ ok?: boolean; error?: string }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("job_number, department").eq("id", jobId).maybeSingle();
  if (!job) return { error: "Job not found." };
  const n = { type: "fix_reminder", title: `Please fix: ${what} · ${job.job_number}`, body: `${staff.display_name} needs this before the car can go on.`, jobId, href };
  if (who === "advisor") {
    const ids = await jobAdvisorIds(jobId);
    if (ids.length) await notifyStaff(ids, n);
    else await notifyRoles(["service_advisor"], n);
  } else if (who === "bodyshop_manager") {
    const { data: mgrs } = await admin.from("staff").select("id, department_id").eq("role_id", "workshop_manager").eq("is_active", true);
    const ids = ((mgrs ?? []) as { id: string; department_id: string | null }[]).filter((m) => ["bodyshop", "paint", "ppf_tint", "detailing"].includes(m.department_id ?? "")).map((m) => m.id);
    if (ids.length) await notifyStaff(ids, n);
    else await notifyRoles(["owner"], n);
  } else await notifyRoles([who as RoleId], n);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "fix_reminder", note: `${staff.display_name} reminded the ${who.replace("_", " ")}: ${what}`, created_by: staff.id });
  return { ok: true };
}
