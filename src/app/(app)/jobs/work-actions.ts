"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentStaff, requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { dubaiDate, workingTimeOf } from "@/lib/jobs";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { ensurePartRequests, labourRateFor, logQuoteEvent, refreshQuoteTotals } from "@/lib/quote-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentDevice } from "@/lib/devices";
import { verifyPin } from "@/lib/pin";
import { ADDITIONAL_SELECT, sessionMinutes, type AdditionalWorkRow } from "@/lib/work-data";
import { activeTechnicians, finishMyPart, keepWorkingThroughBreak, leaveJob, managerConfirmWork, pauseWork, rejectPause, startWorking, workBudget, type Actor } from "@/lib/work-flow";

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/work`);
  revalidatePath(`/my-jobs/${jobId}`);
  revalidatePath("/my-jobs");
  revalidatePath("/dashboard");
  revalidatePath("/qc");
  revalidatePath("/pauses");
}

async function jobRow(jobId: string) {
  const { data } = await createAdminClient().from("jobs").select("id, job_number, status, stage, department, assigned_to, is_open, gated_in_by, customer_id, vehicle_id").eq("id", jobId).maybeSingle();
  return data;
}

async function advisorIds(jobId: string, gatedInBy: string | null) {
  const { data: appr } = await createAdminClient().from("approval_requests").select("sent_by").eq("job_id", jobId);
  return Array.from(new Set([gatedInBy, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
}

const actorOf = (s: { id: string; display_name: string; role_id: string }): Actor => ({ id: s.id, display_name: s.display_name, role_id: s.role_id });
const back = (path: string, r: { error?: string; message?: string }) => redirect(`${path}?${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? r.message ?? "Done.")}`);

/** "Working": the technician's clock starts on this car. */
export async function startWork(jobId: string) {
  const staff = await requirePermission("doWork");
  const r = await startWorking(jobId, actorOf(staff));
  refresh(jobId);
  back(`/my-jobs/${jobId}`, r);
}

/** "Pause" with one of the reasons. */
export async function pauseWorkAction(jobId: string, formData: FormData) {
  const staff = await requirePermission("doWork");
  const reason = blankToNull(formData.get("pause_reason")) ?? "";
  const r = await pauseWork(jobId, actorOf(staff), reason);
  refresh(jobId);
  back(`/my-jobs/${jobId}`, r);
}

/** "Leave this job" with a reason; the manager is told. */
export async function leaveJobAction(jobId: string, formData: FormData) {
  const staff = await requirePermission("doWork");
  const r = await leaveJob(jobId, actorOf(staff), blankToNull(formData.get("reason")) ?? "");
  refresh(jobId);
  if (r.error) back(`/my-jobs/${jobId}`, r);
  redirect(`/my-jobs?message=${encodeURIComponent(r.message ?? "You left the job.")}`);
}

/** "Job finished" (or "My part is done"): the clock stops and locks; the manager confirms. */
/** "Keep working" through the break: recorded, and the break counts on this session. */
export async function keepWorking(jobId: string) {
  const staff = await requirePermission("doWork");
  const r = await keepWorkingThroughBreak(jobId, actorOf(staff));
  refresh(jobId);
  back(`/my-jobs/${jobId}`, r);
}

export async function jobFinished(jobId: string, formData?: FormData) {
  const staff = await requirePermission("doWork");
  // On a personal device the PIN is the signature for "Job finished".
  const device = await getCurrentDevice();
  if (device?.kind === "personal" && staff.role_id === "technician") {
    const { data: priv } = await createAdminClient().from("staff_private").select("pin_hash").eq("staff_id", staff.id).maybeSingle();
    if (priv?.pin_hash && !verifyPin(String(formData?.get("pin") ?? ""), priv.pin_hash)) back(`/my-jobs/${jobId}`, { error: "Wrong PIN." });
  }
  const r = await finishMyPart(jobId, actorOf(staff));
  refresh(jobId);
  back(`/my-jobs/${jobId}`, r);
}

/** The technician flags additional work: a remark, the parts needed, photos. The manager gets a loud alert; the advisor quotes it. */
export async function reportAdditionalWork(jobId: string, formData: FormData) {
  const staff = await requirePermission("doWork");
  const back = `/my-jobs/${jobId}`;
  const remark = blankToNull(formData.get("remark"));
  const partsNeeded = blankToNull(formData.get("parts_needed"));
  const lineId = blankToNull(formData.get("work_line_id"));
  if (!remark || remark.length < 3) redirect(`${back}?error=${encodeURIComponent("Describe the additional work found.")}`);
  const admin = createAdminClient();
  const job = await jobRow(jobId);
  if (!job) redirect("/my-jobs");
  const { data: created } = await admin.from("additional_work").insert({ job_id: jobId, technician_id: staff.id, work_line_id: lineId, remark: remark.slice(0, 1000), parts_needed: partsNeeded?.slice(0, 500) ?? null, created_by: staff.id, updated_by: staff.id }).select("id").single();
  const ids = formData.getAll("file").map(String).filter(Boolean);
  if (created && ids.length) await admin.from("job_files").update({ ref_id: created.id }).in("id", ids);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "additional_work", note: `${staff.display_name} found additional work: ${remark}${partsNeeded ? ` (parts: ${partsNeeded})` : ""}`, created_by: staff.id });
  await notifyManagers(job.department ?? null, { type: "additional_work", title: `Additional work found · ${job.job_number}`, body: `${staff.display_name}: ${remark}. Open the work order to send it to the advisor or dismiss it.`, jobId, href: `/jobs/${jobId}/work` });
  refresh(jobId);
  redirect(`${back}?message=${encodeURIComponent("Sent to the workshop manager. Carry on with the original work.")}`);
}

/** The workshop manager sends the finding to the advisor to quote, or dismisses it. */
export async function decideAdditionalWork(id: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  const admin = createAdminClient();
  const { data: raw } = await admin.from("additional_work").select(ADDITIONAL_SELECT).eq("id", id).maybeSingle();
  if (!raw) redirect("/dashboard");
  const a = raw as AdditionalWorkRow;
  const back = `/jobs/${a.job_id}/work`;
  if (a.status !== "pending") redirect(back);
  const decision = String(formData.get("decision") ?? "");
  const note = blankToNull(formData.get("note"));
  const job = await jobRow(a.job_id);
  if (!job) redirect("/dashboard");
  if (decision !== "approve") {
    await admin.from("additional_work").update({ status: "rejected", decided_by: staff.id, decided_at: new Date().toISOString(), decision_note: note, updated_by: staff.id }).eq("id", id);
    await admin.from("job_events").insert({ job_id: a.job_id, event_type: "additional_work", note: `Additional work dismissed by ${staff.display_name}: ${a.remark}${note ? ` (${note})` : ""}`, created_by: staff.id });
    if (a.technician_id) await notifyStaff([a.technician_id], { type: "additional_work_decided", title: `Additional work not taken up · ${job.job_number}`, body: note ?? a.remark, jobId: a.job_id, href: `/my-jobs/${a.job_id}` });
    refresh(a.job_id);
    redirect(`${back}?message=${encodeURIComponent("Dismissed.")}`);
  }
  const settings = await getSettings();
  const { data: q, error } = await admin.from("quotations").insert({ kind: "quotation", job_id: a.job_id, customer_id: job.customer_id, vehicle_id: job.vehicle_id, validity_days: Number(settings.quote_validity_days) || 7, vat_percent: 5, created_by: job.gated_in_by, updated_by: staff.id }).select("id, number").single();
  if (error || !q) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Could not start the additional quotation.")}`);
  await admin.from("quotation_lines").insert({ quotation_id: q.id, position: 0, line_type: "labour", title: a.remark.slice(0, 200), details: note ?? "Found by the technician during the work", group_label: "Additional work", source_type: "manual", labour_rate: labourRateFor(settings, job.department), quantity: 1, created_by: staff.id, updated_by: staff.id });
  if (a.parts_needed) {
    await admin.from("part_requests").insert({ job_id: a.job_id, source_type: "manual", source_key: `additional:${a.id}`, label: a.parts_needed.slice(0, 120), requested_text: `Additional work: ${a.remark}`.slice(0, 300), created_by: staff.id, updated_by: staff.id });
    await notifyRoles(["parts"], { type: "parts_request", title: `Parts to price · ${job.job_number}`, body: `${a.parts_needed} (additional work)`, jobId: a.job_id, href: `/parts/${a.job_id}` });
  }
  await ensurePartRequests(a.job_id, staff.id);
  await refreshQuoteTotals(q.id, settings, staff.id);
  await admin.from("additional_work").update({ status: "approved", decided_by: staff.id, decided_at: new Date().toISOString(), decision_note: note, quotation_id: q.id, updated_by: staff.id }).eq("id", id);
  await logQuoteEvent(q.id, a.job_id, staff.id, "quote_started", `Additional quotation ${q.number} started from a finding approved by ${staff.display_name}`);
  const advisors = await advisorIds(a.job_id, job.gated_in_by);
  await notifyStaff(advisors, { type: "additional_work_decided", title: `Additional work to quote · ${job.job_number}`, body: `${a.remark}. Quotation ${q.number} is started: price it and send it. The work cannot start until the customer approves.`, jobId: a.job_id, href: `/jobs/${a.job_id}/quote/${q.id}` });
  if (a.technician_id) await notifyStaff([a.technician_id], { type: "additional_work_decided", title: `Additional work approved · ${job.job_number}`, body: "The advisor quotes it. Carry on with the original work; the extra work starts once the customer approves.", jobId: a.job_id, href: `/my-jobs/${a.job_id}` });
  refresh(a.job_id);
  redirect(`${back}?message=${encodeURIComponent(`Sent to the advisor. Quotation ${q.number} is started.`)}`);
}

