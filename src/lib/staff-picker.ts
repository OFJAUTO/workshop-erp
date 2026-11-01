import "server-only";
import { sidesOfJob, sidesOfDepartment, type SideLine } from "./job-sides";
import { LINE_SELECT, approvedQuotations, toLine } from "./quote-data";
import { isUnchosen } from "./quotes";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { isLeader, sideOfPerson, teamOf, SECTION_OF_TEAM, type Side, type TeamKey } from "./teams";
import { technicianLoads, type TechnicianLoad } from "./technician-load";
import { attachTeams, servicesFor } from "./line-teams-data";
import { staffTeamsFor, teamOfLine, teamsOf, type LineTeam, type TeamLine } from "./line-teams";

/**
 * The people a picker offers for the given sides, from THE people source (technicianLoads). With the car's line teams
 * (1 November 2026) a side offers only the staff teams its lines need: a bodyshop car whose only mechanical-side work
 * is coding gets the electricians; the bodyshop side gets the teams of its lines.
 */
export async function pickablePeople(settings: Settings, sides: Side[], teams: LineTeam[] = []): Promise<TechnicianLoad[]> {
  const all = await technicianLoads(settings, sides.length === 1 ? sides[0] : null);
  const present = await presentTeams();
  return all.filter((p) => sides.includes(p.side) && fitsTeams(p, p.side, teams, present));
}

/** The staff teams that have at least one active hands-on person (a team nobody is in yet never blocks a car). */
export async function presentTeams(): Promise<Set<TeamKey>> {
  const { data } = await createAdminClient().from("staff").select("team, department_id, role_id").eq("is_active", true).in("role_id", ["technician", "team_leader", "workshop_manager"]);
  return new Set(((data ?? []) as { team: string | null; department_id: string | null; role_id: string }[]).filter((p) => p.role_id !== "workshop_manager" || p.team).map((p) => teamOf(p)));
}

/** Does a person's staff team fit the line teams on that side (no teams known = anyone on the side)? */
export function fitsTeams(p: { team?: string | null; department_id?: string | null }, side: Side, teams: LineTeam[], present?: Set<TeamKey>): boolean {
  const allowed = staffTeamsFor(teams, side, present);
  return !allowed || allowed.includes(teamOf(p));
}

/** The approved lines of a job with their teams (chosen or default) and their services. */
async function approvedTeamLines(jobId: string): Promise<{ line: TeamLine & SideLine; svc: { name: string | null; department: string | null; bodyshop_kind: string | null; outside_work: boolean | null } | null }[]> {
  const admin = createAdminClient();
  const quotes = await approvedQuotations(jobId);
  if (!quotes.length) return [];
  const { data: lineRows } = await admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", quotes.map((q) => q.id)).eq("is_active", true);
  const lines = await attachTeams(((lineRows ?? []) as Record<string, unknown>[]).map(toLine).filter((l) => !isUnchosen(l)));
  const svcOf = await servicesFor(lines.map((l) => l.service_id ?? ""));
  return lines.map((l) => ({ line: l as unknown as TeamLine & SideLine, svc: l.service_id ? svcOf.get(l.service_id) ?? null : null }));
}

/** The teams on a job (approved work, in the order of work) and its sides. */
export async function workTeamsOf(jobId: string, department?: string | null): Promise<{ teams: LineTeam[]; sides: Side[] }> {
  let dept = department;
  if (dept === undefined) {
    const { data } = await createAdminClient().from("jobs").select("department").eq("id", jobId).maybeSingle();
    dept = (data?.department as string | null) ?? null;
  }
  const lines = await approvedTeamLines(jobId);
  if (!lines.length) return { teams: [], sides: sidesOfDepartment(dept) };
  return { teams: teamsOf(lines, dept), sides: sidesOfJob(dept, lines) };
}

