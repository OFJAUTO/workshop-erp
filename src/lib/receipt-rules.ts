/**
 * THE SUPPLIER'S INVOICE NUMBER AT RECEIVING (13 November 2026). Pure rules: the due date of an "invoice comes later"
 * receipt, which reminder is due (day 3, day 5, then every day while overdue), the tag, who may replace a file.
 */

export const MAX_LATER_DAYS = 5;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** The Dubai calendar day of an instant ("2026-11-13"). */
export const dubaiDay = (iso: string | number | Date) => new Date(new Date(iso).getTime() + 4 * 3600000).toISOString().slice(0, 10);
const dayNum = (d: string) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`) / 86400000;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d.slice(0, 10)}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** Whole days from the first Dubai day to the second (0 on the same day). */
export const daysBetween = (from: string, to: string) => Math.round(dayNum(to) - dayNum(from));

/** The supplier's own limit, never above 5 days. */
export const laterDays = (days: number | null | undefined) => Math.min(MAX_LATER_DAYS, Math.max(1, Math.round(Number(days) || MAX_LATER_DAYS)));

/** "INVOICE DUE BY 18 NOV 2026". */
export function dueTag(due: string | null): string {
  if (!due) return "INVOICE DUE";
  const [y, m, d] = due.slice(0, 10).split("-").map(Number);
  return `INVOICE DUE BY ${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

/** What a typed number must look like (the same rule as the invoice box). */
export function receiptNumberProblem(raw: string): string | null {
  const n = raw.trim();
  if (!n) return "Type the supplier's invoice number (it is on the supplier's paper).";
  if (n.length < 3 || n.length > 80 || !/^[A-Za-z0-9 /\-._#]+$/.test(n) || !/\d/.test(n)) return `"${n}" does not look like an invoice number: type it as printed on the supplier's paper.`;
  const compact = n.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (/^(.)\1+$/.test(compact)) return `"${n}" does not look like an invoice number: type it as printed on the supplier's paper.`;
  return null;
}

/** Compare numbers the way people type them ("INV-123" = "inv 123"). */
export const sameNumber = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.replace(/[^A-Za-z0-9]/g, "").toUpperCase() === b.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

export type ReminderFacts = { received_at: string; invoice_due_date: string | null; invoice_number: string | null; invoice_later: boolean; reminded_day3_at: string | null; reminded_day5_at: string | null; last_reminded_on: string | null; is_active: boolean };
export type ReminderStep = "day3" | "day5" | "overdue";

/** Which reminder is due today for an "invoice comes later" receipt (one a day at most). */
export function reminderDue(r: ReminderFacts, today: string): ReminderStep | null {
  if (!r.is_active || !r.invoice_later || r.invoice_number) return null;
  if (r.last_reminded_on && r.last_reminded_on >= today) return null;
  const day = daysBetween(dubaiDay(r.received_at), today);
  if (r.invoice_due_date && today > r.invoice_due_date && (r.reminded_day5_at || day > 5)) return "overdue";
  if (day >= 5 && !r.reminded_day5_at) return "day5";
  if (day >= 3 && !r.reminded_day3_at) return "day3";
  if (r.invoice_due_date && today > r.invoice_due_date) return "overdue";
  return null;
}

export function reminderWords(step: ReminderStep, supplier: string, po: string, due: string | null, today: string): { title: string; body: string } {
  const late = due ? daysBetween(due, today) : 0;
  if (step === "overdue") return { title: `Supplier invoice OVERDUE · ${po}`, body: `${supplier}: the invoice was due ${dueTag(due).replace("INVOICE DUE BY ", "on ")} (${late} day${late === 1 ? "" : "s"} late). Get it from the supplier and type the number on the receipt.` };
  return { title: `Supplier invoice still missing (day ${step === "day3" ? 3 : 5}) · ${po}`, body: `${supplier}: ${dueTag(due).toLowerCase().replace("invoice due by", "the invoice is due by")}. Type the number on the receipt as soon as it comes.` };
}

/** "2 of 5 received": parts (lines) fully received out of all lines. */
export function receivedCountWords(lines: { quantity: number; received_qty: number }[]): string {
  const done = lines.filter((l) => l.received_qty + 0.005 >= l.quantity).length;
  return `${done} of ${lines.length} received`;
}

/** Owner and accounts replace any file at any time; the parts desk only its delivery-paper photo, until accounts checked the invoice. */
export function mayReplaceFile(role: string, kind: "paper" | "invoice", invoiceChecked: boolean): boolean {
  if (role === "owner" || role === "accounts") return true;
  return role === "parts" && kind === "paper" && !invoiceChecked;
}
/** Owner and accounts correct a number; the parts desk only types a missing one. */
export const mayCorrectNumber = (role: string) => role === "owner" || role === "accounts";
export const mayTypeMissingNumber = (role: string) => role === "owner" || role === "accounts" || role === "parts";
