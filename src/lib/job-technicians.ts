import "server-only";
import { createAdminClient } from "./supabase/admin";

/** A technician put on the car by the manager (assigned, or added later) counts as the car's technician. */
export async function technicianOnJob(jobId: string, staffId: string) {
  const admin = createAdminClient();
  const [{ data: job }, { data: rows }] = await Promise.all([
    admin.from("jobs").select("assigned_to").eq("id", jobId).maybeSingle(),
    admin.from("job_technicians").select("id").eq("job_id", jobId).eq("staff_id", staffId).eq("is_active", true).is("left_at", null).limit(1),
  ]);
  return job?.assigned_to === staffId || (rows ?? []).length > 0;
}

export type JobTechnician = { staff_id: string; display_name: string; lead: boolean; done_at: string | null; working: boolean };

/**
 * Everyone on the car right now: the technicians the manager put on it, with the lead (the one
 * the job is assigned to, who does the inspection) first.
 */
export async function loadJobTechnicians(jobId: string): Promise<JobTechnician[]> {
  const admin = createAdminClient();
  const [{ data: job }, { data: rows }, { data: running }] = await Promise.all([
    admin.from("jobs").select("assigned_to").eq("id", jobId).maybeSingle(),
    admin.from("job_technicians").select("staff_id, done_at, added_at, staff:staff!job_technicians_staff_id_fkey(display_name)").eq("job_id", jobId).eq("is_active", true).is("left_at", null).order("added_at"),
    admin.from("work_sessions").select("technician_id").eq("job_id", jobId).is("ended_at", null),
  ]);
  const working = new Set((running ?? []).map((r) => r.technician_id as string));
  const out: JobTechnician[] = ((rows ?? []) as unknown as { staff_id: string; done_at: string | null; staff: { display_name: string } | null }[]).map((r) => ({
    staff_id: r.staff_id,
    display_name: r.staff?.display_name ?? "Technician",
    lead: r.staff_id === job?.assigned_to,
    done_at: r.done_at,
    working: working.has(r.staff_id),
  }));
  if (job?.assigned_to && !out.some((t) => t.staff_id === job.assigned_to)) {
    const { data: lead } = await admin.from("staff").select("display_name").eq("id", job.assigned_to).maybeSingle();
    out.unshift({ staff_id: job.assigned_to, display_name: lead?.display_name ?? "Technician", lead: true, done_at: null, working: working.has(job.assigned_to) });
  }
  return out.sort((a, b) => Number(b.lead) - Number(a.lead));
}
