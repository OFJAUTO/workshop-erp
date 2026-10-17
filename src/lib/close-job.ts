import "server-only";
import { dubaiDate } from "./jobs";
import { recordOwnerReport } from "./owner-report";
import { getSettings } from "./settings";
import { createAdminClient } from "./supabase/admin";

/** Closes a job at gate-out or delivery: the stamp, the history line, the follow-up date, the owner's report. */
export async function closeJob(jobId: string, by: string | null, byName: string, how: string) {
  const admin = createAdminClient();
  const settings = await getSettings();
  const followDays = Number(settings.followup_days) || 3;
  const due = new Date(Date.now() + followDays * 86400000);
  const { data: job } = await admin.from("jobs").select("status, gated_in_by").eq("id", jobId).maybeSingle();
  const actor = by ?? job?.gated_in_by ?? null;
  await admin.from("jobs").update({ status: "closed", stage: "ready", is_open: false, gated_out_at: new Date().toISOString(), gated_out_by: actor, followup_due_at: dubaiDate(due) }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "gate_out", from_status: job?.status ?? null, to_status: "closed", note: `Gated out by ${byName}: ${how}`, created_by: actor });
  await admin.from("appointments").update({ status: "done", updated_by: actor }).eq("job_id", jobId).eq("kind", "customer_collects").eq("status", "booked");
  // The owner's report on the job, written now that it is over.
  await recordOwnerReport(jobId, settings).catch(() => null);
}
