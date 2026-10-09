"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { QC_SELECT, type QcCheckRow, type QcItem } from "@/lib/work-data";

function refresh(jobId: string) {
  revalidatePath("/qc");
  revalidatePath(`/qc/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/work`);
  revalidatePath(`/my-jobs/${jobId}`);
  revalidatePath("/wash");
  revalidatePath("/dashboard");
}

/** Pass or fail on every item, mileage recorded, the post-scan attached (or a written reason). The person who did the work cannot do its QC. */
export async function saveQc(jobId: string, formData: FormData) {
  const staff = await requirePermission("doQc");
  const back = `/qc/${jobId}`;
  const admin = createAdminClient();
  const [{ data: job }, { data: qcRaw }, { data: worked }] = await Promise.all([
    admin.from("jobs").select("id, job_number, status, department, assigned_to, is_open, gated_in_by, rework_count").eq("id", jobId).maybeSingle(),
    admin.from("qc_checks").select(QC_SELECT).eq("job_id", jobId).eq("status", "open").eq("is_active", true).order("round", { ascending: false }).limit(1).maybeSingle(),
    admin.from("work_sessions").select("technician_id").eq("job_id", jobId).eq("technician_id", staff.id).limit(1),
  ]);
  if (!job || !job.is_open || job.status !== "pending_qc" || !qcRaw) redirect(`${back}?error=${encodeURIComponent("This car is not waiting for QC.")}`);
  if ((worked ?? []).length || job.assigned_to === staff.id) redirect(`${back}?error=${encodeURIComponent("You worked on this car; someone else must do its QC.")}`);
  const qc = qcRaw as QcCheckRow;
  const finish = String(formData.get("finish") ?? "") === "yes";
  const items: QcItem[] = qc.items.map((it) => {
    const result = String(formData.get(`result__${it.key}`) ?? "");
    const remark = blankToNull(formData.get(`remark__${it.key}`));
    return { ...it, result: result === "pass" || result === "fail" ? result : null, remark };
  });
  const mileageText = String(formData.get("mileage") ?? "").replace(/[^\d]/g, "");
  const mileage = mileageText ? Number(mileageText) : null;
  const mileageUnit = String(formData.get("mileage_unit") ?? "km") === "mi" ? "mi" : "km";
  const postscan = blankToNull(formData.get("postscan_path")) ?? qc.postscan_path;
  const waived = blankToNull(formData.get("postscan_waived_reason"));
  const notes = blankToNull(formData.get("notes"));
  const patch: Record<string, unknown> = { items, mileage, mileage_unit: mileageUnit, postscan_path: postscan, postscan_waived_reason: postscan ? null : waived, notes, inspector_id: staff.id, updated_by: staff.id };
  if (!finish) {
    await admin.from("qc_checks").update(patch).eq("id", qc.id);
    refresh(jobId);
    redirect(`${back}?message=${encodeURIComponent("Saved. Finish the checks when ready.")}`);
  }
  const missing = items.filter((i) => !i.result);
  if (missing.length) redirect(`${back}?error=${encodeURIComponent(`${missing.length} item${missing.length === 1 ? "" : "s"} not marked: ${missing.slice(0, 3).map((i) => i.label).join("; ")}${missing.length > 3 ? "…" : ""}`)}`);
  const noRemark = items.filter((i) => i.result === "fail" && !(i.remark ?? "").trim());
  if (noRemark.length) redirect(`${back}?error=${encodeURIComponent(`Write a remark on every Fail: ${noRemark.map((i) => i.label).join("; ")}`)}`);
  if (mileage === null) redirect(`${back}?error=${encodeURIComponent("Record the mileage at QC.")}`);
  if (!postscan && !waived) redirect(`${back}?error=${encodeURIComponent("Attach the post-scan PDF from the Autel, or write the reason it is missing.")}`);
  const failed = items.filter((i) => i.result === "fail");
  const now = new Date().toISOString();
  await admin.from("qc_checks").update({ ...patch, status: failed.length ? "failed" : "passed", finished_at: now }).eq("id", qc.id);
  await admin.from("jobs").update({ mileage_out: mileage }).eq("id", jobId);
  if (failed.length) {
    await admin.from("jobs").update({ status: "in_work", stage: "work", stage_entered_at: now, rework_count: (Number(job.rework_count) || 0) + 1 }).eq("id", jobId);
    // The failed work lines open again for the technician.
    const lineIds = failed.filter((i) => i.kind === "work").map((i) => i.key.slice("work:".length));
    if (lineIds.length) await admin.from("work_lines").update({ status: "in_progress", done_at: null, done_by: null, updated_by: staff.id }).in("id", lineIds);
    const summary = failed.map((i) => `${i.label}: ${i.remark}`).join("; ");
    await admin.from("job_events").insert({ job_id: jobId, event_type: "qc_failed", from_status: "pending_qc", to_status: "in_work", to_staff: job.assigned_to, note: `QC round ${qc.round} failed (${staff.display_name}), rework for ${job.assigned_to ? "the technician" : "the workshop"}: ${summary}`, created_by: staff.id });
    const n = { type: "qc_result", title: `QC failed, back to Work · ${job.job_number}`, body: summary, jobId, href: `/jobs/${jobId}/work` };
    await notifyManagers(job.department ?? null, n);
    if (job.assigned_to) await notifyStaff([job.assigned_to], { ...n, href: `/my-jobs/${jobId}` });
    refresh(jobId);
    redirect(`/qc?message=${encodeURIComponent(`${job.job_number}: ${failed.length} fail${failed.length === 1 ? "" : "s"}. The car is back in Work with the failed items.`)}`);
  }
  await admin.from("jobs").update({ status: "pending_wash", stage: "wash", stage_entered_at: now }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: "pending_qc", to_status: "pending_wash", note: `QC passed (${staff.display_name}), mileage ${mileage.toLocaleString("en-GB")} ${mileageUnit}${qc.round > 1 ? `, round ${qc.round}` : ""}`, created_by: staff.id });
  const washNote = { type: "wash_ready", title: `QC passed, car for the wash · ${job.job_number}`, body: `Passed by ${staff.display_name}.`, jobId, href: "/wash" };
  await notifyManagers(job.department ?? null, washNote);
  await notifyRoles(["qc_inspector"], washNote);
  const { data: appr } = await admin.from("approval_requests").select("sent_by").eq("job_id", jobId);
  await notifyStaff(Array.from(new Set([job.gated_in_by, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x))), washNote);
  refresh(jobId);
  redirect(`/qc?message=${encodeURIComponent(`${job.job_number} passed QC. It is on the car wash list.`)}`);
}
