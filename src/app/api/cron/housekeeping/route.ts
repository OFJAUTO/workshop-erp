import { NextResponse, type NextRequest } from "next/server";
import { GATE_IN_BUCKET } from "@/lib/media";
import { addDays, dayStartIso, dubaiTimeOf } from "@/lib/calendar";
import { dubaiDate, workingTimeOf } from "@/lib/jobs";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { workingHoursBetween } from "@/lib/working-time";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Runs every hour (Vercel cron). Two jobs:
 * 1. Delete gate-in videos older than the retention setting (photos are kept).
 * 2. Remind advisors about approval links not opened within the set hours.
 * 3. From 8:00 Dubai time, tell advisors about tomorrow's appointments so they send the WhatsApp reminder.
 * Protected by CRON_SECRET, which Vercel sends automatically.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const admin = createAdminClient();
  const settings = await getSettings();
  const report: Record<string, number> = { videosDeleted: 0, remindersSent: 0, appointmentReminders: 0, inspectionWarnings: 0, assignmentWarnings: 0 };

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
    await notifyStaff([r.sent_by, job.gated_in_by].filter((x): x is string => !!x), {
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
      await admin.from("jobs").update({ assignment_overdue_notified_at: new Date().toISOString() }).eq("id", j.id);
      report.assignmentWarnings++;
    }
  }

  return NextResponse.json({ ok: true, ...report });
}
