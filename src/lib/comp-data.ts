import "server-only";
import { COMP_REASON_LABELS, isCompReason, type CompReason } from "./complimentary";
import { compReady } from "./schema-ready";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { timeSpentFor } from "./time-spent";
import { formatPlate } from "./types";

/**
 * Approved complimentary work (section 5.4/5.8, 30 October 2026), one row per quotation the owner approved as free:
 * where its cost goes (our mistake / warranty → the original job and Comebacks; goodwill → the customer's record), the
 * cost approved and - once the car has left - the actual cost (the hours really clocked at the cost rate, plus the
 * approved materials, parts and recovery). Never toward an advisor bonus: the bonus counts paid tax invoices only, and
 * nothing here touches them.
 */
export type CompJob = {
  quotationId: string;
  number: string;
  jobId: string | null;
  jobNumber: string | null;
  plate: string;
  customerId: string | null;
  customerName: string;
  advisorName: string | null;
  reason: CompReason;
  reasonLabel: string;
  note: string | null;
  originalJobId: string | null;
  originalJobNumber: string | null;
  normal: number;
  cost: number;
  costDetail: string | null;
  actualCost: number | null;
  decidedAt: string | null;
  gatedOutAt: string | null;
  /** The whole job was free (nothing to pay): no tax invoice by default. */
  whole: boolean;
};

