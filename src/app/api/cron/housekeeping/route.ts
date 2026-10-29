import { NextResponse, type NextRequest } from "next/server";
import { checkLateJobs, recordJobRun } from "@/lib/background-jobs";
import { jobAdvisorIds as advisorsInCharge } from "@/lib/notifications";
import { recalcTripKm } from "@/lib/delivery";
import { aftercareHourly } from "@/lib/aftercare";
import { depositState } from "@/lib/deposits";
import { notifyLowStock } from "@/lib/stock";
import { bodyshopHourly } from "@/lib/bodyshop";
import { GATE_IN_BUCKET } from "@/lib/media";
import { addDays, dayStartIso, dubaiTimeOf } from "@/lib/calendar";
import { dubaiDate, workingMinutesSince, workingTimeOf } from "@/lib/jobs";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { formatDateTime } from "@/lib/format";
import { formatPlate } from "@/lib/types";
import { workingHoursBetween } from "@/lib/working-time";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { autoPauseBreaks, autoPauseEndOfShift } from "@/lib/work-flow";
import { monthKey, monthLabel, monthlySummary, shiftMonth } from "@/lib/owner-report";
import { loadDocAlerts } from "@/lib/doc-reminders-data";
import { depositsWaiting } from "@/lib/deposits";

/**
 * Runs every hour (Vercel cron). Two jobs:
 * 1. Delete gate-in videos older than the retention setting (photos are kept).
 * 2. Remind advisors about approval links not opened within the set hours.
 * 3. From 8:00 Dubai time, tell advisors about tomorrow's appointments so they send the WhatsApp reminder.
 * Protected by CRON_SECRET, which Vercel sends automatically.
 */
