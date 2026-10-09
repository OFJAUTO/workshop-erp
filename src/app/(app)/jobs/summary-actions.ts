"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

/** The manager's (or owner's) one-line comment on the job summary. */
export async function commentJobSummary(jobId: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  const comment = blankToNull(formData.get("comment"));
  const admin = createAdminClient();
  await admin.from("jobs").update({ summary_comment: comment?.slice(0, 300) ?? null, summary_comment_by: staff.id }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "job_summary", note: `${staff.display_name} on the job summary: ${comment ?? "(comment removed)"}`, created_by: staff.id });
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent("Comment saved.")}#summary`);
}
