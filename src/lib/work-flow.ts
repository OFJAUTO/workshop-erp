import "server-only";
import { dubaiDate } from "./jobs";
import { notifyManagers, notifyRoles, notifyStaff } from "./notifications";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { breakOf } from "./breaks";
import { breakNow } from "./working-time";
import { getSettings } from "./settings";
import { ensureProforma } from "./invoice-flow";
import { WORK_SESSION_SELECT, buildQcItems, ensureWorkLines, latestQc, sessionMinutes, type WorkSessionRow } from "./work-data";

/** Who is doing something: a staff row, or the owner acting for someone. */
export type Actor = { id: string; display_name: string; role_id: string };
export type Result = { error?: string; ok?: boolean; message?: string };

export const PAUSE_REASONS = ["Waiting for parts", "Waiting for the manager", "Another job", "Break", "Tools or lift busy"] as const;

async function jobRow(jobId: string) {
  const { data } = await createAdminClient().from("jobs").select("id, job_number, status, stage, department, assigned_to, is_open, gated_in_by, work_done_at, work_sendbacks, qc_round, rework_count").eq("id", jobId).maybeSingle();
  return data;
}
async function event(jobId: string, by: string | null, event_type: string, note: string, extra: Record<string, unknown> = {}) {
  await createAdminClient().from("job_events").insert({ job_id: jobId, event_type, note, created_by: by, ...extra });
}
async function advisorIds(jobId: string, gatedInBy: string | null) {
  const { data: appr } = await createAdminClient().from("approval_requests").select("sent_by").eq("job_id", jobId);
  return Array.from(new Set([gatedInBy, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
}

/** The technicians on a car: everyone the manager put on it who has not left. */
export async function activeTechnicians(jobId: string) {
  const { data } = await createAdminClient().from("job_technicians").select("id, staff_id, done_at, left_at").eq("job_id", jobId).eq("is_active", true).is("left_at", null);
  return (data ?? []) as { id: string; staff_id: string; done_at: string | null; left_at: string | null }[];
}

/** Ends every open session of a technician (one car at a time), with the reason given. */
async function closeOpenSessions(technicianId: string, by: string, endReason: "stop" | "pause" | "complete" | "auto", pauseReason: string | null, jobId?: string) {
  const admin = createAdminClient();
  let qy = admin.from("work_sessions").select(WORK_SESSION_SELECT).eq("technician_id", technicianId).is("ended_at", null);
  if (jobId) qy = qy.eq("job_id", jobId);
  const [{ data: open }, { data: person }, settings] = await Promise.all([qy, admin.from("staff").select("department_id, break_start, break_end").eq("id", technicianId).maybeSingle(), getSettings()]);
  const brk = breakOf(settings, person);
  const now = new Date().toISOString();
  let minutes = 0;
  for (const s of (open ?? []) as WorkSessionRow[]) {
    const m = sessionMinutes({ started_at: s.started_at, ended_at: now, minutes: null, through_break: s.through_break }, Date.now(), brk);
    minutes += m;
    await admin.from("work_sessions").update({ ended_at: now, end_reason: endReason, pause_reason: pauseReason, minutes: m, updated_by: by }).eq("id", s.id);
  }
  return { count: (open ?? []).length, minutes };
}

/** Closes the technician's open pause on this car, if any. */
async function closeOpenPause(jobId: string, technicianId: string, by: string) {
  const admin = createAdminClient();
  const { data: open } = await admin.from("work_pauses").select("id, started_at").eq("job_id", jobId).eq("technician_id", technicianId).is("ended_at", null);
  const now = new Date().toISOString();
  for (const p of open ?? []) await admin.from("work_pauses").update({ ended_at: now, minutes: sessionMinutes({ started_at: p.started_at, ended_at: now, minutes: null }), updated_by: by }).eq("id", p.id);
}

/** "Working": the clock starts for this technician on this car. Any other car's clock stops; an open pause ends. */
export async function startWorking(jobId: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient();
  const job = await jobRow(jobId);
  if (!job || !job.is_open) return { error: "This job is closed." };
  if (job.status !== "in_work") return { error: "This car is not in Work. The workshop manager releases it from planning first." };
  const techs = await activeTechnicians(jobId);
  const onJob = techs.find((t) => t.staff_id === actor.id);
  if (!onJob && actor.role_id !== "owner" && job.assigned_to !== actor.id) return { error: "You are not on this car. Ask the workshop manager to put you on it." };
  if (!onJob) await admin.from("job_technicians").insert({ job_id: jobId, staff_id: actor.id, added_by: actor.id, created_by: actor.id, updated_by: actor.id });
  if (onJob?.done_at) await admin.from("job_technicians").update({ done_at: null, updated_by: actor.id }).eq("id", onJob.id);
  if (job.work_done_at) await admin.from("jobs").update({ work_done_at: null }).eq("id", jobId);
  const closed = await closeOpenSessions(actor.id, actor.id, "auto", "Another job");
  if (closed.count) await event(jobId, actor.id, "work_clock", `${actor.display_name} stopped on another car (switched) after ${closed.minutes} min`);
  await closeOpenPause(jobId, actor.id, actor.id);
  await admin.from("work_sessions").insert({ job_id: jobId, technician_id: actor.id, started_at: new Date().toISOString(), created_by: actor.id, updated_by: actor.id });
  await admin.from("work_lines").update({ status: "in_progress", updated_by: actor.id }).eq("job_id", jobId).eq("status", "todo");
  if (!job.assigned_to) await admin.from("jobs").update({ assigned_to: actor.id }).eq("id", jobId);
  await event(jobId, actor.id, "work_clock", `${actor.display_name} working`);
  return { ok: true, message: "Working. The clock runs against the car's hours." };
}

/** "Pause": one tap with the reason. Waiting for parts tells Parts; waiting for the manager tells the manager. */
export async function pauseWork(jobId: string, actor: Actor, reason: string): Promise<Result> {
  const admin = createAdminClient();
  const job = await jobRow(jobId);
  if (!job) return { error: "Job not found." };
  const clean = reason.trim().slice(0, 80);
  if (!clean) return { error: "Choose the reason for the pause." };
  const closed = await closeOpenSessions(actor.id, actor.id, "pause", clean, jobId);
  if (!closed.count) return { error: "The clock is not running on this car." };
  await closeOpenPause(jobId, actor.id, actor.id);
  await admin.from("work_pauses").insert({ job_id: jobId, technician_id: actor.id, reason: clean, created_by: actor.id, updated_by: actor.id });
  await event(jobId, actor.id, "work_pause", `${actor.display_name} paused: ${clean} (after ${closed.minutes} min)`);
  if (/parts/i.test(clean)) await notifyRoles(["parts"], { type: "pause", title: `Technician waiting for parts · ${job.job_number}`, body: `${actor.display_name} paused the work: ${clean}.`, jobId, href: `/parts/${jobId}` });
  if (/manager/i.test(clean)) await notifyManagers(job.department ?? null, { type: "pause", title: `Technician waiting for you · ${job.job_number}`, body: `${actor.display_name} paused the work: ${clean}.`, jobId, href: `/jobs/${jobId}/work` });
  return { ok: true, message: `Paused: ${clean}.` };
}

/** "Leave this job": the technician is off the car; the manager is told; only the manager or owner puts him back. */
export async function leaveJob(jobId: string, actor: Actor, reason: string): Promise<Result> {
  const admin = createAdminClient();
  const job = await jobRow(jobId);
  if (!job) return { error: "Job not found." };
  const clean = reason.trim().slice(0, 200);
  if (clean.length < 3) return { error: "Say why you leave this job." };
  await closeOpenSessions(actor.id, actor.id, "stop", null, jobId);
  await closeOpenPause(jobId, actor.id, actor.id);
  await admin.from("job_technicians").update({ left_at: new Date().toISOString(), left_reason: clean, updated_by: actor.id }).eq("job_id", jobId).eq("staff_id", actor.id).is("left_at", null);
  const left = await activeTechnicians(jobId);
  if (job.assigned_to === actor.id) await admin.from("jobs").update({ assigned_to: left[0]?.staff_id ?? null }).eq("id", jobId);
  await event(jobId, actor.id, "left_job", `${actor.display_name} left the job: ${clean}`);
  await notifyManagers(job.department ?? null, { type: "left_job", title: `${actor.display_name} left a job · ${job.job_number}`, body: `${clean}. ${left.length ? `${left.length} technician${left.length === 1 ? "" : "s"} still on the car.` : "Nobody is on the car now: put someone on it."}`, jobId, href: `/jobs/${jobId}/work` });
  return { ok: true, message: "You are off this job. The workshop manager has been told." };
}

/** "Job finished" (or "My part is done" with several technicians): the clock stops and locks; the last one sends the car to the manager. */
export async function finishMyPart(jobId: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient();
  const job = await jobRow(jobId);
  if (!job || !job.is_open || job.status !== "in_work") return { error: "This car is not in Work." };
  const techs = await activeTechnicians(jobId);
  const mine = techs.find((t) => t.staff_id === actor.id);
  if (!mine && actor.role_id !== "owner") return { error: "You are not on this car." };
  await closeOpenSessions(actor.id, actor.id, "complete", null, jobId);
  await closeOpenPause(jobId, actor.id, actor.id);
  const now = new Date().toISOString();
  if (mine) await admin.from("job_technicians").update({ done_at: now, updated_by: actor.id }).eq("id", mine.id);
  const stillWorking = techs.filter((t) => t.staff_id !== actor.id && !t.done_at);
  await event(jobId, actor.id, "work_done", `${actor.display_name}: ${stillWorking.length ? "my part is done" : "job finished"}`);
  if (stillWorking.length) return { ok: true, message: `Your part is done. Waiting for ${stillWorking.length} other technician${stillWorking.length === 1 ? "" : "s"}.` };
  await admin.from("work_lines").update({ status: "done", done_at: now, done_by: actor.id, updated_by: actor.id }).eq("job_id", jobId).eq("is_active", true).neq("status", "done");
  await admin.from("jobs").update({ work_done_at: now }).eq("id", jobId);
  await notifyManagers(job.department ?? null, { type: "work_done", title: `Job finished, confirm it · ${job.job_number}`, body: `${actor.display_name} says all work on this car is done. Confirm and send to QC, or send it back with a note.`, jobId, href: `/jobs/${jobId}/work` });
  return { ok: true, message: "Job finished. The workshop manager confirms and sends the car to QC." };
}

/** Opens a QC round if none is open: the checklist from the job plus the general checks. */
export async function openQcRound(jobId: string, by: string | null, settings: Settings): Promise<number> {
  const admin = createAdminClient();
  const { data: open } = await admin.from("qc_checks").select("id, round").eq("job_id", jobId).eq("status", "open").eq("is_active", true).maybeSingle();
  if (open) return Number(open.round);
  const previous = await latestQc(jobId);
  const round = (previous?.round ?? 0) + 1;
  const items = await buildQcItems(jobId, settings, previous);
  await admin.from("qc_checks").insert({ job_id: jobId, round, status: "open", items, created_by: by, updated_by: by });
  await admin.from("jobs").update({ qc_round: round }).eq("id", jobId);
  return round;
}

/** The manager confirms the finished work (the car goes to QC) or sends it back with a note (the technicians get it back, same clock). */
export async function managerConfirmWork(jobId: string, actor: Actor, ok: boolean, note: string | null, settings: Settings): Promise<Result> {
  const admin = createAdminClient();
  const job = await jobRow(jobId);
  if (!job || !job.is_open || job.status !== "in_work") return { error: "This car is not in Work." };
  const techs = await activeTechnicians(jobId);
  const now = new Date().toISOString();
  if (!ok) {
    const clean = (note ?? "").trim().slice(0, 500);
    if (clean.length < 3) return { error: "Write what is not done; the technician sees it on top." };
    await admin.from("jobs").update({ work_done_at: null, work_sendbacks: (Number(job.work_sendbacks) || 0) + 1 }).eq("id", jobId);
    for (const t of techs) await admin.from("job_technicians").update({ done_at: null, manager_sendbacks: await bump("job_technicians", t.id, "manager_sendbacks"), updated_by: actor.id }).eq("id", t.id);
    await admin.from("work_lines").update({ status: "in_progress", done_at: null, done_by: null, updated_by: actor.id }).eq("job_id", jobId).eq("is_active", true).eq("status", "done");
    await event(jobId, actor.id, "work_sendback", `Sent back by ${actor.display_name}: ${clean}`);
    await notifyStaff(techs.map((t) => t.staff_id), { type: "work_sendback", title: `Not done, sent back · ${job.job_number}`, body: `${actor.display_name}: ${clean}`, jobId, href: `/my-jobs/${jobId}` });
    return { ok: true, message: "Sent back to the technician with your note." };
  }
  const [{ data: parts }, { data: additional }] = await Promise.all([
    admin.from("part_items").select("id, description, issue_status, return_status").eq("job_id", jobId).eq("is_active", true).neq("order_status", "none"),
    admin.from("additional_work").select("id").eq("job_id", jobId).eq("status", "pending").eq("is_active", true),
  ]);
  if ((additional ?? []).length) return { error: "Decide the pending additional work first." };
  const unhanded = (parts ?? []).filter((p) => p.return_status === "none" && p.issue_status !== "confirmed");
  if (unhanded.length) return { error: `Not possible: ${unhanded.length} part${unhanded.length === 1 ? " was" : "s were"} never handed to the technician (${unhanded.map((p) => p.description).join(", ")}). Parts hand them over, or scan them back.` };
  for (const t of techs) await closeOpenSessions(t.staff_id, actor.id, "complete", null, jobId);
  await admin.from("work_lines").update({ status: "done", done_at: now, done_by: actor.id, updated_by: actor.id }).eq("job_id", jobId).eq("is_active", true).neq("status", "done");
  const round = await openQcRound(jobId, actor.id, settings);
  await admin.from("jobs").update({ status: "pending_qc", stage: "qc", stage_entered_at: now, work_completed_at: now, work_done_at: job.work_done_at ?? now }).eq("id", jobId);
  await event(jobId, actor.id, "status_change", `Work confirmed complete by ${actor.display_name}${round > 1 ? ` (QC round ${round})` : ""}`, { from_status: "in_work", to_status: "pending_qc" });
  await notifyRoles(["qc_inspector"], { type: "work_complete", title: `Car for QC · ${job.job_number}`, body: round > 1 ? "Rework done. Recheck the failed items." : "Record the mileage and attach the post-scan.", jobId, href: `/qc/${jobId}` });
  await notifyStaff(await advisorIds(jobId, job.gated_in_by), { type: "work_complete", title: `Work complete, in QC · ${job.job_number}`, body: `Confirmed by ${actor.display_name}.`, jobId, href: `/jobs/${jobId}` });
  return { ok: true, message: "Confirmed. The car is with QC." };
}

async function bump(table: string, id: string, column: string): Promise<number> {
  const { data } = await createAdminClient().from(table).select(column).eq("id", id).maybeSingle();
  return (Number((data as Record<string, unknown> | null)?.[column]) || 0) + 1;
}

/** The manager marks a pause "Not accepted". */
export async function rejectPause(pauseId: string, actor: Actor, accepted: boolean): Promise<Result> {
  const admin = createAdminClient();
  const { error } = await admin.from("work_pauses").update(accepted ? { accepted: true, rejected_by: null, rejected_at: null, updated_by: actor.id } : { accepted: false, rejected_by: actor.id, rejected_at: new Date().toISOString(), updated_by: actor.id }).eq("id", pauseId);
  return error ? { error: error.message } : { ok: true };
}

/** The manager puts a technician on a car (or back on it after he left). */
export async function addTechnician(jobId: string, staffId: string, actor: Actor, opts: { quiet?: boolean } = {}): Promise<Result> {
  const admin = createAdminClient();
  const job = await jobRow(jobId);
  if (!job || !job.is_open) return { error: "This job is closed." };
  const { data: tech } = await admin.from("staff").select("id, display_name, role_id, is_active").eq("id", staffId).maybeSingle();
  if (!tech || !tech.is_active || tech.role_id !== "technician") return { error: "Choose a technician." };
  const { data: existing } = await admin.from("job_technicians").select("id, left_at").eq("job_id", jobId).eq("staff_id", staffId).eq("is_active", true).maybeSingle();
  if (existing && !existing.left_at) return { error: `${tech.display_name} is already on this car.` };
  if (existing) await admin.from("job_technicians").update({ left_at: null, left_reason: null, done_at: null, added_by: actor.id, added_at: new Date().toISOString(), updated_by: actor.id }).eq("id", existing.id);
  else await admin.from("job_technicians").insert({ job_id: jobId, staff_id: staffId, added_by: actor.id, created_by: actor.id, updated_by: actor.id });
  if (!job.assigned_to) await admin.from("jobs").update({ assigned_to: staffId }).eq("id", jobId);
  if (job.work_done_at) await admin.from("jobs").update({ work_done_at: null }).eq("id", jobId);
  await event(jobId, actor.id, "work_assigned", `${tech.display_name} put on the car by ${actor.display_name}`, { to_staff: staffId });
  if (!opts.quiet) await notifyStaff([staffId], { type: "work_assigned", title: `Car for you · ${job.job_number}`, body: `${actor.display_name} put you on this car.`, jobId, href: `/my-jobs/${jobId}` });
  return { ok: true, message: `${tech.display_name} is on the car.` };
}

/**
 * The manager takes a technician off the car: the clock stops, any pause closes, and if he was the
 * lead the next technician on the car becomes the lead (and takes over an unapproved inspection).
 */
export async function removeTechnician(jobId: string, staffId: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient();
  const job = await jobRow(jobId);
  if (!job || !job.is_open) return { error: "This job is closed." };
  if (["pending_qc", "pending_wash", "ready", "pending_payment", "in_delivery", "closed"].includes(job.status)) return { error: "The work is confirmed finished; the technicians cannot change now." };
  const { data: tech } = await admin.from("staff").select("id, display_name").eq("id", staffId).maybeSingle();
  if (!tech) return { error: "Technician not found." };
  await closeOpenSessions(staffId, actor.id, "stop", null, jobId);
  await closeOpenPause(jobId, staffId, actor.id);
  await admin.from("job_technicians").update({ left_at: new Date().toISOString(), left_reason: `Taken off by ${actor.display_name}`, updated_by: actor.id }).eq("job_id", jobId).eq("staff_id", staffId).is("left_at", null);
  const left = await activeTechnicians(jobId);
  if (job.assigned_to === staffId) {
    const next = left[0]?.staff_id ?? null;
    await admin.from("jobs").update({ assigned_to: next }).eq("id", jobId);
    await admin.from("inspections").update({ technician_id: next ?? staffId, updated_by: actor.id }).eq("job_id", jobId).eq("is_active", true).neq("status", "approved");
  }
  await event(jobId, actor.id, "left_job", `${tech.display_name} taken off the car by ${actor.display_name}`, { from_staff: staffId });
  await notifyStaff([staffId], { type: "work_assigned", title: `Taken off a car · ${job.job_number}`, body: `${actor.display_name} took you off this car.`, jobId, href: "/my-jobs" });
  return { ok: true, message: `${tech.display_name} is off the car.${!left.length ? " Nobody is on it now." : ""}` };
}

/** Another technician on the car becomes the lead: the name on the job, and the one who does the inspection. */
export async function setLeadTechnician(jobId: string, staffId: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient();
  const job = await jobRow(jobId);
  if (!job || !job.is_open) return { error: "This job is closed." };
  const techs = await activeTechnicians(jobId);
  if (!techs.some((t) => t.staff_id === staffId)) return { error: "Put the technician on the car first." };
  const { data: tech } = await admin.from("staff").select("display_name").eq("id", staffId).maybeSingle();
  await admin.from("jobs").update({ assigned_to: staffId }).eq("id", jobId);
  await admin.from("inspections").update({ technician_id: staffId, updated_by: actor.id }).eq("job_id", jobId).eq("is_active", true).neq("status", "approved");
  await event(jobId, actor.id, "assigned", `${tech?.display_name ?? "Technician"} made the lead by ${actor.display_name}`, { from_staff: job.assigned_to, to_staff: staffId });
  return { ok: true, message: `${tech?.display_name ?? "Technician"} is the lead on this car.` };
}

/** "Keep working": the technician works through his break; the running session counts the break and it is written down. */
export async function keepWorkingThroughBreak(jobId: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient();
  const { data: open } = await admin.from("work_sessions").select("id").eq("job_id", jobId).eq("technician_id", actor.id).is("ended_at", null).limit(1);
  if (!(open ?? []).length) {
    const r = await startWorking(jobId, actor);
    if (r.error) return r;
  }
  await admin.from("work_sessions").update({ through_break: true, updated_by: actor.id }).eq("job_id", jobId).eq("technician_id", actor.id).is("ended_at", null);
  await event(jobId, actor.id, "work_clock", `${actor.display_name} kept working through the break`);
  return { ok: true, message: "Working through the break. It is written down." };
}

/**
 * The clock pauses itself at the start of the break (hourly job as the safety net; the tablet does it
 * at the minute when the page is open): a session that was running when the break started ends at
 * that moment with the reason "Break", which never counts against the technician.
 */
export async function autoPauseBreaks(settings: Settings): Promise<number> {
  const admin = createAdminClient();
  const { data: open } = await admin.from("work_sessions").select(WORK_SESSION_SELECT).is("ended_at", null);
  const sessions = (open ?? []) as WorkSessionRow[];
  if (!sessions.length) return 0;
  const { data: people } = await admin.from("staff").select("id, department_id, break_start, break_end").in("id", Array.from(new Set(sessions.map((s) => s.technician_id))));
  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  let n = 0;
  for (const s of sessions) {
    if (s.through_break) continue;
    const brk = breakOf(settings, byId.get(s.technician_id));
    const b = breakNow(brk);
    if (!b) continue;
    const started = Date.parse(s.started_at);
    const now = Date.now();
    // Only once the break has started, only for a session that was running before it, and only within the break or the hour after.
    if (now < b.startsAt || started >= b.startsAt || now > b.endsAt + 65 * 60000) continue;
    const at = new Date(b.startsAt).toISOString();
    const minutes = sessionMinutes({ started_at: s.started_at, ended_at: at, minutes: null }, now, brk);
    await admin.from("work_sessions").update({ ended_at: at, end_reason: "pause", pause_reason: "Break", minutes }).eq("id", s.id);
    await admin.from("work_pauses").insert({ job_id: s.job_id, technician_id: s.technician_id, reason: "Break", started_at: at, accepted: true });
    await event(s.job_id, null, "work_pause", "Clock paused for the break");
    n++;
  }
  return n;
}

/** The clock pauses itself at the end of the shift (hourly job): open sessions past closing time end, logged as a pause. */
export async function autoPauseEndOfShift(settings: Settings): Promise<number> {
  const admin = createAdminClient();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", hour12: false }).format(new Date()));
  if (hour < (Number(settings.closing_hour) || 17)) return 0;
  const { data: open } = await admin.from("work_sessions").select(WORK_SESSION_SELECT).is("ended_at", null);
  let n = 0;
  for (const s of (open ?? []) as WorkSessionRow[]) {
    const now = new Date().toISOString();
    await admin.from("work_sessions").update({ ended_at: now, end_reason: "auto", pause_reason: "End of shift", minutes: sessionMinutes({ started_at: s.started_at, ended_at: now, minutes: null }) }).eq("id", s.id);
    await admin.from("work_pauses").insert({ job_id: s.job_id, technician_id: s.technician_id, reason: "End of shift", started_at: now });
    await event(s.job_id, null, "work_pause", "Clock paused at the end of the shift");
    n++;
  }
  return n;
}

/** The hours charged to the customer for this car, the minutes used by everyone, and who is on it now. */
export async function workBudget(jobId: string) {
  const admin = createAdminClient();
  const [{ data: lines }, { data: sessions }] = await Promise.all([
    admin.from("work_lines").select("hours_quoted").eq("job_id", jobId).eq("is_active", true),
    admin.from("work_sessions").select(WORK_SESSION_SELECT).eq("job_id", jobId).eq("is_active", true),
  ]);
  const ss = (sessions ?? []) as WorkSessionRow[];
  const byTech = new Map<string, number>();
  for (const s of ss) byTech.set(s.technician_id, (byTech.get(s.technician_id) ?? 0) + sessionMinutes(s));
  const minutesUsed = Array.from(byTech.values()).reduce((a, b) => a + b, 0);
  const hoursCharged = Math.round((lines ?? []).reduce((a, l) => a + (Number(l.hours_quoted) || 0), 0) * 10) / 10;
  return { hoursCharged, minutesUsed, byTech, running: ss.filter((s) => !s.ended_at) };
}

/**
 * An owner's or manager's move past a gate does everything the normal step does: to QC opens the round,
 * to Work builds the work order, to Wash and Ready leave the car where the advisor can act.
 */
export async function applyStageSideEffects(jobId: string, toStatus: string, actor: Actor, settings: Settings) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  if (toStatus === "pending_qc") {
    await openQcRound(jobId, actor.id, settings);
    await admin.from("jobs").update({ work_completed_at: now }).eq("id", jobId);
  } else if (toStatus === "in_work") {
    await ensureWorkLines(jobId, actor.id);
    await admin.from("jobs").update({ work_started_at: now, plan_released_at: now, plan_released_by: actor.id }).eq("id", jobId);
  } else if (toStatus === "pending_wash") {
    await admin.from("jobs").update({ wash_sent_at: null }).eq("id", jobId);
  } else if (toStatus === "ready") {
    await ensureProforma(jobId, { id: actor.id, display_name: actor.display_name }, settings).catch(() => null);
  }
}

/** Today's date in Dubai, for pause logs and summaries. */
export const todayDubai = () => dubaiDate();