/** The manager confirms the finished work: the car goes to QC. */
/**
 * The manager gives the technicians more (or less) time than the hours charged, with a reason. The
 * price and the hours on the quotation never change; the countdown and the job summary use the budget.
 */
export async function setTimeBudget(jobId: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  const admin = createAdminClient();
  const raw = String(formData.get("budget_hours") ?? "").trim().replace(",", ".");
  const hours = raw === "" ? null : Math.round(Number(raw) * 10) / 10;
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  const back = (m: string, ok: boolean) => redirect(`/jobs/${jobId}/work?${ok ? "message" : "error"}=${encodeURIComponent(m)}`);
  if (hours !== null && (!Number.isFinite(hours) || hours <= 0)) back("Enter the hours, for example 6.5.", false);
  if (reason.length < 3) back("Write the reason for the change; it goes on the job summary.", false);
  const { data: job } = await admin.from("jobs").select("job_number, budget_hours, is_open").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) back("This job is closed.", false);
  const budget = await workBudget(jobId);
  await admin.from("jobs").update({ budget_hours: hours, budget_reason: reason, budget_by: staff.id, budget_at: new Date().toISOString() }).eq("id", jobId);
  const text = hours === null ? `Time budget back to the ${budget.hoursCharged} h charged` : `Time budget set to ${hours} h (charged ${budget.hoursCharged} h)`;
  await admin.from("job_events").insert({ job_id: jobId, event_type: "budget", note: `${text} by ${staff.display_name}: ${reason}`, created_by: staff.id });
  const techs = await activeTechnicians(jobId);
  await notifyStaff(techs.map((t) => t.staff_id), { type: "work_assigned", title: `Time budget changed · ${job!.job_number}`, body: `${text}. ${reason}`, jobId, href: `/my-jobs/${jobId}` });
  revalidatePath(`/jobs/${jobId}/work`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/my-jobs/${jobId}`);
  back(`${text}.`, true);
}

export async function confirmWorkComplete(jobId: string) {
  const staff = await requirePermission("manageWork");
  const settings = await getSettings();
  const r = await managerConfirmWork(jobId, actorOf(staff), true, null, settings);
  refresh(jobId);
  if (r.error) back(`/jobs/${jobId}/work`, r);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent(r.message ?? "Confirmed. The car is with QC.")}`);
}

