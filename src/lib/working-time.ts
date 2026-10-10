/**
 * Working time in Dubai: only the opening hours on working days count, less the break.
 * A car gated in after closing time starts its clock at opening time on the next working day.
 */

export type BreakWindow = { start: string; end: string };
export type WorkingTime = { openHour: number; closeHour: number; workingDays: string[]; breakStart?: string | null; breakEnd?: string | null };

const DAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DUBAI_OFFSET_MS = 4 * 3600000; // Dubai has no daylight saving time.
const DAY_MS = 86400000;

/** "12:30-13:30" from Settings, or a person's own start and end. */
export function parseBreak(text: string | null | undefined): BreakWindow | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(String(text ?? ""));
  if (!m) return null;
  const start = `${m[1].padStart(2, "0")}:${m[2]}`;
  const end = `${m[3].padStart(2, "0")}:${m[4]}`;
  return clockMs(start) < clockMs(end) ? { start, end } : null;
}

/** Milliseconds since midnight for "HH:MM". */
export function clockMs(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return ((h || 0) * 60 + (m || 0)) * 60000;
}

/** Hours of working time between two moments, breaks taken out. Never negative. */
export function workingHoursBetween(start: Date | string | number, end: Date | string | number, wt: WorkingTime): number {
  const s = toMs(start) + DUBAI_OFFSET_MS;
  const e = toMs(end) + DUBAI_OFFSET_MS;
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  const open = clamp(wt.openHour, 0, 24) * 3600000;
  const close = clamp(wt.closeHour, 0, 24) * 3600000;
  if (close <= open) return (e - s) / 3600000; // Nonsense settings: fall back to plain hours.
  const days = new Set(wt.workingDays);
  const brk = wt.breakStart && wt.breakEnd ? { s: clockMs(wt.breakStart), e: clockMs(wt.breakEnd) } : null;
  let total = 0;
  for (let day = Math.floor(s / DAY_MS); day <= Math.floor(e / DAY_MS); day++) {
    if (!days.has(DAY_IDS[new Date(day * DAY_MS).getUTCDay()])) continue;
    const from = Math.max(s, day * DAY_MS + open);
    const to = Math.min(e, day * DAY_MS + close);
    if (to > from) {
      total += to - from;
      if (brk) total -= Math.max(0, Math.min(to, day * DAY_MS + brk.e) - Math.max(from, day * DAY_MS + brk.s));
    }
  }
  return total / 3600000;
}

/** Minutes of a break that fall inside a span of time (Dubai clock), for a technician's clock. */
export function breakMinutesBetween(start: Date | string | number, end: Date | string | number, brk: BreakWindow | null | undefined): number {
  if (!brk) return 0;
  const s = toMs(start) + DUBAI_OFFSET_MS;
  const e = toMs(end) + DUBAI_OFFSET_MS;
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  const bs = clockMs(brk.start);
  const be = clockMs(brk.end);
  let total = 0;
  for (let day = Math.floor(s / DAY_MS); day <= Math.floor(e / DAY_MS); day++) {
    total += Math.max(0, Math.min(e, day * DAY_MS + be) - Math.max(s, day * DAY_MS + bs));
  }
  return Math.round(total / 60000);
}

/** Where the Dubai clock is inside the break right now: the break's start and end as moments, or null. */
export function breakNow(brk: BreakWindow | null | undefined, now = Date.now()): { startsAt: number; endsAt: number; inBreak: boolean } | null {
  if (!brk) return null;
  const local = now + DUBAI_OFFSET_MS;
  const day = Math.floor(local / DAY_MS) * DAY_MS;
  const startsAt = day + clockMs(brk.start) - DUBAI_OFFSET_MS;
  const endsAt = day + clockMs(brk.end) - DUBAI_OFFSET_MS;
  return { startsAt, endsAt, inBreak: now >= startsAt && now < endsAt };
}

/** Working hours in one working day, breaks taken out. */
export function hoursPerDay(wt: WorkingTime): number {
  const brk = wt.breakStart && wt.breakEnd ? (clockMs(wt.breakEnd) - clockMs(wt.breakStart)) / 3600000 : 0;
  return Math.max(0, wt.closeHour - wt.openHour - brk);
}

/** Working hours left in the current week (Dubai), from now to the last working day's close. */
export function hoursLeftThisWeek(wt: WorkingTime, now = Date.now()): { left: number; total: number } {
  const local = now + DUBAI_OFFSET_MS;
  const today = Math.floor(local / DAY_MS);
  const dow = new Date(today * DAY_MS).getUTCDay();
  const weekStart = today - ((dow + 6) % 7); // Monday
  let total = 0;
  let left = 0;
  for (let d = weekStart; d < weekStart + 7; d++) {
    if (!wt.workingDays.includes(DAY_IDS[new Date(d * DAY_MS).getUTCDay()])) continue;
    total += hoursPerDay(wt);
    const dayOpen = d * DAY_MS + wt.openHour * 3600000 - DUBAI_OFFSET_MS;
    const dayClose = d * DAY_MS + wt.closeHour * 3600000 - DUBAI_OFFSET_MS;
    if (now >= dayClose) continue;
    if (now <= dayOpen) left += hoursPerDay(wt);
    else left += workingHoursBetween(now, dayClose, wt);
  }
  return { left: Math.round(left * 10) / 10, total };
}

function toMs(v: Date | string | number) {
  return v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}
