import { createAdminClient } from "@/lib/supabase/admin";
import { schemaReady } from "@/lib/schema-ready";
import { notifyRoles } from "@/lib/notifications";

/**
 * COMEBACK AT OUR COST (10 November 2026, Section 9). A car back because of our mistake: marked on the job card with
 * the original job (this car's earlier jobs, found by VIN) or "original job not in the ERP" with the old invoice
 * number, and a compulsory reason (what went wrong, who did the original work). The owner approves (the existing
 * "Free of charge" decision). Every line then defaults to At our cost (complimentary: price 0, the real cost counted,
 * "Covered by OFJ warranty – no charge" for the customer); a line can be switched to Charged. Nothing at our cost is
 * invoiced. The cost comes off the original job's profit and its advisor bonus unless the owner switches that off.
 */
export type ComebackExtra = { reason: string | null; originalRef: string | null; deduct: boolean; markedBy: string | null; markedAt: string | null };

export async function comebackExtraReady(): Promise<boolean> {
  return schemaReady("jobs", "comeback_reason, comeback_original_ref, comeback_deduct_original");
}

export async function loadComebackExtra(jobId: string): Promise<ComebackExtra | null> {
  if (!(await comebackExtraReady())) return null;
  const { data } = await createAdminClient().from("jobs").select("comeback_reason, comeback_original_ref, comeback_deduct_original, comeback_marked_by, comeback_marked_at").eq("id", jobId).maybeSingle();
  if (!data) return null;
  return { reason: (data.comeback_reason as string | null) ?? null, originalRef: (data.comeback_original_ref as string | null) ?? null, deduct: data.comeback_deduct_original !== false, markedBy: (data.comeback_marked_by as string | null) ?? null, markedAt: (data.comeback_marked_at as string | null) ?? null };
}

/** This car's earlier jobs (same car record, or another record with the same VIN), newest first. */
export async function earlierJobsOfCar(jobId: string): Promise<{ id: string; job_number: string; gated_in_at: string; advisor_id: string | null }[]> {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, vehicle_id, gated_in_at, vehicle:vehicles(vin)").eq("id", jobId).maybeSingle();
  if (!job) return [];
  const vin = String((job.vehicle as { vin?: string | null } | null)?.vin ?? "").trim();
  const { data: sameVin } = vin.length >= 11 ? await admin.from("vehicles").select("id").eq("vin", vin) : { data: [] };
  const carIds = Array.from(new Set([job.vehicle_id as string, ...((sameVin ?? []).map((v) => v.id as string))].filter(Boolean)));
  const { data } = await admin.from("jobs").select("id, job_number, gated_in_at, advisor_id").in("vehicle_id", carIds).neq("id", jobId).lt("gated_in_at", job.gated_in_at as string).order("gated_in_at", { ascending: false }).limit(30);
  return (data ?? []) as { id: string; job_number: string; gated_in_at: string; advisor_id: string | null }[];
}

/** A job the owner decided is at our cost (the free comeback). */
export async function comebackFreeJob(jobId: string): Promise<boolean> {
  const { data } = await createAdminClient().from("jobs").select("comeback_free, comeback_confirmed_at").eq("id", jobId).maybeSingle();
  return !!data?.comeback_free && !!data?.comeback_confirmed_at;
}

/** "COMEBACK – AT OUR COST" on a job: the original (or the old invoice number) and the reason; the owner is asked. */
export async function markComebackAtOurCost(jobId: string, input: { originalJobId: string | null; originalRef: string | null; reason: string }, by: { id: string; display_name: string }): Promise<{ error?: string; words?: string }> {
  if (!(await comebackExtraReady())) return { error: "Comeback at our cost switches on once the database change is applied." };
  const reason = input.reason.trim();
  if (reason.length < 10) return { error: "Write what went wrong and who did the original work." };
  const ref = (input.originalRef ?? "").trim();
  if (!input.originalJobId && ref.length < 2) return { error: "Pick the original job, or tick \"Original job not in the ERP\" and type its old invoice number." };
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, is_open, comeback_confirmed_at").eq("id", jobId).maybeSingle();
  if (!job?.is_open) return { error: "This car is not in the workshop." };
  if (job.comeback_confirmed_at) return { error: "The owner has already decided this comeback." };
  if (input.originalJobId) {
    const ok = (await earlierJobsOfCar(jobId)).some((j) => j.id === input.originalJobId);
    if (!ok) return { error: "That job is not an earlier job of this car." };
  }
  const { error } = await admin.from("jobs").update({ comeback_of: input.originalJobId, comeback_original_ref: input.originalJobId ? null : ref.slice(0, 60), comeback_reason: reason.slice(0, 1000), comeback_cause: "workmanship", comeback_cause_by: by.id, comeback_cause_at: new Date().toISOString(), comeback_marked_by: by.id, comeback_marked_at: new Date().toISOString(), priority: "high" }).eq("id", jobId);
  if (error) return { error: "Couldn't save – nothing was changed. Try again." };
  let originalWords = `original invoice ${ref} (before the ERP)`;
  if (input.originalJobId) {
    const { data: o } = await admin.from("jobs").select("job_number").eq("id", input.originalJobId).maybeSingle();
    originalWords = `original job ${o?.job_number ?? ""}`;
  }
  await admin.from("job_events").insert({ job_id: jobId, event_type: "comeback", note: `Comeback at our cost marked by ${by.display_name} (${originalWords}): ${reason}`, created_by: by.id });
  await notifyRoles(["owner"], { type: "comeback", title: `Comeback at our cost waiting for you · ${job.job_number}`, body: `${by.display_name}: ${reason} (${originalWords})`, jobId, href: `/jobs/${jobId}#comeback` });
  return { words: "Marked ✓ The owner approves it; every line then defaults to At our cost." };
}

/** The comeback jobs whose cost the owner switched OFF the original job (and its bonus). */
export async function notDeducted(comebackJobIds: string[]): Promise<Set<string>> {
  if (!comebackJobIds.length || !(await comebackExtraReady())) return new Set();
  const { data } = await createAdminClient().from("jobs").select("id").in("id", comebackJobIds).eq("comeback_deduct_original", false);
  return new Set((data ?? []).map((r) => r.id as string));
}

/** Every line of the job's quotations being prepared: At our cost by default, the original job named (Section 9). */
export async function atOurCostQuotations(jobId: string, originalJobId: string | null, note: string | null, by: string) {
  const admin = createAdminClient();
  const { data: qs } = await admin.from("quotations").select("id").eq("job_id", jobId).eq("is_active", true).in("status", ["draft", "pending_owner"]);
  for (const q of qs ?? []) {
    await admin.from("quotations").update({ comp_reason: "our_mistake", comp_original_job_id: originalJobId, comp_note: note ? note.slice(0, 500) : null, updated_by: by }).eq("id", q.id);
    await admin.from("quotation_lines").update({ price_display: "complimentary", updated_by: by }).eq("quotation_id", q.id).eq("is_active", true).neq("line_type", "fee").or("price_display.is.null,price_display.eq.normal");
  }
}

