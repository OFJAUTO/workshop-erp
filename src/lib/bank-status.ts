/*
 * THE rule of money that waits for the bank (9 November 2026, Section 2; J-00858's cheque RCT-00058 showed "Paid so far
 * 0.00 · Cheque pending clearance" with no way to clear it, and was recorded twice more). Pure, no imports.
 *
 * A cheque counts as paid only once it has cleared. A bank transfer recorded from 9 November 2026 waits too: it is
 * saved with cheque_status = 'pending' (the column is the payment's BANK status for both methods) until accounts
 * confirm it reached the bank. A transfer with no bank status (recorded before) counts as it always did. A bounced
 * cheque or a transfer that never arrived counts for nothing. Every money reader asks these two functions.
 */

export type BankStatusLike = { method: string; cheque_status: string | null | undefined };

/** The methods whose money waits for the bank. */
export const BANK_METHODS = ["cheque", "transfer"] as const;
export const isBankMethod = (m: string) => m === "cheque" || m === "transfer";

/** Waiting for the bank: a cheque not cleared yet, a transfer not confirmed yet. */
export function awaitsBank(p: BankStatusLike): boolean {
  return isBankMethod(p.method) && p.cheque_status === "pending";
}

/** Counts as money in: anything but a cheque not cleared, a transfer not confirmed, or a bounced one. */
export function countsAsPaid(p: BankStatusLike): boolean {
  if (p.method === "cheque") return p.cheque_status === "cleared";
  if (p.method === "transfer") return p.cheque_status !== "pending" && p.cheque_status !== "bounced";
  return true;
}

/** "Cheque" / "Transfer": the words for what waits. */
export const bankWord = (method: string) => (method === "cheque" ? "Cheque" : "Transfer");

/** A post-dated cheque cannot be deposited before its date: "due on 12 Nov 2026" (null when it can go in). */
export function chequeNotDue(chequeDate: string | null | undefined, today: string): string | null {
  if (!chequeDate) return null;
  const d = String(chequeDate).slice(0, 10);
  if (d <= today) return null;
  const [y, m, day] = d.split("-").map(Number);
  const words = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `due on ${words}`;
}

/** What a bank transfer that arrived short or over does: less = the balance stays open, more = the rest is an advance. */
export function transferArrival(recorded: number, arrived: number): { kind: "exact" | "less" | "more"; difference: number } {
  const diff = Math.round((arrived - recorded) * 100) / 100;
  if (Math.abs(diff) < 0.005) return { kind: "exact", difference: 0 };
  return diff < 0 ? { kind: "less", difference: -diff } : { kind: "more", difference: diff };
}

/** The pending words on a job: "Paid 0.00 · Cheque pending 2,131.50 (RCT-00058) · Balance once cleared 0.00". */
export function pendingLine(a: { paid: number; pending: { method: string; number: string; amount: number }[]; balance: number | null }): string | null {
  if (!a.pending.length) return null;
  const m = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sum = a.pending.reduce((x, p) => x + p.amount, 0);
  const after = a.balance === null ? null : Math.max(0, Math.round((a.balance - sum) * 100) / 100);
  const parts = a.pending.map((p) => `${bankWord(p.method)} pending ${m(p.amount)} (${p.number})`);
  return [`Paid ${m(a.paid)}`, ...parts, after === null ? null : `Balance once cleared ${m(after)}`].filter(Boolean).join(" · ");
}

/** The duplicate warning: money already waiting for the bank covers what is due. */
export function duplicateWords(pending: { method: string; number: string; amount: number }[], due: number | null): string | null {
  if (!pending.length || due === null) return null;
  const sum = pending.reduce((x, p) => x + p.amount, 0);
  if (sum + 0.004 < due || due <= 0.004) return null;
  const m = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const first = pending[0];
  const what = pending.length === 1 ? `A ${bankWord(first.method).toLowerCase()} for AED ${m(first.amount)} is already pending (${first.number})` : `${pending.length} payments for AED ${m(sum)} are already pending (${pending.map((p) => p.number).join(", ")})`;
  return `${what}. Record another anyway?`;
}

/**
 * The day a payment counts in Zoho (the posting and the daily reconciliation read this ONE rule). Once Accounts posting
 * is applied a cheque or transfer goes into Undeposited Funds on the day it was received (and the posting moves it to
 * the bank later); before that, or for one cleared before it reached Zoho without a posting, it posts on its clearing
 * day. A cheque or transfer still waiting before the change is not in Zoho at all (null). Everything else: received.
 */
export function zohoPayDay(p: BankStatusLike & { received_at: string; cleared_at: string | null; settlement_id?: string | null }, postingReady: boolean): string | null {
  if (!isBankMethod(p.method)) return p.received_at;
  if (p.cheque_status === null || p.cheque_status === undefined) return p.method === "transfer" ? p.received_at : (p.cleared_at ?? p.received_at);
  if (p.cheque_status === "bounced") return null;
  if (postingReady && (p.cheque_status === "pending" || !!p.settlement_id)) return p.received_at;
  if (p.cheque_status === "pending") return null;
  return p.cleared_at ?? p.received_at;
}
