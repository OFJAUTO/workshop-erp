"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { loadInspection } from "@/lib/inspection-data";
import { newToken } from "@/lib/media";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

export type ReportLinkState = { error?: string; ok?: boolean; id?: string; token?: string };

/**
 * Owner or advisor creates the customer's link to the approved inspection report.
 * Every outcome comes back as a message: the button never does nothing.
 */
export async function createReportLink(jobId: string, _prev: ReportLinkState, _formData?: FormData): Promise<ReportLinkState> {
  void _prev;
  void _formData;
  const staff = await getCurrentStaff();
  if (!staff) return { error: "Please sign in again." };
  if (staff.viewingAs) return { error: "View only: press Exit on the yellow bar first." };
  if (!can(staff.role_id as RoleId, "sendReport")) return { error: "Only the owner and service advisors can send the report." };
  const bundle = await loadInspection(jobId);
  if (!bundle) return { error: "This job has no inspection report yet." };
  if (bundle.inspection.status !== "approved") return { error: "The report can be sent once the workshop manager has approved it." };
  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin.from("report_links").select("id, token").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (readError) return { error: `Could not check for an existing link: ${readError.message}` };
  let row = existing as { id: string; token: string } | null;
  if (!row) {
    const { data: created, error } = await admin.from("report_links").insert({ job_id: jobId, inspection_id: bundle.inspection.id, token: newToken(), created_by: staff.id, updated_by: staff.id }).select("id, token").single();
    if (error || !created) return { error: `Could not create the link: ${error?.message ?? "unknown error"}` };
    row = created as { id: string; token: string };
    await admin.from("job_events").insert({ job_id: jobId, event_type: "report_link_created", note: `Inspection report link created by ${staff.display_name}`, created_by: staff.id });
  }
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, id: row.id, token: row.token };
}

/** Records that the link went to the customer (Open WhatsApp or Copy link). */
export async function markReportSent(jobId: string, linkId: string, method: string): Promise<ReportLinkState> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || !can(staff.role_id as RoleId, "sendReport")) return { error: "Not allowed." };
  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("report_links")
    .update({ status: "sent", sent_at: new Date().toISOString(), sent_method: method.slice(0, 20), updated_by: staff.id })
    .eq("id", linkId)
    .eq("job_id", jobId)
    .eq("status", "created")
    .select("id");
  if (error) return { error: `Could not record the send: ${error.message}` };
  if (updated?.length) {
    await admin.from("job_events").insert({ job_id: jobId, event_type: "report_sent", note: `Inspection report sent to the customer by ${staff.display_name} (${method})`, created_by: staff.id });
  }
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
