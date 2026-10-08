import { NextResponse, type NextRequest } from "next/server";
import { GATE_IN_BUCKET } from "@/lib/media";
import { addDays, dayStartIso, dubaiTimeOf } from "@/lib/calendar";
import { dubaiDate } from "@/lib/jobs";
import { notifyRoles, notifyStaff } from "@/lib/notifications";
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
  const report: Record<string, number> = { videosDeleted: 0, remindersSent: 0, appointmentReminders: 0 };

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

  // 3. Appointment reminders for tomorrow
  const dubaiHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", hour12: false }).format(new Date()));
  if (dubaiHour >= 8) {
    const tomorrow = addDays(dubaiDate(), 1);
    const { data: appts } = await admin
      .from("appointments")
      .select("id, reason, starts_at, advisor_id, customer:customers(full_name, company_name)")
      .eq("is_active", true)
      .eq("status", "booked")
      .is("reminder_notified_at", null)
      .gte("starts_at", dayStartIso(tomorrow))
      .lt("starts_at", dayStartIso(addDays(tomorrow, 1)))
      .limit(100);
    for (const a of appts ?? []) {
      const c = a.customer as unknown as { full_name: string; company_name: string | null } | null;
      const n = {
        type: "appointment_reminder",
        title: `Send tomorrow's reminder: ${c?.company_name ?? c?.full_name ?? "customer"} at ${dubaiTimeOf(a.starts_at)}`,
        body: a.reason,
        href: `/calendar/${a.id}`,
      };
      if (a.advisor_id) await notifyStaff([a.advisor_id], n);
      else await notifyRoles(["service_advisor", "workshop_manager"], n);
      await admin.from("appointments").update({ reminder_notified_at: new Date().toISOString() }).eq("id", a.id);
      report.appointmentReminders++;
    }
  }

  return NextResponse.json({ ok: true, ...report });
}
