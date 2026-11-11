import "server-only";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { scopeLabel } from "@/lib/inspection-scope";

type ScopeAnswer = { ok?: boolean; error?: string; message?: string } | null;
const refresh = (jobId: string) => { revalidatePath(`/jobs/${jobId}`); revalidatePath(`/my-jobs/${jobId}`); };
async function logEvent(jobId: string, by: string, type: string, note: string) { await createAdminClient().from("job_events").insert({ job_id: jobId, event_type: type, note, created_by: by }); }

/** The owner's answer on a downgrade asked after the start (the Approvals box). */
export async function decideScopeRequest(jobId: string, approve: boolean, note: string, by: { id: string; display_name: string; role_id: string }): Promise<ScopeAnswer> {
  if (by.role_id !== "owner") return { error: "Only the owner decides this." };
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("inspection_scope, inspection_scope_request, inspection_scope_request_by").eq("id", jobId).maybeSingle();
  if (!job?.inspection_scope_request) return { error: "Nothing waiting." };
  const to = job.inspection_scope_request as string;
  await admin.from("jobs").update({ ...(approve ? { inspection_scope: to, inspection_scope_set_by: by.id, inspection_scope_set_at: new Date().toISOString() } : {}), inspection_scope_request: null, inspection_scope_request_by: null, inspection_scope_request_at: null, inspection_scope_request_reason: null, updated_by: by.id }).eq("id", jobId);
  await logEvent(jobId, by.id, "inspection_scope", approve ? `The owner approved the inspection type ${scopeLabel(to)}${note ? `: ${note}` : ""}` : `The owner kept the inspection as ${scopeLabel(job.inspection_scope as string)}: ${note}`);
  if (job.inspection_scope_request_by) {
    const { notifyStaff } = await import("@/lib/notifications");
    await notifyStaff([job.inspection_scope_request_by as string], { type: "owner_approval_needed", title: approve ? `Inspection type changed to ${scopeLabel(to)}` : "Inspection type kept", body: note || "", jobId, href: `/jobs/${jobId}` });
  }
  refresh(jobId);
  return { ok: true, message: approve ? `Changed to ${scopeLabel(to)}.` : "Kept as it was." };
}

