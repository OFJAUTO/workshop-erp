import "server-only";
import { startersOf, staffNamesOf } from "./quote-lead";
import { pageAllIn } from "./page-all";
import { createAdminClient } from "./supabase/admin";

/**
 * THE ADVISOR OF A CAR on the parts screens (6 November 2026, Peter): the job's advisor in charge (`jobs.advisor_id`),
 * and who made the car's newest quotation when that was someone else ("quotation by Arsalan"). INTERNAL ONLY: shown on
 * staff screens, never on a supplier copy, a supplier list or anything the customer sees.
 */
export type JobAdvisor = { advisorId: string | null; advisorName: string | null; quoteById: string | null; quoteByName: string | null };

const NONE: JobAdvisor = { advisorId: null, advisorName: null, quoteById: null, quoteByName: null };

export async function jobAdvisorsFor(jobIds: string[]): Promise<Map<string, JobAdvisor>> {
  const ids = Array.from(new Set(jobIds.filter(Boolean)));
  const out = new Map<string, JobAdvisor>();
  if (!ids.length) return out;
  const admin = createAdminClient();
  const [jobs, quotes] = await Promise.all([
    pageAllIn<{ id: string; advisor_id: string | null }>(ids, (part, a, b) => admin.from("jobs").select("id, advisor_id").in("id", part).order("id").range(a, b)),
    pageAllIn<{ job_id: string; number: string; created_at: string }>(ids, (part, a, b) =>
      admin.from("quotations").select("job_id, number, created_at").in("job_id", part).eq("kind", "quotation").eq("is_active", true).order("id").range(a, b),
    ),
  ]);
  // The newest quotation NUMBER of each job (its first version's maker is "who made the quotation").
  const newest = new Map<string, { number: string; at: string }>();
  for (const q of quotes) {
    const was = newest.get(q.job_id);
    if (!was || q.created_at > was.at) newest.set(q.job_id, { number: q.number, at: q.created_at });
  }
  const starters = await startersOf(Array.from(new Set(Array.from(newest.values()).map((n) => n.number))));
  const people = new Set<string>();
  for (const j of jobs) if (j.advisor_id) people.add(j.advisor_id);
  for (const s of starters.values()) people.add(s);
  const names = await staffNamesOf(Array.from(people));
  for (const j of jobs) {
    const n = newest.get(j.id);
    const starter = n ? (starters.get(n.number) ?? null) : null;
    const quoteById = starter && starter !== j.advisor_id ? starter : null;
    out.set(j.id, {
      advisorId: j.advisor_id,
      advisorName: j.advisor_id ? (names.get(j.advisor_id) ?? null) : null,
      quoteById,
      quoteByName: quoteById ? (names.get(quoteById) ?? null) : null,
    });
  }
  return out;
}

export async function jobAdvisorOf(jobId: string): Promise<JobAdvisor> {
  return (await jobAdvisorsFor([jobId])).get(jobId) ?? NONE;
}

/**
 * A job with NO advisor gets the advisor who made its quotation, else its estimate (8 November 2026, J-00989:
 * "Advisor: not set yet (quotation by Adarsh)"). Only a service advisor is ever set; a job that has an advisor is never
 * touched. Called when a quotation is started and when a car arrives with a carried estimate. Returns who was set.
 */
export async function fillMissingAdvisor(jobId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, advisor_id, estimate_id").eq("id", jobId).maybeSingle();
  if (!job || job.advisor_id) return null;
  const { data: qs } = await admin.from("quotations").select("number, created_at").eq("job_id", jobId).eq("is_active", true).order("created_at", { ascending: false }).limit(1);
  const numbers: string[] = [];
  if (qs?.[0]?.number) numbers.push(String(qs[0].number));
  if (job.estimate_id) {
    const { data: est } = await admin.from("quotations").select("number").eq("id", job.estimate_id).maybeSingle();
    if (est?.number) numbers.push(String(est.number));
  }
  if (!numbers.length) return null;
  const starters = await startersOf(numbers);
  const candidates = numbers.map((n) => starters.get(n)).filter((x): x is string => !!x);
  if (!candidates.length) return null;
  const { data: people } = await admin.from("staff").select("id, role_id, is_active").in("id", candidates);
  const pick = candidates.find((c) => (people ?? []).some((p) => p.id === c && p.role_id === "service_advisor" && p.is_active));
  if (!pick) return null;
  const { data: done } = await admin.from("jobs").update({ advisor_id: pick, updated_by: pick }).eq("id", jobId).is("advisor_id", null).select("id");
  if (!(done ?? []).length) return null;
  await admin.from("job_events").insert({ job_id: jobId, event_type: "advisor_set", note: "Advisor set from the quotation or estimate (the job had none)", created_by: pick });
  return pick;
}
