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
import { ADDITIONAL_SELECT, PAUSE_REASONS, WORK_LINE_SELECT, buildQcItems, latestQc, sessionMinutes, type AdditionalWorkRow, type WorkLineRow } from "@/lib/work-data";

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/work`);
  revalidatePath(`/my-jobs/${jobId}`);
  revalidatePath("/my-jobs");
  revalidatePath("/dashboard");
  revalidatePath("/qc");
}

async function jobRow(jobId: string) {
  const { data } = await createAdminClient().from("jobs").select("id, job_number, status, stage, department, assigned_to, is_open, gated_in_by, customer_id, vehicle_id").eq("id", jobId).maybeSingle();
  return data;
}

async function advisorIds(jobId: string, gatedInBy: string | null) {
  const { data: appr } = await createAdminClient().from("approval_requests").select("sent_by").eq("job_id", jobId);
  return Array.from(new Set([gatedInBy, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
}

/** The workshop manager assigns the work order, or single lines, to technicians. */
export async function assignWorkLines(jobId: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  const back = `/jobs/${jobId}/work`;
  const admin = createAdminClient();
  const job = await jobRow(jobId);
  if (!job || !job.is_open) redirect(`${back}?error=${encodeURIComponent("This job is closed.")}`);
  const { data: lineRows } = await admin.from("work_lines").select(WORK_LINE_SELECT).eq("job_id", jobId).eq("is_active", true);
  const lines = (lineRows ?? []) as WorkLineRow[];
  const all = String(formData.get("assign_all") ?? "");
  const { data: techs } = await admin.from("staff").select("id, display_name").eq("role_id", "technician").eq("is_active", true);
  const techOf = new Map((techs ?? []).map((t) => [t.id, t.display_name]));
  const changed = new Map<string, string[]>();
  for (const l of lines) {
    const who = all || String(formData.get(`assign__${l.id}`) ?? "");
    if (!who || !techOf.has(who) || who === l.assigned_to) continue;
    await admin.from("work_lines").update({ assigned_to: who, updated_by: staff.id }).eq("id", l.id);
    changed.set(who, [...(changed.get(who) ?? []), l.title]);
  }
  if (!changed.size) redirect(`${back}?error=${encodeURIComponent("Choose a technician for at least one line.")}`);
  const first = Array.from(changed.keys())[0];
  if (!job.assigned_to || all) await admin.from("jobs").update({ assigned_to: first, assigned_at: new Date().toISOString() }).eq("id", jobId);
  for (const [who, titles] of changed) {
    await admin.from("job_events").insert({ job_id: jobId, event_type: "work_assigned", to_staff: who, note: `${titles.length} work line${titles.length === 1 ? "" : "s"} assigned to ${techOf.get(who)} by ${staff.display_name}`, created_by: staff.id });
    await notifyStaff([who], { type: "work_assigned", title: `Work for you · ${job.job_number}`, body: titles.join(" · "), jobId, href: `/my-jobs/${jobId}` });
  }
  refresh(jobId);
  redirect(`${back}?message=${encodeURIComponent("Assigned. The technician has the work order on the tablet.")}`);
}

/** The technician starts the clock on a job. One active job at a time: any other open session closes. */
export async function startWork(jobId: string) {
  const staff = await requirePermission("doWork");
  const back = `/my-jobs/${jobId}`;
  const admin = createAdminClient();
  const job = await jobRow(jobId);
  if (!job || !job.is_open || job.status !== "in_work") redirect(`${back}?error=${encodeURIComponent("This car is not in Work.")}`);
  const now = new Date().toISOString();
  const { data: open } = await admin.from("work_sessions").select("id, job_id, started_at").eq("technician_id", staff.id).is("ended_at", null);
  for (const s of open ?? []) {
    const minutes = sessionMinutes({ started_at: s.started_at, ended_at: now, minutes: null });
    await admin.from("work_sessions").update({ ended_at: now, end_reason: "auto", minutes, updated_by: staff.id }).eq("id", s.id);
    await admin.from("job_events").insert({ job_id: s.job_id, event_type: "work_clock", note: `${staff.display_name} stopped (switched to another car) after ${minutes} min`, created_by: staff.id });
  }
  await admin.from("work_sessions").insert({ job_id: jobId, technician_id: staff.id, started_at: now, created_by: staff.id, updated_by: staff.id });
  await admin.from("work_lines").update({ status: "in_progress", updated_by: staff.id }).eq("job_id", jobId).eq("assigned_to", staff.id).eq("status", "todo");
  if (!job.assigned_to) await admin.from("jobs").update({ assigned_to: staff.id }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "work_clock", note: `${staff.display_name} started work`, created_by: staff.id });
  refresh(jobId);
  redirect(`${back}?message=${encodeURIComponent("Clock started.")}`);
}

/** Stop or pause the clock; a pause needs a reason. */
export async function stopWork(jobId: string, formData: FormData) {
  const staff = await requirePermission("doWork");
  const back = `/my-jobs/${jobId}`;
  const admin = createAdminClient();
  const mode = String(formData.get("mode") ?? "stop") === "pause" ? "pause" : "stop";
  const reason = blankToNull(formData.get("pause_reason"));
  if (mode === "pause" && !reason) redirect(`${back}?error=${encodeURIComponent("Choose the reason for the pause.")}`);
  if (mode === "pause" && reason && !PAUSE_REASONS.includes(reason as (typeof PAUSE_REASONS)[number]) && reason.length < 3) redirect(`${back}?error=${encodeURIComponent("Say why you pause.")}`);
  const { data: open } = await admin.from("work_sessions").select("id, started_at").eq("technician_id", staff.id).eq("job_id", jobId).is("ended_at", null).maybeSingle();
  if (!open) redirect(`${back}?error=${encodeURIComponent("The clock is not running on this car.")}`);
  const now = new Date().toISOString();
  const minutes = sessionMinutes({ started_at: open.started_at, ended_at: now, minutes: null });
  await admin.from("work_sessions").update({ ended_at: now, end_reason: mode, pause_reason: mode === "pause" ? reason : null, minutes, updated_by: staff.id }).eq("id", open.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "work_clock", note: `${staff.display_name} ${mode === "pause" ? `paused: ${reason}` : "stopped"} after ${minutes} min`, created_by: staff.id });
  refresh(jobId);
  redirect(`${back}?message=${encodeURIComponent(mode === "pause" ? "Paused." : "Clock stopped.")}`);
}

/** A line marked done (or back to open), with notes. */
export async function setLineDone(lineId: string, formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) redirect("/my-jobs");
  const role = staff.role_id as RoleId;
  if (!can(role, "doWork") && !can(role, "manageWork")) redirect("/my-jobs");
  const admin = createAdminClient();
  const { data: line } = await admin.from("work_lines").select(WORK_LINE_SELECT).eq("id", lineId).maybeSingle();
  if (!line) redirect("/my-jobs");
  const l = line as WorkLineRow;
  const back = role === "technician" ? `/my-jobs/${l.job_id}` : `/jobs/${l.job_id}/work`;
  if (role === "technician" && l.assigned_to && l.assigned_to !== staff.id) redirect(`${back}?error=${encodeURIComponent("This line is assigned to someone else.")}`);
  const done = String(formData.get("done") ?? "") === "yes";
  const notes = formData.has("notes") ? blankToNull(formData.get("notes")) : l.notes;
  await admin.from("work_lines").update({ status: done ? "done" : "in_progress", done_at: done ? new Date().toISOString() : null, done_by: done ? staff.id : null, notes, updated_by: staff.id }).eq("id", lineId);
  await admin.from("job_events").insert({ job_id: l.job_id, event_type: "work_line", note: `${l.title}: ${done ? "done" : "reopened"} by ${staff.display_name}${notes ? ` · ${notes}` : ""}`, created_by: staff.id });
  refresh(l.job_id);
  redirect(`${back}?message=${encodeURIComponent(done ? `${l.title}: done.` : `${l.title}: reopened.`)}`);
}

/** The technician flags additional work: a remark, the parts needed, photos. The manager approves it, the advisor quotes it. */
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
  // Photos uploaded before the form was sent carry the job only; tie them to the finding now.
  const ids = formData.getAll("file").map(String).filter(Boolean);
  if (created && ids.length) await admin.from("job_files").update({ ref_id: created.id }).in("id", ids);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "additional_work", note: `${staff.display_name} found additional work: ${remark}${partsNeeded ? ` (parts: ${partsNeeded})` : ""}`, created_by: staff.id });
  await notifyManagers(job.department ?? null, { type: "additional_work", title: `Additional work found · ${job.job_number}`, body: `${staff.display_name}: ${remark}`, jobId, href: `/jobs/${jobId}/work` });
  refresh(jobId);
  redirect(`${back}?message=${encodeURIComponent("Sent to the workshop manager. The original work continues.")}`);
}

/** The workshop manager approves the finding (it becomes an additional quotation for the advisor) or refuses it. */
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
    await admin.from("job_events").insert({ job_id: a.job_id, event_type: "additional_work", note: `Additional work refused by ${staff.display_name}: ${a.remark}${note ? ` (${note})` : ""}`, created_by: staff.id });
    if (a.technician_id) await notifyStaff([a.technician_id], { type: "additional_work_decided", title: `Additional work not approved · ${job.job_number}`, body: note ?? a.remark, jobId: a.job_id, href: `/my-jobs/${a.job_id}` });
    refresh(a.job_id);
    redirect(`${back}?message=${encodeURIComponent("Refused.")}`);
  }
  // An additional quotation through the normal flow: a labour line with the finding, parts requests for Parts.
  const settings = await getSettings();
  const { data: q, error } = await admin.from("quotations").insert({ kind: "quotation", job_id: a.job_id, customer_id: job.customer_id, vehicle_id: job.vehicle_id, validity_days: Number(settings.quote_validity_days) || 7, vat_percent: 5, created_by: job.gated_in_by, updated_by: staff.id }).select("id, number").single();
  if (error || !q) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Could not start the additional quotation.")}`);
  await admin.from("quotation_lines").insert({ quotation_id: q.id, position: 0, line_type: "labour", title: a.remark.slice(0, 200), details: note ?? `Found by ${staff.display_name === "" ? "the technician" : "the technician"} during the work`, group_label: "Additional work", source_type: "manual", labour_rate: labourRateFor(settings, job.department), quantity: 1, created_by: staff.id, updated_by: staff.id });
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
  redirect(`${back}?message=${encodeURIComponent(`Approved. Quotation ${q.number} is with the advisor.`)}`);
}

