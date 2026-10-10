import "server-only";
import { breakOf } from "./breaks";
import { sideOfDepartment } from "./inspection";
import { workingTimeOf } from "./jobs";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";
import { WORK_SESSION_SELECT, sessionMinutes, type WorkSessionRow } from "./work-data";
import { hoursLeftThisWeek, hoursPerDay } from "./working-time";

export type TechnicianLoad = {
  id: string;
  display_name: string;
  department_id: string | null;
  photoUrl: string | null;
  /** green: free, amber: on a car but not working now, red: clock running. */
  status: "free" | "paused" | "working";
  /** What he is doing now, in words. */
  now: string;
  cars: { jobId: string; plate: string; jobNumber: string; running: boolean }[];
  /** Hours still to do on his cars, against the hours in a week. */
  loadHours: number;
  weekHours: number;
  percent: number;
};

/**
 * One line per technician for the assignment list and the Workshop load page: free, paused or
 * working, his cars as plate tags, and his weekly load (remaining hours on his cars against the
 * working hours of a week), freest first.
 */
export async function technicianLoads(settings: Settings, side: "mechanical" | "bodyshop" | null): Promise<TechnicianLoad[]> {
  const admin = createAdminClient();
  const [{ data: techs }, { data: links }, { data: sessions }, { data: pauses }] = await Promise.all([
    admin.from("staff").select("id, display_name, department_id, photo_path, break_start, break_end").eq("role_id", "technician").eq("is_active", true).order("display_name"),
    admin.from("job_technicians").select("job_id, staff_id, done_at, job:jobs!inner(id, job_number, status, is_open, budget_hours, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin))").eq("is_active", true).is("left_at", null),
    admin.from("work_sessions").select(WORK_SESSION_SELECT).eq("is_active", true),
    admin.from("work_pauses").select("job_id, technician_id").is("ended_at", null).eq("is_active", true),
  ]);
  const people = ((techs ?? []) as { id: string; display_name: string; department_id: string | null; photo_path: string | null; break_start: string | null; break_end: string | null }[]).filter((t) => !side || !sideOfDepartment(t.department_id) || sideOfDepartment(t.department_id) === side);
  type Link = { job_id: string; staff_id: string; done_at: string | null; job: { id: string; job_number: string; status: string; is_open: boolean; budget_hours: number | string | null; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null } | null } };
  const rows = ((links ?? []) as unknown as Link[]).filter((l) => l.job.is_open && !["ready", "pending_payment", "in_delivery", "closed", "pending_wash", "pending_qc"].includes(l.job.status));
  const openJobIds = Array.from(new Set(rows.map((l) => l.job_id)));
  const { data: lines } = openJobIds.length ? await admin.from("work_lines").select("job_id, hours_quoted, status").in("job_id", openJobIds).eq("is_active", true) : { data: [] as { job_id: string; hours_quoted: number | string | null; status: string }[] };
  const hoursOf = new Map<string, number>();
  for (const l of lines ?? []) hoursOf.set(l.job_id, (hoursOf.get(l.job_id) ?? 0) + (Number(l.hours_quoted) || 0));
  const ss = (sessions ?? []) as WorkSessionRow[];
  const usedOf = new Map<string, number>();
  for (const s of ss) usedOf.set(s.job_id, (usedOf.get(s.job_id) ?? 0) + sessionMinutes(s));
  const running = new Map(ss.filter((s) => !s.ended_at).map((s) => [s.technician_id, s.job_id]));
  const paused = new Set((pauses ?? []).map((p) => p.technician_id as string));
  const photoPaths = people.map((p) => p.photo_path).filter((p): p is string => !!p);
  const { data: signed } = photoPaths.length ? await admin.storage.from("staff-photos").createSignedUrls(photoPaths, 3600) : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const out: TechnicianLoad[] = people.map((p) => {
    const mine = rows.filter((l) => l.staff_id === p.id);
    const wt = workingTimeOf(settings, sideOfDepartment(p.department_id) === "bodyshop" ? "bodyshop" : "mechanical");
    const brk = breakOf(settings, p);
    const week = hoursLeftThisWeek({ ...wt, breakStart: brk?.start, breakEnd: brk?.end });
    const weekHours = week.total || hoursPerDay(wt) * 6;
    let loadHours = 0;
    const cars = mine.map((l) => {
      const budget = l.job.budget_hours !== null && l.job.budget_hours !== undefined ? Number(l.job.budget_hours) : hoursOf.get(l.job_id) ?? 0;
      const share = Math.max(1, rows.filter((x) => x.job_id === l.job_id).length);
      const left = Math.max(0, budget - (usedOf.get(l.job_id) ?? 0) / 60) / share;
      if (!l.done_at) loadHours += left;
      return { jobId: l.job_id, plate: l.job.vehicle ? formatPlate(l.job.vehicle) : l.job.job_number, jobNumber: l.job.job_number, running: running.get(p.id) === l.job_id };
    });
    const status: TechnicianLoad["status"] = running.has(p.id) ? "working" : mine.length || paused.has(p.id) ? "paused" : "free";
    const nowCar = cars.find((c) => c.running);
    const now = status === "working" ? `Working on ${nowCar?.plate ?? "a car"}` : status === "paused" ? (paused.has(p.id) ? `Paused · ${cars.map((c) => c.plate).join(", ")}` : `On ${cars.length} car${cars.length === 1 ? "" : "s"}, clock off`) : "Free";
    loadHours = Math.round(loadHours * 10) / 10;
    return { id: p.id, display_name: p.display_name, department_id: p.department_id, photoUrl: p.photo_path ? (urlOf.get(p.photo_path) ?? null) : null, status, now, cars, loadHours, weekHours, percent: weekHours > 0 ? Math.round((loadHours / weekHours) * 100) : 0 };
  });
  return out.sort((a, b) => a.percent - b.percent || (a.status === "free" ? -1 : 1) - (b.status === "free" ? -1 : 1) || a.display_name.localeCompare(b.display_name));
}