export const dynamic = "force-dynamic";
// The first run after 23 October 2026 catches up on everything due since the scheduler's calls stopped bouncing.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  // Every run is recorded for Settings > Background jobs (23 October 2026), good or bad.
  try {
    const report = await runHousekeeping();
    await recordJobRun("housekeeping", true, housekeepingWords(report));
    await checkLateJobs(true).catch(() => null);
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordJobRun("housekeeping", false, `Stopped with an error: ${message}`).catch(() => null);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** "3 approval reminders · 1 quotation expired", or "Nothing due". */
function housekeepingWords(report: Record<string, number>): string {
  // Plain words for every count the run reports: [one, more than one].
  const words: Record<string, [string, string]> = {
    videosDeleted: ["old video removed", "old videos removed"], remindersSent: ["approval reminder", "approval reminders"], appointmentReminders: ["booking reminder", "booking reminders"],
    inspectionWarnings: ["inspection warning", "inspection warnings"], assignmentWarnings: ["assignment warning", "assignment warnings"], quotesExpired: ["quotation expired", "quotations expired"],
    estimateFollowUps: ["estimate follow-up", "estimate follow-ups"], followUps: ["gate-out follow-up", "gate-out follow-ups"], partsLate: ["late part", "late parts"], partsDelayed: ["delayed part", "delayed parts"],
    partsNoHome: ["part with no home", "parts with no home"], clocksPaused: ["clock paused at end of shift", "clocks paused at end of shift"], clocksOvernight: ["clock left overnight", "clocks left overnight"],
    breaksPaused: ["clock paused for a break", "clocks paused for a break"], planningReminders: ["planning reminder", "planning reminders"], docReminders: ["document-not-sent reminder", "document-not-sent reminders"],
    paymentWaiting: ["proforma waiting for payment", "proformas waiting for payment"], depositOverdue: ["deposit overdue", "deposits overdue"], deliveryWaiting: ["delivery reminder", "delivery reminders"],
    kmRecalc: ["trip distance checked", "trip distances checked"], kmFound: ["trip distance found", "trip distances found"], aftercareReminded: ["after-care reminder", "after-care reminders"],
    aftercareOverdue: ["after-care check overdue", "after-care checks overdue"], redTaskBells: ["red task bell", "red task bells"], orderNowOverdue: ["LPO to order", "LPOs to order"],
    invoiceMissingReminders: ["missing supplier invoice reminder", "missing supplier invoice reminders"], stockLow: ["low stock alert", "low stock alerts"], stockCount: ["monthly stock count request", "monthly stock count requests"],
    bodyshopLate: ["late bodyshop stage", "late bodyshop stages"], bodyshopDueOut: ["bodyshop car due out tomorrow", "bodyshop cars due out tomorrow"], monthlySummary: ["monthly summary sent", "monthly summaries sent"],
  };
  const parts = Object.entries(report)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${words[k] ? words[k][n === 1 ? 0 : 1] : k}`);
  return parts.length ? parts.slice(0, 6).join(" · ") : "Nothing due";
}

async function runHousekeeping(): Promise<Record<string, number>> {
  const admin = createAdminClient();
  const settings = await getSettings();
  const report: Record<string, number> = { videosDeleted: 0, remindersSent: 0, appointmentReminders: 0, inspectionWarnings: 0, assignmentWarnings: 0, quotesExpired: 0, estimateFollowUps: 0 };

  // 1. Video retention
  const months = Number(settings.video_retention_months) || 12;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const { data: oldVideos } = await admin
    .from("gate_in_media")
    .select("id, storage_path")
    .in("kind", ["video", "video_exterior", "video_interior"])
    .lt("taken_at", cutoff.toISOString())
    .is("caption", null)
    .limit(200);
  if (oldVideos?.length) {
    const paths = oldVideos.map((v) => v.storage_path);
    const { error } = await admin.storage.from(GATE_IN_BUCKET).remove(paths);
    if (!error) {
      // The row stays (nothing is deleted from the record); the caption notes the file is gone.
      await admin.from("gate_in_media").update({ caption: `Video deleted after ${months} months` }).in("id", oldVideos.map((v) => v.id));
      report.videosDeleted = paths.length;
    }
  }

  // 2. Approval reminders
  const hours = Number(settings.approval_reminder_hours) || 4;
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { data: stale } = await admin
    .from("approval_requests")
    .select("id, job_id, sent_by, sent_to_name, sent_to_phone, sent_at, job:jobs(job_number, is_open, gated_in_by)")
    .eq("status", "sent")
    .is("opened_at", null)
    .is("reminded_at", null)
    .lt("sent_at", since)
    .limit(100);
  for (const r of stale ?? []) {
    const job = r.job as unknown as { job_number: string; is_open: boolean; gated_in_by: string | null } | null;
    if (!job?.is_open) continue;
    // The person who sent the link (owner or advisor): never the gate-in person, who may not see customers (29 October 2026).
    await notifyStaff([r.sent_by].filter((x): x is string => !!x), {
      type: "approval_reminder",
      title: `Approval link not opened for ${hours} hours`,
      body: `${job.job_number} · sent to ${r.sent_to_name ?? r.sent_to_phone}. Consider calling the customer.`,
      jobId: r.job_id,
      href: `/jobs/${r.job_id}`,
    });
    await admin.from("approval_requests").update({ reminded_at: new Date().toISOString() }).eq("id", r.id);
    report.remindersSent++;
  }

  // 3. Booking reminders for the assigned person (hourly, so "an hour before" means within the next hour).
  const nowIso = new Date().toISOString();
  const dubaiHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", hour12: false }).format(new Date()));
  const tomorrow = addDays(dubaiDate(), 1);
  const apptSelect = "id, kind, reason, starts_at, advisor_id, customer:customers(full_name, company_name)";
  type Appt = { id: string; kind: string; reason: string; starts_at: string; advisor_id: string | null; customer: { full_name: string; company_name: string | null } | null };
  const who = (a: Appt) => a.customer?.company_name ?? a.customer?.full_name ?? "customer";
  const tell = async (a: Appt, type: string, title: string) => {
    const n = { type, title, body: a.reason, href: `/calendar/${a.id}` };
    if (a.advisor_id) await notifyStaff([a.advisor_id], n);
    else await notifyRoles(["service_advisor", "owner"], n);
  };

  // 3a. The day before, from opening time.
  if (dubaiHour >= (Number(settings.opening_hour) || 8)) {
    const { data } = await admin.from("appointments").select(apptSelect).eq("is_active", true).eq("status", "booked").is("reminder_notified_at", null).gte("starts_at", dayStartIso(tomorrow)).lt("starts_at", dayStartIso(addDays(tomorrow, 1))).limit(100);
    for (const a of (data ?? []) as unknown as Appt[]) {
      await tell(a, "appointment_reminder", `Tomorrow ${dubaiTimeOf(a.starts_at)}: ${who(a)}. Send the customer reminder.`);
      await admin.from("appointments").update({ reminder_notified_at: nowIso }).eq("id", a.id);
      report.appointmentReminders++;
    }
  }
  // 3b. The evening before, for cars we collect, so the recovery can be arranged.
  if (dubaiHour >= (Number(settings.appointment_evening_reminder_hour) || 18)) {
    const { data } = await admin.from("appointments").select(apptSelect).eq("is_active", true).eq("status", "booked").eq("kind", "we_collect").is("notified_evening_before_at", null).gte("starts_at", dayStartIso(tomorrow)).lt("starts_at", dayStartIso(addDays(tomorrow, 1))).limit(100);
    for (const a of (data ?? []) as unknown as Appt[]) {
      await tell(a, "appointment_reminder", `Collection tomorrow ${dubaiTimeOf(a.starts_at)}: ${who(a)}. Arrange the recovery.`);
      await admin.from("appointments").update({ notified_evening_before_at: nowIso }).eq("id", a.id);
      report.appointmentReminders++;
    }
  }
  // 3c. Shortly before the booking.
  const hoursBefore = Number(settings.appointment_reminder_hours_before) || 1;
  {
    const until = new Date(Date.now() + hoursBefore * 3600000).toISOString();
    const { data } = await admin.from("appointments").select(apptSelect).eq("is_active", true).eq("status", "booked").is("notified_hour_before_at", null).gt("starts_at", nowIso).lte("starts_at", until).limit(100);
    for (const a of (data ?? []) as unknown as Appt[]) {
      await tell(a, "appointment_reminder", `At ${dubaiTimeOf(a.starts_at)}: ${who(a)}`);
      await admin.from("appointments").update({ notified_hour_before_at: nowIso }).eq("id", a.id);
      report.appointmentReminders++;
    }
  }
  // 3d. Time passed with nothing recorded.
  const graceMinutes = Number(settings.appointment_missed_after_minutes) || 30;
  {
    const cutoff = new Date(Date.now() - graceMinutes * 60000).toISOString();
    const { data } = await admin.from("appointments").select(apptSelect).eq("is_active", true).eq("status", "booked").is("missed_notified_at", null).lt("starts_at", cutoff).limit(100);
    for (const a of (data ?? []) as unknown as Appt[]) {
      const label = a.kind === "we_collect" || a.kind === "customer_collects" ? "Not collected" : "Not arrived";
      await tell(a, "appointment_missed", `${label}: ${who(a)} at ${dubaiTimeOf(a.starts_at)}`);
      await admin.from("appointments").update({ missed_notified_at: nowIso }).eq("id", a.id);
      report.appointmentReminders++;
    }
  }

  // 4. Inspections over their target: warn the department's manager and the owner once.
  {
    const wt = workingTimeOf(settings);
    const { data: open } = await admin.from("inspections").select("id, job_id, started_at, target_minutes, technician_id, job:jobs(job_number, department)").eq("status", "in_progress").is("overdue_warned_at", null).not("started_at", "is", null).limit(100);
    for (const i of open ?? []) {
      const target = i.target_minutes ?? (Number(settings.inspection_target_minutes) || 90);
      const minutes = Math.round(workingHoursBetween(i.started_at as string, new Date(), wt) * 60);
      if (minutes <= target) continue;
      const job = i.job as unknown as { job_number: string; department: string | null } | null;
      const n = { type: "inspection_overdue", title: `Inspection taking too long · ${job?.job_number ?? ""}`, body: `${minutes} min of working time against a target of ${target} min.`, jobId: i.job_id as string, href: `/jobs/${i.job_id}/inspection` };
      await notifyManagers(job?.department ?? null, n);
      await notifyRoles(["owner"], n);
      await admin.from("inspections").update({ overdue_warned_at: new Date().toISOString() }).eq("id", i.id);
      report.inspectionWarnings++;
    }
  }

  // 5. Cars waiting for a technician past the assignment target: tell the owner once.
  {
    const wt = workingTimeOf(settings);
    const target = Number(settings.assignment_target_minutes) || 30;
    const { data: waiting } = await admin.from("jobs").select("id, job_number, first_approval_at, stage_entered_at, department").eq("is_open", true).eq("status", "pending_inspection").is("assigned_to", null).is("assignment_overdue_notified_at", null).limit(100);
    for (const j of waiting ?? []) {
      const minutes = Math.round(workingHoursBetween((j.first_approval_at ?? j.stage_entered_at) as string, new Date(), wt) * 60);
      if (minutes <= target) continue;
      await notifyRoles(["owner"], { type: "assignment_overdue", title: `Still not assigned · ${j.job_number}`, body: `${minutes} working minutes since the customer approved, against a target of ${target}. The ${j.department === "bodyshop" ? "bodyshop" : "workshop"} manager has not assigned a technician.`, jobId: j.id as string, href: `/jobs/${j.id}` });
      await notifyManagers(j.department ?? null, { type: "assignment_overdue", title: `Car waiting for a technician · ${j.job_number}`, body: `${minutes} working minutes since the customer approved, against a target of ${target}. Assign a technician.`, jobId: j.id as string, href: "/assign" });
      await admin.from("jobs").update({ assignment_overdue_notified_at: new Date().toISOString() }).eq("id", j.id);
      report.assignmentWarnings++;
    }
  }

  // 6. Quotations and estimates past their validity: mark expired and tell the advisor once.
  {
    const { data: stale } = await admin.from("quotations").select("id, number, kind, job_id, created_by, sent_by").in("status", ["sent", "opened"]).lt("valid_until", new Date().toISOString()).limit(100);
    for (const q of stale ?? []) {
      await admin.from("quotations").update({ status: "expired" }).eq("id", q.id);
      await admin.from("quotation_events").insert({ quotation_id: q.id, job_id: q.job_id, event_type: "quote_expired", note: `${q.number} expired without a reply` });
      await notifyStaff([q.created_by, q.sent_by].filter((x): x is string => !!x), { type: "quote_expired", title: `${q.kind === "estimate" ? "Estimate" : "Quotation"} expired · ${q.number}`, body: "No reply from the customer. Re-send it or revise it.", jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}` : `/estimates/${q.id}` });
      report.quotesExpired++;
    }
  }
  // 7. Estimates with no reply: remind the advisor once after the set number of days.
  {
    const days = Number(settings.estimate_followup_days) || 2;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const { data: quiet } = await admin.from("quotations").select("id, number, created_by, sent_by").eq("kind", "estimate").in("status", ["sent", "opened"]).is("reminded_at", null).lt("sent_at", cutoff).limit(100);
    for (const q of quiet ?? []) {
      await notifyStaff([q.created_by, q.sent_by].filter((x): x is string => !!x), { type: "estimate_followup", title: `Follow up the estimate · ${q.number}`, body: `No reply for ${days} day${days === 1 ? "" : "s"}. Call the customer.`, href: `/estimates/${q.id}` });
      await admin.from("quotations").update({ reminded_at: new Date().toISOString() }).eq("id", q.id);
      report.estimateFollowUps++;
    }
  }

  // 8. Follow-up after gate-out: remind the advisor once on the due day.
  {
    const today = dubaiDate();
    const { data: due } = await admin.from("jobs").select("id, job_number, gated_in_by, gated_out_by").eq("is_open", false).lte("followup_due_at", today).is("followup_done_at", null).is("followup_notified_at", null).limit(100);
    for (const j of due ?? []) {
      await notifyStaff([j.gated_in_by, j.gated_out_by].filter((x): x is string => !!x), { type: "gate_out_followup", title: `Follow-up call due · ${j.job_number}`, body: "Ask the customer how the car is. Mark it done on the job card.", jobId: j.id as string, href: `/jobs/${j.id}` });
      await admin.from("jobs").update({ followup_notified_at: new Date().toISOString() }).eq("id", j.id);
      report.followUps = (report.followUps ?? 0) + 1;
    }
  }
  // 9. Parts past their expected date: tell Parts on the first late day.
  {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const { data: late } = await admin.from("part_items").select("id, description, job_id, job:jobs(job_number)").eq("is_active", true).in("order_status", ["ordered", "partly_received"]).eq("expected_date", yesterday).limit(100);
    for (const p of late ?? []) {
      const job = p.job as unknown as { job_number: string } | null;
      await notifyRoles(["parts"], { type: "parts_late", title: `Part late · ${job?.job_number ?? ""}`, body: `${p.description} was expected ${yesterday}. Chase the supplier.`, jobId: p.job_id as string, href: "/parts/orders" });
      report.partsLate = (report.partsLate ?? 0) + 1;
    }
  }

  // 10. The job clocks pause themselves at the end of the shift.
  report.clocksPaused = await autoPauseEndOfShift(settings);
  report.breaksPaused = await autoPauseBreaks(settings);

  // 10b. The next morning (the first run after opening): "Clock left running overnight: [car], [person]" to the manager, once per clock.
  {
    const hourNow = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", hour12: false }).format(new Date()));
    if (hourNow === (Number(settings.opening_hour) || 8)) {
      const since = new Date(Date.now() - 20 * 3600000).toISOString();
      const carOf = (j: { job_number: string; vehicle?: { make?: { name: string } | null; model?: { name: string } | null } | null } | null) => j ? [j.job_number, [j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : "";
      const { data: ws } = await admin.from("work_sessions").select("id, job_id, technician_id, tech:staff!work_sessions_technician_id_fkey(display_name), job:jobs(job_number, department, vehicle:vehicles(make:vehicle_makes(name), model:vehicle_models(name)))").eq("end_reason", "auto").eq("pause_reason", "End of shift").gte("ended_at", since).is("overnight_notified_at", null);
      for (const s of ws ?? []) {
        const job = s.job as unknown as { job_number: string; department: string | null; vehicle?: { make?: { name: string } | null; model?: { name: string } | null } | null } | null;
        const who = (s.tech as unknown as { display_name: string } | null)?.display_name ?? "a technician";
        await notifyManagers(job?.department ?? null, { type: "clock_overnight", title: `Clock left running overnight: ${carOf(job)}, ${who}`, body: "The clock stopped counting at closing time; the minutes after hours are not charged.", jobId: s.job_id as string, href: `/jobs/${s.job_id}/work` });
        await admin.from("work_sessions").update({ overnight_notified_at: new Date().toISOString() }).eq("id", s.id);
        report.clocksOvernight = (report.clocksOvernight ?? 0) + 1;
      }
      const { data: bs } = await admin.from("bodyshop_clockings").select("id, job_id, staff_id, person:staff!bodyshop_clockings_staff_id_fkey(display_name), job:jobs(job_number, department, vehicle:vehicles(make:vehicle_makes(name), model:vehicle_models(name)))").eq("closed_reason", "end_of_shift").gte("ended_at", since).is("overnight_notified_at", null);
      for (const c of bs ?? []) {
        const job = c.job as unknown as { job_number: string; department: string | null; vehicle?: { make?: { name: string } | null; model?: { name: string } | null } | null } | null;
        const who = (c.person as unknown as { display_name: string } | null)?.display_name ?? "someone";
        await notifyManagers("bodyshop", { type: "clock_overnight", title: `Clock left running overnight: ${carOf(job)}, ${who}`, body: "The clock stopped counting at closing time; the minutes after hours are not charged.", jobId: c.job_id as string, href: `/bodyshop/${c.job_id}` });
        await admin.from("bodyshop_clockings").update({ overnight_notified_at: new Date().toISOString() }).eq("id", c.id);
        report.clocksOvernight = (report.clocksOvernight ?? 0) + 1;
      }
    }
  }

  // 11. Planning that waits too long on one person: a reminder every working day.
  {
    const { data: stuck } = await admin.from("jobs").select("id, job_number, status, department, gated_in_by, plan_parts_done_at, plan_released_at, plan_date_confirmed_at, stage_entered_at, plan_reminded_at").eq("is_open", true).in("status", ["approved", "waiting_parts"]).limit(100);
    const dayAgo = Date.now() - 86400000;
    for (const j of stuck ?? []) {
      if (j.plan_reminded_at && Date.parse(j.plan_reminded_at) > dayAgo) continue;
      const since = Date.parse(j.plan_released_at ?? j.plan_parts_done_at ?? j.stage_entered_at);
      if (since > dayAgo) continue;
      const n = { type: "planning", title: `Planning waits on you · ${j.job_number}`, body: "The car has waited a day in planning.", jobId: j.id as string, href: `/jobs/${j.id}#planning` };
      if (!j.plan_parts_done_at) await notifyRoles(["parts"], { ...n, href: `/parts/${j.id}` });
      else if (!j.plan_released_at) await notifyManagers(j.department ?? null, n);
      else if (!j.plan_date_confirmed_at) await notifyStaff([j.gated_in_by].filter((x): x is string => !!x), n);
      else continue;
      await admin.from("jobs").update({ plan_reminded_at: new Date().toISOString() }).eq("id", j.id);
      report.planningReminders = (report.planningReminders ?? 0) + 1;
    }
  }

  // 12. A part arriving later than Parts promised: the Parts circle turns amber, the manager and the advisor are told.
  {
    const { data: late } = await admin.from("part_items").select("id, description, job_id, expected_date, delivery_date, job:jobs(job_number, department, gated_in_by, plan_parts_ready_date, plan_parts_done_at, status)").eq("is_active", true).in("order_status", ["to_order", "ordered", "partly_received"]).limit(200);
    for (const p of late ?? []) {
      const job = p.job as unknown as { job_number: string; department: string | null; gated_in_by: string | null; plan_parts_ready_date: string | null; plan_parts_done_at: string | null; status: string } | null;
      const when = p.expected_date ?? p.delivery_date;
      if (!job || !job.plan_parts_done_at || !job.plan_parts_ready_date || !when || when <= job.plan_parts_ready_date) continue;
      const { data: already } = await admin.from("job_events").select("id").eq("job_id", p.job_id).eq("event_type", "parts_delayed").ilike("note", `%${p.description}%${when}%`).limit(1);
      if ((already ?? []).length) continue;
      await admin.from("job_events").insert({ job_id: p.job_id, event_type: "parts_delayed", note: `${p.description} now expected ${when}, after the planned date ${job.plan_parts_ready_date}`, created_by: null });
      const n = { type: "planning", title: `Part delayed · ${job.job_number}`, body: `${p.description} now comes ${when}, after the planned ${job.plan_parts_ready_date}. ${job.status === "in_work" ? "The car is already in Work." : "Parts re-plan the date."}`, jobId: p.job_id as string, href: `/jobs/${p.job_id}#planning` };
      await notifyManagers(job.department ?? null, n);
      await notifyStaff([job.gated_in_by].filter((x): x is string => !!x), n);
      await notifyRoles(["parts"], { ...n, href: `/parts/${p.job_id}` });
      report.partsDelayed = (report.partsDelayed ?? 0) + 1;
    }
  }

  // 14. A part with no home (not needed, wrong or faulty, back with Parts) for three working days: the owner is told once.
  {
    const wt = workingTimeOf(settings);
    const dayMinutes = Math.max(60, (wt.closeHour - wt.openHour) * 60);
    const { data: homeless } = await admin.from("part_items").select("id, description, job_id, not_needed_at, exchange_at, updated_at, return_status, exchange_status, disposition, job:jobs(job_number)").eq("is_active", true).is("disposition", null).is("no_home_notified_at", null).or("not_needed_at.not.is.null,exchange_status.in.(needed,ordered),return_status.eq.returned").limit(100);
    for (const p of homeless ?? []) {
      const since = (p.not_needed_at ?? p.exchange_at ?? p.updated_at) as string | null;
      if (!since || workingMinutesSince(since, wt) < 3 * dayMinutes) continue;
      const job = p.job as unknown as { job_number: string } | null;
      await notifyRoles(["owner"], { type: "parts_no_home", title: `Part with no home · ${job?.job_number ?? ""}`, body: `${p.description} has waited three working days for an ending: back to the supplier, to stock, or fitted with your approval.`, jobId: p.job_id as string, href: "/parts/no-home" });
      await admin.from("part_items").update({ no_home_notified_at: new Date().toISOString() }).eq("id", p.id);
      report.partsNoHome = (report.partsNoHome ?? 0) + 1;
    }
  }

  // 15. Documents not sent past the red limit (report, quotation, proforma, tax invoice, customer's reply): the advisor
  //     is reminded once per document; the job remembers which reminders went out.
  {
    const { data: openJobs } = await admin.from("jobs").select("id, job_number, gated_in_by, doc_reminders").eq("is_open", true).limit(500);
    const jobIds = (openJobs ?? []).map((j) => j.id as string);
    const alerts = await loadDocAlerts(jobIds, settings);
    for (const j of openJobs ?? []) {
      const red = (alerts.get(j.id as string) ?? []).filter((a) => a.state === "red");
      if (!red.length) continue;
      const done = { ...(((j.doc_reminders as Record<string, string> | null) ?? {})) };
      const fresh = red.filter((a) => !done[a.key]);
      if (!fresh.length) continue;
      const people = await advisorsInCharge(j.id as string);
      for (const a of fresh) {
        await notifyStaff(people, { type: "doc_not_sent", title: `${a.label} not sent · ${j.job_number}`, body: `${a.text}. Send it now.`, jobId: j.id as string, href: `/jobs/${j.id}` });
        done[a.key] = new Date().toISOString();
      }
      await admin.from("jobs").update({ doc_reminders: done }).eq("id", j.id as string);
      report.docReminders = (report.docReminders ?? 0) + fresh.length;
    }
  }

  // 17. A sent proforma unpaid past the waiting limit (24 h by default): the owner is told once per proforma.
  {
    const limitMs = (Number(settings.payment_waiting_hours) || 24) * 3600000;
    const { data: waiting } = await admin.from("invoices").select("id, number, job_id, total_aed, sent_at, expected_payment_method, job:jobs!invoices_job_id_fkey(job_number, is_open, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin))").eq("kind", "proforma").eq("status", "issued").eq("is_active", true).is("converted_to", null).is("deposit_for_quotation_id", null).is("waiting_notified_at", null).not("sent_at", "is", null).lt("sent_at", new Date(Date.now() - limitMs).toISOString()).limit(100);
    let told = 0;
    for (const w of waiting ?? []) {
      const job = w.job as unknown as { job_number: string; is_open: boolean; vehicle: Parameters<typeof formatPlate>[0] | null } | null;
      if (!job?.is_open) continue;
      const hours = Math.floor((Date.now() - Date.parse(w.sent_at as string)) / 3600000);
      const plate = job.vehicle ? formatPlate(job.vehicle) : job.job_number;
      await notifyRoles(["owner"], { type: "payment_waiting_long", title: `Waiting ${hours} h for payment: ${plate}, AED ${Number(w.total_aed).toLocaleString("en-GB")}`, body: `${w.number} sent ${formatDateTime(w.sent_at as string)}${w.expected_payment_method ? `, expected ${w.expected_payment_method}` : ""}. Nothing received yet.`, jobId: w.job_id as string, href: `/jobs/${w.job_id}/invoice` });
      await admin.from("invoices").update({ waiting_notified_at: new Date().toISOString() }).eq("id", w.id);
      told++;
    }
    report.paymentWaiting = told;
  }

  // 19. A deposit asked for on an approved quotation, not received after the waiting limit (24 h by default): the advisor and
  // accounts are reminded once; the owner's dashboard lists it until it arrives.
  {
    const limitHours = Number(settings.payment_waiting_hours) || 24;
    let told = 0;
    for (const w of await depositsWaiting()) {
      if (w.hours < limitHours || w.reminded) continue;
      const msg = { type: "deposit_overdue", title: `Deposit AED ${w.required.toLocaleString("en-GB")} still not received: ${w.plate}`, body: `${w.quotation} approved ${w.hours} h ago${w.received ? `; AED ${w.received.toLocaleString("en-GB")} received so far` : ""}. Ask the customer; the owner can override on the LPO.`, jobId: w.jobId, href: `/jobs/${w.jobId}/invoice` };
      await notifyStaff(w.advisorIds, msg);
      await notifyRoles(["accounts"], msg);
      await admin.from("quotations").update({ deposit_reminded_at: new Date().toISOString() }).eq("job_id", w.jobId).eq("status", "approved").eq("kind", "quotation");
      told++;
    }
    report.depositOverdue = told;
  }

  // 21. Parts marked ready at the desk, still not received two hours later: one reminder to the car's technicians
  // and the workshop manager, then quiet.
  {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
    const { data: readyRows } = await admin.from("part_items").select("id, job_id, description").eq("is_active", true).neq("issue_status", "confirmed").is("ready_reminder_at", null).not("ready_for_handover_at", "is", null).lt("ready_for_handover_at", twoHoursAgo);
    const byJob = new Map<string, { ids: string[]; names: string[] }>();
    for (const r of readyRows ?? []) {
      const g = byJob.get(r.job_id as string) ?? { ids: [], names: [] };
      g.ids.push(r.id as string);
      g.names.push(r.description as string);
      byJob.set(r.job_id as string, g);
    }
    for (const [jobId, g] of byJob) {
      const { data: job } = await admin.from("jobs").select("id, job_number, is_open, department, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", jobId).maybeSingle();
      if (!job?.is_open) continue;
      const v = job.vehicle as unknown as (Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null }) | null;
      const plate = v ? formatPlate(v) : (job.job_number as string);
      const car = v ? [v.make?.name, v.model?.name].filter(Boolean).join(" ") : "";
      const { data: techRows } = await admin.from("job_technicians").select("staff_id").eq("job_id", jobId).eq("is_active", true).is("done_at", null);
      const title = `Still at the parts desk: ${g.ids.length} part${g.ids.length === 1 ? "" : "s"} for ${plate}${car ? ` (${car})` : ""}`;
      const body = g.names.join(", ");
      const techIds = (techRows ?? []).map((t) => t.staff_id as string);
      if (techIds.length) await notifyStaff(techIds, { type: "handover", title, body: `${body}. Tick them on your tablet and enter your PIN when you pick them up.`, jobId, href: `/my-jobs/${jobId}` });
      await notifyManagers((job.department as string | null) ?? null, { type: "handover", title, body, jobId, href: `/jobs/${jobId}/work` });
      await admin.from("part_items").update({ ready_reminder_at: new Date().toISOString() }).in("id", g.ids);
    }
  }

  // 22. Trips still without a road distance: worked out again every hour on the server (where the
  // GOOGLE_MAPS_API_KEY lives), and the reason stored on the trip when Google still cannot say.
  {
    const { data: noKm } = await admin.from("recovery_trips").select("id").eq("is_active", true).is("road_km", null).order("created_at", { ascending: false }).limit(20);
    let found = 0;
    for (const t of noKm ?? []) {
      const r = await recalcTripKm(t.id as string, null);
      if (r.km !== null) found++;
    }
    report.kmRecalc = (noKm ?? []).length;
    report.kmFound = found;
  }

  // 23. The 10-day after-care checks activate the warranty: reminders on day 8, 12 and 20 after the handover.
  {
    const a = await aftercareHourly();
    report.aftercareReminded = a.reminded;
    report.aftercareOverdue = a.overdue;
  }

  // 25. A RED task older than 30 minutes rings one bell (1.2, 21 October 2026): cash taken and still
  // not confirmed and banked, and a deposit the customer approved that is still not recorded.
  {
    let rang = 0;
    const cut = new Date(Date.now() - 30 * 60000).toISOString();
    const { data: cashOld } = await admin.from("payments").select("id, number, amount_aed, job_id").eq("is_active", true).eq("status", "recorded").is("verified_at", null).eq("method", "cash").is("bank_reminder_at", null).lt("received_at", cut);
    for (const p of cashOld ?? []) {
      await notifyRoles(["accounts"], { type: "task_overdue", title: `Still to bank · ${p.number}`, body: `Cash of AED ${Number(p.amount_aed).toLocaleString("en-GB")} was taken over 30 minutes ago and is not confirmed and banked yet.`, jobId: (p.job_id as string | null) ?? null, href: "/dashboard" });
      await admin.from("payments").update({ bank_reminder_at: new Date().toISOString() }).eq("id", p.id);
      rang++;
    }
    const { data: depOld } = await admin.from("quotations").select("id, number, deposit_aed, job_id, responded_at").eq("kind", "quotation").eq("status", "approved").eq("is_active", true).gt("deposit_aed", 0).is("deposit_accounts_reminded_at", null).lt("responded_at", cut);
    for (const q of depOld ?? []) {
      if (!q.job_id) continue;
      const st = await depositState(q.job_id as string);
      if (!st.short) { await admin.from("quotations").update({ deposit_accounts_reminded_at: new Date().toISOString() }).eq("id", q.id); continue; }
      await notifyRoles(["accounts"], { type: "task_overdue", title: `Deposit still to record · ${q.number}`, body: `AED ${Math.max(0, st.required - st.received).toLocaleString("en-GB")} asked over 30 minutes ago and not recorded yet. It sits on your Waiting on you.`, jobId: q.job_id as string, href: "/dashboard" });
      await admin.from("quotations").update({ deposit_accounts_reminded_at: new Date().toISOString() }).eq("id", q.id);
      rang++;
    }
    report.redTaskBells = rang;
  }

  // 26. The ORDER NOW clock (2.4, 21 October 2026): an approved LPO still not ordered past the red
  // line tells the owner once.
  {
    let rang = 0;
    const redMin = Number(settings.order_now_red_minutes) || 60;
    const wt26 = workingTimeOf(settings);
    const { data: lateOrders } = await admin.from("purchase_orders").select("id, number, supplier_name, approved_at, job_id, total_cost_aed").eq("is_active", true).eq("status", "approved").in("kind", ["supplier", "stock"]).is("order_overdue_notified_at", null).not("approved_at", "is", null);
    for (const po of lateOrders ?? []) {
      const mins = workingMinutesSince(po.approved_at as string, wt26);
      if (mins < redMin) continue;
      await notifyRoles(["owner"], { type: "task_overdue", title: `ORDER NOW overdue · ${po.number} · ${po.supplier_name}`, body: `Approved ${Math.round(mins)} working minutes ago (AED ${Number(po.total_cost_aed).toLocaleString("en-GB")}) and still not ordered. Parts have it red on their list.`, jobId: (po.job_id as string | null) ?? null, href: `/parts/orders/${po.id}` });
      await admin.from("purchase_orders").update({ order_overdue_notified_at: new Date().toISOString() }).eq("id", po.id);
      rang++;
    }
    report.orderNowOverdue = rang;
  }

  // 24. Supplier invoices still missing ("to follow"): Parts are reminded once a day per LPO until the
  // number and the date are entered. Accounts see the same LPOs on their Waiting list all along.
  {
    let told = 0;
    const dayAgo = new Date(Date.now() - 20 * 3600000).toISOString();
    const { data: missing } = await admin.from("purchase_orders").select("id, number, supplier_name, job_id, received_at, invoice_reminder_at").eq("supplier_invoice_status", "to_follow").eq("is_active", true).neq("status", "cancelled");
    for (const po of missing ?? []) {
      if (po.invoice_reminder_at && String(po.invoice_reminder_at) > dayAgo) continue;
      const days = po.received_at ? Math.max(0, Math.floor((Date.now() - Date.parse(po.received_at as string)) / 86400000)) : 0;
      await notifyRoles(["parts"], { type: "supplier_invoice_missing", title: `Invoice missing · ${po.number}`, body: `${po.supplier_name}: no invoice ${days ? `${days} day${days === 1 ? "" : "s"} after the delivery` : "yet"}. Chase it and enter the number and the date.`, jobId: (po.job_id as string | null) ?? null, href: `/parts/orders/${po.id}` });
      await admin.from("purchase_orders").update({ invoice_reminder_at: new Date().toISOString() }).eq("id", po.id);
      told++;
    }
    report.invoiceMissingReminders = told;
  }

  // 20. A car still "On the way" three hours after loading (or leaving): the advisor is reminded once; he can press
  // "Mark delivered" and the driver's price follows on the Recovery page.
  {
    let told = 0;
    const { data: trips } = await admin.from("recovery_trips").select("id, job_id, loaded_at, sent_at, created_at, driver_name").eq("kind", "delivery").eq("is_active", true).is("delivered_at", null).is("reminded_at", null);
    for (const t of trips ?? []) {
      if (!t.job_id) continue;
      const since = Date.parse((t.loaded_at ?? t.sent_at ?? t.created_at) as string);
      if (!(Date.now() - since > 3 * 3600000)) continue;
      const { data: j } = await admin.from("jobs").select("job_number, status, gated_in_by").eq("id", t.job_id).maybeSingle();
      if (!j || j.status !== "in_delivery") continue;
      const ids = await advisorsInCharge(t.job_id);
      await notifyStaff(ids, { type: "delivery", title: `Still on the way after 3 hours · ${j.job_number}`, body: `The driver (${t.driver_name ?? "driver"}) has not pressed Delivered. Check with him, or press "Mark delivered" on the gate-out page (the price follows on the Recovery page).`, jobId: t.job_id, href: `/jobs/${t.job_id}/gate-out` });
      await admin.from("recovery_trips").update({ reminded_at: new Date().toISOString() }).eq("id", t.id);
      told++;
    }
    report.deliveryWaiting = told;
  }

  // 18. Stock: an item below its minimum tells Parts once; on the 1st the monthly count is asked for.
  {
    report.stockLow = await notifyLowStock();
    const thisMonth = monthKey();
    if (String(settings.stock_count_reminded_for ?? "") !== thisMonth) {
      const { count } = await admin.from("stock_items").select("id", { count: "exact", head: true }).eq("is_active", true);
      if ((count ?? 0) > 0) await notifyRoles(["parts"], { type: "stock_low", title: "Monthly stock count", body: "A new month: count the shelf and type the figures on the stock page.", href: "/parts/stock?count=1" });
      await admin.from("settings").upsert({ key: "stock_count_reminded_for", value: thisMonth }, { onConflict: "key" });
      report.stockCount = 1;
    }
  }

  // 16. Bodyshop: a late stage pushes the later due dates and the handover (manager and advisor told); cars due out tomorrow are announced with the sign-offs needed.
  try {
    const b = await bodyshopHourly(settings);
    report.bodyshopLate = b.late;
    report.bodyshopDueOut = b.dueOut;
  } catch {
    report.bodyshopLate = -1;
  }

  // 13. On the 1st (the first run of a new month): last month's summary goes to the owner, once.
  {
    const last = shiftMonth(monthKey(), -1);
    if (String(settings.monthly_summary_sent_for ?? "") !== last) {
      const s = await monthlySummary(settings, last);
      await notifyRoles(["owner"], { type: "monthly_summary", title: `Monthly summary · ${monthLabel(last)}`, body: `${s.count} gated out, invoiced AED ${s.invoiced.toLocaleString("en-GB")}, profit AED ${s.profit.toLocaleString("en-GB")}${s.marginPercent !== null ? ` (${s.marginPercent}%)` : ""}, ${s.verdicts.talk} need a talk. Open it, or download the PDF.`, href: `/reports/monthly?month=${last}` });
      await admin.from("settings").update({ value: last }).eq("key", "monthly_summary_sent_for");
      report.monthlySummary = 1;
    }
  }
  return report;
}
