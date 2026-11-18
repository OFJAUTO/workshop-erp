/**
 * THE tax-invoice deadline and the cheque rule (18 November 2026, J-00493: the job was done on 6 November, a cheque
 * covered it, and no tax invoice existed). Pure: the invoice page, the accounts dashboard, the hourly job and the tests
 * read it.
 *
 * - A completed job must have its tax invoice within TAX_DUE_DAYS (14) of completion. From TAX_WARN_DAYS (10) accounts
 *   and the owner are told: "TAX INVOICE DUE BY <date>".
 * - "For cheque payments, issue the tax invoice": when the cheque clears (as before), when the cheque is received, or
 *   when the job is completed. Only the owner and accounts change it.
 */
export const TAX_DUE_DAYS = 14;
export const TAX_WARN_DAYS = 10;

export const CHEQUE_TAX_WHEN = ["cleared", "received", "completed"] as const;
export type ChequeTaxWhen = (typeof CHEQUE_TAX_WHEN)[number];
export const CHEQUE_TAX_WORDS: Record<ChequeTaxWhen, string> = {
  cleared: "When the cheque clears (as now)",
  received: "When the cheque is received",
  completed: "When the job is completed",
};
export const CHEQUE_TAX_SETTING = "cheque_tax_invoice_when";

export function chequeTaxWhenOf(raw: unknown): ChequeTaxWhen {
  const v = String(raw ?? "").trim();
  return (CHEQUE_TAX_WHEN as readonly string[]).includes(v) ? (v as ChequeTaxWhen) : "cleared";
}

const day = (iso: string) => new Date(Date.parse(iso) + 4 * 3600000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
export const niceDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export type TaxDue = { completedDay: string; dueDay: string; daysSince: number; daysLeft: number; warn: boolean; late: boolean; words: string };

/** The deadline of a completed job's tax invoice, seen from `today` (a Dubai day). */
export function taxDueOf(completedAt: string, today: string): TaxDue {
  const completedDay = day(completedAt);
  const dueDay = addDays(completedDay, TAX_DUE_DAYS);
  const daysSince = Math.max(0, daysBetween(completedDay, today));
  const daysLeft = daysBetween(today, dueDay);
  const late = daysLeft < 0;
  return { completedDay, dueDay, daysSince, daysLeft, warn: daysSince >= TAX_WARN_DAYS, late, words: late ? `TAX INVOICE OVERDUE SINCE ${niceDay(dueDay).toUpperCase()}` : `TAX INVOICE DUE BY ${niceDay(dueDay).toUpperCase()}` };
}

/** The earliest moment a job counts as completed: Ready to invoice, a Ready / payment / delivery stage, or its proforma. */
export function completedAtOf(stamps: (string | null | undefined)[]): string | null {
  const real = stamps.filter((s): s is string => !!s && Number.isFinite(Date.parse(s)));
  return real.length ? real.sort()[0] : null;
}

/**
 * May accounts issue the tax invoice now? Fully paid (cleared) = yes at once (it was missed). Covered by a cheque or
 * transfer still clearing = yes with the owner's approval. Otherwise no (money still due).
 */
export function earlyTaxStateOf(m: { balance: number; pending: number }): "paid" | "covered" | "due" {
  if (m.balance <= 0.005) return "paid";
  if (m.pending > 0.005 && m.pending + 0.005 >= m.balance) return "covered";
  return "due";
}

export const EARLY_TAX_ASKED = "early_tax_asked";
export const EARLY_TAX_DECIDED = "early_tax_decided";
