import "server-only";
import { createAdminClient } from "./supabase/admin";
import { additionalTo, dubaiDay, estimateFamilies, quoteFamilies, type QuoteFamily, type QuoteVersionRow } from "./quote-history";

/** Every quotation and version of these jobs (kept versions included; cancelled and deleted ones left out), grouped per job. */
export async function loadQuoteHistory(jobIds: string[]): Promise<Map<string, QuoteFamily[]>> {
  const out = new Map<string, QuoteFamily[]>();
  if (!jobIds.length) return out;
  const { data } = await createAdminClient()
    .from("quotations")
    .select("id, job_id, number, version, kind, status, total_aed, approved_total_aed, rounded_total_aed, sent_at, opened_at, responded_at, approver_name, created_at, created_by, token")
    .in("job_id", jobIds)
    .eq("kind", "quotation")
    .eq("is_active", true)
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .order("created_at");
  const rows = ((data ?? []) as Record<string, unknown>[]).map(toRow);
  for (const id of jobIds) out.set(id, quoteFamilies(rows.filter((r) => r.job_id === id)));
  return out;
}

export async function loadJobQuotes(jobId: string): Promise<QuoteFamily[]> {
  return (await loadQuoteHistory([jobId])).get(jobId) ?? [];
}

/** For the customer's copy of a quotation: the earlier approved quotations it adds to. */
export async function additionalToOf(jobId: string | null, number: string) {
  if (!jobId) return [];
  return additionalTo(await loadJobQuotes(jobId), number);
}

/**
 * Every estimate of these cars, or of one customer (30 October 2026), grouped per car: each number with its versions,
 * ADDITIONAL / ORIGINAL, and the job it was carried over to. Deleted drafts are left out; cancelled ones stay.
 */
export async function loadEstimateHistory(where: { vehicleIds?: string[]; customerId?: string }): Promise<Map<string, QuoteFamily[]>> {
  const out = new Map<string, QuoteFamily[]>();
  if (!where.customerId && !where.vehicleIds?.length) return out;
  const admin = createAdminClient();
  let q = admin
    .from("quotations")
    .select("id, job_id, vehicle_id, number, version, kind, status, total_aed, approved_total_aed, rounded_total_aed, sent_at, opened_at, responded_at, approver_name, created_at, created_by, token, additional_to_id, carried_job_id, cancel_reason")
    .eq("kind", "estimate")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("created_at");
  q = where.customerId ? q.eq("customer_id", where.customerId) : q.in("vehicle_id", where.vehicleIds!);
  const { data } = await q;
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...toRow(r), vehicle_id: (r.vehicle_id as string | null) ?? null, additional_to_id: (r.additional_to_id as string | null) ?? null, carried_job_id: (r.carried_job_id as string | null) ?? null, cancel_reason: (r.cancel_reason as string | null) ?? null }));
  if (!rows.length) return out;
  // An estimate attached before 30 October (jobs.estimate_id) counts as carried over too.
  const { data: attached } = await admin.from("jobs").select("id, job_number, estimate_id").in("estimate_id", rows.map((r) => r.id));
  for (const j of attached ?? []) {
    const r = rows.find((x) => x.id === j.estimate_id);
    if (r && !r.carried_job_id) r.carried_job_id = j.id as string;
  }
  const jobIds = Array.from(new Set(rows.map((r) => r.carried_job_id).filter((x): x is string => !!x)));
  const { data: jobs } = jobIds.length ? await admin.from("jobs").select("id, job_number").in("id", jobIds) : { data: [] };
  const jobNumbers = new Map((jobs ?? []).map((j) => [j.id as string, j.job_number as string]));
  for (const vid of Array.from(new Set(rows.map((r) => r.vehicle_id ?? "")))) out.set(vid, estimateFamilies(rows.filter((r) => (r.vehicle_id ?? "") === vid), jobNumbers));
  return out;
}

/** For the customer's copy of an additional estimate: the estimate it adds to ("E-00035", accepted on). */
export async function estimateAddsTo(q: { kind: string; additional_to_id?: string | null }): Promise<{ number: string; acceptedOn: string | null } | null> {
  if (q.kind !== "estimate" || !q.additional_to_id) return null;
  const admin = createAdminClient();
  const { data: base } = await admin.from("quotations").select("number").eq("id", q.additional_to_id).maybeSingle();
  if (!base) return null;
  // Accepted on any of its versions.
  const { data: accepted } = await admin.from("quotations").select("responded_at").eq("kind", "estimate").eq("number", base.number).eq("status", "approved").order("version", { ascending: false }).limit(1).maybeSingle();
  return { number: base.number as string, acceptedOn: accepted?.responded_at ? dubaiDay(accepted.responded_at as string) : null };
}

/** Staff names by id, for "replaced by v2 on 29 Oct by Mathew". */
export async function staffNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!unique.length) return new Map();
  const { data } = await createAdminClient().from("staff").select("id, display_name").in("id", unique);
  return new Map((data ?? []).map((r) => [r.id as string, r.display_name as string]));
}

function toRow(r: Record<string, unknown>): QuoteVersionRow {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: r.id as string,
    job_id: (r.job_id as string | null) ?? null,
    number: r.number as string,
    version: Number(r.version) || 1,
    kind: r.kind as string,
    status: r.status as string,
    total_aed: Number(r.total_aed) || 0,
    approved_total_aed: n(r.approved_total_aed),
    rounded_total_aed: n(r.rounded_total_aed),
    sent_at: (r.sent_at as string | null) ?? null,
    opened_at: (r.opened_at as string | null) ?? null,
    responded_at: (r.responded_at as string | null) ?? null,
    approver_name: (r.approver_name as string | null) ?? null,
    created_at: r.created_at as string,
    created_by: (r.created_by as string | null) ?? null,
    token: (r.token as string | null) ?? null,
  };
}
