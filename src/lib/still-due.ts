/**
 * THE "still due" figure (10 November 2026, "paid means paid"). One rule for every place that offers the customer a way
 * to pay: the proforma page, the "car is ready" window and its WhatsApp message, the customer's link, Pay now, the
 * advisor's payment link and payment report. Pure: no server imports.
 *
 * - paid: nothing left once cleared money is counted. No payment options, no link; "fully paid, thank you".
 * - waiting_clear: a cheque or bank transfer waiting to clear covers what is left. No new link: the customer is never
 *   asked to pay twice; "Payment received – waiting to clear".
 * - part: some money is in (or waiting to clear) and some is still to pay: only the remaining figure is offered.
 * - due: nothing received yet.
 * - none: no approved total to measure against yet.
 */
export type DueState = "none" | "due" | "part" | "waiting_clear" | "paid";

export type StillDue = {
  state: DueState;
  total: number | null;
  /** Cleared money in. */
  paid: number;
  /** Cheques / transfers received and waiting to clear. */
  pending: number;
  /** What may still be asked of the customer: the balance less what is waiting to clear (0 when paid or covered). */
  due: number;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function stillDueOf(m: { total: number | null; paid: number; balance: number | null; pendingCheque?: number; pending?: number } | null | undefined): StillDue {
  if (!m) return { state: "none", total: null, paid: 0, pending: 0, due: 0 };
  const pending = r2(Math.max(0, m.pending ?? m.pendingCheque ?? 0));
  const paid = r2(Math.max(0, m.paid ?? 0));
  if (m.total === null || m.balance === null) return { state: "none", total: m.total, paid, pending, due: 0 };
  const balance = r2(Math.max(0, m.balance));
  if (balance <= 0.005) return { state: "paid", total: m.total, paid, pending, due: 0 };
  const due = r2(Math.max(0, balance - pending));
  if (due <= 0.005) return { state: "waiting_clear", total: m.total, paid, pending, due: 0 };
  return { state: paid > 0.005 || pending > 0.005 ? "part" : "due", total: m.total, paid, pending, due };
}

/** May the customer be offered a way to pay (Pay now, a payment link, "how will you pay")? */
export function mayOfferPayment(d: StillDue): boolean {
  return d.state === "due" || d.state === "part" || d.state === "none";
}

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const PAID_THANKS = "Fully paid, thank you";
export const WAITING_CLEAR = "Payment received – waiting to clear";

/** The short words for the state (customer page heading, staff lines). */
export function stillDueWords(d: StillDue): string {
  if (d.state === "paid") return PAID_THANKS;
  if (d.state === "waiting_clear") return WAITING_CLEAR;
  if (d.state === "part") return `${aed(d.due)} still to pay${d.pending > 0.005 ? ` (${aed(d.pending)} waiting to clear)` : ""}`;
  if (d.state === "due") return `${aed(d.due)} due`;
  return "";
}

/** "Your car is ready" when the money is already in: never a payment option. [name], [make model], [plate] and [link] are filled by the caller. */
export const READY_PAID_TEMPLATE = "Dear [name],\n\nYour *[make model]* ([plate]) is ready – fully paid, thank you.\n\nYour invoice and receipts are here:\n[link]\n\nOFJ Automotive";
export const READY_WAITING_TEMPLATE = "Dear [name],\n\nYour *[make model]* ([plate]) is ready.\n\nPayment received – waiting to clear. There is nothing more to pay; we will confirm once it has cleared.\n\nYour proforma is here:\n[link]\n\nOFJ Automotive";

/**
 * THE "car is ready" message template for the money as it stands: the owner's template while something is due (with the
 * remaining figure after the link when part of it is in), the built-in paid / waiting wording otherwise.
 */
export function readyTemplateFor(template: string, d: StillDue): string {
  if (d.state === "paid") return READY_PAID_TEMPLATE;
  if (d.state === "waiting_clear") return READY_WAITING_TEMPLATE;
  if (d.state === "part") {
    const line = `Received so far ${aed(r2(d.paid + d.pending))}${d.pending > 0.005 ? ` (${aed(d.pending)} waiting to clear)` : ""}. Balance due: ${aed(d.due)}.`;
    return template.includes("[link]") ? template.replace("[link]", `[link]\n\n${line}`) : `${template}\n\n${line}`;
  }
  return template;
}

/**
 * THE balance headline of a job or document (18 November 2026, J-00493: a cheque of AED 12,600.00 waiting to clear and
 * the page said "BALANCE DUE AED 12,600.00" in red). Red BALANCE DUE only for money nobody has paid in any form:
 * - covered: "COVERED BY CHEQUE - WAITING TO CLEAR" in amber, "Balance once cleared: AED 0.00";
 * - part: "Cheque pending AED x" (amber) and "Balance due AED y" (red);
 * - due: "BALANCE DUE AED x" (red); paid: "Paid in full" (green).
 * The word is "transfer" ("waiting to confirm") when every waiting payment is a bank transfer.
 */
export type BalanceWordsKind = "none" | "paid" | "covered" | "part_pending" | "due";
export type BalanceWords = { kind: BalanceWordsKind; headline: string; tone: "green" | "amber" | "red" | "muted"; pendingLine: string | null; dueLine: string | null; after: string | null; due: number; pending: number };

const aedText = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function balanceWordsOf(d: StillDue, word: "cheque" | "transfer" = "cheque"): BalanceWords {
  const W = word === "transfer" ? "Transfer" : "Cheque";
  const base = { due: d.due, pending: d.pending };
  if (d.state === "none") return { ...base, kind: "none", headline: "No approved total yet", tone: "muted", pendingLine: d.pending > 0.005 ? `${W} pending ${aedText(d.pending)}` : null, dueLine: null, after: null };
  if (d.state === "paid") return { ...base, kind: "paid", headline: "Paid in full", tone: "green", pendingLine: null, dueLine: null, after: null };
  if (d.state === "waiting_clear") return { ...base, kind: "covered", headline: word === "transfer" ? "COVERED BY TRANSFER – WAITING TO CONFIRM" : "COVERED BY CHEQUE – WAITING TO CLEAR", tone: "amber", pendingLine: `${W} pending ${aedText(d.pending)}`, dueLine: null, after: `Balance once cleared: ${aedText(0)}` };
  if (d.pending > 0.005) return { ...base, kind: "part_pending", headline: `BALANCE DUE ${aedText(d.due)}`, tone: "red", pendingLine: `${W} pending ${aedText(d.pending)}`, dueLine: `Balance due ${aedText(d.due)}`, after: null };
  return { ...base, kind: "due", headline: `BALANCE DUE ${aedText(d.due)}`, tone: "red", pendingLine: null, dueLine: `Balance due ${aedText(d.due)}`, after: null };
}

/** The word of the waiting money: "transfer" when every waiting payment is a bank transfer, else "cheque". */
export function waitingWordOf(methods: string[]): "cheque" | "transfer" {
  return methods.length && methods.every((m) => m === "transfer") ? "transfer" : "cheque";
}

/** What holds the car at the gate, in THE balance words (18 November 2026): money waiting to clear is never "Balance due". */
export function balanceBlockWords(b: { balance: number; invoiceNumber: string | null; pending?: number }): string {
  const aed = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2 });
  const on = b.invoiceNumber ? ` on ${b.invoiceNumber}` : "";
  const pend = b.pending ?? 0;
  if (pend > 0.005 && pend + 0.005 >= b.balance) return `Covered by cheque – waiting to clear (AED ${aed(b.balance)}${on}). The car leaves once it clears, or on the customer's credit terms.`;
  if (pend > 0.005) return `Cheque pending AED ${aed(pend)} · Balance due AED ${aed(Math.max(0, b.balance - pend))}${on}.`;
  return `Balance due AED ${aed(b.balance)}${on}.`;
}
