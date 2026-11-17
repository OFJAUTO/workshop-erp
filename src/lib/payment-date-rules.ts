/*
 * THE payment date (17 November 2026, Section 3; the E-00095 case: "Record a payment" had no date, so every payment was
 * stamped with the day it was typed, and Record a settlement could not go earlier than that wrong day). Pure rules, no
 * server imports (the unit tests run them):
 *  - the date starts on today and can be set earlier, never in the future;
 *  - advisors: today or up to 3 days back; accounts and the owner: any day of a month that is not closed;
 *  - a day in a CLOSED month (settings.books_closed_through, "YYYY-MM") needs the owner;
 *  - the stamp saved: now for today, noon Dubai for an earlier day (so every report puts it on that Dubai day);
 *  - the words when a payment and its tax invoice sit in different months (never a silent change of the invoice).
 */

export const ADVISOR_BACK_DAYS = 3;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A calendar day moved by n days ("YYYY-MM-DD"). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "November 2026" for "2026-11-14". */
export function monthWords(day: string): string {
  const [y, m] = day.slice(0, 7).split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
}

/** Is this day in a closed month? ("YYYY-MM" closed through; empty = nothing closed). */
export function inClosedMonth(day: string, closedThrough: string | null | undefined): boolean {
  const c = String(closedThrough ?? "").trim();
  return /^\d{4}-\d{2}$/.test(c) && day.slice(0, 7) <= c;
}

export type DateRole = "owner" | "accounts" | "advisor" | "other";
export const dateRoleOf = (roleId: string): DateRole => (roleId === "owner" ? "owner" : roleId === "accounts" ? "accounts" : roleId === "service_advisor" ? "advisor" : "other");

/** The earliest day this person may pick without asking anyone (null = no earlier limit but the closed month). */
export function earliestDay(role: DateRole, today: string): string | null {
  return role === "advisor" || role === "other" ? addDays(today, -ADVISOR_BACK_DAYS) : null;
}

export type DateCheck = { ok: true } | { ok: false; error: string; needsOwner?: boolean };

/** THE check of a payment date, on the server for every save and on the screen while typing. */
export function checkPaymentDate(input: { day: string; today: string; role: DateRole; closedThrough?: string | null }): DateCheck {
  const { day, today, role } = input;
  if (!ISO.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`)) || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) return { ok: false, error: "Pick the payment date (or type it as day/month/year)." };
  if (day > today) return { ok: false, error: "The payment date cannot be in the future." };
  const min = earliestDay(role, today);
  if (min && day < min) return { ok: false, error: `Advisors can set today or up to ${ADVISOR_BACK_DAYS} days back (from ${min}). For an earlier date, ask accounts.` };
  if (inClosedMonth(day, input.closedThrough) && role !== "owner") return { ok: false, needsOwner: true, error: `${monthWords(day)} is closed: a payment dated in it needs the owner. Ask the owner to record or correct it.` };
  return { ok: true };
}

/** The stamp saved for a picked day: the moment itself for today, noon in Dubai for an earlier day. */
export function stampOfDay(day: string, today: string, nowIso: string): string {
  return day === today ? nowIso : `${day}T12:00:00+04:00`;
}

/** The Dubai day of a stored stamp. */
export function dubaiDayOf(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(Date.parse(iso) + 4 * 3600000).toISOString().slice(0, 10);
}

/** "RCT-00041 is dated 30 Oct 2026 (October 2026) but its tax invoice INV-00012 is dated 2 Nov 2026 (November 2026)". */
export function monthMismatchWords(payment: { number: string; day: string }, invoice: { number: string; day: string } | null): string | null {
  if (!invoice || !invoice.day || !payment.day) return null;
  if (payment.day.slice(0, 7) === invoice.day.slice(0, 7)) return null;
  const nice = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${payment.number} is dated ${nice(payment.day)} (${monthWords(payment.day)}) but its tax invoice ${invoice.number} is dated ${nice(invoice.day)} (${monthWords(invoice.day)}). The tax invoice's date is not changed: check the VAT month.`;
}

/**
 * The date typed in the box: "16/11/2026", "16-11-26", "16.11.2026", "2026-11-16" → "2026-11-16"; anything else null.
 * Day first (the UAE way).
 */
export function parseTypedDay(text: string): string | null {
  const t = text.trim();
  if (ISO.test(t)) return t;
  const m = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/.exec(t);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

/** "2026-11-16" → "16/11/2026" (how the box shows a picked day). */
export function showDay(day: string): string {
  return ISO.test(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : "";
}
