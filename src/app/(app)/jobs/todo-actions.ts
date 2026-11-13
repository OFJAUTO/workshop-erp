"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ticksReady } from "@/lib/jobs-to-do-data";

/**
 * A job of the approved quotation ticked done (or not) by the technician (11 November 2026, Section 9). A mechanical job
 * with a work line moves that work line too; a bodyshop job is ticked on its own. Logged on the car's history.
 */
export async function tickJobLine(jobId: string, lineId: string, done: boolean): Promise<{ ok?: boolean; error?: string }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  if (!["owner", "technician", "workshop_manager", "team_leader", "qc_inspector"].includes(staff.role_id)) return { error: "Only the people working on the car tick its jobs." };
  if (!(await ticksReady())) return { error: "Ticking jobs switches on once the database change is applied." };
  const admin = createAdminClient();
  const { data: line } = await admin.from("quotation_lines").select("id, title").eq("id", lineId).maybeSingle();
  if (!line) return { error: "That job is no longer on the quotation." };
  const now = new Date().toISOString();
  const { error } = await admin.from("job_line_ticks").upsert({ job_id: jobId, quotation_line_id: lineId, done_at: done ? now : null, done_by: done ? staff.id : null, is_active: true, created_by: staff.id, updated_by: staff.id }, { onConflict: "job_id,quotation_line_id" });
  if (error) return { error: "Couldn't save – try again." };
  await admin.from("work_lines").update(done ? { status: "done", done_at: now, done_by: staff.id, updated_by: staff.id } : { status: "in_progress", done_at: null, done_by: null, updated_by: staff.id }).eq("job_id", jobId).eq("quotation_line_id", lineId).eq("is_active", true);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "job_line_ticked", note: `${String(line.title).toUpperCase()} ${done ? "done" : "not done after all"} · ${staff.display_name}`, created_by: staff.id });
  revalidatePath(`/my-jobs/${jobId}`);
  revalidatePath(`/bodyshop/${jobId}`);
  return { ok: true };
}

/** "Start anyway" (13 November 2026, Section 1): the workshop or bodyshop manager lets a job line start (dismantling and
 * preparation) before its parts are here. Kept in the job's history; the technician sees it on the line. */
export async function startAnywayAction(jobId: string, lineId: string): Promise<{ ok?: boolean; error?: string }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  if (!["owner", "workshop_manager"].includes(staff.role_id)) return { error: "Only the workshop or bodyshop manager allows a start before the parts are here." };
  const admin = createAdminClient();
  const { data: line } = await admin.from("quotation_lines").select("id, title").eq("id", lineId).maybeSingle();
  if (!line) return { error: "That job is no longer on the quotation." };
  const { error } = await admin.from("job_events").insert({ job_id: jobId, event_type: "start_anyway", from_stage: `line:${lineId}`, note: `Start anyway (dismantle and prepare): ${String(line.title).toUpperCase()} · allowed by ${staff.display_name}`, created_by: staff.id });
  if (error) return { error: "Couldn't save – try again." };
  revalidatePath(`/my-jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/work`);
  revalidatePath(`/bodyshop/${jobId}`);
  return { ok: true };
}
