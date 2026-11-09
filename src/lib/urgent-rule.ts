// "Urgent" must mean urgent (9 November 2026). THE rule for the red items on Waiting on you, pure (no server imports).
//
// Before: red was any accounts task, any ORDER NOW, a deposit to record and every car at Ready / pending payment /
// out for delivery, and ANY other item turned red once it had waited 24 hours. So most of the list was red.
//
// Now an item is urgent ONLY for one of three reasons, and it carries the reason in words:
//   1. money at risk - cash taken and not banked, a payment the customer made that is not recorded yet, a car done or
//      leaving with money still owed, a supplier invoice that may be paid twice;
//   2. the promised date has passed, or it is at risk (due within the next 4 working hours and the car is not yet
//      at QC, wash or Ready);
//   3. a customer has been waiting on us for more than 4 working hours (settings `urgent_customer_wait_hours`,
//      the owner changes it in Settings).
// Everything else is "today" (amber) or "when you can" (grey). Nothing turns red just by getting old.

export const DEFAULT_CUSTOMER_WAIT_HOURS = 4;
/** A promised date due within this many working hours, with the car not yet near the end, is at risk. */
export const PROMISE_AT_RISK_HOURS = 4;

/** Statuses where the customer is waiting on US: the counter, the inspection and the price, and the hand-back. */
export const CUSTOMER_WAITS_IN = new Set([
  "gate_in_pending",
  "pending_inspection",
  "pending_road_test",
  "in_inspection",
  "pending_quote",
  "ready",
  "pending_payment",
  "in_delivery",
]);

/** Statuses near the end: a promise due soon is not at risk once the car is here. */
const NEAR_DONE = new Set(["pending_qc", "pending_wash", "ready", "pending_payment", "in_delivery", "closed"]);

export function customerWaitHoursOf(settings: { urgent_customer_wait_hours?: unknown }): number {
  const n = Number(settings.urgent_customer_wait_hours);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CUSTOMER_WAIT_HOURS;
}

export type UrgentFacts = {
  status?: string | null;
  /** Words for the money at risk, when there is some ("AED 4,200.00 still owed on a car that is Ready"). */
  money?: string | null;
  promisedAt?: string | null;
  /** Working hours from now until the promised date (negative once passed); null when there is no date. */
  hoursToPromise?: number | null;
  /** True when this task keeps a customer waiting (see CUSTOMER_WAITS_IN, or a price the customer is waiting for). */
  customerWaiting?: boolean;
  /** Working hours the task has waited. */
  waitedHours?: number | null;
};

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Dubai" });

const hoursWords = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${Math.round(h * 10) / 10} h`.replace(".0 h", " h"));

/** The reason this item is urgent, or null when it is not. */
export function urgentReason(f: UrgentFacts, limitHours: number): string | null {
  if (f.money) return `Money at risk: ${f.money}`;
  if (f.promisedAt && f.status && !["closed"].includes(f.status) && f.hoursToPromise != null) {
    const afterPromiseOk = ["ready", "pending_payment", "in_delivery"].includes(f.status);
    if (f.hoursToPromise < 0 && !afterPromiseOk) return `Promised date passed (${fmtDay(f.promisedAt)})`;
    if (f.hoursToPromise >= 0 && f.hoursToPromise <= PROMISE_AT_RISK_HOURS && !NEAR_DONE.has(f.status)) return `Promised date at risk (due ${fmtDay(f.promisedAt)}, ${hoursWords(f.hoursToPromise)} left)`;
  }
  if (f.customerWaiting && f.waitedHours != null && f.waitedHours > limitHours) return `Customer waiting ${hoursWords(f.waitedHours)} (over ${limitHours} working hours)`;
  return null;
}

/** Header words: "41 waiting · 6 urgent". */
export function waitingHeader(total: number, urgent: number): string {
  return urgent > 0 ? `${total} waiting · ${urgent} urgent` : `${total} waiting`;
}

/**
 * The rule before 9 November 2026, kept ONLY so the test server can report how many items it made red
 * (data-waiting-urgent-old on the panel, test server only). Never used to colour anything.
 */
export function oldRuleRed(i: { actorRole: string | null; status: string | null; line: string; since: string | null; wasRedBefore: boolean }, nowMs: number): boolean {
  if (i.wasRedBefore) return true;
  if (/order now/i.test(i.line)) return true;
  if (i.actorRole === "accounts") return true;
  if (/deposit/i.test(i.line) && /record|waiting for the deposit/i.test(i.line)) return true;
  if (i.status && ["ready", "pending_payment", "in_delivery"].includes(i.status)) return true;
  return !!i.since && nowMs - Date.parse(i.since) > 24 * 3600000;
}

/**
 * The moment a promised date falls due (Dubai): the promised time when one was given, else closing time that day.
 * jobs.promised_at is a DATE; a bare date never means midnight.
 */
export function promiseMoment(date: string, time: string | null | undefined, closeHour: number): string {
  const d = String(date).slice(0, 10);
  const t = time && /^\d{2}:\d{2}/.test(time)
    ? time.slice(0, 5)
    : `${String(Math.floor(closeHour)).padStart(2, "0")}:${String(Math.round((closeHour % 1) * 60)).padStart(2, "0")}`;
  return `${d}T${t}:00+04:00`;
}