/** Each approved line's team on a job, for the job card's Teams card. */
export async function lineTeamsOfJob(jobId: string, department: string | null): Promise<{ id: string; title: string; line_type: string; chosen: string | null; team: LineTeam | null }[]> {
  const lines = await approvedTeamLines(jobId);
  return lines.map((x) => ({ id: (x.line as unknown as { id: string }).id, title: x.line.title ?? "", line_type: x.line.line_type, chosen: x.line.team ?? null, team: teamOfLine(x.line, x.svc, department) })).filter((x) => x.team);
}

/** The sides of a job from its approved work (job-sides.ts), the department alone before anything is approved. */
export async function workSidesOf(jobId: string, department?: string | null): Promise<Side[]> {
  const admin = createAdminClient();
  let dept = department;
  if (dept === undefined) {
    const { data } = await admin.from("jobs").select("department").eq("id", jobId).maybeSingle();
    dept = (data?.department as string | null) ?? null;
  }
  const lines = await approvedTeamLines(jobId);
  if (!lines.length) return sidesOfDepartment(dept);
  return sidesOfJob(dept, lines);
}

export type PickedPerson = { id: string; display_name: string; role_id: string; department_id: string | null; team: string | null; side: Side; isLeader: boolean; section: "strip_refit" | "ppf" | "paint" | "detailing" | null };

/**
 * The server check behind every picker: the ids must be active hands-on people (technicians, team leaders, a manager
 * who leads a team) on one of the given sides. Returns them in the order ticked, or the words of the refusal.
 */
export async function checkPickable(ids: string[], sides: Side[], teams: LineTeam[] = []): Promise<{ people: PickedPerson[]; error?: string }> {
  const clean = Array.from(new Set(ids.filter(Boolean)));
  if (!clean.length) return { people: [], error: "Tick at least one person." };
  const { data } = await createAdminClient().from("staff").select("id, display_name, role_id, department_id, team, is_active").in("id", clean);
  const rows = (data ?? []) as { id: string; display_name: string; role_id: string; department_id: string | null; team: string | null; is_active: boolean }[];
  const people: PickedPerson[] = [];
  const present = teams.length ? await presentTeams() : undefined;
  for (const id of clean) {
    const r = rows.find((x) => x.id === id);
    if (!r || !r.is_active) return { people: [], error: "One of the people ticked is no longer active. Refresh the page." };
    const handsOn = r.role_id === "technician" || r.role_id === "team_leader" || (r.role_id === "workshop_manager" && !!r.team);
    const team = teamOf(r);
    const side = (sideOfPerson(r) ?? (team === "technicians" || team === "electricians" || team === "helpers" ? "mechanical" : "bodyshop")) as Side;
    if (!handsOn) return { people: [], error: `${r.display_name} does not work on cars: pick technicians or team leaders.` };
    if (!sides.includes(side)) return { people: [], error: `${r.display_name} works in the ${side === "bodyshop" ? "bodyshop" : "mechanical workshop"}; this car needs ${sides.map((s) => (s === "bodyshop" ? "the bodyshop" : "the mechanical workshop")).join(" and ")}.` };
    // 1 November 2026: each line can only be done by its own team (a coding line by the electricians, paint by the painters).
    if (!fitsTeams(r, side, teams, present)) return { people: [], error: `${r.display_name} is not in a team this car's ${side === "bodyshop" ? "bodyshop" : "workshop"} lines need (${(staffTeamsFor(teams, side, present) ?? []).map((t) => t.replace(/_/g, " ")).join(", ")}).` };
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
  const lines = await attachTeams(((lineRows ?? []) as Record<string, unknown>[]).map(toLine).filter((l) => !isUnchosen(l)));
  const svcOf = await servicesFor(lines.map((l) => l.service_id ?? ""));
  for (const j of jobs) {
    const mine = lines.filter((l) => jobOfQuote.get(l.quotation_id) === j.id);
    out.set(j.id, mine.length ? sidesOfJob(j.department, mine.map((l) => ({ line: l as unknown as SideLine, svc: l.service_id ? svcOf.get(l.service_id) : null }))) : sidesOfDepartment(j.department));
  }
  return out;
}
