"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { loadInspection } from "@/lib/inspection-data";
import { newToken } from "@/lib/media";
import { createAdminClient } from "@/lib/supabase/admin";

/** Owner or advisor creates the customer's link to the approved inspection report. */
export async function createReportLink(jobId: string) {
  const staff = await requirePermission("sendReport");
  const bundle = await loadInspection(jobId);
  if (!bundle || bundle.inspection.status !== "approved") return;
  const admin = createAdminClient();
  const { data: existing } = await admin.from("report_links").select("id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) return;
  await admin.from("report_links").insert({ job_id: jobId, inspection_id: bundle.inspection.id, token: newToken(), created_by: staff.id, updated_by: staff.id });
  await admin.from("job_events").insert({ job_id: jobId, event_type: "report_link_created", note: `Inspection report link created by ${staff.display_name}`, created_by: staff.id });
  revalidatePath(`/jobs/${jobId}`);
}

export async function markReportSent(jobId: string, linkId: string, method: string) {
  const staff = await requirePermission("sendReport");
  const admin = createAdminClient();
  await admin.from("report_links").update({ status: "sent", sent_at: new Date().toISOString(), sent_method: method.slice(0, 20), updated_by: staff.id }).eq("id", linkId).eq("job_id", jobId).eq("status", "created");
  await admin.from("job_events").insert({ job_id: jobId, event_type: "report_sent", note: `Inspection report sent to the customer by ${staff.display_name} (${method})`, created_by: staff.id });
  revalidatePath(`/jobs/${jobId}`);
}
