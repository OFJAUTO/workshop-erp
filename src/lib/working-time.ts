/**
 * Working time in Dubai: only the opening hours on working days count.
 * A car gated in after closing time starts its clock at opening time on the next working day.
 */

export type WorkingTime = { openHour: number; closeHour: number; workingDays: string[] };

const DAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DUBAI_OFFSET_MS = 4 * 3600000; // Dubai has no daylight saving time.
const DAY_MS = 86400000;

/** Hours of working time between two moments. Never negative. */
export function workingHoursBetween(start: Date | string | number, end: Date | string | number, wt: WorkingTime): number {
  const s = toMs(start) + DUBAI_OFFSET_MS;
  const e = toMs(end) + DUBAI_OFFSET_MS;
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  const open = clamp(wt.openHour, 0, 24) * 3600000;
  const close = clamp(wt.closeHour, 0, 24) * 3600000;
  if (close <= open) return (e - s) / 3600000; // Nonsense settings: fall back to plain hours.
  const days = new Set(wt.workingDays);
  let total = 0;
  for (let day = Math.floor(s / DAY_MS); day <= Math.floor(e / DAY_MS); day++) {
    if (!days.has(DAY_IDS[new Date(day * DAY_MS).getUTCDay()])) continue;
    const from = Math.max(s, day * DAY_MS + open);
    const to = Math.min(e, day * DAY_MS + close);
    if (to > from) total += to - from;
  }
  return total / 3600000;
}

function toMs(v: Date | string | number) {
  return v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}