/** The manager sends the work back with a note; the technician sees it on top. */
export async function sendWorkBack(jobId: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  const settings = await getSettings();
  const r = await managerConfirmWork(jobId, actorOf(staff), false, blankToNull(formData.get("note")), settings);
  refresh(jobId);
  back(`/jobs/${jobId}/work`, r);
}

/** The manager marks a pause "Not accepted" (or accepts it again). */
export async function decidePause(pauseId: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  const admin = createAdminClient();
  const { data: p } = await admin.from("work_pauses").select("id, job_id").eq("id", pauseId).maybeSingle();
  if (!p) redirect("/pauses");
  const accepted = String(formData.get("accepted") ?? "") === "yes";
  const r = await rejectPause(pauseId, actorOf(staff), accepted);
  const to = blankToNull(formData.get("return_to")) ?? `/jobs/${p.job_id}/work`;
  refresh(p.job_id);
  back(to, r.error ? r : { message: accepted ? "Pause accepted." : "Pause marked not accepted." });
}

/** The advisor or the owner reminds the manager that a finished job waits for confirmation. */
export async function remindManagerToConfirm(jobId: string) {
  const staff = await requirePermission("sendApproval");
  const job = await jobRow(jobId);
  if (!job || job.status !== "in_work") redirect(`/jobs/${jobId}`);
  await notifyManagers(job.department ?? null, { type: "work_done", title: `Reminder: confirm the finished work · ${job.job_number}`, body: `${staff.display_name} is waiting. Confirm and send to QC, or send it back with a note.`, jobId, href: `/jobs/${jobId}/work` });
  await createAdminClient().from("job_events").insert({ job_id: jobId, event_type: "reminder", note: `${staff.display_name} reminded the workshop manager to confirm the finished work`, created_by: staff.id });
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent("Reminder sent.")}`);
}

/** Shift clock in: late minutes count from the opening hour. */
export async function clockIn() {
  const staff = await requirePermission("clockShift");
  const admin = createAdminClient();
  const settings = await getSettings();
  const wt = workingTimeOf(settings);
  const now = new Date();
  const dubaiMinutes = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", hour12: false }).format(now)) * 60 + Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", minute: "2-digit" }).format(now));
  const late = Math.max(0, dubaiMinutes - wt.openHour * 60);
  const { error } = await admin.from("shifts").insert({ staff_id: staff.id, shift_date: dubaiDate(now), clock_in: now.toISOString(), late_minutes: late, created_by: staff.id, updated_by: staff.id });
  revalidatePath("/my-jobs");
  revalidatePath("/attendance");
  redirect(`/my-jobs?message=${encodeURIComponent(error ? "You are already clocked in." : late ? `Clocked in, ${late} min after opening.` : "Clocked in. Have a good day.")}`);
}

export async function clockOut() {
  const staff = await requirePermission("clockShift");
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: open } = await admin.from("shifts").select("id").eq("staff_id", staff.id).is("clock_out", null).maybeSingle();
  if (open) await admin.from("shifts").update({ clock_out: now, updated_by: staff.id }).eq("id", open.id);
  // Any running job clock pauses with the shift.
  const { data: sessions } = await admin.from("work_sessions").select("id, job_id, started_at").eq("technician_id", staff.id).is("ended_at", null);
  for (const s of sessions ?? []) {
    await admin.from("work_sessions").update({ ended_at: now, end_reason: "auto", pause_reason: "End of shift", minutes: sessionMinutes({ started_at: s.started_at, ended_at: now, minutes: null }), updated_by: staff.id }).eq("id", s.id);
    await admin.from("work_pauses").insert({ job_id: s.job_id, technician_id: staff.id, reason: "End of shift", started_at: now, created_by: staff.id, updated_by: staff.id });
  }
  revalidatePath("/my-jobs");
  revalidatePath("/attendance");
  redirect(`/my-jobs?message=${encodeURIComponent(open ? "Clocked out." : "You were not clocked in.")}`);
}

/** The owner may act on the tablet screens as a technician would; nobody else outside the role. */
export async function canActAsTechnician() {
  const staff = await getCurrentStaff();
  if (!staff) return false;
  const role = staff.role_id as RoleId;
  return can(role, "doWork") && !staff.viewingAs;
}