/** The workshop manager confirms the work complete: every line done, every issued part confirmed; the car moves to QC. */
export async function confirmWorkComplete(jobId: string) {
  const staff = await requirePermission("manageWork");
  const back = `/jobs/${jobId}/work`;
  const admin = createAdminClient();
  const job = await jobRow(jobId);
  if (!job || !job.is_open || job.status !== "in_work") redirect(`${back}?error=${encodeURIComponent("This car is not in Work.")}`);
  const [{ data: lines }, { data: parts }, { data: open }, { data: additional }] = await Promise.all([
    admin.from("work_lines").select("id, title, status").eq("job_id", jobId).eq("is_active", true),
    admin.from("part_items").select("id, description, issue_status, return_status").eq("job_id", jobId).eq("is_active", true).neq("order_status", "none"),
    admin.from("work_sessions").select("id, technician_id, started_at").eq("job_id", jobId).is("ended_at", null),
    admin.from("additional_work").select("id, remark").eq("job_id", jobId).eq("status", "pending").eq("is_active", true),
  ]);
  const undone = (lines ?? []).filter((l) => l.status !== "done");
  if (undone.length) redirect(`${back}?error=${encodeURIComponent(`Not possible: ${undone.length} line${undone.length === 1 ? " is" : "s are"} not done (${undone.map((l) => l.title).join(", ")}).`)}`);
  const unconfirmed = (parts ?? []).filter((p) => p.return_status === "none" && p.issue_status !== "confirmed");
  if (unconfirmed.length) redirect(`${back}?error=${encodeURIComponent(`Not possible: ${unconfirmed.length} issued part${unconfirmed.length === 1 ? " is" : "s are"} not confirmed by the technician (${unconfirmed.map((p) => p.description).join(", ")}).`)}`);
  if ((additional ?? []).length) redirect(`${back}?error=${encodeURIComponent("Decide the pending additional work first.")}`);
  const now = new Date().toISOString();
  for (const s of open ?? []) await admin.from("work_sessions").update({ ended_at: now, end_reason: "complete", minutes: sessionMinutes({ started_at: s.started_at, ended_at: now, minutes: null }), updated_by: staff.id }).eq("id", s.id);
  const settings = await getSettings();
  const previous = await latestQc(jobId);
  const round = (previous?.round ?? 0) + 1;
  const items = await buildQcItems(jobId, settings, previous);
  await admin.from("qc_checks").insert({ job_id: jobId, round, status: "open", items, created_by: staff.id, updated_by: staff.id });
  await admin.from("jobs").update({ status: "pending_qc", stage: "qc", stage_entered_at: now, work_completed_at: now, qc_round: round }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: "in_work", to_status: "pending_qc", note: `Work confirmed complete by ${staff.display_name}${round > 1 ? ` (QC round ${round})` : ""}`, created_by: staff.id });
  await notifyRoles(["qc_inspector"], { type: "work_complete", title: `Car for QC · ${job.job_number}`, body: round > 1 ? `Rework done. Recheck the ${items.length} failed item${items.length === 1 ? "" : "s"}.` : `${items.length} checks. Record the mileage and attach the post-scan.`, jobId, href: `/qc/${jobId}` });
  const advisors = await advisorIds(jobId, job.gated_in_by);
  await notifyStaff(advisors, { type: "work_complete", title: `Work complete, in QC · ${job.job_number}`, body: `Confirmed by ${staff.display_name}.`, jobId, href: `/jobs/${jobId}` });
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent("Work complete. The car is with QC.")}`);
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
  // Any running job clock stops with the shift.
  const { data: sessions } = await admin.from("work_sessions").select("id, job_id, started_at").eq("technician_id", staff.id).is("ended_at", null);
  for (const s of sessions ?? []) await admin.from("work_sessions").update({ ended_at: now, end_reason: "auto", minutes: sessionMinutes({ started_at: s.started_at, ended_at: now, minutes: null }), updated_by: staff.id }).eq("id", s.id);
  revalidatePath("/my-jobs");
  revalidatePath("/attendance");
  redirect(`/my-jobs?message=${encodeURIComponent(open ? "Clocked out." : "You were not clocked in.")}`);
}
