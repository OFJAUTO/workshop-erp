/** Calendar helpers. All dates are Dubai dates (YYYY-MM-DD); Dubai has no daylight saving time. */

export const APPOINTMENT_STATUSES = ["booked", "arrived", "no_show", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  booked: "Booked",
  arrived: "Arrived, gated in",
  no_show: "No-show",
  cancelled: "Cancelled",
};

export const DURATIONS = [30, 45, 60, 90, 120, 180] as const;

export type CalendarView = "day" | "week" | "month";

const DAY_MS = 86400000;

export function isDateString(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T12:00:00Z"));
}

/** The Dubai date of a moment. */
export function dubaiDateOf(iso: string | Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** The Dubai clock time (HH:MM) of a moment. */
export function dubaiTimeOf(iso: string | Date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** Midnight at the start of a Dubai date, as an ISO moment. */
export function dayStartIso(date: string) {
  return new Date(`${date}T00:00:00+04:00`).toISOString();
}

export function addDays(date: string, n: number) {
  return new Date(Date.parse(date + "T12:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: string) {
  return (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
}

export function weekStart(date: string) {
  return addDays(date, -weekdayIndex(date));
}

export function monthStart(date: string) {
  return date.slice(0, 8) + "01";
}

export function monthEnd(date: string) {
  const [y, m] = date.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return addDays(next, -1);
}

/** The dates shown for a view, and the range to load (end exclusive). */
export function viewRange(view: CalendarView, date: string): { days: string[]; from: string; to: string } {
  if (view === "day") return { days: [date], from: date, to: addDays(date, 1) };
  if (view === "week") {
    const start = weekStart(date);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return { days, from: start, to: addDays(start, 7) };
  }
  const first = weekStart(monthStart(date));
  const last = monthEnd(date);
  const days: string[] = [];
  for (let d = first; d <= last || days.length % 7 !== 0; d = addDays(d, 1)) days.push(d);
  return { days, from: days[0], to: addDays(days[days.length - 1], 1) };
}

export function shiftDate(view: CalendarView, date: string, direction: 1 | -1) {
  if (view === "day") return addDays(date, direction);
  if (view === "week") return addDays(date, 7 * direction);
  const [y, m] = date.split("-").map(Number);
  const nm = m + direction;
  const ny = nm === 0 ? y - 1 : nm === 13 ? y + 1 : y;
  const mm = nm === 0 ? 12 : nm === 13 ? 1 : nm;
  return `${ny}-${String(mm).padStart(2, "0")}-01`;
}

export function formatDayHeading(date: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
}

export function formatShortDay(date: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
}

export function formatMonthHeading(date: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
}

/** Fills [name], [date] and the other placeholders in a WhatsApp template. */
export function fillTemplate(template: string, values: Record<string, string>) {
  let out = template;
  for (const [k, v] of Object.entries(values)) out = out.replaceAll(`[${k}]`, v);
  return out;
}

/** How full a day is against the setting. */
export function fullness(count: number, perDay: number): { percent: number; tone: "green" | "amber" | "red"; text: string } {
  const cap = Math.max(1, perDay);
  const percent = Math.min(100, Math.round((count / cap) * 100));
  const tone = count > cap ? "red" : count >= cap * 0.75 ? "amber" : "green";
  return { percent, tone, text: `${count} of ${cap}` };
}
