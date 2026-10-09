"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentStaff, requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { recordJobSummary } from "@/lib/job-summary";
import { notifyManagers, notifyStaff } from "@/lib/notifications";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { QC_SELECT, type QcCheckRow, type QcItem } from "@/lib/work-data";
import { activeTechnicians, openQcRound } from "@/lib/work-flow";

function refresh(jobId: string) {
  revalidatePath("/qc");
  revalidatePath(`/qc/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/work`);
  revalidatePath(`/my-jobs/${jobId}`);
  revalidatePath("/wash");
  revalidatePath("/dashboard");
}

async function advisorIds(jobId: string, gatedInBy: string | null) {
  const { data: appr } = await createAdminClient().from("approval_requests").select("sent_by").eq("job_id", jobId);
  return Array.from(new Set([gatedInBy, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
}

/** A car in Pending QC with no open round (moved there by hand): open the round so "Start QC" always works. */
export async function openQcRoundAction(jobId: string) {
  const staff = await getCurrentStaff();
  const role = (staff?.role_id ?? "") as RoleId;
  if (!staff || !(can(role, "doQc") || can(role, "manageWork"))) redirect(`/qc/${jobId}`);
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("status, is_open").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open || job.status !== "pending_qc") redirect(`/qc/${jobId}?error=${encodeURIComponent("The car is not in Pending QC.")}`);
  const round = await openQcRound(jobId, staff.id, await getSettings());
  refresh(jobId);
  redirect(`/qc/${jobId}?message=${encodeURIComponent(`QC round ${round} is open.`)}`);
}

/** Pass or fail on every item, mileage recorded, the post-scan attached (or a written reason). The person who did the work cannot do its QC. */
export async function saveQc(jobId: string, formData: FormData) {
  const staff = await requirePermission("doQc");
  const back = `/qc/${jobId}`;
  const admin = createAdminClient();
  const settings = await getSettings();
  const [{ data: job }, { data: worked }] = await Promise.all([
    admin.from("jobs").select("id, job_number, status, department, assigned_to, is_open, gated_in_by, rework_count").eq("id", jobId).maybeSingle(),
    admin.from("work_sessions").select("technician_id").eq("job_id", jobId).eq("technician_id", staff.id).limit(1),
  ]);
  if (!job || !job.is_open || job.status !== "pending_qc") redirect(`${back}?error=${encodeURIComponent("This car is not waiting for QC.")}`);
  if ((worked ?? []).length || job.assigned_to === staff.id) redirect(`${back}?error=${encodeURIComponent("You worked on this car; someone else must do its QC.")}`);
  // No open round (the car was moved here by hand): open it now rather than refuse the save.
  let { data: qcRaw } = await admin.from("qc_checks").select(QC_SELECT).eq("job_id", jobId).eq("status", "open").eq("is_active", true).order("round", { ascending: false }).limit(1).maybeSingle();
  if (!qcRaw) {
    await openQcRound(jobId, staff.id, settings);
    ({ data: qcRaw } = await admin.from("qc_checks").select(QC_SELECT).eq("job_id", jobId).eq("status", "open").eq("is_active", true).order("round", { ascending: false }).limit(1).maybeSingle());
    if (!qcRaw) redirect(`${back}?error=${encodeURIComponent("Could not open the QC round. Try again.")}`);
    refresh(jobId);
    redirect(`${back}?message=${encodeURIComponent("The QC round was not open yet; it is now. Fill it in.")}`);
  }
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
  const techs = await activeTechnicians(jobId);
  if (failed.length) {
    // Back to Work: the technicians get the failed items on top, their "Job finished" is undone, and the send-back counts against them.
    await admin.from("jobs").update({ status: "in_work", stage: "work", stage_entered_at: now, rework_count: (Number(job.rework_count) || 0) + 1, work_done_at: null }).eq("id", jobId);
    for (const t of techs) {
      const { data: row } = await admin.from("job_technicians").select("qc_sendbacks").eq("id", t.id).maybeSingle();
      await admin.from("job_technicians").update({ done_at: null, qc_sendbacks: (Number(row?.qc_sendbacks) || 0) + 1, updated_by: staff.id }).eq("id", t.id);
    }
    const lineIds = failed.filter((i) => i.kind === "work").map((i) => i.key.slice("work:".length));
    if (lineIds.length) await admin.from("work_lines").update({ status: "in_progress", done_at: null, done_by: null, updated_by: staff.id }).in("id", lineIds);
    const summary = failed.map((i) => `${i.label}: ${i.remark}`).join("; ");
    await admin.from("job_events").insert({ job_id: jobId, event_type: "qc_failed", from_status: "pending_qc", to_status: "in_work", to_staff: job.assigned_to, note: `QC round ${qc.round} failed (${staff.display_name}): ${summary}`, created_by: staff.id });
    const n = { type: "qc_result", title: `QC failed, back to Work · ${job.job_number}`, body: summary, jobId, href: `/jobs/${jobId}/work` };
    await notifyManagers(job.department ?? null, n);
    const techIds = Array.from(new Set([...techs.map((t) => t.staff_id), ...(job.assigned_to ? [job.assigned_to] : [])]));
    if (techIds.length) await notifyStaff(techIds, { ...n, href: `/my-jobs/${jobId}` });
    refresh(jobId);
    redirect(`/qc?message=${encodeURIComponent(`${job.job_number}: ${failed.length} fail${failed.length === 1 ? "" : "s"}. The car is back in Work with the failed items.`)}`);
  }
  // Passed: the car waits for the advisor to send it to the wash; the owner and the manager get the job summary.
  await admin.from("jobs").update({ status: "pending_wash", stage: "wash", stage_entered_at: now, wash_sent_at: null, wash_sent_by: null }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: "pending_qc", to_status: "pending_wash", note: `QC passed (${staff.display_name}), mileage ${mileage.toLocaleString("en-GB")} ${mileageUnit}${qc.round > 1 ? `, round ${qc.round}` : ""}`, created_by: staff.id });
  await notifyStaff(await advisorIds(jobId, job.gated_in_by), { type: "wash", title: `QC passed · ${job.job_number}`, body: `Passed by ${staff.display_name}. The car is ready for the wash: press "Send to wash" on the job card when it should go.`, jobId, href: `/jobs/${jobId}` });
  await recordJobSummary(jobId, job.job_number, job.department ?? null, settings);
  refresh(jobId);
  redirect(`/qc?message=${encodeURIComponent(`${job.job_number} passed QC. The advisor sends it to the wash.`)}`);
}
