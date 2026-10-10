"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { notifyManagers, notifyStaff } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProforma } from "@/lib/invoice-flow";
import { getSettings } from "@/lib/settings";

function refresh(jobId: string) {
  revalidatePath("/wash");
  revalidatePath("/board/wash");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
}

async function advisorIds(jobId: string, gatedInBy: string | null) {
  const { data: appr } = await createAdminClient().from("approval_requests").select("sent_by").eq("job_id", jobId);
  return Array.from(new Set([gatedInBy, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
}

/** After the wash (or a skip) the car is Ready; the advisor marks it ready to invoice. */
async function toReady(jobId: string, by: string | null, byName: string, note: string) {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, status, gated_in_by, is_open").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open || job.status !== "pending_wash") return null;
  const now = new Date().toISOString();
  await admin.from("jobs").update({ status: "ready", stage: "ready", stage_entered_at: now }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: "pending_wash", to_status: "ready", note, created_by: by });
  const proforma = await ensureProforma(jobId, by ? { id: by, display_name: byName } : null, await getSettings()).catch(() => null);
  await notifyStaff(await advisorIds(jobId, job.gated_in_by), { type: "car_ready", title: `Car ready · ${job.job_number}`, body: `${note} (${byName}). ${proforma ? `${proforma.number} is ready: send it to the customer.` : "Nothing to invoice yet."}`, jobId, href: `/jobs/${jobId}` });
  return job;
}

const back = (from: string | null, jobId: string, msg: string, ok: boolean) => redirect(`${from === "job" ? `/jobs/${jobId}` : "/wash"}?${ok ? "message" : "error"}=${encodeURIComponent(msg)}`);

/** The advisor (or the owner) sends the car to the wash once it should go. It appears on the wash board. */
export async function sendToWash(jobId: string, formData: FormData) {
  const staff = await requirePermission("washCars");
  const from = blankToNull(formData.get("from"));
  if (staff.role_id !== "owner" && staff.role_id !== "service_advisor") back(from, jobId, "Only the advisor or the owner sends a car to the wash.", false);
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, status, is_open, wash_sent_at, department").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open || job.status !== "pending_wash") back(from, jobId, "The car is not waiting for the wash.", false);
  if (job!.wash_sent_at) back(from, jobId, "Already at the wash.", true);
  const now = new Date().toISOString();
  await admin.from("jobs").update({ wash_sent_at: now, wash_sent_by: staff.id }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "wash", note: `Sent to the wash by ${staff.display_name}`, created_by: staff.id });
  await notifyManagers(job!.department ?? null, { type: "wash", title: `Car at the wash · ${job!.job_number}`, body: `${staff.display_name} sent it. It is on the wash board.`, jobId, href: "/wash" });
  refresh(jobId);
  back(from, jobId, `${job!.job_number} is at the wash.`, true);
}

/** "Wash done", by the advisor or the owner: the car is Ready. No photo. */
export async function washDone(jobId: string, formData: FormData) {
  const staff = await requirePermission("washCars");
  const from = blankToNull(formData.get("from"));
  if (staff.role_id !== "owner" && staff.role_id !== "service_advisor") back(from, jobId, "Only the advisor or the owner marks the wash done.", false);
  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin.from("washes").upsert({ job_id: jobId, done_by: staff.id, done_at: now, photo_path: null, skipped: false, skip_reason: null, skipped_by: null, created_by: staff.id, updated_by: staff.id }, { onConflict: "job_id" });
  const job = await toReady(jobId, staff.id, staff.display_name, `Wash done by ${staff.display_name}`);
  refresh(jobId);
  back(from, jobId, job ? `${job.job_number}: wash done, the car is Ready.` : "Wash recorded.", true);
}

/** An advisor or the owner skips the wash with a reason. */
export async function skipWash(jobId: string, formData: FormData) {
  const staff = await requirePermission("washCars");
  const from = blankToNull(formData.get("from"));
  if (staff.role_id !== "owner" && staff.role_id !== "service_advisor") back(from, jobId, "Only an advisor or the owner can skip the wash.", false);
  const reason = blankToNull(formData.get("reason"));
  if (!reason || reason.length < 3) back(from, jobId, "Write the reason to skip the wash.", false);
  const admin = createAdminClient();
  await admin.from("washes").upsert({ job_id: jobId, skipped: true, skip_reason: reason, skipped_by: staff.id, done_at: null, created_by: staff.id, updated_by: staff.id }, { onConflict: "job_id" });
  const job = await toReady(jobId, staff.id, staff.display_name, `Wash skipped by ${staff.display_name}: ${reason}`);
  refresh(jobId);
  back(from, jobId, job ? `${job.job_number}: wash skipped, the car is Ready.` : "Recorded.", true);
}
