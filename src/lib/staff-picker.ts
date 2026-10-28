import "server-only";
import { sidesOfJob, sidesOfDepartment, type SideLine } from "./job-sides";
import { LINE_SELECT, approvedQuotations, toLine } from "./quote-data";
import { isUnchosen } from "./quotes";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { isLeader, sideOfPerson, teamOf, SECTION_OF_TEAM, type Side } from "./teams";
import { technicianLoads, type TechnicianLoad } from "./technician-load";

/** The people a picker offers for the given sides, from THE people source (technicianLoads). */
export async function pickablePeople(settings: Settings, sides: Side[]): Promise<TechnicianLoad[]> {
  const all = await technicianLoads(settings, sides.length === 1 ? sides[0] : null);
  return all.filter((p) => sides.includes(p.side));
}

/** The sides of a job from its approved work (job-sides.ts), the department alone before anything is approved. */
export async function workSidesOf(jobId: string, department?: string | null): Promise<Side[]> {
  const admin = createAdminClient();
  let dept = department;
  if (dept === undefined) {
    const { data } = await admin.from("jobs").select("department").eq("id", jobId).maybeSingle();
    dept = (data?.department as string | null) ?? null;
  }
  const quotes = await approvedQuotations(jobId);
  if (!quotes.length) return sidesOfDepartment(dept);
  const { data: lineRows } = await admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", quotes.map((q) => q.id)).eq("is_active", true);
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map(toLine).filter((l) => !isUnchosen(l));
  const serviceIds = Array.from(new Set(lines.map((l) => l.service_id).filter((x): x is string => !!x)));
  const { data: svcs } = serviceIds.length ? await admin.from("services").select("id, department, bodyshop_kind").in("id", serviceIds) : { data: [] as { id: string; department: string | null; bodyshop_kind: string | null }[] };
  const svcOf = new Map((svcs ?? []).map((s) => [s.id as string, s]));
  return sidesOfJob(dept, lines.map((l) => ({ line: l as unknown as SideLine, svc: l.service_id ? svcOf.get(l.service_id) : null })));
}

export type PickedPerson = { id: string; display_name: string; role_id: string; department_id: string | null; team: string | null; side: Side; isLeader: boolean; section: "strip_refit" | "ppf" | "paint" | "detailing" | null };

/**
 * The server check behind every picker: the ids must be active hands-on people (technicians, team leaders, a manager
 * who leads a team) on one of the given sides. Returns them in the order ticked, or the words of the refusal.
 */
export async function checkPickable(ids: string[], sides: Side[]): Promise<{ people: PickedPerson[]; error?: string }> {
  const clean = Array.from(new Set(ids.filter(Boolean)));
  if (!clean.length) return { people: [], error: "Tick at least one person." };
  const { data } = await createAdminClient().from("staff").select("id, display_name, role_id, department_id, team, is_active").in("id", clean);
  const rows = (data ?? []) as { id: string; display_name: string; role_id: string; department_id: string | null; team: string | null; is_active: boolean }[];
  const people: PickedPerson[] = [];
  for (const id of clean) {
    const r = rows.find((x) => x.id === id);
    if (!r || !r.is_active) return { people: [], error: "One of the people ticked is no longer active. Refresh the page." };
    const handsOn = r.role_id === "technician" || r.role_id === "team_leader" || (r.role_id === "workshop_manager" && !!r.team);
    const team = teamOf(r);
    const side = (sideOfPerson(r) ?? (team === "technicians" || team === "electricians" || team === "helpers" ? "mechanical" : "bodyshop")) as Side;
    if (!handsOn) return { people: [], error: `${r.display_name} does not work on cars: pick technicians or team leaders.` };
    if (!sides.includes(side)) return { people: [], error: `${r.display_name} works in the ${side === "bodyshop" ? "bodyshop" : "mechanical workshop"}; this car needs ${sides.map((s) => (s === "bodyshop" ? "the bodyshop" : "the mechanical workshop")).join(" and ")}.` };
    people.push({ id: r.id, display_name: r.display_name, role_id: r.role_id, department_id: r.department_id, team: r.team, side, isLeader: isLeader(r), section: SECTION_OF_TEAM[team] ?? null });
  }
  return { people };
}

/** The bodyshop people on a car (bodyshop_assignments), with their section and the leader mark. */
export async function bodyshopOnCar(jobId: string): Promise<{ staff_id: string; display_name: string; section: string; leader: boolean }[]> {
  const { data } = await createAdminClient().from("bodyshop_assignments").select("staff_id, section, assigned_at, staff:staff!bodyshop_assignments_staff_id_fkey(display_name, role_id, team)").eq("job_id", jobId).eq("is_active", true).is("removed_at", null).order("assigned_at");
  return ((data ?? []) as unknown as { staff_id: string; section: string; staff: { display_name: string; role_id: string; team: string | null } | null }[]).map((r) => ({ staff_id: r.staff_id, display_name: r.staff?.display_name ?? "Bodyshop", section: r.section, leader: isLeader(r.staff ?? {}) }));
}

/** workSidesOf for many jobs at once (the dashboard and Waiting on you): one read of their approved quotations. */
export async function workSidesForJobs(jobs: { id: string; department: string | null }[]): Promise<Map<string, Side[]>> {
  const out = new Map<string, Side[]>();
  if (!jobs.length) return out;
  const admin = createAdminClient();
  const { data: qs } = await admin.from("quotations").select("id, job_id, number, version").in("job_id", jobs.map((j) => j.id)).eq("kind", "quotation").eq("is_active", true).eq("status", "approved");
  const best = new Map<string, { id: string; job_id: string; version: number }>();
  for (const q of (qs ?? []) as { id: string; job_id: string; number: string; version: number | string }[]) {
    const key = `${q.job_id}:${q.number}`;
    const have = best.get(key);
    if (!have || have.version < Number(q.version)) best.set(key, { id: q.id, job_id: q.job_id, version: Number(q.version) || 1 });
  }
  const qids = Array.from(best.values()).map((q) => q.id);
  const jobOfQuote = new Map(Array.from(best.values()).map((q) => [q.id, q.job_id]));
  const { data: lineRows } = qids.length ? await admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", qids).eq("is_active", true) : { data: [] };
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map(toLine).filter((l) => !isUnchosen(l));
  const serviceIds = Array.from(new Set(lines.map((l) => l.service_id).filter((x): x is string => !!x)));
  const { data: svcs } = serviceIds.length ? await admin.from("services").select("id, department, bodyshop_kind").in("id", serviceIds) : { data: [] as { id: string; department: string | null; bodyshop_kind: string | null }[] };
  const svcOf = new Map((svcs ?? []).map((s) => [s.id as string, s]));
  for (const j of jobs) {
    const mine = lines.filter((l) => jobOfQuote.get(l.quotation_id) === j.id);
    out.set(j.id, mine.length ? sidesOfJob(j.department, mine.map((l) => ({ line: l as unknown as SideLine, svc: l.service_id ? svcOf.get(l.service_id) : null }))) : sidesOfDepartment(j.department));
  }
  return out;
}
