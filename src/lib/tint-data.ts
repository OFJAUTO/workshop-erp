import "server-only";
import { cleanTintSpec, DEFAULT_TINT_PRESETS, type TintSpec } from "./tint";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatDate } from "./format";

/**
 * Section 11: where the tint specification is read from. It lives on the quotation (it travels with the
 * versions and the approval); the job's specification is the one on its newest approved quotation, else
 * on its newest quotation that has one.
 */
type SpecRow = { id: string; job_id: string | null; status: string; version: number; created_at: string; tint_spec: unknown; number: string };
const rank = (r: SpecRow) => `${r.status === "approved" ? 1 : 0}·${String(r.version).padStart(4, "0")}·${r.created_at}`;

export async function tintSpecsForJobs(jobIds: string[]): Promise<Map<string, TintSpec>> {
  const out = new Map<string, TintSpec>();
  if (!jobIds.length) return out;
  const { data } = await createAdminClient().from("quotations").select("id, job_id, status, version, created_at, tint_spec, number").in("job_id", jobIds).eq("kind", "quotation").eq("is_active", true).not("tint_spec", "is", null).not("status", "in", "(cancelled,superseded)");
  const best = new Map<string, SpecRow>();
  for (const r of (data ?? []) as SpecRow[]) {
    if (!r.job_id || !cleanTintSpec(r.tint_spec)) continue;
    const have = best.get(r.job_id);
    if (!have || rank(r) > rank(have)) best.set(r.job_id, r);
  }
  for (const [jobId, r] of best) out.set(jobId, cleanTintSpec(r.tint_spec)!);
  return out;
}

export async function tintSpecForJob(jobId: string | null | undefined): Promise<TintSpec | null> {
  if (!jobId) return null;
  return (await tintSpecsForJobs([jobId])).get(jobId) ?? null;
}

/** "Same as last time": the newest specification on this car, else on the customer's other cars (never this quotation). */
export async function lastTintSpecFor(vehicleId: string | null, customerId: string | null, exceptQuotationId: string): Promise<{ spec: TintSpec; from: string } | null> {
  const admin = createAdminClient();
  const pick = async (col: "vehicle_id" | "customer_id", id: string | null) => {
    if (!id) return null;
    const { data } = await admin.from("quotations").select("id, number, version, status, created_at, tint_spec").eq(col, id).neq("id", exceptQuotationId).eq("is_active", true).not("tint_spec", "is", null).not("status", "in", "(cancelled,draft,pending_owner)").order("created_at", { ascending: false }).limit(5);
    const row = ((data ?? []) as { number: string; version: number; created_at: string; tint_spec: unknown }[]).find((r) => cleanTintSpec(r.tint_spec));
    return row ? { spec: cleanTintSpec(row.tint_spec)!, from: `${row.number}${row.version > 1 ? ` v${row.version}` : ""}, ${formatDate(row.created_at)}${col === "customer_id" ? " (another car)" : ""}` } : null;
  };
  return (await pick("vehicle_id", vehicleId)) ?? (await pick("customer_id", customerId));
}

/** Whether the tint is being fitted or done: the tint stage, or the PPF stage it merged into ("PPF install and tint"). */
export async function tintStageStarted(jobId: string | null | undefined): Promise<{ started: boolean; label: string | null }> {
  if (!jobId) return { started: false, label: null };
  const { data } = await createAdminClient().from("bodyshop_stages").select("key, label, status").eq("job_id", jobId).eq("is_active", true).in("status", ["active", "done"]);
  const hit = ((data ?? []) as { key: string; label: string; status: string }[]).find((s) => s.key === "tint" || (s.key === "ppf" && /tint/i.test(s.label)));
  return hit ? { started: true, label: hit.label } : { started: false, label: null };
}

/** The owner's one-tap presets (Settings), else the built-in Standard. */
export function tintPresetsOf(settings: Settings): { name: string; spec: TintSpec }[] {
  const raw = Array.isArray(settings.tint_presets) ? (settings.tint_presets as { name?: unknown; spec?: unknown }[]) : [];
  const list = raw.map((p) => ({ name: String(p?.name ?? "").trim(), spec: cleanTintSpec(p?.spec) })).filter((p): p is { name: string; spec: TintSpec } => !!p.name && !!p.spec);
  return list.length ? list : DEFAULT_TINT_PRESETS;
}

export function tintLimitOf(settings: Settings): number {
  const n = Number(settings.tint_legal_max_darkness);
  return Number.isFinite(n) && n > 0 ? n : 50;
}
