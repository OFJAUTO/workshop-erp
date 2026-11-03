/**
 * PAYMENT HAND-OVER (2 November 2026, section 3; J-00969). An advisor takes a payment at the counter but only accounts and
 * the owner record money: "Payment received – send to accounts" makes a PAYMENT REPORT that accounts record (one tap
 * opens the Record payment window pre-filled) or query back. These are the pure rules of it - the one wording of a
 * report line, the input checks, the working-hours reminder - shared by the screens, the server and the tests.
 */
import { AUTH_CODE_RE, cleanAuthCode, needsAuthCode } from "./auth-code";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "./money-steps";
import { workingHoursBetween, type WorkingTime } from "./working-time";

export type ReportStatus = "waiting" | "recorded" | "queried" | "withdrawn";

/** Reported and not recorded or queried within this many working hours: accounts and the owner are reminded once. */
export const DEFAULT_REPORT_REMINDER_HOURS = 4;
export const REPORT_REFERENCE_MAX = 80;
export const REPORT_NOTE_MAX = 500;
export const REPORT_QUERY_MIN = 3;

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Anas" from "Anas Khan" (the reporter as the line names him). */
export function firstName(name: string | null | undefined): string {
  return String(name ?? "").trim().split(/\s+/)[0] || "an advisor";
}

/** "Card", "Payment link", "Bank transfer". */
export function methodWord(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

/**
 * THE line of a report, everywhere it is listed (Waiting on you, the notification, the Invoices card), in the owner's
 * words: "J-00969 · DUBAI GG 13706 · MERCEDES-BENZ S 580 · <CUSTOMER> · AED 37,930.00 · Card · from Anas".
 */
export function reportLine(r: { jobNumber: string; plate: string; car: string; customer: string; amount: number; method: string; reporter: string | null }): string {
  return [r.jobNumber, r.plate.toUpperCase(), r.car.toUpperCase(), r.customer, aed(r.amount), methodWord(r.method), `from ${firstName(r.reporter)}`].filter((x) => x && x.trim()).join(" · ");
}

/** "Card · auth 123456" or "Bank transfer · ref TT-55" - what the slip said, for the job card and the window. */
export function reportMethodWords(r: { method: string; authCode: string | null; reference: string | null }): string {
  return [methodWord(r.method), r.authCode ? `auth ${r.authCode}` : r.reference ? `ref ${r.reference}` : ""].filter(Boolean).join(" · ");
}

/** The reminder setting: whole working hours, 1 to 24, 4 when not set. */
export function reminderHoursOf(settings: Record<string, unknown> | null | undefined): number {
  const n = Number((settings ?? {}).payment_report_reminder_hours);
  return Number.isFinite(n) && n >= 1 && n <= 24 ? Math.round(n) : DEFAULT_REPORT_REMINDER_HOURS;
}

/** Working hours since the report (the opening hours on working days, breaks out). */
export function reportWorkingHours(reportedAt: string | number | Date, now: string | number | Date, wt: WorkingTime): number {
  return workingHoursBetween(reportedAt, now, wt);
}

/** Not recorded or queried within the set working hours: the reminder is due and the Waiting line turns red. */
export function reportLate(reportedAt: string | number | Date, now: string | number | Date, wt: WorkingTime, hours: number): boolean {
  return reportWorkingHours(reportedAt, now, wt) >= hours;
}

export type ReportInput = { amount: unknown; method: unknown; authCode?: unknown; reference?: unknown; note?: unknown };
export type CleanReport = { amount: number; method: string; authCode: string | null; reference: string | null; note: string | null };

/**
 * The advisor's form, checked the same way on the screen and on the server: an amount above zero, one of the five
 * methods, an auth code that is 6 letters or digits when given (optional here - accounts type it when they record if
 * it is missing), a short reference and note.
 */
export function checkReportInput(i: ReportInput): { error: string } | { ok: CleanReport } {
  const amount = Math.round(Number(String(i.amount ?? "").replace(/,/g, "").trim()) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Type the amount the customer paid." };
  if (amount > 10_000_000) return { error: "That amount is too large – check it." };
  const method = String(i.method ?? "");
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) return { error: "Choose how the customer paid." };
  const code = cleanAuthCode(i.authCode);
  if (code && !needsAuthCode(method)) return { error: "An auth code is only for card and payment-link payments – write it as the reference." };
  if (code && !AUTH_CODE_RE.test(code)) return { error: `The auth code is 6 letters or digits; "${code}" has ${code.length}. Leave it empty if you don't have it.` };
  const reference = String(i.reference ?? "").trim();
  if (reference.length > REPORT_REFERENCE_MAX) return { error: `The reference is too long (${REPORT_REFERENCE_MAX} characters at most).` };
  const note = String(i.note ?? "").trim();
  if (note.length > REPORT_NOTE_MAX) return { error: `The note is too long (${REPORT_NOTE_MAX} characters at most).` };
  return { ok: { amount, method, authCode: code || null, reference: reference || null, note: note || null } };
}

/** The status words on the job card and in the window. */
export function reportStatusWords(r: { status: ReportStatus; reporter: string | null; recordedBy?: string | null; paymentNumber?: string | null; queriedBy?: string | null; queryNote?: string | null }): string {
  if (r.status === "recorded") return `Recorded ✓ ${r.paymentNumber ?? ""}${r.recordedBy ? ` by ${firstName(r.recordedBy)}` : ""}`.replace(/\s+/g, " ").trim();
  if (r.status === "queried") return `Query from ${firstName(r.queriedBy)}: ${r.queryNote ?? ""}`.trim();
  if (r.status === "withdrawn") return `Withdrawn by ${firstName(r.reporter)}`;
  return `Payment reported by ${firstName(r.reporter)} · waiting for accounts`;
}

/**
 * THE rule of when an advisor may send a payment to accounts, the same on the job card and the money page: something is
 * owed on the car - the balance is above zero, or nothing is approved yet to measure against. Open or gone alike (a car
 * that left on credit terms still owes).
 */
export function stillOwes(m: { balance: number | null } | null | undefined): boolean {
  return !!m && (m.balance === null || m.balance > 0.005);
}

/** What a slip is: a photo, a PDF (bank transfer confirmations come as PDFs) or a video - each shown its own way. */
export type SlipKind = "image" | "pdf" | "video";

export function slipKind(contentType: string | null | undefined, path: string | null | undefined): SlipKind {
  const t = String(contentType ?? "").toLowerCase();
  const p = String(path ?? "").toLowerCase();
  if (t === "application/pdf" || p.endsWith(".pdf")) return "pdf";
  if (t.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/.test(p)) return "video";
  return "image";
}

/** Codes and references compared without spaces, dashes or letter case. */
const codeOf = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Two references of the same transfer: the same, or one inside the other (a bank's "FT2611…" against the advisor's "2611…"). */
const refsAgree = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)));

