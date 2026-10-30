import "server-only";
import { createAdminClient } from "./supabase/admin";
import { costRateFor } from "./profit";
import type { Settings } from "./settings";

/**
 * THE time spent on a car (29 October 2026, batch 2 section 2), from the real records only: CLOCKED is a person working
 * (the gate-in form from start to finish, the inspection, the road test, QC, the workshop's work sessions, the bodyshop
 * clockings), kept apart from the car just WAITING in the workshop. A step that happened without a clock reads "not
 * clocked" (null minutes), never 0, so it shows who is not clocking. Advisors' and Parts' time is never clocked.
 * Used by the job card's panel, the declined-car charge and its profit, and the Declined cars report.
 */
export type TimeRow = { stage: string; who: string | null; minutes: number | null };
export type TimeSpent = {
  rows: TimeRow[];
  clockedMinutes: number;
  /** Labour cost per hour (Settings, by department) and the clocked time at that cost. */
  costRate: number;
  cost: number;
  /** The selling labour rate (Settings) and what the clocked time is worth at it. */
  sellRate: number;
  worth: number;
  inWorkshop: { from: string | null; to: string | null; minutes: number };
  /** 30 October 2026: the free PPF recheck visits of this job, a cost of THIS job ("Recheck: 1.2 h · AED 60.00"). */
  recheck?: { minutes: number; cost: number; film: number; words: string; visits: { id: string; number: string }[] } | null;
};

const mins = (a: string | null | undefined, b: string | null | undefined) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : null);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function hoursAndMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export function daysAndHours(minutes: number): string {
  const h = Math.max(0, Math.floor(minutes / 60));
  return `${Math.floor(h / 24)} day${Math.floor(h / 24) === 1 ? "" : "s"} ${h % 24} h`;
}

