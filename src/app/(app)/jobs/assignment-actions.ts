"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { jobConcernsSide, sideOfDepartment } from "@/lib/inspection";
import { workingMinutesSince, workingTimeOf } from "@/lib/jobs";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { ROAD_TEST_DECISION_LABELS, ROAD_TEST_SELECT, roadTestWaiting, type RoadTestDecision, type RoadTestRow } from "@/lib/road-test";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

/* Everything around a car waiting for a technician: the advisor's note to the manager, the reminder,
   and the manager's road test choice, which can change at any time. */

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/my-jobs/${jobId}`);
  revalidatePath("/assign");
  revalidatePath("/dashboard");
  revalidatePath("/road-tests");
}

async function jobOf(jobId: string) {
  const { data } = await createAdminClient().from("jobs").select("id, job_number, status, department, assigned_to, is_open, first_approval_at, assignment_reminded_at, gated_in_by").eq("id", jobId).maybeSingle();
  return data;
}

/** The advisor leaves a short note for the workshop manager about a car waiting to be assigned. */
export async function setAssignmentNote(jobId: string, formData: FormData) {
  const staff = await requirePermission("noteToManager");
  const note = blankToNull(formData.get("assignment_note"));
  const job = await jobOf(jobId);
  if (!job || !job.is_open) redirect(`/jobs/${jobId}?error=` + encodeURIComponent("This job is closed."));
  const admin = createAdminClient();
  const { error } = await admin.from("jobs").update({ assignment_note: note ? note.slice(0, 500) : null, assignment_note_by: note ? staff.id : null, assignment_note_at: note ? new Date().toISOString() : null, updated_by: staff.id }).eq("id", jobId);
  if (error) redirect(`/jobs/${jobId}?error=` + encodeURIComponent(error.message));
  await admin.from("job_events").insert({ job_id: jobId, event_type: "assignment_note", note: note ? `Note to the workshop manager: ${note}` : "Note to the workshop manager removed", created_by: staff.id });
  if (note) {
    await notifyManagers(job.department ?? null, { type: "assignment_note", title: `Note from ${staff.display_name} · ${job.job_number}`, body: note, jobId, href: `/jobs/${jobId}` });
  }
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=` + encodeURIComponent(note ? "Note sent to the workshop manager." : "Note removed."));
}

/** Once the car has waited longer than the assignment target, the advisor can send the manager a fresh notification. */
export async function remindManager(jobId: string) {
  const staff = await requirePermission("noteToManager");
  const job = await jobOf(jobId);
  if (!job || !job.is_open || job.assigned_to || job.status !== "pending_inspection") redirect(`/jobs/${jobId}`);
  const settings = await getSettings();
  const since = job.first_approval_at ?? new Date().toISOString();
  const minutes = workingMinutesSince(since, workingTimeOf(settings));
  const target = Number(settings.assignment_target_minutes) || 30;
  if (minutes < target && staff.role_id !== "owner") redirect(`/jobs/${jobId}?error=` + encodeURIComponent(`The reminder opens after ${target} working minutes.`));
  const admin = createAdminClient();
  await admin.from("jobs").update({ assignment_reminded_at: new Date().toISOString(), updated_by: staff.id }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "assignment_reminder", note: `${staff.display_name} reminded the workshop manager to assign a technician (waiting ${minutes} min)`, created_by: staff.id });
  await notifyManagers(job.department ?? null, { type: "assignment_reminder", title: `Reminder: assign a technician · ${job.job_number}`, body: `${staff.display_name}: the car has waited ${minutes} working minutes.`, jobId, href: "/assign" });
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=` + encodeURIComponent("Reminder sent to the workshop manager."));
}

/** The workshop manager changes the road test choice at any time, with a note. Opening the inspection tells the technician. */
export async function decideRoadTest(jobId: string, formData: FormData) {
  const staff = await requirePermission("assignJobs");
  const job = await jobOf(jobId);
  if (!job || !job.is_open) redirect(`/jobs/${jobId}?error=` + encodeURIComponent("This job is closed."));
  if (staff.role_id !== "owner" && !jobConcernsSide(job.department, sideOfDepartment(staff.department_id))) redirect(`/jobs/${jobId}?error=` + encodeURIComponent("This car belongs to the other department."));
  const decision = String(formData.get("road_test") ?? "") as RoadTestDecision;
  const note = blankToNull(formData.get("road_test_note"));
  if (!["needed", "not_needed", "not_possible"].includes(decision)) redirect(`/jobs/${jobId}?error=` + encodeURIComponent("Choose a road test option."));
  if (!note || note.length < 3) redirect(`/jobs/${jobId}?error=` + encodeURIComponent("Write a note with the change."));

  const admin = createAdminClient();
  const { data: existing } = await admin.from("road_tests").select(ROAD_TEST_SELECT).eq("job_id", jobId).maybeSingle();
  const before = (existing as RoadTestRow | null) ?? null;
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { job_id: jobId, decision, decision_note: note, decided_by: staff.id, decided_at: now, updated_by: staff.id, ...(before ? {} : { created_by: staff.id }) };
  if (decision === "not_possible") Object.assign(row, { status: "not_possible", not_possible_reason: note, done_at: before?.status === "done" ? before.done_at : now });
  else if (before?.status === "not_possible") Object.assign(row, { status: "not_started", not_possible_reason: null, done_at: null });
  const { error } = await admin.from("road_tests").upsert(row, { onConflict: "job_id" });
  if (error) redirect(`/jobs/${jobId}?error=` + encodeURIComponent(error.message));
  await admin.from("job_events").insert({ job_id: jobId, event_type: "road_test_decision", note: `${ROAD_TEST_DECISION_LABELS[decision]} (${staff.display_name}): ${note}`, created_by: staff.id });

  const nowWaiting = roadTestWaiting({ status: decision === "not_possible" ? "not_possible" : (before?.status === "not_possible" ? "not_started" : (before?.status ?? "not_started")), decision });
  if (nowWaiting && !roadTestWaiting(before)) {
    await notifyRoles(["qc_inspector"], { type: "road_test_assigned", title: `Road test needed · ${job.job_number}`, body: `${staff.display_name}: ${note}`, jobId, href: `/road-tests/${jobId}` });
  }
  if (job.assigned_to) {
    const opened = roadTestWaiting(before) && !nowWaiting;
    await notifyStaff([job.assigned_to], { type: opened ? "inspection_open" : "road_test_decided", title: opened ? `Inspection open · ${job.job_number}` : `Road test: ${ROAD_TEST_DECISION_LABELS[decision]} · ${job.job_number}`, body: `${staff.display_name}: ${note}`, jobId, href: `/my-jobs/${jobId}` });
  }
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=` + encodeURIComponent(`Road test choice saved: ${ROAD_TEST_DECISION_LABELS[decision]}.`));
}
