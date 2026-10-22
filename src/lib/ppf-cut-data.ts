import "server-only";
import { cutOf, isPpfFilmItem, lineIsPpf, ppfFinishOf } from "./ppf-cut";
import { createAdminClient } from "./supabase/admin";

export type JobCut = { key: "hand" | "machine" | "mixed"; badge: string; long: string; note: string | null };

/**
 * Section 10: the cutting method each job's PPF is done with - from the PPF line of its newest APPROVED
 * quotation (else the newest version), for the big badge on the job card, the bodyshop page and the
 * PPF tablet. Jobs with no PPF are left out of the map.
 */
export async function cutMethodsForJobs(jobIds: string[]): Promise<Map<string, JobCut>> {
  const out = new Map<string, JobCut>();
  if (!jobIds.length) return out;
  const { data } = await createAdminClient()
    .from("quotation_lines")
    .select("title, package_items, cut_method, cut_note, service:services(bodyshop_kind), quotation:quotations!inner(job_id, status, version, created_at, is_active, kind)")
    .in("quotation.job_id", jobIds)
    .eq("quotation.is_active", true)
    .eq("quotation.kind", "quotation")
    .neq("quotation.status", "cancelled")
    .eq("is_active", true);
  type Row = { title: string; package_items: unknown; cut_method: string | null; cut_note: string | null; service: { bodyshop_kind: string | null } | null; quotation: { job_id: string; status: string; version: number; created_at: string } };
  const rank = (r: Row) => `${r.quotation.status === "approved" ? 1 : 0}·${String(r.quotation.version).padStart(4, "0")}·${r.quotation.created_at}`;
  const best = new Map<string, Row>();
  for (const r of (data ?? []) as unknown as Row[]) {
    if (!lineIsPpf(r, r.service?.bodyshop_kind ?? null)) continue;
    const have = best.get(r.quotation.job_id);
    if (!have || rank(r) > rank(have)) best.set(r.quotation.job_id, r);
  }
  for (const [jobId, r] of best) {
    const c = cutOf(r.cut_method, r.cut_note);
    out.set(jobId, { key: c.key, badge: c.badge, long: c.long, note: c.note });
  }
  return out;
}

/**
 * The warranty card's film line: "OFJ Bespoke PPF – Gloss · Hand-cut · Full body · 10-year warranty" - the brand,
 * the finish (from the package or the film colour), the cutting method, the coverage (the PPF item) and the years.
 */
export async function ppfWarrantyWords(jobId: string, brand: string, film: { colour?: string | null; code?: string | null } | null, years: number | null = null): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("quotation_lines")
    .select("title, package_items, cut_method, cut_note, service:services(bodyshop_kind), quotation:quotations!inner(job_id, status, version, created_at, is_active, kind)")
    .eq("quotation.job_id", jobId)
    .eq("quotation.is_active", true)
    .eq("quotation.kind", "quotation")
    .neq("quotation.status", "cancelled")
    .eq("is_active", true);
  type Row = { title: string; package_items: unknown; cut_method: string | null; cut_note: string | null; service: { bodyshop_kind: string | null } | null; quotation: { status: string; version: number; created_at: string } };
  const rank = (r: Row) => `${r.quotation.status === "approved" ? 1 : 0}·${String(r.quotation.version).padStart(4, "0")}·${r.quotation.created_at}`;
  const best = ((data ?? []) as unknown as Row[]).filter((r) => lineIsPpf(r, r.service?.bodyshop_kind ?? null)).sort((a, b) => (rank(a) < rank(b) ? 1 : -1))[0];
  if (!best) return null;
  const snap = best.package_items && typeof best.package_items === "object" ? (best.package_items as { name?: string; items?: { label?: string }[] }) : null;
  const words = [snap?.name ?? best.title, ...(snap?.items ?? []).map((i) => i.label ?? ""), film?.colour ?? ""].join(" ");
  const finish = ppfFinishOf(words, film?.colour ?? null);
  const ppfLabel = (snap?.items ?? []).map((i) => i.label ?? "").find((l) => isPpfFilmItem(l)) ?? best.title;
  let coverage = ppfLabel.replace(/\bppf\b|paint protection film/gi, "").replace(/[-–—,·]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^full$/i.test(coverage) || !coverage) coverage = "Full body";
  const c = cutOf(best.cut_method, best.cut_note);
  return `${brand} – ${finish}${film?.code ? ` (${film.code})` : ""} · ${c.short} · ${coverage}${years ? ` · ${years}-year warranty` : ""}`;
}

/**
 * The month's PPF work by cutting method, for the owner's report: hand-cut against pre-cut (and mixed) -
 * jobs handed over, the hours clocked on the PPF stage, the film metres used, and per job on average.
 */
export async function ppfByCutMethod(fromIso: string, toIso: string): Promise<{ key: string; label: string; jobs: number; hours: number; metres: number; hoursPerJob: number | null; metresPerJob: number | null }[]> {
  const admin = createAdminClient();
  const { data: jobs } = await admin.from("jobs").select("id").in("department", ["bodyshop", "both"]).gte("gated_out_at", fromIso).lt("gated_out_at", toIso);
  const ids = (jobs ?? []).map((j) => j.id as string);
  const cuts = await cutMethodsForJobs(ids);
  const ppfJobs = ids.filter((id) => cuts.has(id));
  if (!ppfJobs.length) return [];
  const [{ data: clk }, { data: film }] = await Promise.all([
    admin.from("bodyshop_clockings").select("job_id, minutes, stage:bodyshop_stages(section)").in("job_id", ppfJobs).eq("is_active", true),
    admin.from("film_usage").select("job_id, metres").in("job_id", ppfJobs).eq("is_active", true),
  ]);
  const rows = new Map<string, { jobs: number; minutes: number; metres: number }>();
  for (const id of ppfJobs) {
    const k = cuts.get(id)!.key;
    const r = rows.get(k) ?? { jobs: 0, minutes: 0, metres: 0 };
    r.jobs += 1;
    r.minutes += ((clk ?? []) as unknown as { job_id: string; minutes: number | null; stage: { section: string } | null }[]).filter((c) => c.job_id === id && c.stage?.section === "ppf").reduce((a, c) => a + (Number(c.minutes) || 0), 0);
    r.metres += ((film ?? []) as { job_id: string; metres: number | string | null }[]).filter((f) => f.job_id === id).reduce((a, f) => a + (Number(f.metres) || 0), 0);
    rows.set(k, r);
  }
  const label = { hand: "Hand-cut", machine: "Machine pre-cut", mixed: "Mixed" } as Record<string, string>;
  return ["hand", "machine", "mixed"].filter((k) => rows.has(k)).map((k) => {
    const r = rows.get(k)!;
    const hours = Math.round((r.minutes / 60) * 10) / 10;
    const metres = Math.round(r.metres * 10) / 10;
    return { key: k, label: label[k], jobs: r.jobs, hours, metres, hoursPerJob: r.jobs ? Math.round((hours / r.jobs) * 10) / 10 : null, metresPerJob: r.jobs ? Math.round((metres / r.jobs) * 10) / 10 : null };
  });
}
