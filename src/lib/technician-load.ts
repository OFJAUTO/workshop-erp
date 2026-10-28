import "server-only";
import { breakOf, withBreak } from "./breaks";
import { workingTimeOf } from "./jobs";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { isLeader, sideOfPerson, teamOf, SECTION_OF_TEAM, type Side, type TeamKey } from "./teams";
import { formatPlate } from "./types";
import { WORK_SESSION_SELECT, sessionMinutes, type WorkSessionRow } from "./work-data";
import { breakNow, hoursLeftThisWeek, hoursPerDay } from "./working-time";

export type TechnicianLoad = {
  id: string;
  display_name: string;
  department_id: string | null;
  /** The person's team inside their side (section 6): Technicians / Electricians / Helpers, or the bodyshop teams. */
  team: TeamKey;
  /** The side of the workshop they work on. */
  side: Side;
  /** team_leader rows (and a manager with a team, the bodyshop manager for Dismantle & refit) lead their team. */
  role_id: string;
  isLeader: boolean;
  /** The bodyshop section of their team (bodyshop_assignments.section), null on the mechanical side. */
  section: "strip_refit" | "ppf" | "paint" | "detailing" | null;
  photoUrl: string | null;
  /** green: free, amber: on a car but not working now, red: clock running. */
  status: "free" | "paused" | "working";
  /** Inside their break right now (and not clocked on). */
  onBreak: boolean;
  /** What they are doing now, in words. */
  now: string;
  cars: { jobId: string; plate: string; jobNumber: string; running: boolean }[];
  /** Hours still to do on their cars, against the hours in a week. */
  loadHours: number;
  weekHours: number;
  percent: number;
};

const FINISHED = ["ready", "pending_payment", "in_delivery", "closed", "pending_wash", "pending_qc"];
type Vehicle = { kind?: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null } | null;
const VEHICLE = "vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin)";

/**
 * THE people source for every staff picker (26 October batch B1): technicians, team leaders and managers who lead a
 * team, each with their side, team, leader mark, free / paused / working (mechanical work sessions AND bodyshop
 * clockings), break, their cars as plate tags and their weekly load (mechanical hours left on their cars, bodyshop
 * stage hours left for their section), freest first. `side` limits the list to one side; null gives everyone.
 */
