/**
 * Documents not sent (evening list of 12 October 2026, item 9). For every open job: the report after approval, the
 * quotation after Parts finish pricing, the proforma after the car is ready, the tax invoice after payment, and the
 * customer's reply to a quotation. Each one is Waiting (grey), Not sent in amber after a first limit, red after a
 * second (with a reminder to the advisor from the hourly job), then green once sent. Working time only. The limits
 * live in Settings (`doc_reminder_limits`), in minutes; the customer's second limit can be "next working day".
 */
import { addDays } from "./calendar";
import { dubaiDate, workingMinutesSince } from "./jobs";
import type { WorkingTime } from "./working-time";
import { DOC_LABELS, type DocKey, type DocLimit, type DocLimits } from "./doc-reminder-defs";

export { DOC_KEYS, DOC_LABELS, DOC_HINTS, DEFAULT_DOC_LIMITS, docLimitsOf, type DocKey, type DocLimit, type DocLimits } from "./doc-reminder-defs";

export type DocTone = "muted" | "amber" | "red" | "green";
export type DocAlert = {
  key: DocKey;
  label: string;
  /** waiting: before the first limit; amber, red: past a limit; sent: done. */
  state: "waiting" | "amber" | "red" | "sent";
  tone: DocTone;
  /** "Report not sent · 25 min", "Quotation sent 14:05", "Sent, not opened · 5 h". */
  text: string;
  /** When the clock started (ISO). */
  since: string;
  /** Working minutes since the clock started (0 once sent). */
  minutes: number;
};

/** What a job's documents look like right now: the raw timestamps the alerts are built from. */
export type DocFacts = {
  jobStatus: string;
  isOpen: boolean;
  /** The inspection approved, and the report link sent and opened. */
  reportApprovedAt: string | null;
  reportSentAt: string | null;
  /** Pricing done (or the inspection approved when the car needs no parts), and the latest quotation. */
  pricingDoneAt: string | null;
  partsCount: number;
  quotation: { sentAt: string | null; openedAt: string | null; respondedAt: string | null; status: string } | null;
  /** The car ready (the stage clock) and the proforma or invoice sent. */
  readyAt: string | null;
  readySentAt: string | null;
  /** A tax invoice made at payment, and when it was sent. */
  taxInvoiceAt: string | null;
  taxInvoiceSentAt: string | null;
};

const timeWords = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dubai" }).format(new Date(iso));
const waitWords = (minutes: number) => (minutes < 60 ? `${minutes} min` : minutes < 60 * 10 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${Math.round(minutes / 60)} h`);

/** True once the next working day after `sinceIso` has started (Dubai time, opening hour). */
export function nextWorkingDayReached(sinceIso: string, wt: WorkingTime, now = new Date()): boolean {
  const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  let day = dubaiDate(new Date(sinceIso));
  for (let i = 0; i < 14; i++) {
    day = addDays(day, 1);
    const dow = DAYS[new Date(`${day}T00:00:00Z`).getUTCDay()];
    if (wt.workingDays.includes(dow)) break;
  }
  // The opening hour of that day, Dubai time (UTC+4, no daylight saving).
  const opens = Date.parse(`${day}T${String(wt.openHour).padStart(2, "0")}:00:00+04:00`);
  return now.getTime() >= opens;
}

function stateOf(sinceIso: string, limit: DocLimit, wt: WorkingTime, now: Date): { state: "waiting" | "amber" | "red"; minutes: number } {
  const minutes = workingMinutesSince(sinceIso, wt, now);
  const red = limit.red === "next_working_day" ? nextWorkingDayReached(sinceIso, wt, now) : minutes >= limit.red;
  if (red) return { state: "red", minutes };
  if (minutes >= limit.amber) return { state: "amber", minutes };
  return { state: "waiting", minutes };
}

/** The alerts of one job, in the order the documents happen. Nothing for closed jobs. */
export function docAlertsOf(f: DocFacts, limits: DocLimits, wt: WorkingTime, now = new Date()): DocAlert[] {
  if (!f.isOpen) return [];
  const out: DocAlert[] = [];
  const push = (key: DocKey, since: string | null, sentAt: string | null, words: { waiting: string; sent: string }) => {
      if (!since) return;
    if (sentAt) {
      out.push({ key, label: DOC_LABELS[key], state: "sent", tone: "green", text: `${words.sent} ${timeWords(sentAt)}`, since, minutes: 0 });
      return;
    }
    const s = stateOf(since, limits[key], wt, now);
    out.push({ key, label: DOC_LABELS[key], state: s.state, tone: s.state === "waiting" ? "muted" : s.state, text: `${words.waiting} · ${waitWords(s.minutes)}`, since, minutes: s.minutes });
  };
  // 1. The inspection report, from approval.
  push("report", f.reportApprovedAt, f.reportSentAt, { waiting: "Report not sent", sent: "Report sent" });
  // 2. The quotation, from Pricing done (or from approval when no parts were requested).
  const quoteClock = f.pricingDoneAt ?? (f.reportApprovedAt && f.partsCount === 0 ? f.reportApprovedAt : null);
  const quoteSent = f.quotation?.sentAt ?? null;
  if (quoteClock && !["approved", "waiting_parts", "in_work", "pending_qc", "pending_wash", "ready", "pending_payment", "in_delivery"].includes(f.jobStatus)) push("quotation", quoteClock, quoteSent, { waiting: "Quotation not sent", sent: "Quotation sent" });
  // 3. The customer's reply, from the quotation being sent: not opened, then opened with no reply.
  if (f.quotation?.sentAt && !f.quotation.respondedAt && ["pending_customer_approval", "pending_quote"].includes(f.jobStatus) && f.quotation.status !== "approved" && f.quotation.status !== "declined") {
    const opened = !!f.quotation.openedAt;
    const s = stateOf(opened ? f.quotation.openedAt! : f.quotation.sentAt, limits.customer_reply, wt, now);
    out.push({ key: "customer_reply", label: DOC_LABELS.customer_reply, state: s.state, tone: s.state === "waiting" ? "muted" : s.state, text: `${opened ? "Opened, no reply" : "Sent, not opened"} · ${waitWords(s.minutes)}`, since: f.quotation.sentAt, minutes: s.minutes });
  }
  // 4. The proforma, from the car being ready.
  if (["ready", "pending_payment", "in_delivery"].includes(f.jobStatus)) push("proforma", f.readyAt, f.readySentAt, { waiting: "Proforma not sent", sent: "Proforma sent" });
  // 5. The tax invoice, from the payment that made it.
  push("tax_invoice", f.taxInvoiceAt, f.taxInvoiceSentAt, { waiting: "Tax invoice not sent", sent: "Tax invoice sent" });
  return out;
}

/** The one line for a job card or a dashboard row: the worst open alert first, else the latest sent one. */
export function docHeadline(alerts: DocAlert[]): DocAlert | null {
  const rank = (a: DocAlert) => (a.state === "red" ? 0 : a.state === "amber" ? 1 : a.state === "waiting" ? 2 : 3);
  return [...alerts].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Jobs with a document past its first limit: the "Not sent" count of the dashboard's Pending row. */
export const docNotSent = (alerts: DocAlert[]) => alerts.some((a) => a.state === "amber" || a.state === "red");
