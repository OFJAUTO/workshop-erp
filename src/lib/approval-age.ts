/**
 * HOW LONG AN APPROVAL HAS WAITED (18 November 2026, Section 2: the void of RCT-00062 waited for the owner for days).
 * Pure: the Approvals page, the approval boxes, the daily reminder and the tests read it.
 */
export const REMIND_AFTER_HOURS = 24;
/** The daily email goes from this Dubai hour onwards (once a day). */
export const DAILY_REMINDER_HOUR = 9;

export type Age = { hours: number; days: number; words: string; long: boolean };

/** "3 h", "1 day", "6 days"; long = more than 24 hours. */
export function ageOf(askedAt: string | null | undefined, nowMs: number): Age | null {
  if (!askedAt) return null;
  const t = Date.parse(askedAt);
  if (!Number.isFinite(t)) return null;
  const hours = Math.max(0, Math.floor((nowMs - t) / 3600000));
  const days = Math.floor(hours / 24);
  const words = hours < 1 ? "less than an hour" : hours < 24 ? `${hours} h` : `${days} day${days === 1 ? "" : "s"}`;
  return { hours, days, words, long: hours >= REMIND_AFTER_HOURS };
}

/** "Waiting for the owner – 6 days". */
export function waitingWords(askedAt: string | null | undefined, nowMs: number): string {
  const a = ageOf(askedAt, nowMs);
  return a ? `Waiting for the owner – ${a.words}` : "Waiting for the owner";
}

/** The daily reminder's title, or null when nothing has waited more than 24 hours. */
export function reminderTitle(askedAts: (string | null)[], nowMs: number): { title: string; count: number; oldestDays: number } | null {
  const ages = askedAts.map((a) => ageOf(a, nowMs)).filter((a): a is Age => !!a);
  if (!ages.some((a) => a.long)) return null;
  const oldestDays = Math.max(...ages.map((a) => a.days));
  const count = askedAts.length;
  return { title: `WAITING FOR YOUR APPROVAL: ${count} item${count === 1 ? "" : "s"}, oldest ${oldestDays} day${oldestDays === 1 ? "" : "s"}`, count, oldestDays };
}

export const dubaiDayOf = (ms: number) => new Date(ms + 4 * 3600000).toISOString().slice(0, 10);
export const dubaiHourOf = (ms: number) => new Date(ms + 4 * 3600000).getUTCHours();

/** Once a day: the stored day of the last send is not today (Dubai), and it is past the reminder hour. */
export function dailyReminderDue(lastDay: string | null | undefined, nowMs: number): boolean {
  return dubaiHourOf(nowMs) >= DAILY_REMINDER_HOUR && lastDay !== dubaiDayOf(nowMs);
}

/** "Remind the owner" once a day per item. */
export function remindAllowed(lastDay: string | null | undefined, nowMs: number): boolean {
  return lastDay !== dubaiDayOf(nowMs);
}

/** Sort kinds of approvals so the group holding the oldest item comes first. */
export function kindsOldestFirst<K extends string>(items: { kind: K; askedAt: string | null }[]): K[] {
  const oldest = new Map<K, string>();
  for (const i of items) {
    const a = i.askedAt ?? "9999";
    const cur = oldest.get(i.kind);
    if (!cur || a < cur) oldest.set(i.kind, a);
  }
  return Array.from(oldest.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([k]) => k);
}