export type ReportCandidate = { id: string; amount: number; status: ReportStatus; authCode: string | null; reference: string | null; reportedAt: string };

/**
 * Which report a receipt recorded ANOTHER way answers (the money page, the deposit panel, Pay now - not from the report
 * itself): one on the same job and method (the caller filters those) for the same amount, waiting for accounts or queried
 * back (the money arrived after the query). A report whose auth code or reference says it is a DIFFERENT payment is never
 * taken - two card payments of the same amount stay two. A matching code or reference comes first, then waiting before
 * queried, then the oldest. Null = no report is answered by this receipt.
 */
export function pickReportForReceipt(reports: ReportCandidate[], receipt: { amount: number; authCode?: string | null; reference?: string | null }): string | null {
  const ra = codeOf(receipt.authCode);
  const rr = codeOf(receipt.reference);
  const scored: { r: ReportCandidate; rank: number }[] = [];
  for (const r of reports) {
    if (!(r.status === "waiting" || r.status === "queried")) continue;
    if (Math.abs((Number(r.amount) || 0) - receipt.amount) >= 0.005) continue;
    const a = codeOf(r.authCode);
    const ref = codeOf(r.reference);
    if (a && ra && a !== ra) continue;
    if (ref && rr && !refsAgree(ref, rr)) continue;
    const exact = (!!a && a === ra) || (!!ref && !!rr && refsAgree(ref, rr));
    scored.push({ r, rank: (exact ? 0 : 2) + (r.status === "waiting" ? 0 : 1) });
  }
  scored.sort((x, y) => x.rank - y.rank || Date.parse(x.r.reportedAt) - Date.parse(y.r.reportedAt));
  return scored[0]?.r.id ?? null;
}

/** Why a report cannot be recorded any more (the window says it instead of the form). */
export function reportClosedWords(r: { status: ReportStatus; paymentNumber?: string | null; queriedBy?: string | null; queryNote?: string | null; reporter?: string | null }): string | null {
  if (r.status === "waiting") return null;
  if (r.status === "recorded") return `Already recorded${r.paymentNumber ? ` as ${r.paymentNumber}` : ""}.`;
  if (r.status === "queried") return `Queried by ${firstName(r.queriedBy)}: ${r.queryNote ?? ""}. The advisor sends it again when it is sorted.`;
  return `Withdrawn by ${firstName(r.reporter)}.`;
}
