"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { notifyManagers, notifyStaff } from "@/lib/notifications";
import { SCANS_BUCKET, attachPrescan, scanKindFor } from "@/lib/scans";
import { createAdminClient } from "@/lib/supabase/admin";

/** The manager attaches an unmatched scan to a job by hand; it is filed by the job's stage like a matched one. */
export async function attachScan(scanId: string, formData: FormData) {
  const staff = await requirePermission("approveInspections");
  const jobId = String(formData.get("job_id") ?? "");
  const back = (m: string, ok = false) => redirect(`/scans?${ok ? "message" : "error"}=${encodeURIComponent(m)}`);
  if (!jobId) back("Choose the job.");
  const admin = createAdminClient();
  const [{ data: scan }, { data: job }] = await Promise.all([
    admin.from("inbound_scans").select("id, storage_path, file_name, status").eq("id", scanId).maybeSingle(),
    admin.from("jobs").select("id, job_number, status, department, assigned_to").eq("id", jobId).maybeSingle(),
  ]);
  if (!scan || !job) back("Scan or job not found.");
  const kind = scanKindFor(job!.status);
  await admin.from("inbound_scans").update({ job_id: job!.id, kind, status: "attached", attached_by: staff.id, attached_at: new Date().toISOString(), updated_by: staff.id }).eq("id", scan!.id);
  if (kind === "pre") {
    const { data: file } = await admin.storage.from(SCANS_BUCKET).download(scan!.storage_path);
    if (file) await attachPrescan(job!.id, Buffer.from(await file.arrayBuffer()), scan!.file_name ?? "scan.pdf");
  }
  await admin.from("job_events").insert({ job_id: job!.id, event_type: "scan_attached", note: `${staff.display_name} attached the scan report ${scan!.file_name ?? ""} (${kind}-scan)`, created_by: staff.id });
  const n = { type: "scan_received", title: `${kind === "pre" ? "Pre-scan" : "Post-scan"} report attached · ${job!.job_number}`, body: `${staff.display_name} attached ${scan!.file_name ?? "a scan report"}.`, jobId: job!.id, href: `/jobs/${job!.id}/inspection` };
  await notifyManagers(job!.department, n);
  if (job!.assigned_to) await notifyStaff([job!.assigned_to], { ...n, href: `/my-jobs/${job!.id}` });
  revalidatePath("/scans");
  revalidatePath(`/jobs/${job!.id}`);
  back(`Attached to ${job!.job_number} as a ${kind}-scan.`, true);
}

/** A scan that belongs to no car in the workshop (a test, or someone else's car). Kept, marked ignored. */
export async function ignoreScan(scanId: string) {
  const staff = await requirePermission("approveInspections");
  const admin = createAdminClient();
  await admin.from("inbound_scans").update({ status: "ignored", updated_by: staff.id }).eq("id", scanId);
  revalidatePath("/scans");
  redirect(`/scans?message=${encodeURIComponent("Ignored. It stays on the list below.")}`);
}
