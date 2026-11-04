import "server-only";
import { logAppError } from "./app-errors";
import { INSPECTION_BUCKET } from "./inspection-data";
import { createAdminClient } from "./supabase/admin";

export const SCANS_BUCKET = "scan-reports";

/** Stages before the work starts take a pre-scan; from the work onwards a scan is the post-scan. */
export function scanKindFor(status: string): "pre" | "post" {
  return ["in_work", "pending_qc", "pending_wash", "ready", "pending_payment", "in_delivery", "closed"].includes(status) ? "post" : "pre";
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
