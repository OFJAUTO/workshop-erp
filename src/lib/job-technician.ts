import "server-only";
import { createAdminClient } from "./supabase/admin";
import { pageAllIn } from "./page-all";

/**
 * THE TECHNICIAN OF A CAR on the parts screens (8 November 2026, Peter, J-00492): who is on the car, by side - the
 * mechanics on the job (job_technicians, the lead first) and the bodyshop team (bodyshop_assignments). INTERNAL ONLY:
 * shown on staff screens next to the advisor, never on a supplier copy or anything the customer sees.
 */
export type CarTechnicians = { mechanical: { id: string; name: string }[]; bodyshop: { id: string; name: string }[] };

const first = (n: string | null | undefined) => String(n ?? "").trim().split(" ")[0] ?? "";

export async function jobTechniciansFor(jobIds: (string | null | undefined)[]): Promise<Map<string, CarTechnicians>> {
  const ids = Array.from(new Set(jobIds.filter((x): x is string => !!x)));
  const out = new Map<string, CarTechnicians>();
  if (!ids.length) return out;
  const admin = createAdminClient();
  const [jobs, techs, body] = await Promise.all([
    pageAllIn<{ id: string; assigned_to: string | null }>(ids, (part, a, b) => admin.from("jobs").select("id, assigned_to").in("id", part).order("id").range(a, b)),
    pageAllIn<{ job_id: string; staff_id: string; added_at: string }>(ids, (part, a, b) => admin.from("job_technicians").select("job_id, staff_id, added_at").in("job_id", part).eq("is_active", true).is("left_at", null).is("done_at", null).order("added_at").range(a, b)),
    pageAllIn<{ job_id: string; staff_id: string; assigned_at: string }>(ids, (part, a, b) => admin.from("bodyshop_assignments").select("job_id, staff_id, assigned_at").in("job_id", part).eq("is_active", true).is("removed_at", null).order("assigned_at").range(a, b)),
  ]);
  const people = Array.from(new Set([...techs.map((t) => t.staff_id), ...body.map((b) => b.staff_id)]));
  const { data: staff } = people.length ? await admin.from("staff").select("id, display_name").in("id", people) : { data: [] };
  const nameOf = new Map((staff ?? []).map((s) => [s.id as string, first(s.display_name as string)]));
  const get = (j: string) => out.get(j) ?? (out.set(j, { mechanical: [], bodyshop: [] }), out.get(j)!);
  // The lead (the job's assigned technician) first, then the others in the order they joined.
  const leadOf = new Map(jobs.map((j) => [j.id, j.assigned_to]));
  for (const t of [...techs].sort((a, b) => Number(leadOf.get(b.job_id) === b.staff_id) - Number(leadOf.get(a.job_id) === a.staff_id))) {
    const g = get(t.job_id);
    if (!g.mechanical.some((x) => x.id === t.staff_id)) g.mechanical.push({ id: t.staff_id, name: nameOf.get(t.staff_id) ?? "" });
  }
  for (const b of body) {
    const g = get(b.job_id);
    if (!g.bodyshop.some((x) => x.id === b.staff_id)) g.bodyshop.push({ id: b.staff_id, name: nameOf.get(b.staff_id) ?? "" });
  }
  return out;
}

/** "Technician: Keno" / "Technician: Keno, Ali" / "Mechanical: Keno · Bodyshop: Sabir" / null when nobody is on the car. */
export function technicianWords(t: CarTechnicians | null | undefined): string | null {
  if (!t) return null;
  const m = t.mechanical.map((x) => x.name).filter(Boolean);
  const b = t.bodyshop.map((x) => x.name).filter(Boolean);
  if (m.length && b.length) return `Mechanical: ${m.join(", ")} · Bodyshop: ${b.join(", ")}`;
  if (m.length || b.length) return `Technician: ${[...m, ...b].join(", ")}`;
  return null;
}

/** First names only, for "waiting for Keno". */
export function technicianNames(t: CarTechnicians | null | undefined): string {
  if (!t) return "";
  return [...t.mechanical, ...t.bodyshop].map((x) => x.name).filter(Boolean).join(", ");
}
