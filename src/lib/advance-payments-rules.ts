/**
 * The PAYMENTS box of an estimate and of the job it becomes (16 November 2026, Section 2). Pure: what was asked as an
 * advance (the proformas), what came in (receipts, cheques still clearing apart), what is still to receive, and the
 * words the box shows. The same reading on the estimate page and on the job card, so the two never disagree.
 */

export type AdvanceAsk = { id: string; number: string; amount: number; at: string; complete: boolean };
export type AdvanceReceipt = { id: string; number: string; amount: number; at: string; method: string; pending: boolean; invoiceNumber: string | null };

export type AdvanceBox = {
  /** What the proformas asked for (a complete proforma = the whole bill). */
  requested: number;
  asks: AdvanceAsk[];
  /** Cleared money. */
  received: number;
  /** Cheques and transfers still waiting for the bank. */
  pending: number;
  receipts: AdvanceReceipt[];
  /** Still to receive of what was asked (never below zero). */
  advanceLeft: number;
  /** Of the whole bill (the estimate's total), after cleared money. */
  totalLeft: number;
  /** Received more than was asked: kept as the customer's advance. */
  extra: number;
  state: "nothing_asked" | "not_received" | "waiting_bank" | "partial" | "received";
  words: string;
};

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/** THE reading of the box. `total` = the estimate's (newest accepted) total. */
export function advanceBoxOf(input: { total: number; asks: AdvanceAsk[]; receipts: AdvanceReceipt[] }): AdvanceBox {
  const asks = [...input.asks].sort((a, b) => a.at.localeCompare(b.at));
  const receipts = [...input.receipts].sort((a, b) => a.at.localeCompare(b.at));
  const requested = r2(asks.reduce((a, x) => a + x.amount, 0));
  const received = r2(receipts.filter((x) => !x.pending).reduce((a, x) => a + x.amount, 0));
  const pending = r2(receipts.filter((x) => x.pending).reduce((a, x) => a + x.amount, 0));
  const advanceLeft = r2(Math.max(0, requested - received));
  const totalLeft = r2(Math.max(0, input.total - received));
  const extra = r2(Math.max(0, received - Math.max(requested, input.total)));
  let state: AdvanceBox["state"];
  if (received > 0.004 && advanceLeft <= 0.004) state = "received";
  else if (received > 0.004) state = "partial";
  else if (pending > 0.004) state = "waiting_bank";
  else if (requested > 0.004) state = "not_received";
  else state = "nothing_asked";
  const aed = (n: number) => `AED ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const words =
    state === "received" ? `Advance received: ${aed(received)}`
    : state === "partial" ? `Part received: ${aed(received)} of ${aed(requested)} · ${aed(advanceLeft)} still to receive`
    : state === "waiting_bank" ? `${aed(pending)} waiting for the bank (not counted yet)`
    : state === "not_received" ? "NOT RECEIVED YET"
    : "No advance asked yet";
  return { requested, asks, received, pending, receipts, advanceLeft, totalLeft, extra, state, words };
}