export async function technicianLoads(settings: Settings, side: Side | null): Promise<TechnicianLoad[]> {
  const admin = createAdminClient();
  const [{ data: staffRows }, { data: links }, { data: sessions }, { data: pauses }, { data: bodyLinks }, { data: clockings }] = await Promise.all([
    admin.from("staff").select("id, display_name, department_id, team, role_id, photo_path, break_start, break_end").in("role_id", ["technician", "team_leader", "workshop_manager"]).eq("is_active", true).order("display_name"),
    admin.from("job_technicians").select(`job_id, staff_id, done_at, job:jobs!inner(id, job_number, status, is_open, budget_hours, ${VEHICLE})`).eq("is_active", true).is("left_at", null),
    admin.from("work_sessions").select(WORK_SESSION_SELECT).eq("is_active", true),
    admin.from("work_pauses").select("job_id, technician_id").is("ended_at", null).eq("is_active", true),
    admin.from("bodyshop_assignments").select(`job_id, staff_id, section, job:jobs!inner(id, job_number, status, is_open, ${VEHICLE})`).eq("is_active", true).is("removed_at", null),
    admin.from("bodyshop_clockings").select("job_id, staff_id").is("ended_at", null).eq("is_active", true),
  ]);
  type Staff = { id: string; display_name: string; department_id: string | null; team: string | null; role_id: string; photo_path: string | null; break_start: string | null; break_end: string | null };
  // A manager is in a picker only when they lead a team (the owner sets the team on the Team page).
  const people = ((staffRows ?? []) as Staff[])
    .filter((t) => t.role_id !== "workshop_manager" || !!t.team)
    .map((t) => ({ ...t, side: (sideOfPerson(t) ?? (teamOf(t) === "technicians" || teamOf(t) === "electricians" || teamOf(t) === "helpers" ? "mechanical" : "bodyshop")) as Side }))
    .filter((t) => !side || t.side === side);
  type Job = { id: string; job_number: string; status: string; is_open: boolean; budget_hours?: number | string | null; vehicle: Vehicle };
  type Link = { job_id: string; staff_id: string; done_at: string | null; job: Job };
  type BodyLink = { job_id: string; staff_id: string; section: string; job: Job };
  const live = (j: Job) => j.is_open && !FINISHED.includes(j.status);
  const rows = ((links ?? []) as unknown as Link[]).filter((l) => live(l.job));
  const bodyRows = ((bodyLinks ?? []) as unknown as BodyLink[]).filter((l) => l.job.is_open && !["closed", "in_delivery"].includes(l.job.status));
  const openJobIds = Array.from(new Set(rows.map((l) => l.job_id)));
  const bodyJobIds = Array.from(new Set(bodyRows.map((l) => l.job_id)));
  const [{ data: lines }, { data: stages }] = await Promise.all([
    openJobIds.length ? admin.from("work_lines").select("job_id, hours_quoted, status").in("job_id", openJobIds).eq("is_active", true) : Promise.resolve({ data: [] as { job_id: string; hours_quoted: number | string | null; status: string }[] }),
    bodyJobIds.length ? admin.from("bodyshop_stages").select("job_id, section, est_hours, status").in("job_id", bodyJobIds).eq("is_active", true) : Promise.resolve({ data: [] as { job_id: string; section: string; est_hours: number | string | null; status: string }[] }),
  ]);
  const hoursOf = new Map<string, number>();
  for (const l of lines ?? []) hoursOf.set(l.job_id, (hoursOf.get(l.job_id) ?? 0) + (Number(l.hours_quoted) || 0));
  const stageHours = new Map<string, number>();
  for (const s of stages ?? []) if (s.status !== "done" && s.status !== "skipped") stageHours.set(`${s.job_id}:${s.section}`, (stageHours.get(`${s.job_id}:${s.section}`) ?? 0) + (Number(s.est_hours) || 0));
  const ss = (sessions ?? []) as WorkSessionRow[];
  const usedOf = new Map<string, number>();
  for (const s of ss) usedOf.set(s.job_id, (usedOf.get(s.job_id) ?? 0) + sessionMinutes(s));
  const running = new Map(ss.filter((s) => !s.ended_at).map((s) => [s.technician_id, s.job_id]));
  for (const c of clockings ?? []) running.set(c.staff_id as string, c.job_id as string);
  const paused = new Set((pauses ?? []).map((p) => p.technician_id as string));
  const photoPaths = people.map((p) => p.photo_path).filter((p): p is string => !!p);
  const { data: signed } = photoPaths.length ? await admin.storage.from("staff-photos").createSignedUrls(photoPaths, 3600) : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const plateOf = (j: Job) => (j.vehicle ? formatPlate(j.vehicle) : j.job_number);
  const nowMs = Date.now();
  const out: TechnicianLoad[] = people.map((p) => {
    const team = teamOf(p);
    const section = SECTION_OF_TEAM[team] ?? null;
    const wt = workingTimeOf(settings, p.side);
    const brk = breakOf(settings, p);
    const week = hoursLeftThisWeek(withBreak(wt, brk));
    const weekHours = week.total || hoursPerDay(wt) * 6;
    let loadHours = 0;
    const cars: TechnicianLoad["cars"] = [];
    for (const l of rows.filter((x) => x.staff_id === p.id)) {
      const budget = l.job.budget_hours !== null && l.job.budget_hours !== undefined ? Number(l.job.budget_hours) : hoursOf.get(l.job_id) ?? 0;
      const share = Math.max(1, rows.filter((x) => x.job_id === l.job_id).length);
      if (!l.done_at) loadHours += Math.max(0, budget - (usedOf.get(l.job_id) ?? 0) / 60) / share;
      cars.push({ jobId: l.job_id, plate: plateOf(l.job), jobNumber: l.job.job_number, running: running.get(p.id) === l.job_id });
    }
    for (const l of bodyRows.filter((x) => x.staff_id === p.id)) {
      if (cars.some((c) => c.jobId === l.job_id)) continue;
      const share = Math.max(1, bodyRows.filter((x) => x.job_id === l.job_id && x.section === l.section).length);
      loadHours += (stageHours.get(`${l.job_id}:${l.section}`) ?? 0) / share;
      cars.push({ jobId: l.job_id, plate: plateOf(l.job), jobNumber: l.job.job_number, running: running.get(p.id) === l.job_id });
    }
    const runningJob = running.get(p.id);
    const status: TechnicianLoad["status"] = runningJob ? "working" : cars.length || paused.has(p.id) ? "paused" : "free";
    const b = breakNow(brk, nowMs);
    const onBreak = status !== "working" && !!b?.inBreak;
    const nowCar = cars.find((c) => c.running);
    const now = status === "working"
      ? `Working on ${nowCar?.plate ?? "a car"}`
      : onBreak
        ? `On break until ${b!.window.end}`
        : status === "paused"
          ? paused.has(p.id) ? `Paused · ${cars.map((c) => c.plate).join(", ")}` : `On ${cars.length} car${cars.length === 1 ? "" : "s"}, clock off`
          : "Free";
    loadHours = Math.round(loadHours * 10) / 10;
    return { id: p.id, display_name: p.display_name, department_id: p.department_id, team, side: p.side, role_id: p.role_id, isLeader: isLeader(p), section, photoUrl: p.photo_path ? (urlOf.get(p.photo_path) ?? null) : null, status, onBreak, now, cars, loadHours, weekHours, percent: weekHours > 0 ? Math.round((loadHours / weekHours) * 100) : 0 };
  });
  return out.sort((a, b) => a.percent - b.percent || (a.status === "free" ? -1 : 1) - (b.status === "free" ? -1 : 1) || a.display_name.localeCompare(b.display_name));
}
