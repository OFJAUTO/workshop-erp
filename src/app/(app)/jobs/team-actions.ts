"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { JOB_DEPARTMENTS } from "@/lib/inspection";
import { LINE_TEAM_LABELS, isLineTeam } from "@/lib/line-teams";
import { teamsReady } from "@/lib/line-teams-data";
import { notifyManagers } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/** Who may change a job's department and its lines' teams: the owner, the advisors and the managers (workshop and bodyshop). */
const MAY_CHANGE = ["owner", "service_advisor", "workshop_manager"];

function back(jobId: string, words: { message?: string; error?: string }): never {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
  revalidatePath("/bodyshop");
  revalidatePath("/assign");
  const q = words.error ? `error=${encodeURIComponent(words.error)}` : `message=${encodeURIComponent(words.message ?? "")}`;
  redirect(`/jobs/${jobId}?${q}#teams`);
}

const DEPARTMENT_WORDS: Record<string, string> = Object.fromEntries(JOB_DEPARTMENTS.map((d) => [d.value, d.label]));

/**
 * "Department: Mechanical ▾" → Bodyshop / Mechanical / Both (1 November 2026, J-00969). Planning and the pickers follow
 * at once; people already on the car who no longer fit are listed on the Teams card for reassigning, never dropped.
 */
export async function setJobDepartment(jobId: string, formData: FormData) {
  const staff = await requireStaff();
  if (!MAY_CHANGE.includes(staff.role_id) || staff.viewingAs) return back(jobId, { error: "Only the owner, an advisor or a manager can change the department." });
  const value = String(formData.get("department") ?? "");
  if (!DEPARTMENT_WORDS[value]) return back(jobId, { error: "Pick Mechanical, Bodyshop or Both." });
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, department, is_open").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return back(jobId, { error: "This job is closed." });
  if (job.department === value) return back(jobId, { message: `Already ${DEPARTMENT_WORDS[value]}.` });
  const from = DEPARTMENT_WORDS[String(job.department ?? "mechanical")] ?? "Mechanical";
  await admin.from("jobs").update({ department: value, updated_by: staff.id }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "department_change", note: `Department: ${from} → ${DEPARTMENT_WORDS[value]} (changed by ${staff.display_name})`, created_by: staff.id });
  const n = { type: "planning", title: `${job.job_number} is now ${DEPARTMENT_WORDS[value]}`, body: `${staff.display_name} changed the department from ${from} to ${DEPARTMENT_WORDS[value]}. Check the planning and the people on the car.`, jobId, href: `/jobs/${jobId}#planning` };
  await notifyManagers("mechanical", n);
  await notifyManagers("bodyshop", n);
  return back(jobId, { message: `Department changed to ${DEPARTMENT_WORDS[value]} ✓` });
}

/** "Team: Paint ▾" on one line of the car's work: who does it. Logged; the planning and the pickers follow. */
export async function setLineTeam(jobId: string, lineId: string, formData: FormData) {
  const staff = await requireStaff();
  if (!MAY_CHANGE.includes(staff.role_id) || staff.viewingAs) return back(jobId, { error: "Only the owner, an advisor or a manager can change a line's team." });
  if (!(await teamsReady())) return back(jobId, { error: "Choosing a team per line needs the database update first (waiting for apply)." });
  const team = String(formData.get("team") ?? "");
  if (!isLineTeam(team)) return back(jobId, { error: "Pick a team." });
  const admin = createAdminClient();
  const { data: line } = await admin.from("quotation_lines").select("id, title, team, quotation:quotations!inner(job_id)").eq("id", lineId).maybeSingle();
  const l = line as unknown as { id: string; title: string; team: string | null; quotation: { job_id: string | null } } | null;
  if (!l || l.quotation?.job_id !== jobId) return back(jobId, { error: "That line is not on this car." });
  if (l.team === team) return back(jobId, { message: "No change." });
  const { error } = await admin.from("quotation_lines").update({ team, updated_by: staff.id }).eq("id", lineId);
  if (error) return back(jobId, { error: "Couldn't save the team. Try again." });
  await admin.from("job_events").insert({ job_id: jobId, event_type: "line_team", note: `${String(l.title).toUpperCase()}: team ${l.team && isLineTeam(l.team) ? LINE_TEAM_LABELS[l.team] : "default"} → ${LINE_TEAM_LABELS[team]} (${staff.display_name})`, created_by: staff.id });
  return back(jobId, { message: `${String(l.title).toUpperCase()} → ${LINE_TEAM_LABELS[team]} ✓` });
}
