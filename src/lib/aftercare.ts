import "server-only";
import { addWorkingDays } from "./planning";
import { formatDate } from "./format";
import { notifyStaff } from "./notifications";
import { dubaiDate, workingTimeOf } from "./jobs";
import { getSettings } from "./settings";
import { createAdminClient } from "./supabase/admin";

/**
 * The complimentary 10-day after-care check on package jobs (20 October 2026). Booked by itself the
 * moment a package job gates out: a calendar visit for the advisor ten days on, an aftercare row to
 * track it. On day 8 the advisor gets one reminder with the WhatsApp message ready; the PPF team
 * leader does the check (lifting edges, bubbles, dust), takes photos and signs off with his PIN. Not
 * done past the date: the advisor is reminded once more and the job card says so - that matters for
 * warranty claims.
 */

export const AFTERCARE_POINTS = ["Lifting edges", "Bubbles", "Dust or inclusions"] as const;

/** At gate-out of a package job with the after-care line: the appointment and the tracking row. */
export async function ensureAftercare(jobId: string, by: string | null): Promise<void> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("aftercare_checks").select("id").eq("job_id", jobId).limit(1);
  if (existing?.length) return;
  const { data: q } = await admin.from("quotations").select("id").eq("job_id", jobId).eq("status", "approved").eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!q) return;
  const { data: pkgLines } = await admin.from("quotation_lines").select("package_items").eq("quotation_id", q.id).eq("is_active", true).not("package_items", "is", null);
  const wants = (pkgLines ?? []).some((l) => (l.package_items as { aftercare_check?: boolean } | null)?.aftercare_check);
  if (!wants) return;
  const settings = await getSettings();
  const days = Number(settings.bodyshop_final_check_days) || 10;
  const due = addWorkingDays(dubaiDate(), days, { openHour: 8, closeHour: 17, workingDays: workingTimeOf(settings).workingDays });
  const { data: job } = await admin.from("jobs").select("id, job_number, customer_id, vehicle_id, gated_in_by, final_check_appointment_id").eq("id", jobId).maybeSingle();
  if (!job) return;
  let appointmentId = job.final_check_appointment_id as string | null;
  if (!appointmentId) {
    const { data: appt } = await admin
      .from("appointments")
      .insert({ kind: "customer_visit", department: "bodyshop", customer_id: job.customer_id, vehicle_id: job.vehicle_id, job_id: jobId, reason: "10-day after-care check", starts_at: new Date(`${due}T10:00:00+04:00`).toISOString(), duration_minutes: 30, advisor_id: job.gated_in_by, created_by: by, updated_by: by })
      .select("id")
      .maybeSingle();
    appointmentId = appt?.id ?? null;
    if (appointmentId) await admin.from("jobs").update({ final_check_appointment_id: appointmentId }).eq("id", jobId);
  }
  await admin.from("aftercare_checks").insert({ job_id: jobId, appointment_id: appointmentId, due_date: due, created_by: by, updated_by: by });
  await admin.from("job_events").insert({ job_id: jobId, event_type: "aftercare_booked", note: `10-day after-care check booked for ${formatDate(due)}`, created_by: by });
}

/** One row per job for the job card: due, done, or overdue. */
export async function aftercareOf(jobId: string): Promise<{ due_date: string; done_at: string | null; overdue: boolean } | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("aftercare_checks").select("due_date, done_at").eq("job_id", jobId).eq("is_active", true).maybeSingle();
  if (!data) return null;
  return { due_date: data.due_date as string, done_at: (data.done_at as string | null) ?? null, overdue: !data.done_at && String(data.due_date) < dubaiDate() };
}

/** Cron: day-8 reminders with the message ready, and one "not done" reminder after the date. */
export async function aftercareHourly(): Promise<{ reminded: number; overdue: number }> {
  const admin = createAdminClient();
  const today = dubaiDate();
  const soon = new Date(Date.parse(`${today}T12:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10);
  let reminded = 0;
  let overdue = 0;
  const { data: rows } = await admin.from("aftercare_checks").select("id, job_id, due_date, reminded_at, overdue_notified_at, done_at, job:jobs(job_number, gated_in_by, customer:customers(phone), vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number))").eq("is_active", true).is("done_at", null);
  for (const r of rows ?? []) {
    const job = r.job as unknown as { job_number: string; gated_in_by: string | null; customer: { phone: string | null } | null; vehicle: Record<string, unknown> | null } | null;
    if (!job?.gated_in_by) continue;
    if (!r.reminded_at && String(r.due_date) <= soon && String(r.due_date) >= today) {
      await notifyStaff([job.gated_in_by], { type: "aftercare_due", title: `10-day after-care check due ${formatDate(String(r.due_date))} · ${job.job_number}`, body: `Send the customer the message (ready on the job card) and confirm the visit.`, jobId: r.job_id as string, href: `/jobs/${r.job_id}` });
      await admin.from("aftercare_checks").update({ reminded_at: new Date().toISOString() }).eq("id", r.id);
      reminded++;
    } else if (!r.overdue_notified_at && String(r.due_date) < today) {
      await notifyStaff([job.gated_in_by], { type: "aftercare_due", title: `10-day check NOT done · ${job.job_number}`, body: "The after-care check date has passed. The job card shows it as not done - that matters for warranty claims.", jobId: r.job_id as string, href: `/jobs/${r.job_id}` });
      await admin.from("aftercare_checks").update({ overdue_notified_at: new Date().toISOString() }).eq("id", r.id);
      overdue++;
    }
  }
  return { reminded, overdue };
}
