import "server-only";
import { logAppError } from "./app-errors";
import { INSPECTION_BUCKET } from "./inspection-data";
import { createAdminClient } from "./supabase/admin";
import { JOB_FILES_BUCKET } from "./work-data";

export const SCANS_BUCKET = "scan-reports";

/**
 * THE pre/post rule (10 November 2026, Autel post-scan): the FIRST report for a job is the pre-scan; a report that arrives
 * once the work has started, or once a pre-scan exists, is the POST-scan.
 */
export function scanKindFor(status: string, hasPre = false): "pre" | "post" {
  if (hasPre) return "post";
  return ["in_work", "pending_qc", "pending_wash", "ready", "pending_payment", "in_delivery", "closed"].includes(status) ? "post" : "pre";
}

/** The job already has a pre-scan (an emailed one filed as pre, or one on the inspection). */
export async function jobHasPrescan(jobId: string): Promise<boolean> {
  const admin = createAdminClient();
  const [{ count: mailed }, { data: insp }] = await Promise.all([
    admin.from("inbound_scans").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "pre").eq("is_active", true),
    admin.from("inspections").select("id").eq("job_id", jobId).eq("is_active", true),
  ]);
  if ((mailed ?? 0) > 0) return true;
  const ids = (insp ?? []).map((r) => r.id as string);
  if (!ids.length) return false;
  const { count } = await admin.from("inspection_media").select("id", { count: "exact", head: true }).in("inspection_id", ids).eq("is_prescan", true).is("removed_at", null);
  return (count ?? 0) > 0;
}

/** THE pre/post rule for a job as it stands. */
export async function scanKindForJob(jobId: string, status: string): Promise<"pre" | "post"> {
  return scanKindFor(status, await jobHasPrescan(jobId));
}

export type PostscanOutcome = "attached" | "no_round" | "none" | "has_scan" | "failed";

/**
 * An emailed post-scan files itself into QC (10 November 2026): the newest matched post-scan PDF of the job becomes the
 * open QC round's post-scan when that round has none - copied into the job's files (kind qc_postscan) so QC, the job card
 * and the history read it like an attached one. Called when the email is filed and when a QC round opens (a scan that
 * came during the work waits for its round). Never replaces a post-scan QC already has; a failure is logged, never lost.
 */
export async function attachPostscanToQc(jobId: string): Promise<PostscanOutcome> {
  const admin = createAdminClient();
  const { data: round } = await admin.from("qc_checks").select("id, postscan_path").eq("job_id", jobId).eq("status", "open").eq("is_active", true).maybeSingle();
  if (!round) return "no_round";
  if (round.postscan_path) return "has_scan";
  const { data: scan } = await admin.from("inbound_scans").select("id, storage_path, file_name").eq("job_id", jobId).eq("kind", "post").in("status", ["matched", "attached"]).eq("is_active", true).eq("content_type", "application/pdf").order("received_at", { ascending: false }).limit(1).maybeSingle();
  if (!scan) return "none";
  const dest = `${jobId}/qc-postscan-${scan.id}.pdf`;
  const { error: copyErr } = await admin.storage.from(SCANS_BUCKET).copy(scan.storage_path as string, dest, { destinationBucket: JOB_FILES_BUCKET });
  if (copyErr && !/exists/i.test(copyErr.message)) {
    await logAppError("scans.postscan", copyErr, { jobId, detail: { scan: scan.id } });
    return "failed";
  }
  const caption = `Autel post-scan (email) ${String(scan.file_name ?? "").slice(0, 80)}`.trim();
  const { data: had } = await admin.from("job_files").select("id").eq("job_id", jobId).eq("kind", "qc_postscan").eq("storage_path", dest).limit(1);
  if (!had?.length) {
    const { error: fileErr } = await admin.from("job_files").insert({ job_id: jobId, kind: "qc_postscan", storage_path: dest, caption, content_type: "application/pdf", ref_id: round.id });
    if (fileErr) {
      await logAppError("scans.postscan", fileErr, { jobId, detail: { scan: scan.id } });
      return "failed";
    }
  }
  const { error: qcErr } = await admin.from("qc_checks").update({ postscan_path: dest, postscan_waived_reason: null }).eq("id", round.id).is("postscan_path", null);
  if (qcErr) {
    await logAppError("scans.postscan", qcErr, { jobId, detail: { scan: scan.id } });
    return "failed";
  }
  await admin.from("inbound_scans").update({ attached_at: new Date().toISOString() }).eq("id", scan.id).is("attached_at", null);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "scan_attached", note: `Autel post-scan ${scan.file_name ?? ""} filed into QC by itself` });
  return "attached";
}

/** The one caption an emailed scan carries on the inspection: how every path knows the file is already there. */
export const prescanCaption = (name: string) => `${name.slice(0, 100)} (email)`;

export type AttachOutcome = "attached" | "exists" | "no_inspection" | "failed";

/**
 * Copies a scan PDF into the inspection's files as its pre-scan, so the report and the "I have read it" step see it.
 * Idempotent: the same report (by its caption) is never copied twice, and a copy the technician removed with the X
 * stays removed. Failures are written to app_errors instead of vanishing.
 */
export async function attachPrescan(jobId: string, bytes: Buffer, name: string): Promise<AttachOutcome> {
  const admin = createAdminClient();
  const { data: insp } = await admin.from("inspections").select("id").eq("job_id", jobId).eq("path", "mechanical").eq("is_active", true).maybeSingle();
  if (!insp) return "no_inspection";
  const caption = prescanCaption(name);
  // Ever attached (removed ones included): attaching again would bring back what someone took off.
  const { data: already } = await admin.from("inspection_media").select("id").eq("inspection_id", insp.id).eq("is_prescan", true).eq("caption", caption).limit(1);
  if (already?.length) return "exists";
  const path = `${insp.id}/prescan-${Date.now()}.pdf`;
  const { error } = await admin.storage.from(INSPECTION_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (error) {
    await logAppError("scans.attach", error, { jobId, detail: { name } });
    return "failed";
  }
  const { error: insErr } = await admin.from("inspection_media").insert({ inspection_id: insp.id, kind: "pdf", is_prescan: true, storage_path: path, caption });
  if (insErr) {
    await logAppError("scans.attach", insErr, { jobId, detail: { name } });
    return "failed";
  }
  return "attached";
}