export async function loadCompJobs(settings: Settings, filter: { from?: string; to?: string; jobIds?: string[]; originalJobIds?: string[]; customerId?: string } = {}): Promise<CompJob[]> {
  if (!(await compReady())) return [];
  const admin = createAdminClient();
  let q = admin
    .from("quotations")
    .select("id, number, version, job_id, customer_id, created_by, total_aed, comp_reason, comp_note, comp_original_job_id, comp_normal_aed, comp_cost_aed, comp_cost_detail, comp_decided_at")
    .eq("comp_status", "approved")
    .eq("is_active", true)
    .eq("status", "approved")
    .order("comp_decided_at", { ascending: false });
  if (filter.from) q = q.gte("comp_decided_at", filter.from);
  if (filter.to) q = q.lt("comp_decided_at", filter.to);
  if (filter.jobIds) q = q.in("job_id", filter.jobIds);
  if (filter.originalJobIds) q = q.in("comp_original_job_id", filter.originalJobIds);
  if (filter.customerId) q = q.eq("customer_id", filter.customerId);
  const { data } = await q.limit(500);
  // One row per quotation NUMBER: the newest approved version (a revision replaces the earlier figure).
  const seen = new Set<string>();
  const rows = ((data ?? []) as Record<string, unknown>[]).filter((r) => { const k = `${r.number}`; if (seen.has(k)) return false; seen.add(k); return isCompReason(r.comp_reason); });
  if (!rows.length) return [];
  const jobIds = Array.from(new Set(rows.flatMap((r) => [r.job_id, r.comp_original_job_id]).filter((x): x is string => typeof x === "string")));
  const customerIds = Array.from(new Set(rows.map((r) => r.customer_id).filter((x): x is string => typeof x === "string")));
  const staffIds = Array.from(new Set(rows.map((r) => r.created_by).filter((x): x is string => typeof x === "string")));
  const [{ data: jobs }, { data: customers }, { data: people }] = await Promise.all([
    jobIds.length ? admin.from("jobs").select("id, job_number, gated_out_at, vehicle:vehicles(kind, plate_number, plate_code, plate_emirate, has_plate, vin, make:vehicle_makes(name), model:vehicle_models(name))").in("id", jobIds) : Promise.resolve({ data: [] }),
    customerIds.length ? admin.from("customers").select("id, full_name, company_name").in("id", customerIds) : Promise.resolve({ data: [] }),
    staffIds.length ? admin.from("staff").select("id, display_name").in("id", staffIds) : Promise.resolve({ data: [] }),
  ]);
  type J = { id: string; job_number: string; gated_out_at: string | null; vehicle: Parameters<typeof formatPlate>[0] | null };
  const jobOf = new Map(((jobs ?? []) as unknown as J[]).map((j) => [j.id, j]));
  const custOf = new Map(((customers ?? []) as { id: string; full_name: string | null; company_name: string | null }[]).map((c) => [c.id, c.company_name || c.full_name || "Customer"]));
  const nameOf = new Map(((people ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  // The actual cost once the car has left: the approved figure with its labour replaced by the hours really clocked.
  const closed = rows.filter((r) => typeof r.job_id === "string" && jobOf.get(r.job_id as string)?.gated_out_at).map((r) => r.job_id as string);
  const spent = closed.length ? await timeSpentFor(closed, settings) : new Map();
  const labourOf = (detail: unknown) => { const m = /labour ([\d,]+)/.exec(String(detail ?? "")); return m ? Number(m[1].replace(/,/g, "")) : 0; };
  return rows.map((r) => {
    const job = typeof r.job_id === "string" ? jobOf.get(r.job_id) : undefined;
    const original = typeof r.comp_original_job_id === "string" ? jobOf.get(r.comp_original_job_id) : undefined;
    const reason = r.comp_reason as CompReason;
    const cost = Number(r.comp_cost_aed) || 0;
    const t = job?.gated_out_at ? spent.get(job.id) : undefined;
    const actualCost = t ? Math.round((cost - labourOf(r.comp_cost_detail) + (t.cost ?? 0)) * 100) / 100 : null;
    return {
      quotationId: String(r.id),
      number: `${r.number}${Number(r.version) > 1 ? ` v${r.version}` : ""}`,
      jobId: job?.id ?? null,
      jobNumber: job?.job_number ?? null,
      plate: job?.vehicle ? formatPlate(job.vehicle) : "",
      customerId: (r.customer_id as string | null) ?? null,
      customerName: custOf.get(String(r.customer_id)) ?? "Customer",
      advisorName: nameOf.get(String(r.created_by)) ?? null,
      reason,
      reasonLabel: COMP_REASON_LABELS[reason],
      note: (r.comp_note as string | null) ?? null,
      originalJobId: original?.id ?? null,
      originalJobNumber: original?.job_number ?? null,
      normal: Number(r.comp_normal_aed) || 0,
      cost,
      costDetail: (r.comp_cost_detail as string | null) ?? null,
      actualCost,
      decidedAt: (r.comp_decided_at as string | null) ?? null,
      gatedOutAt: job?.gated_out_at ?? null,
      whole: !(Number(r.total_aed) > 0),
    };
  });
}

/** The cost that counts: the actual once the car has left, else the approved figure. */
export const compCostOf = (c: Pick<CompJob, "cost" | "actualCost">) => c.actualCost ?? c.cost;

/** "Rework: AED X" for original jobs (our mistake / warranty work done later on them). */
export async function reworkByOriginal(settings: Settings, jobIds: string[]): Promise<Map<string, { total: number; jobs: CompJob[] }>> {
  const out = new Map<string, { total: number; jobs: CompJob[] }>();
  if (!jobIds.length) return out;
  for (const c of await loadCompJobs(settings, { originalJobIds: jobIds })) {
    if (!c.originalJobId || c.reason === "goodwill") continue;
    const cur = out.get(c.originalJobId) ?? { total: 0, jobs: [] };
    cur.total = Math.round((cur.total + compCostOf(c)) * 100) / 100;
    cur.jobs.push(c);
    out.set(c.originalJobId, cur);
  }
  return out;
}

/** "Goodwill this year: AED X" on the customer's record. */
export async function goodwillThisYear(settings: Settings, customerId: string): Promise<{ total: number; count: number; normal: number } | null> {
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric" }).format(new Date());
  const rows = (await loadCompJobs(settings, { customerId, from: new Date(`${year}-01-01T00:00:00+04:00`).toISOString() })).filter((c) => c.reason === "goodwill");
  if (!rows.length) return null;
  return { total: Math.round(rows.reduce((a, c) => a + compCostOf(c), 0) * 100) / 100, count: rows.length, normal: Math.round(rows.reduce((a, c) => a + c.normal, 0) * 100) / 100 };
}

/** The cost of whole-job complimentary work that left in a window with no tax invoice (the daily profit counts it as a loss). */
export async function uninvoicedCompCost(settings: Settings, from: string, to: string): Promise<{ total: number; byDay: Map<string, number> }> {
  const rows = (await loadCompJobs(settings)).filter((c) => c.whole && c.gatedOutAt && c.gatedOutAt >= from && c.gatedOutAt < to);
  if (!rows.length) return { total: 0, byDay: new Map() };
  const admin = createAdminClient();
  const ids = rows.map((r) => r.jobId).filter((x): x is string => !!x);
  const { data: inv } = ids.length ? await admin.from("invoices").select("job_id").in("job_id", ids).eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true) : { data: [] };
  const invoiced = new Set(((inv ?? []) as { job_id: string }[]).map((i) => i.job_id));
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const byDay = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    if (r.jobId && invoiced.has(r.jobId)) continue;
    const c = compCostOf(r);
    total += c;
    const d = dayOf(r.gatedOutAt!);
    byDay.set(d, Math.round(((byDay.get(d) ?? 0) + c) * 100) / 100);
  }
  return { total: Math.round(total * 100) / 100, byDay };
}

/**
 * A wholly complimentary job with no tax invoice (section 5.7): every approved quotation totals nothing, the owner
 * approved the free work, no inspection fee is due, and Settings has not switched the AED 0 tax invoice on. The
 * customer gets the job completion note "No charge" and the cost stays internal.
 */
export async function noChargeJob(jobId: string, settings: Settings): Promise<boolean> {
  if (settings.comp_tax_invoice === true || !(await compReady())) return false;
  const admin = createAdminClient();
  const [{ data: qs }, { data: job }] = await Promise.all([
    admin.from("quotations").select("total_aed, comp_status").eq("job_id", jobId).eq("status", "approved").eq("is_active", true),
    admin.from("jobs").select("inspection_fee_due").eq("id", jobId).maybeSingle(),
  ]);
  const rows = (qs ?? []) as { total_aed: number | string | null; comp_status: string | null }[];
  if (!rows.length || job?.inspection_fee_due) return false;
  return rows.every((q) => !(Number(q.total_aed) > 0)) && rows.some((q) => q.comp_status === "approved");
}
