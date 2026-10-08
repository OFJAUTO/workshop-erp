"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { MANUAL_STATUS_OPTIONS, STATUS_LABELS, STATUS_STAGE, type JobStatus } from "@/lib/jobs";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/** A workshop manager or advisor asks the owner to move a job past a gate. */
export async function requestMove(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("requestMove");
  const values = formValues(formData);
  const reason = blankToNull(formData.get("reason"));
  if (!reason || reason.length < 5) return { error: "Say why the job needs to move.", values };
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, is_open").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return { error: "This job is closed.", values };
  const { data: pending } = await admin.from("move_requests").select("id").eq("job_id", jobId).eq("status", "pending").maybeSingle();
  if (pending) return { error: "A special move request is already waiting for the owner.", values };
  await admin.from("move_requests").insert({ job_id: jobId, requested_by: staff.id, reason, created_by: staff.id, updated_by: staff.id });
  await admin.from("job_events").insert({ job_id: jobId, event_type: "move_requested", note: `${staff.display_name} asked for a special move: ${reason}`, created_by: staff.id });
  await notifyRoles(["owner"], { type: "move_requested", title: `Special move requested · ${job.job_number}`, body: `${staff.display_name}: ${reason}`, jobId, href: `/jobs/${jobId}#moves` });
  revalidatePath(`/jobs/${jobId}`);
  return { success: "Sent to the owner.", values };
}

/** The owner approves (choosing the step and writing a reason) or refuses. The override stays on the job card for good. */
export async function decideMove(jobId: string, requestId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("moveJobs");
  const values = formValues(formData);
  const decision = String(formData.get("decision") ?? "");
  const reason = blankToNull(formData.get("decision_reason"));
  const toStatus = String(formData.get("to_status") ?? "") as JobStatus;
  if (decision !== "approved" && decision !== "refused") return { error: "Choose approve or refuse.", values };
  if (!reason || reason.length < 3) return { error: "Write a reason. It stays on the job card.", values };
  if (decision === "approved" && !MANUAL_STATUS_OPTIONS.includes(toStatus)) return { error: "Choose the step to move to.", values };
  const admin = createAdminClient();
  const { data: req } = await admin.from("move_requests").select("id, requested_by, status, reason").eq("id", requestId).eq("job_id", jobId).maybeSingle();
  if (!req || req.status !== "pending") return { error: "That request was already decided.", values };
  const { data: job } = await admin.from("jobs").select("id, job_number, status, is_open, gated_in_by, department").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return { error: "This job is closed.", values };
  const now = new Date().toISOString();
  await admin.from("move_requests").update({ status: decision, decided_by: staff.id, decided_at: now, decision_reason: reason, to_status: decision === "approved" ? toStatus : null, updated_by: staff.id }).eq("id", req.id);
  if (decision === "approved") {
    await admin.from("jobs").update({ status: toStatus, stage: STATUS_STAGE[toStatus] }).eq("id", jobId);
    await admin.from("job_events").insert({ job_id: jobId, event_type: "override", from_status: job.status, to_status: toStatus, note: `OVERRIDE by ${staff.display_name}: moved to "${STATUS_LABELS[toStatus]}" · ${reason} · requested by ${req.requested_by ? "staff" : "unknown"}: ${req.reason}`, created_by: staff.id });
  } else {
    await admin.from("job_events").insert({ job_id: jobId, event_type: "move_refused", note: `Special move refused by ${staff.display_name}: ${reason}`, created_by: staff.id });
  }
  const n = {
    type: "move_decided",
    title: `Special move ${decision} · ${job.job_number}`,
    body: decision === "approved" ? `Moved to "${STATUS_LABELS[toStatus]}" · ${reason}` : reason,
    jobId,
    href: `/jobs/${jobId}`,
  };
  await notifyStaff([req.requested_by, job.gated_in_by].filter((x): x is string => !!x), n);
  await notifyManagers(job.department ?? null, n);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
  revalidatePath("/overrides");
  return { success: decision === "approved" ? `Moved to "${STATUS_LABELS[toStatus]}". The override is on the job card.` : "Refused.", values };
}

/** Plain redirect helper for forms that need no state. */
export async function backToJob(jobId: string) {
  redirect(`/jobs/${jobId}`);
}
