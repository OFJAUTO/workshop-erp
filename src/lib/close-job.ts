import "server-only";
import { consumablesShare, jobFilmCost } from "./film";
import { bodyshopLabourCost } from "./bodyshop";
import { ensureAftercare } from "./aftercare";
import { dubaiDate } from "./jobs";
import { recordOwnerReport } from "./owner-report";
import { getSettings } from "./settings";
import { createAdminClient } from "./supabase/admin";

/** Closes a job at gate-out or delivery: the stamp, the history line, the follow-up date, the owner's report. */
export async function closeJob(jobId: string, by: string | null, byName: string, how: string) {
  try { await updatePackageCostHistory(jobId); } catch { /* the history never blocks a close */ }
  try { await ensureAftercare(jobId, by); } catch { /* the check never blocks a close */ }
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

/** A closed package job teaches the system its REAL cost, so advisors get a low-price warning without seeing numbers. */
export async function updatePackageCostHistory(jobId: string): Promise<void> {
  const admin = createAdminClient();
  const settings = await getSettings();
  const { data: q } = await admin.from("quotations").select("id, materials_cost_aed").eq("job_id", jobId).eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!q) return;
  const { data: pkgLines } = await admin.from("quotation_lines").select("package_key").eq("quotation_id", q.id).eq("is_active", true).not("package_key", "is", null);
  const keys = Array.from(new Set((pkgLines ?? []).map((l) => l.package_key as string).filter(Boolean)));
  if (!keys.length) return;
  const [film, share, labour, { data: trips }] = await Promise.all([
    jobFilmCost(jobId),
    consumablesShare(settings),
    bodyshopLabourCost(jobId, settings),
    admin.from("recovery_trips").select("price_aed").eq("job_id", jobId).eq("is_active", true),
  ]);
  const recovery = (trips ?? []).reduce((a, t) => a + (Number(t.price_aed) || 0), 0);
  const realCost = Math.round((film.film + film.tint + (Number(q.materials_cost_aed) || 0) + share + labour.cost + recovery) * 100) / 100;
  if (!(realCost > 0)) return;
  const history = { ...((settings.package_cost_history ?? {}) as Record<string, { n: number; avg_cost: number }>) };
  for (const key of keys) {
    const cur = history[key] ?? { n: 0, avg_cost: 0 };
    const n = cur.n + 1;
    history[key] = { n, avg_cost: Math.round(((cur.avg_cost * cur.n + realCost) / n) * 100) / 100 };
  }
  await admin.from("settings").upsert({ key: "package_cost_history", label: "Package real-cost history", value: history }, { onConflict: "key" });
}
