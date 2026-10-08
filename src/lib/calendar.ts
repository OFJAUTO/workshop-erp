/** Calendar helpers. All dates are Dubai dates (YYYY-MM-DD); Dubai has no daylight saving time. */

export const APPOINTMENT_STATUSES = ["booked", "arrived", "done", "no_show", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  booked: "Booked",
  arrived: "Arrived, gated in",
  done: "Done",
  no_show: "No-show",
  cancelled: "Cancelled",
};

/** The four kinds of booking, chosen first with one tap. */
export const BOOKING_KINDS = ["customer_visit", "car_drop", "we_collect", "customer_collects"] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];

export const BOOKING_KIND_LABELS: Record<BookingKind, string> = {
  customer_visit: "Customer coming in",
  car_drop: "Car only arriving",
  we_collect: "We collect the car",
  customer_collects: "Customer collects",
};

export const BOOKING_KIND_SHORT: Record<BookingKind, string> = {
  customer_visit: "Customer visit",
  car_drop: "Car drop-off",
  we_collect: "We collect",
  customer_collects: "Collection",
};

export const BOOKING_KIND_HINTS: Record<BookingKind, string> = {
  customer_visit: "With or without the car being left",
  car_drop: "Dropped by a driver or recovery",
  we_collect: "From the customer's address",
  customer_collects: "Finished car, linked to its job card",
};

export const COLLECT_METHODS = [
  { value: "our_recovery", label: "Our recovery" },
  { value: "outside_recovery", label: "Outside recovery" },
  { value: "our_driver", label: "Our driver" },
] as const;
export type CollectMethod = (typeof COLLECT_METHODS)[number]["value"];

/** "Not arrived" for people and cars coming to us; "Not collected" for collections either way. */
export function missedLabel(kind: BookingKind) {
  return kind === "we_collect" || kind === "customer_collects" ? "Not collected" : "Not arrived";
}

/** A booking whose time has passed with nothing recorded. */
export function isMissed(a: { status: string; starts_at: string }, graceMinutes: number, now = new Date()) {
  return a.status === "booked" && Date.parse(a.starts_at) + graceMinutes * 60000 < now.getTime();
}

/** Durations for a customer visit only; the other kinds have a date and time. */
export const DURATIONS = [15, 30, 45, 60] as const;

/** Colours a person can be given on the Team page. */
export const PERSON_COLOURS = [
  { value: "#111113", label: "Black" },
  { value: "#2563eb", label: "Blue" },
  { value: "#16a34a", label: "Green" },
  { value: "#d97706", label: "Orange" },
  { value: "#dc2626", label: "Red" },
  { value: "#7c3aed", label: "Purple" },
  { value: "#0891b2", label: "Teal" },
  { value: "#db2777", label: "Pink" },
  { value: "#65a30d", label: "Lime" },
  { value: "#78716c", label: "Grey" },
] as const;

/** The person's own colour, or a steady fallback from their id until the owner assigns one. */
export function colourFor(person: { id: string; colour?: string | null } | null | undefined) {
  if (!person) return "#9ca3af";
  if (person.colour) return person.colour;
  let h = 0;
  for (const ch of person.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PERSON_COLOURS[h % PERSON_COLOURS.length].value;
}

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

/** The Dubai hour (0 to 23) of a moment. */
export function dubaiHourOf(iso: string | Date) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", hour12: false }).format(new Date(iso)));
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
