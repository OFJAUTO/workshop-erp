import "server-only";
import { dubaiDate } from "./jobs";
import { loadJobLpos } from "./lpo";
import { PART_FULL_SELECT, partsLiveOf, partsPlanned, planningOnOf, toPartFull, type PartFull, type PlanningOn } from "./parts-data";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import type { JobRow } from "./types";
import type { WorkingTime } from "./working-time";
import { SIDE_LABEL, sideReleased, type Side } from "./job-sides";
import { workSidesOf } from "./staff-picker";
import { approvedKinds } from "./bodyshop";
import { STAGE_DEFS, stageKeysFor } from "./bodyshop-kinds";

export type CircleKey = "parts" | "workshop" | "bodyshop" | "advisor";
export type PlanningCircle = { key: CircleKey; n: number; title: string; state: "grey" | "amber" | "green"; since: string | null; person: { id: string | null; name: string; photoUrl: string | null } | null; line: string };
export type Planning = {
  active: boolean;
  circles: PlanningCircle[];
  /** Whose move it is; "both_sides" on a mixed car while both managers still have to release their side. */
  waitingOn: PlanningOn | null;
  /** The car's sides (job-sides.ts): Workshop, Bodyshop, or both on a mixed car. */
  sides: Side[];
  /** The sides whose manager may release now (parts sorted, not released yet). */
  releaseNow: Side[];
  /** Hours per side for the start-day hint and the finish date. */
  hoursBySide: Partial<Record<Side, number>>;
  parts: PartFull[];
  /** Approved parts with no in-stock or to-order choice yet. */
  unplanned: PartFull[];
  /** Parts not here yet (ordered, not received). */
  missing: PartFull[];
  partsReadyDate: string | null;
  partsDelayed: boolean;
  technicians: { id: string; display_name: string; photoUrl: string | null; left_at: string | null; done_at: string | null }[];
  suggestedFinish: string | null;
  hoursEstimate: number;
};

const DAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Adds working days to a date, skipping the days the workshop is closed (Sundays by default). */
export function addWorkingDays(from: string, days: number, wt: WorkingTime): string {
  const open = new Set(wt.workingDays.length ? wt.workingDays : DAY_IDS.filter((d) => d !== "sun"));
  const d = new Date(from + "T12:00:00Z");
  let left = Math.max(0, Math.ceil(days));
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (open.has(DAY_IDS[d.getUTCDay()])) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** The first working day on or after a date. */
export function nextWorkingDay(from: string, wt: WorkingTime): string {
  const open = new Set(wt.workingDays.length ? wt.workingDays : DAY_IDS.filter((d) => d !== "sun"));
  const d = new Date(from + "T12:00:00Z");
  for (let i = 0; i < 8; i++) {
    if (open.has(DAY_IDS[d.getUTCDay()])) return d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return from;
}

/** The finish date from a start day and the hours: working hours 8 to 17 (from Settings), Sundays off. The start day counts. */
export function suggestFinishDate(startDate: string, hours: number, wt: WorkingTime): string {
  const perDay = wt.closeHour > wt.openHour ? wt.closeHour - wt.openHour : 9;
  const days = Math.max(1, Math.ceil(hours / perDay));
  return addWorkingDays(nextWorkingDay(startDate, wt), days - 1, wt);
}

/** The approved parts of a job and when they will all be here. */
export async function loadPlanning(job: JobRow, settings: Settings): Promise<Planning> {
  const admin = createAdminClient();
  const wt = { openHour: Number(settings.opening_hour) || 8, closeHour: Number(settings.closing_hour) || 17, workingDays: (settings.working_days ?? []) as string[] };
  const [{ data: partRows }, { data: techRows }, { data: lineRows }, { data: insp }, { data: bodyRows }, sides] = await Promise.all([
    admin.from("part_items").select(PART_FULL_SELECT).eq("job_id", job.id).eq("is_active", true).neq("order_status", "none").neq("return_status", "returned"),
    admin.from("job_technicians").select("id, staff_id, left_at, done_at, staff:staff!job_technicians_staff_id_fkey(display_name, photo_path)").eq("job_id", job.id).eq("is_active", true).order("added_at"),
    admin.from("work_lines").select("hours_quoted").eq("job_id", job.id).eq("is_active", true),
    admin.from("inspections").select("estimated_hours, estimated_hours_manager").eq("job_id", job.id).eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("bodyshop_assignments").select("staff_id, assigned_at, staff:staff!bodyshop_assignments_staff_id_fkey(display_name, photo_path)").eq("job_id", job.id).eq("is_active", true).is("removed_at", null).order("assigned_at"),
    workSidesOf(job.id, job.department),
  ]);
  const parts = ((partRows ?? []) as unknown as Record<string, unknown>[]).map(toPartFull);
  const unplanned = parts.filter((p) => !p.availability || (p.availability === "to_order" && !p.delivery_date && p.order_status !== "received"));
  const today = dubaiDate();
  // The one live calculation (partsLiveOf): no stored flag decides what the Planning card says.
  const liveBase = partsLiveOf(parts, today);
  const here = (p: typeof parts[number]) => p.availability === "in_stock" || p.order_status === "received" || p.received_qty + 0.005 >= (Number(p.confirmed_quantity ?? p.quantity) || 1);
  const missing = parts.filter((p) => !here(p));
  const partsReadyDate = liveBase.readyDate;
  // Delayed means exactly: at least one part is not at the desk AND its due date has passed.
  const partsDelayed = liveBase.late > 0;
  const quotedHours = (lineRows ?? []).reduce((a, l) => a + (Number(l.hours_quoted) || 0), 0);
  const mechHours = quotedHours || Number(insp?.estimated_hours_manager ?? insp?.estimated_hours ?? 0) || 0;
  // The bodyshop's hours are its stages' hours (the stages the approved packages build).
  const bodyKeys = sides.includes("bodyshop") ? stageKeysFor((await approvedKinds(job.id)).kinds) : [];
  const bodyHours = STAGE_DEFS.filter((d) => bodyKeys.includes(d.key)).reduce((a, d) => a + d.hours, 0);
  const hoursBySide: Partial<Record<Side, number>> = { ...(sides.includes("mechanical") ? { mechanical: mechHours } : {}), ...(sides.includes("bodyshop") ? { bodyshop: bodyHours } : {}) };
  const hoursEstimate = Math.max(sides.includes("mechanical") ? mechHours : 0, sides.includes("bodyshop") ? bodyHours : 0);
  const starts = sides.map((s) => (s === "bodyshop" ? job.plan_bodyshop_start_date : job.plan_start_date)).filter((d): d is string => !!d).sort();
  const start = starts.at(-1) ?? today;
  const suggestedFinish = hoursEstimate > 0 ? suggestFinishDate(start, hoursEstimate, wt) : null;
  const allReleased = sides.every((s) => sideReleased(job, s));
  const anyReleased = sides.some((s) => sideReleased(job, s));
  const active = ["approved", "waiting_parts"].includes(job.status) || (job.is_open && anyReleased && (!allReleased || !job.plan_date_confirmed_at));

  // The faces: the Parts person who planned (or the Parts role), each side's manager (who released it, else the
  // workshop manager of that side), the advisor.
  const [{ data: partsPeople }, { data: managers }, { data: advisor }] = await Promise.all([
    job.plan_parts_by ? admin.from("staff").select("id, display_name, photo_path").eq("id", job.plan_parts_by) : admin.from("staff").select("id, display_name, photo_path").eq("role_id", "parts").eq("is_active", true).order("display_name").limit(1),
    admin.from("staff").select("id, display_name, photo_path, department_id, role_id").or(`role_id.eq.workshop_manager${[job.plan_released_by, job.plan_bodyshop_released_by].filter(Boolean).map((id) => `,id.eq.${id}`).join("")}`).eq("is_active", true).order("display_name"),
    admin.from("staff").select("id, display_name, photo_path").eq("id", job.plan_date_confirmed_by ?? job.gated_in_by).maybeSingle(),
  ]);
  type Mgr = { id: string; display_name: string; photo_path: string | null; department_id: string | null; role_id: string };
  const mgrs = (managers ?? []) as Mgr[];
  const sideOfDept = (d: string | null) => (d === "mechanical" ? "mechanical" : d && ["bodyshop", "paint", "ppf_tint", "detailing"].includes(d) ? "bodyshop" : null);
  const managerOf = (side: Side): Mgr | null => {
    const releasedBy = side === "bodyshop" ? job.plan_bodyshop_released_by : job.department === "bodyshop" ? null : job.plan_released_by;
    return (releasedBy ? mgrs.find((m) => m.id === releasedBy) : null) ?? mgrs.find((m) => m.role_id === "workshop_manager" && sideOfDept(m.department_id) === side) ?? null;
  };
  const people = [partsPeople?.[0] ?? null, ...sides.map(managerOf), advisor ?? null];
  const bodyPeople = (bodyRows ?? []) as unknown as { staff_id: string; staff: { display_name: string; photo_path: string | null } | null }[];
  const paths = [...people.map((p) => p?.photo_path), ...(techRows ?? []).map((t) => (t.staff as unknown as { photo_path: string | null } | null)?.photo_path), ...bodyPeople.map((b) => b.staff?.photo_path)].filter((p): p is string => !!p);
  const { data: signed } = paths.length ? await admin.storage.from("staff-photos").createSignedUrls(Array.from(new Set(paths)), 3600) : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlOf = new Map((signed ?? []).filter((s) => s.path).map((s) => [s.path as string, s.signedUrl]));
  const person = (p: { id: string; display_name: string; photo_path: string | null } | null) => (p ? { id: p.id, name: p.display_name, photoUrl: p.photo_path ? (urlOf.get(p.photo_path) ?? null) : null } : null);
  // The Parts step: the LPO sent for approval, approved and ordered from each supplier; then "All parts here by".
  const lpos = active || !job.plan_parts_done_at ? await loadJobLpos(job.id) : null;
  const pendingMain = lpos?.main && lpos.main.status === "pending_approval" ? lpos.main : null;
  const live = { ...liveBase, pendingLpo: !!pendingMain };
  const partsSorted = !missing.length || partsPlanned(live);
  const waitingOn: PlanningOn | null = !active ? null : planningOnOf(job, live, sides);
  const releaseNow = partsSorted ? sides.filter((s) => !sideReleased(job, s)) : [];
  const toOrderLpos = (lpos?.suppliers ?? []).filter((s) => s.po.status === "approved");
  const partsLine = !missing.length
    ? parts.length ? "Every part is here" : "No parts needed"
    : pendingMain ? `${pendingMain.number} waiting for approval`
    : toOrderLpos.length ? `${toOrderLpos.length} supplier LPO${toOrderLpos.length === 1 ? "" : "s"} to order`
    : lpos?.toOrder.length ? `${lpos.toOrder.length} part${lpos.toOrder.length === 1 ? "" : "s"} to order: send the LPO for approval`
    : partsDelayed ? `Delayed: ${live.late} part${live.late === 1 ? "" : "s"} overdue${partsReadyDate ? `, now all here by ${partsReadyDate}` : ""}`
    : partsReadyDate ? `All parts here by ${partsReadyDate}` : "Waiting for delivery dates";
  const sideCircle = (side: Side, i: number): PlanningCircle => {
    const released = sideReleased(job, side);
    const waiting = !released && releaseNow.includes(side) && active;
    const startDay = side === "bodyshop" ? job.plan_bodyshop_start_date : job.plan_start_date;
    return { key: side === "bodyshop" ? "bodyshop" : "workshop", n: 2, title: SIDE_LABEL[side], state: released ? "green" : waiting ? "amber" : "grey", since: job.plan_parts_done_at, person: person(people[1 + i]), line: released ? `Released: start ${startDay}` : waiting ? (side === "bodyshop" ? "Pick the start day and the bodyshop team" : "Pick the start day and the technicians") : "After Parts" };
  };
  const lastRelease = [job.plan_released_at, job.plan_bodyshop_released_at].filter((d): d is string => !!d).sort().at(-1) ?? null;
  const circles: PlanningCircle[] = [
    { key: "parts", n: 1, title: "Parts", state: partsSorted ? "green" : active ? "amber" : "grey", since: partsSorted ? null : job.stage_entered_at, person: person(people[0]), line: partsLine },
    ...sides.map(sideCircle),
    { key: "advisor", n: 3, title: "Advisor", state: job.plan_date_confirmed_at ? "green" : waitingOn === "advisor" ? "amber" : "grey", since: lastRelease, person: person(people[people.length - 1]), line: job.plan_date_confirmed_at ? `Promised ${job.promised_at}` : waitingOn === "advisor" ? `Confirm the finish date (suggested ${suggestedFinish ?? "…"}) and tell the customer` : sides.length > 1 ? "After both releases" : `After the ${SIDE_LABEL[sides[0]].toLowerCase()}` },
  ];
  return {
    active,
    circles,
    waitingOn,
    sides,
    releaseNow,
    hoursBySide,
    parts,
    unplanned,
    missing,
    partsReadyDate,
    partsDelayed,
    technicians: [
      ...(techRows ?? []).map((t) => ({ id: t.staff_id, display_name: (t.staff as unknown as { display_name: string } | null)?.display_name ?? "Technician", photoUrl: (t.staff as unknown as { photo_path: string | null } | null)?.photo_path ? (urlOf.get((t.staff as unknown as { photo_path: string }).photo_path) ?? null) : null, left_at: t.left_at, done_at: t.done_at })),
      ...bodyPeople.filter((b) => !(techRows ?? []).some((t) => t.staff_id === b.staff_id)).map((b) => ({ id: b.staff_id, display_name: b.staff?.display_name ?? "Bodyshop", photoUrl: b.staff?.photo_path ? (urlOf.get(b.staff.photo_path) ?? null) : null, left_at: null, done_at: null })),
    ],
    suggestedFinish,
    hoursEstimate,
  };
}
