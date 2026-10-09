"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { notifyStaff } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

function refresh(jobId: string) {
  revalidatePath("/wash");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
}

async function toReady(jobId: string, by: string, byName: string, note: string) {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, status, gated_in_by, is_open").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open || job.status !== "pending_wash") return null;
  const now = new Date().toISOString();
  await admin.from("jobs").update({ status: "ready", stage: "ready", stage_entered_at: now }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: "pending_wash", to_status: "ready", note, created_by: by });
  const { data: appr } = await admin.from("approval_requests").select("sent_by").eq("job_id", jobId);
  const ids = Array.from(new Set([job.gated_in_by, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
  await notifyStaff(ids, { type: "car_ready", title: `Car ready · ${job.job_number}`, body: `${note} (${byName}). Mark it ready to invoice so accounts can issue the invoice.`, jobId, href: `/jobs/${jobId}` });
  return job;
}

/** "Wash done", recorded with the name and time, optional photo. */
export async function washDone(jobId: string, formData: FormData) {
  const staff = await requirePermission("washCars");
  const admin = createAdminClient();
  const photo = blankToNull(formData.get("photo_path"));
  const now = new Date().toISOString();
  await admin.from("washes").upsert({ job_id: jobId, done_by: staff.id, done_at: now, photo_path: photo, skipped: false, skip_reason: null, skipped_by: null, created_by: staff.id, updated_by: staff.id }, { onConflict: "job_id" });
  const job = await toReady(jobId, staff.id, staff.display_name, `Wash done by ${staff.display_name}`);
  refresh(jobId);
  redirect(`/wash?message=${encodeURIComponent(job ? `${job.job_number}: wash done, the car is Ready.` : "Wash recorded.")}`);
}

/** An advisor or the owner skips the wash with a reason. */
export async function skipWash(jobId: string, formData: FormData) {
  const staff = await requirePermission("washCars");
  if (staff.role_id !== "owner" && staff.role_id !== "service_advisor") redirect(`/wash?error=${encodeURIComponent("Only an advisor or the owner can skip the wash.")}`);
  const reason = blankToNull(formData.get("reason"));
  if (!reason || reason.length < 3) redirect(`/wash?error=${encodeURIComponent("Write the reason to skip the wash.")}`);
  const admin = createAdminClient();
  await admin.from("washes").upsert({ job_id: jobId, skipped: true, skip_reason: reason, skipped_by: staff.id, done_at: null, created_by: staff.id, updated_by: staff.id }, { onConflict: "job_id" });
  const job = await toReady(jobId, staff.id, staff.display_name, `Wash skipped by ${staff.display_name}: ${reason}`);
  refresh(jobId);
  redirect(`/wash?message=${encodeURIComponent(job ? `${job.job_number}: wash skipped, the car is Ready.` : "Recorded.")}`);
}
