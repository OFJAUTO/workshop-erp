"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAppError, SAVE_FAILED } from "@/lib/app-errors";

/** "Nothing to receive" on a loose-items job (a parts sale): the first step is done with no items or photos. */
export async function nothingToReceiveAction(jobId: string): Promise<{ error?: string; ok?: boolean }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  if (!["owner", "service_advisor", "gate_in", "parts"].includes(staff.role_id)) return { error: "Not allowed." };
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_kind, is_open").eq("id", jobId).maybeSingle();
  if (!job || job.job_kind !== "loose" || !job.is_open) return { error: "This is not an open loose-items job." };
  const { error } = await admin.from("job_events").insert({ job_id: jobId, event_type: "items_none", note: `Nothing to receive (parts sale, no items brought in): ${staff.display_name}`, created_by: staff.id });
  if (error) {
    await logAppError("loose-flow: nothing to receive", error, { staffId: staff.id, jobId });
    return { error: SAVE_FAILED };
  }
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