export async function timeSpentFor(jobIds: string[], settings: Settings, now = Date.now()): Promise<Map<string, TimeSpent>> {
  const out = new Map<string, TimeSpent>();
  const ids = [...new Set(jobIds.filter(Boolean))];
  if (!ids.length) return out;
  const admin = createAdminClient();
  const [{ data: jobs }, { data: gateIns }, { data: insps }, { data: roads }, { data: qcs }, { data: sessions }, { data: clocks }, { data: washes }] = await Promise.all([
    admin.from("jobs").select("id, department, gated_in_at, gated_out_at").in("id", ids),
    admin.from("gate_ins").select("job_id, created_at, completed_at, created_by").in("job_id", ids),
    admin.from("inspections").select("job_id, technician_id, status, started_at, submitted_at, elapsed_minutes").in("job_id", ids),
    admin.from("road_tests").select("job_id, status, started_at, done_at, inspector_id, updated_by, decision").in("job_id", ids),
    admin.from("qc_checks").select("job_id, status, started_at, finished_at, updated_by, created_by").in("job_id", ids).order("started_at"),
    admin.from("work_sessions").select("job_id, technician_id, minutes, started_at, ended_at").in("job_id", ids).eq("is_active", true),
    admin.from("bodyshop_clockings").select("job_id, staff_id, minutes, started_at, ended_at").in("job_id", ids).eq("is_active", true),
    admin.from("washes").select("job_id, done_by, done_at, skip_reason").in("job_id", ids),
  ]);
  const staffIds = new Set<string>();
  const add = (x: unknown) => { if (typeof x === "string" && x) staffIds.add(x); };
  for (const g of gateIns ?? []) add(g.created_by);
  for (const i of insps ?? []) add(i.technician_id);
  for (const r of roads ?? []) { add(r.inspector_id); add(r.updated_by); }
  for (const q of qcs ?? []) { add(q.updated_by); add(q.created_by); }
  for (const s of sessions ?? []) add(s.technician_id);
  for (const c of clocks ?? []) add(c.staff_id);
  for (const w of washes ?? []) add(w.done_by);
  const { data: people } = staffIds.size ? await admin.from("staff").select("id, display_name").in("id", [...staffIds]) : { data: [] as { id: string; display_name: string }[] };
  const nameOf = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]));
  const who = (id: unknown) => (typeof id === "string" ? (nameOf.get(id) ?? null) : null);
  const nowIso = new Date(now).toISOString();
  const runMinutes = (s: { minutes: number | null; started_at: string; ended_at: string | null }) => (s.minutes != null ? Number(s.minutes) : (mins(s.started_at, s.ended_at ?? nowIso) ?? 0));

  for (const j of jobs ?? []) {
    const rows: TimeRow[] = [];
    const g = (gateIns ?? []).find((x) => x.job_id === j.id);
    if (g) rows.push({ stage: "Gate-in", who: who(g.created_by), minutes: g.completed_at ? mins(g.created_at, g.completed_at) : null });
    for (const i of (insps ?? []).filter((x) => x.job_id === j.id)) {
      const m = i.elapsed_minutes != null ? Number(i.elapsed_minutes) : mins(i.started_at, i.submitted_at);
      if (i.started_at || i.submitted_at || i.status !== "not_started") rows.push({ stage: "Inspection", who: who(i.technician_id), minutes: i.started_at ? m : null });
    }
    for (const r of (roads ?? []).filter((x) => x.job_id === j.id && (x.status === "done" || x.started_at))) {
      rows.push({ stage: "Road test", who: who(r.inspector_id ?? r.updated_by), minutes: r.started_at && r.done_at ? mins(r.started_at, r.done_at) : null });
    }
    const bySession = new Map<string, number>();
    for (const s of (sessions ?? []).filter((x) => x.job_id === j.id)) bySession.set(s.technician_id as string, (bySession.get(s.technician_id as string) ?? 0) + runMinutes(s as { minutes: number | null; started_at: string; ended_at: string | null }));
    for (const [id, m] of bySession) rows.push({ stage: "Work", who: who(id), minutes: Math.round(m) });
    const byClock = new Map<string, number>();
    for (const c of (clocks ?? []).filter((x) => x.job_id === j.id)) byClock.set(c.staff_id as string, (byClock.get(c.staff_id as string) ?? 0) + runMinutes(c as { minutes: number | null; started_at: string; ended_at: string | null }));
    for (const [id, m] of byClock) rows.push({ stage: "Bodyshop", who: who(id), minutes: Math.round(m) });
    for (const q of (qcs ?? []).filter((x) => x.job_id === j.id && (x.started_at || x.finished_at))) {
      rows.push({ stage: "QC", who: who(q.updated_by ?? q.created_by), minutes: q.started_at && q.finished_at ? mins(q.started_at, q.finished_at) : null });
    }
    for (const w of (washes ?? []).filter((x) => x.job_id === j.id && x.done_at && !x.skip_reason)) rows.push({ stage: "Wash", who: who(w.done_by), minutes: null });
    const clockedMinutes = rows.reduce((a, r) => a + (r.minutes ?? 0), 0);
    const costRate = costRateFor(settings, j.department as string | null);
    const sellRate = Number(settings.labour_rate_aed) || 0;
    const from = (j.gated_in_at as string | null) ?? null;
    const to = (j.gated_out_at as string | null) ?? null;
    out.set(j.id as string, {
      rows,
      clockedMinutes,
      costRate,
      cost: round2((clockedMinutes / 60) * costRate),
      sellRate,
      worth: round2((clockedMinutes / 60) * sellRate),
      inWorkshop: { from, to, minutes: from ? (mins(from, to ?? nowIso) ?? 0) : 0 },
    });
  }
  return out;
}

export async function timeSpentOf(jobId: string, settings: Settings): Promise<TimeSpent | null> {
  const t = (await timeSpentFor([jobId], settings)).get(jobId) ?? null;
  if (!t) return null;
  const { recheckCostsFor, recheckCostWords } = await import("./recheck");
  const r = (await recheckCostsFor([jobId], settings)).get(jobId);
  return r ? { ...t, recheck: { minutes: r.minutes, cost: r.cost, film: r.film, words: recheckCostWords(r), visits: r.visits } } : t;
}
