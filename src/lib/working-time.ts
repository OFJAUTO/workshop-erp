/**
 * Working time in Dubai: only the opening hours on working days count, less the break.
 * A car gated in after closing time starts its clock at opening time on the next working day.
 */

export type BreakWindow = { start: string; end: string };
/** One break window per day of the week ("sun".."sat"); a missing or null day has no break. */
export type BreakSchedule = Partial<Record<string, BreakWindow | null>>;
/** Wherever a break is taken: one window for every day, or a schedule with a window per weekday. */
export type BreakLike = BreakWindow | BreakSchedule | null | undefined;
export type WorkingTime = { openHour: number; closeHour: number; workingDays: string[]; breakStart?: string | null; breakEnd?: string | null; /** The break per weekday; when set it wins over breakStart/breakEnd. */ breaks?: BreakSchedule | null };

export const DAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** The break that applies on one weekday, whether a single window or a schedule was given. */
export function breakForDay(b: BreakLike, dayId: string): BreakWindow | null {
  if (!b) return null;
  if (typeof (b as BreakWindow).start === "string" && typeof (b as BreakWindow).end === "string") return b as BreakWindow;
  return (b as BreakSchedule)[dayId] ?? null;
}

/** Today's weekday id on the Dubai clock. */
export function dubaiDayId(now = Date.now()): string {
  return DAY_IDS[new Date(now + DUBAI_OFFSET_MS).getUTCDay()];
}
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
  const fixed = wt.breakStart && wt.breakEnd ? { start: wt.breakStart, end: wt.breakEnd } : null;
  let total = 0;
  for (let day = Math.floor(s / DAY_MS); day <= Math.floor(e / DAY_MS); day++) {
    const dayId = DAY_IDS[new Date(day * DAY_MS).getUTCDay()];
    if (!days.has(dayId)) continue;
    const from = Math.max(s, day * DAY_MS + open);
    const to = Math.min(e, day * DAY_MS + close);
    if (to > from) {
      total += to - from;
      // The break of that weekday (Friday's is longer), from the schedule when one is set.
      const w = wt.breaks ? breakForDay(wt.breaks, dayId) : fixed;
      if (w) total -= Math.max(0, Math.min(to, day * DAY_MS + clockMs(w.end)) - Math.max(from, day * DAY_MS + clockMs(w.start)));
    }
  }
  return total / 3600000;
}

/** Minutes a clock counts between two moments: inside the opening hours only, the break left out (unless it was worked through). */
export function countedMinutes(start: Date | string | number, end: Date | string | number, wt: WorkingTime, opts: { throughBreak?: boolean } = {}): number {
  const w = opts.throughBreak ? { ...wt, breakStart: null, breakEnd: null, breaks: null } : wt;
  return Math.max(0, Math.round(workingHoursBetween(start, end, w) * 60));
}

/** Minutes of a break that fall inside a span of time (Dubai clock), for a technician's clock. */
export function breakMinutesBetween(start: Date | string | number, end: Date | string | number, brk: BreakLike): number {
  if (!brk) return 0;
  const s = toMs(start) + DUBAI_OFFSET_MS;
  const e = toMs(end) + DUBAI_OFFSET_MS;
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  let total = 0;
  for (let day = Math.floor(s / DAY_MS); day <= Math.floor(e / DAY_MS); day++) {
    const w = breakForDay(brk, DAY_IDS[new Date(day * DAY_MS).getUTCDay()]);
    if (!w) continue;
    total += Math.max(0, Math.min(e, day * DAY_MS + clockMs(w.end)) - Math.max(s, day * DAY_MS + clockMs(w.start)));
  }
  return Math.round(total / 60000);
}

/** Where the Dubai clock is inside the break right now: the break's start and end as moments, or null. */
export function breakNow(brk: BreakLike, now = Date.now()): { startsAt: number; endsAt: number; inBreak: boolean; window: BreakWindow } | null {
  const w = breakForDay(brk, dubaiDayId(now));
  if (!w) return null;
  const day = Math.floor((now + DUBAI_OFFSET_MS) / DAY_MS) * DAY_MS;
  const startsAt = day + clockMs(w.start) - DUBAI_OFFSET_MS;
  const endsAt = day + clockMs(w.end) - DUBAI_OFFSET_MS;
  return { startsAt, endsAt, inBreak: now >= startsAt && now < endsAt, window: w };
}

/** Working hours in one working day, the break taken out: that weekday's when given, else the average working day. */
export function hoursPerDay(wt: WorkingTime, dayId?: string): number {
  const windowOf = (d: string) => (wt.breaks ? breakForDay(wt.breaks, d) : wt.breakStart && wt.breakEnd ? { start: wt.breakStart, end: wt.breakEnd } : null);
  const hoursOf = (d: string) => {
    const w = windowOf(d);
    return Math.max(0, wt.closeHour - wt.openHour - (w ? (clockMs(w.end) - clockMs(w.start)) / 3600000 : 0));
  };
  if (dayId) return hoursOf(dayId);
  const days = wt.workingDays.length ? wt.workingDays : DAY_IDS;
  return days.reduce((a, d) => a + hoursOf(d), 0) / days.length;
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
    const dayId = DAY_IDS[new Date(d * DAY_MS).getUTCDay()];
    if (!wt.workingDays.includes(dayId)) continue;
    total += hoursPerDay(wt, dayId);
    const dayOpen = d * DAY_MS + wt.openHour * 3600000 - DUBAI_OFFSET_MS;
    const dayClose = d * DAY_MS + wt.closeHour * 3600000 - DUBAI_OFFSET_MS;
    if (now >= dayClose) continue;
    if (now <= dayOpen) left += hoursPerDay(wt, dayId);
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
