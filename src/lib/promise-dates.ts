// Promised dates (9 November 2026), pure: THE rule for "Due today" and "Overdue" on the dashboard, and the checks on a
// promised date picked at release. jobs.promised_at is a DATE (Dubai); the time is optional (jobs.promised_time).

/** A car at these statuses has met its promise (the work is done): it is never due or overdue. */
export const PROMISE_MET = new Set(["ready", "pending_payment", "in_delivery", "closed"]);

/** "due_today", "overdue" or null, from the promised date ONLY (never the stage targets). */
export function promiseState(promisedAt: string | null | undefined, status: string, today: string): "due_today" | "overdue" | null {
  if (!promisedAt || PROMISE_MET.has(status)) return null;
  const d = String(promisedAt).slice(0, 10);
  if (d < today) return "overdue";
  if (d === today) return "due_today";
  return null;
}

/** The parts are expected after the promised date: the warning under the date box (never a block). */
export function partsLaterWarning(promised: string | null | undefined, partsDate: string | null | undefined): string | null {
  if (!promised || !partsDate) return null;
  return String(partsDate).slice(0, 10) > String(promised).slice(0, 10)
    ? `The parts are expected on ${String(partsDate).slice(0, 10)}, after this date.`
    : null;
}

export type PromiseInput = { date: string; time: string | null; reason: string | null };

/** Reads the promised date, the optional time and the reason for a change from a form, with the refusal words. */
export function readPromise(form: { get(k: string): unknown }, existing: string | null | undefined, today: string): { value?: PromiseInput; error?: string; changed: boolean } {
  const date = String(form.get("promised_at") ?? "").trim();
  const timeRaw = String(form.get("promised_time") ?? "").trim();
  const reason = String(form.get("promise_reason") ?? "").trim() || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick the promised date (the day the customer was told).", changed: false };
  if (date < today) return { error: "The promised date cannot be in the past.", changed: false };
  if (timeRaw && !/^\d{2}:\d{2}$/.test(timeRaw)) return { error: "The time is HH:MM (or leave it empty).", changed: false };
  const before = existing ? String(existing).slice(0, 10) : null;
  const changed = !!before && before !== date;
  if (changed && (!reason || reason.length < 3)) return { error: `The promised date was ${before}: write why it changes.`, changed };
  return { value: { date, time: timeRaw || null, reason }, changed };
}

/** The history line: "Promised date 2026-11-12 14:00 set by Kevin" / "Promised date 2026-11-10 → 2026-11-12: parts late (Kevin)". */
export function promiseEventWords(before: string | null | undefined, p: PromiseInput, who: string, where: string): string {
  const now = `${p.date}${p.time ? ` ${p.time}` : ""}`;
  return before && String(before).slice(0, 10) !== p.date
    ? `Promised date ${String(before).slice(0, 10)} → ${now}: ${p.reason} (${who}, ${where})`
    : `Promised date ${now} set by ${who} (${where})`;
}

/** Approved and not yet done: every job here must carry a promised date. */
export const PROMISE_NEEDED = new Set(["approved", "waiting_parts", "in_work", "pending_qc", "pending_wash"]);
