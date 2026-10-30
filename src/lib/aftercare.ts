import "server-only";
import { addWorkingDays } from "./planning";
import { formatDate } from "./format";
import { jobAdvisorIds, notifyStaff } from "./notifications";
import { daysBetween, dubaiDay } from "./warranty";
import { dubaiDate, workingTimeOf } from "./jobs";
import { getSettings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { bodyshopPeople } from "./bodyshop";
import { approvedQuotations } from "./quote-data";
import { ppfInstallLine } from "./ppf-cut";

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
  // A package with the after-care check, or (30 October 2026) ANY real PPF install - a PPF service from the list or a
  // package with PPF film - on any approved quotation of the job. A PPF recheck visit never books another one.
  const { data: kindRow } = await admin.from("jobs").select("job_kind").eq("id", jobId).maybeSingle();
  if (kindRow?.job_kind === "recheck") return;
  const approved = await approvedQuotations(jobId);
  if (!approved.length) return;
  const { data: qLines } = await admin.from("quotation_lines").select("package_items, service_id, left_off").in("quotation_id", approved.map((a) => a.id)).eq("is_active", true);
  const svcIds = Array.from(new Set((qLines ?? []).map((l) => l.service_id as string | null).filter((x): x is string => !!x)));
  const { data: svcs } = svcIds.length ? await admin.from("services").select("id, bodyshop_kind").in("id", svcIds) : { data: [] };
  const kindOf = new Map((svcs ?? []).map((s) => [s.id as string, (s.bodyshop_kind as string | null) ?? null]));
  const wants = (qLines ?? []).some((l) => !l.left_off && ((l.package_items as { aftercare_check?: boolean } | null)?.aftercare_check || ppfInstallLine({ package_items: l.package_items }, kindOf.get((l.service_id as string | null) ?? "") ?? null)));
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

/**
 * Cron (section 12): the 10-day check activates the warranty, so its reminders are counted from the handover
 * day - day 8 (the booking message ready for the advisor), day 12 and day 20 (the reminder with the warranty
 * link) - each sent once to the advisors in charge and its date written down; the warranty page lists them. After
 * 30 days without the check the card reads "Not activated" by itself. Done or activated by the owner: no more.
 */
export async function aftercareHourly(opts: { jobIds?: string[] } = {}): Promise<{ reminded: number; overdue: number }> {
  const admin = createAdminClient();
  const today = dubaiDate();
  // The first reminder comes two days before the final-check day set in Settings (10 → day 8, 30 October 2026).
  const firstDay = Math.max(1, (Number((await getSettings()).bodyshop_final_check_days) || 10) - 2);
  let reminded = 0;
  let overdue = 0;
  let query = admin.from("aftercare_checks").select("id, job_id, due_date, reminded_at, reminded_12_at, reminded_20_at, done_at, activated_at, job:jobs(job_number, gated_out_at)").eq("is_active", true).is("done_at", null).is("activated_at", null);
  if (opts.jobIds) query = query.in("job_id", opts.jobIds);
  const { data: rows } = await query;
  for (const r of rows ?? []) {
    const job = r.job as unknown as { job_number: string; gated_out_at: string | null } | null;
    if (!job?.gated_out_at) continue;
    const day = daysBetween(dubaiDay(job.gated_out_at), today);
    const step = day >= 20 && !r.reminded_20_at ? { col: "reminded_20_at", title: `Third reminder: 10-day check not done · ${job.job_number}`, body: "Send the reminder (ready on the job card). After 30 days the warranty shows Not activated." } : day >= 12 && !r.reminded_12_at && !r.reminded_20_at ? { col: "reminded_12_at", title: `Second reminder: 10-day check not done · ${job.job_number}`, body: "Send the reminder with the warranty link (ready on the job card)." } : day >= firstDay && !r.reminded_at && !r.reminded_12_at && !r.reminded_20_at ? { col: "reminded_at", title: `10-day after-care check due ${formatDate(String(r.due_date))} · ${job.job_number}`, body: "Send the customer the message (ready on the job card) and confirm the visit. The check activates the warranty." } : null;
    if (!step) continue;
    await notifyStaff(await jobAdvisorIds(r.job_id as string), { type: "aftercare_due", title: step.title, body: step.body, jobId: r.job_id as string, href: `/jobs/${r.job_id}#warranty-card` });
    // The PPF leader does the check: told on the same days, sent to the bodyshop page where his card is.
    const ppfLeaders = (await bodyshopPeople()).leaders.filter((l) => l.section === "ppf").map((l) => l.id);
    if (ppfLeaders.length) await notifyStaff(ppfLeaders, { type: "aftercare_due", title: step.title.replace("Send the reminder", "The 10-day check"), body: "The customer is due for the 10-day after-care check: sign it off on the car's bodyshop page.", jobId: r.job_id as string, href: `/bodyshop/${r.job_id}#aftercare` });
    await admin.from("aftercare_checks").update({ [step.col]: new Date().toISOString() }).eq("id", r.id);
    if (step.col === "reminded_at") reminded++;
    else overdue++;
  }
  return { reminded, overdue };
}
