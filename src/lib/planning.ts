import "server-only";
import { dubaiDate } from "./jobs";
import { PART_FULL_SELECT, toPartFull, type PartFull } from "./parts-data";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import type { JobRow } from "./types";
import type { WorkingTime } from "./working-time";

export type CircleKey = "parts" | "workshop" | "advisor";
export type PlanningCircle = { key: CircleKey; n: number; title: string; state: "grey" | "amber" | "green"; since: string | null; person: { id: string | null; name: string; photoUrl: string | null } | null; line: string };
export type Planning = {
  active: boolean;
  circles: PlanningCircle[];
  waitingOn: CircleKey | null;
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
  const [{ data: partRows }, { data: techRows }, { data: lineRows }, { data: insp }] = await Promise.all([
    admin.from("part_items").select(PART_FULL_SELECT).eq("job_id", job.id).eq("is_active", true).neq("order_status", "none").neq("return_status", "returned"),
    admin.from("job_technicians").select("id, staff_id, left_at, done_at, staff:staff!job_technicians_staff_id_fkey(display_name, photo_path)").eq("job_id", job.id).eq("is_active", true).order("added_at"),
    admin.from("work_lines").select("hours_quoted").eq("job_id", job.id).eq("is_active", true),
    admin.from("inspections").select("estimated_hours, estimated_hours_manager").eq("job_id", job.id).eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const parts = ((partRows ?? []) as unknown as Record<string, unknown>[]).map(toPartFull);
  const unplanned = parts.filter((p) => !p.availability || (p.availability === "to_order" && !p.delivery_date && p.order_status !== "received"));
  const missing = parts.filter((p) => p.order_status !== "received" && p.availability !== "in_stock");
  const today = dubaiDate();
  const dates = missing.map((p) => p.expected_date ?? p.delivery_date).filter((d): d is string => !!d);
  const partsReadyDate = missing.length === 0 ? today : dates.length ? dates.sort().at(-1)! : null;
  const partsDelayed = !!job.plan_parts_done_at && !!job.plan_parts_ready_date && !!partsReadyDate && partsReadyDate > job.plan_parts_ready_date;
  const quotedHours = (lineRows ?? []).reduce((a, l) => a + (Number(l.hours_quoted) || 0), 0);
  const hoursEstimate = quotedHours || Number(insp?.estimated_hours_manager ?? insp?.estimated_hours ?? 0) || 0;
  const start = job.plan_start_date ?? today;
  const suggestedFinish = hoursEstimate > 0 ? suggestFinishDate(start, hoursEstimate, wt) : null;
  const active = ["approved", "waiting_parts"].includes(job.status) || (!!job.plan_released_at && !job.plan_date_confirmed_at && job.is_open);
  const waitingOn: CircleKey | null = !active ? null : !job.plan_parts_done_at || partsDelayed ? "parts" : !job.plan_released_at ? "workshop" : !job.plan_date_confirmed_at ? "advisor" : null;

  // The three faces: the Parts person who planned (or the Parts role), the department manager, the advisor.
  const [{ data: partsPeople }, { data: managers }, { data: advisor }] = await Promise.all([
    job.plan_parts_by ? admin.from("staff").select("id, display_name, photo_path").eq("id", job.plan_parts_by) : admin.from("staff").select("id, display_name, photo_path").eq("role_id", "parts").eq("is_active", true).order("display_name").limit(1),
    job.plan_released_by ? admin.from("staff").select("id, display_name, photo_path").eq("id", job.plan_released_by) : admin.from("staff").select("id, display_name, photo_path, department_id").eq("role_id", "workshop_manager").eq("is_active", true).order("display_name"),
    admin.from("staff").select("id, display_name, photo_path").eq("id", job.plan_date_confirmed_by ?? job.gated_in_by).maybeSingle(),
  ]);
  const mgr = (managers ?? []).find((m) => !("department_id" in m) || !m.department_id || job.department === "both" || !job.department || (job.department === "bodyshop" ? ["bodyshop", "paint", "ppf_tint"].includes(String(m.department_id)) : m.department_id === "mechanical")) ?? (managers ?? [])[0] ?? null;
  const people = [partsPeople?.[0] ?? null, mgr, advisor ?? null];
  const paths = [...people.map((p) => p?.photo_path), ...(techRows ?? []).map((t) => (t.staff as unknown as { photo_path: string | null } | null)?.photo_path)].filter((p): p is string => !!p);
  const { data: signed } = paths.length ? await admin.storage.from("staff-photos").createSignedUrls(Array.from(new Set(paths)), 3600) : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlOf = new Map((signed ?? []).filter((s) => s.path).map((s) => [s.path as string, s.signedUrl]));
  const person = (p: { id: string; display_name: string; photo_path: string | null } | null) => (p ? { id: p.id, name: p.display_name, photoUrl: p.photo_path ? (urlOf.get(p.photo_path) ?? null) : null } : null);
  const partsLine = job.plan_parts_done_at ? (partsDelayed ? `Delayed: now all here by ${partsReadyDate}` : missing.length ? `All parts here by ${job.plan_parts_ready_date ?? partsReadyDate}` : "All parts in stock") : unplanned.length ? `${unplanned.length} part${unplanned.length === 1 ? "" : "s"} to decide: in stock or to order` : parts.length ? "Press Parts planned" : "No parts needed: press Parts planned";
  const circles: PlanningCircle[] = [
    { key: "parts", n: 1, title: "Parts", state: job.plan_parts_done_at && !partsDelayed ? "green" : active ? "amber" : "grey", since: job.plan_parts_done_at ? null : job.stage_entered_at, person: person(people[0]), line: partsLine },
    { key: "workshop", n: 2, title: "Workshop", state: job.plan_released_at ? "green" : waitingOn === "workshop" ? "amber" : "grey", since: job.plan_parts_done_at, person: person(people[1]), line: job.plan_released_at ? `Released: start ${job.plan_start_date}` : waitingOn === "workshop" ? "Pick the start day and the technicians" : "After Parts" },
    { key: "advisor", n: 3, title: "Advisor", state: job.plan_date_confirmed_at ? "green" : waitingOn === "advisor" ? "amber" : "grey", since: job.plan_released_at, person: person(people[2]), line: job.plan_date_confirmed_at ? `Promised ${job.promised_at}` : waitingOn === "advisor" ? `Confirm the finish date (suggested ${suggestedFinish ?? "…"}) and tell the customer` : "After the workshop" },
  ];
  return {
    active,
    circles,
    waitingOn,
    parts,
    unplanned,
    missing,
    partsReadyDate,
    partsDelayed,
    technicians: (techRows ?? []).map((t) => ({ id: t.staff_id, display_name: (t.staff as unknown as { display_name: string } | null)?.display_name ?? "Technician", photoUrl: (t.staff as unknown as { photo_path: string | null } | null)?.photo_path ? (urlOf.get((t.staff as unknown as { photo_path: string }).photo_path) ?? null) : null, left_at: t.left_at, done_at: t.done_at })),
    suggestedFinish,
    hoursEstimate,
  };
}
