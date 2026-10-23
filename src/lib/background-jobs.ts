import "server-only";
import { notifyRoles } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The scheduled background jobs (23 October 2026): every run records when it ran, whether it worked and what it did
 * (table background_jobs, server only), shown to the owner in Settings > Background jobs. A job that has not run on
 * time (mailbox check over 15 minutes, hourly housekeeping over 2 hours) turns red there and tells the owner once:
 * "Mailbox check hasn't run since 12:30". Lateness is checked by each job (for the other one) and by the
 * notification poll every signed-in screen makes, so it is noticed even when both jobs have stopped.
 */

export type JobKey = "mailbox" | "housekeeping";
export type BackgroundJob = {
  key: JobKey;
  label: string;
  schedule_label: string;
  late_after_minutes: number;
  last_ran_at: string | null;
  last_ok: boolean | null;
  last_result: string | null;
  late_notified_at: string | null;
  created_at: string;
};

const SELECT = "key, label, schedule_label, late_after_minutes, last_ran_at, last_ok, last_result, late_notified_at, created_at";

/** "12:30" today, otherwise "22 Oct 12:30" (Dubai time). */
export function jobTime(iso: string | null, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short" }).format(x);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return day(d) === day(now) ? time : `${day(d)} ${time}`;
}

/** Late: no run for longer than the job's limit (counted from when the job was set up if it never ran). */
export function jobLate(j: Pick<BackgroundJob, "last_ran_at" | "created_at" | "late_after_minutes">, now = Date.now()): boolean {
  const since = Date.parse(j.last_ran_at ?? j.created_at);
  return Number.isFinite(since) && now - since > j.late_after_minutes * 60_000;
}

/** "Mailbox check hasn't run since 12:30" (or "hasn't run yet"). */
export function lateWords(j: Pick<BackgroundJob, "label" | "last_ran_at">, now = new Date()): string {
  return j.last_ran_at ? `${j.label} hasn't run since ${jobTime(j.last_ran_at, now)}` : `${j.label} hasn't run yet`;
}

export async function loadBackgroundJobs(): Promise<BackgroundJob[]> {
  const { data } = await createAdminClient().from("background_jobs").select(SELECT).order("late_after_minutes");
  return (data ?? []) as BackgroundJob[];
}

/** Written by every run, good or bad; a run also ends a lateness episode, so the next one tells the owner again. */
export async function recordJobRun(key: JobKey, ok: boolean, result: string): Promise<void> {
  const now = new Date().toISOString();
  await createAdminClient().from("background_jobs").update({ last_ran_at: now, last_ok: ok, last_result: result.slice(0, 300), late_notified_at: null, updated_at: now }).eq("key", key);
}

let lastCheck = 0;

/** Tells the owner once per lateness episode. Cheap enough for the notification poll: at most once a minute per server. */
export async function checkLateJobs(force = false): Promise<string[]> {
  if (!force && Date.now() - lastCheck < 60_000) return [];
  lastCheck = Date.now();
  const told: string[] = [];
  const admin = createAdminClient();
  for (const j of await loadBackgroundJobs()) {
    if (!jobLate(j) || j.late_notified_at) continue;
    // Claimed in one update, so two servers checking at the same moment tell the owner once.
    const { data } = await admin.from("background_jobs").update({ late_notified_at: new Date().toISOString() }).eq("key", j.key).is("late_notified_at", null).select("key").maybeSingle();
    if (!data) continue;
    const title = lateWords(j);
    await notifyRoles(["owner"], { type: "background_job_late", title, body: `It runs ${j.schedule_label}. Check Vercel > the project > Settings > Cron Jobs, and the job's logs.`, href: "/settings#background-jobs" });
    told.push(title);
  }
  return told;
}
