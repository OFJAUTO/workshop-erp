import "server-only";
import { INSPECTION_BUCKET } from "./inspection-data";
import { createAdminClient } from "./supabase/admin";

export const SCANS_BUCKET = "scan-reports";

/** Stages before the work starts take a pre-scan; from the work onwards a scan is the post-scan. */
export function scanKindFor(status: string): "pre" | "post" {
  return ["in_work", "pending_qc", "pending_wash", "ready", "pending_payment", "in_delivery", "closed"].includes(status) ? "post" : "pre";
}

/** Copies a scan PDF into the inspection's files as its pre-scan, so the report and the "I have read it" step see it. */
export async function attachPrescan(jobId: string, bytes: Buffer, name: string) {
  const admin = createAdminClient();
  const { data: insp } = await admin.from("inspections").select("id").eq("job_id", jobId).eq("path", "mechanical").eq("is_active", true).maybeSingle();
  if (!insp) return false;
  const path = `${insp.id}/prescan-${Date.now()}.pdf`;
  const { error } = await admin.storage.from(INSPECTION_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (error) return false;
  await admin.from("inspection_media").insert({ inspection_id: insp.id, kind: "pdf", is_prescan: true, storage_path: path, caption: `${name.slice(0, 100)} (email)` });
  return true;
}
