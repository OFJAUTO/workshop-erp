/**
 * THE endings of a part that was ordered and is no longer needed (3 November 2026, section 7, J-00969: "Remove: not
 * needed (ordered: choose its ending)" seemed to go through, but the part stayed "Ordered", stayed on LPO-00037-1 and
 * in Our cost). Pure and import-free (the browser, the server and the unit tests read the same rules):
 *
 *   Cancelled with the supplier   - nothing delivered yet: the LPO line is cancelled, the LPO total goes down.
 *   Return to supplier            - delivered: it goes back; a supplier credit note is awaited (tracked) and recorded
 *                                   later (number or scan), then it becomes a supplier credit in Zoho.
 *   Keep in stock                 - delivered: it goes on our shelf; its cost moves from the job to the stock item.
 *
 * Every ending takes the part's cost off the job (final cost 0), greys the row "Removed – <ending> by <name>", and
 * never changes a price the customer approved: the advisor revises the quotation (the owner allows it).
 *
 * Stored on part_items.disposition ("cancelled", "return_pending", "returned", "stock"). Before migration
 * 20261203140000_part_endings widens the disposition check, "cancelled" and "return_pending" cannot be written there:
 * they are then stored as disposition NULL with disposition_at set (only an ending ever writes disposition_at without a
 * disposition), told apart by return_status ("to_return" = waiting for the credit note, else cancelled).
 */

export type EndingKey = "cancelled" | "return" | "stock";
export type EndingState = "cancelled" | "return_pending" | "returned" | "stock";

/** The columns the rules read; any part row carries them. */
export type EndingPart = {
  is_active?: boolean | null;
  order_status?: string | null;
  quantity?: number | string | null;
  confirmed_quantity?: number | string | null;
  received_qty?: number | string | null;
  issue_status?: string | null;
  availability?: string | null;
  supplier?: string | null;
  stock_item_id?: string | null;
  disposition?: string | null;
  disposition_at?: string | null;
  return_status?: string | null;
  exchange_status?: string | null;
  replacement_part_id?: string | null;
  removed_at?: string | null;
  refused_at?: string | null;
};

export const ENDING_LABEL: Record<EndingState, string> = {
  cancelled: "Cancelled with the supplier",
  return_pending: "Return to supplier – credit note awaited",
  returned: "Returned to supplier – credit note in",
  stock: "Kept in stock",
};

/** On an LPO line: what happened to the part it ordered. */
export const LINE_ENDING_LABEL: Record<EndingState, string> = {
  cancelled: "Cancelled – not delivered",
  return_pending: "Returned – credit note awaited",
  returned: "Returned – credit note in",
  stock: "Kept in our stock",
};

const isOurStockName = (s: string | null | undefined) => /^our stock$/i.test(String(s ?? "").trim());
const num = (v: number | string | null | undefined) => Number(v) || 0;

/** The quantity the part was ordered in. */
export const orderedQty = (p: EndingPart) => num(p.confirmed_quantity ?? p.quantity) || 1;
/** What physically arrived (0 = nothing delivered). */
export const deliveredQty = (p: EndingPart) => Math.max(0, num(p.received_qty));
/** Taken from our own shelf, never bought for this job from a supplier. */
export const fromOurShelf = (p: EndingPart) => isOurStockName(p.supplier) || (p.availability === "in_stock" && !!p.stock_item_id);

/** The ending a part has, or null. Also reads the before-the-migration storage (disposition NULL, disposition_at set). */
export function endingOf(p: EndingPart): EndingState | null {
  if (p.disposition === "cancelled" || p.disposition === "return_pending" || p.disposition === "returned" || p.disposition === "stock") return p.disposition;
  if (!p.disposition && p.disposition_at) return p.return_status === "to_return" ? "return_pending" : "cancelled";
  return null;
}

/** "Removed – Cancelled with the supplier by Omar": the ONE label on the Parts row, the trail and the lists. */
export function endingWords(state: EndingState, by: string | null | undefined): string {
  return `Removed – ${ENDING_LABEL[state]}${by ? ` by ${by}` : ""}`;
}

/** An ending still counts its cost on the job? Never (the cost is off the job: cancelled, back to the supplier, or in stock). */
export const partCostCounts = (p: EndingPart) => !endingOf(p);

/**
 * A wrong or faulty part in its exchange (exchangePart: the correct one raised for ordering). THE rule for "being
 * exchanged": only the exchange status says so - a part replaced by another supplier's part (Replace, 1 November 2026)
 * also carries replacement_part_id but was never delivered and takes the endings like any part not needed.
 */
export const isExchanging = (p: EndingPart) => p.exchange_status === "needed" || p.exchange_status === "ordered";

export type EndingOption = { key: EndingKey; label: string; help: string; allowed: boolean; why: string | null };
export type EndingChoices = { options: EndingOption[]; /** Nothing can be chosen here, and why. */ refusal: string | null; /** The button pre-selected. */ suggested: EndingKey | null; /** "Only 1 of 2 arrived: …" */ partly: string | null };

const pcs = (n: number) => `${n % 1 === 0 ? n : n.toFixed(2)}`;

/**
 * Which endings a part may take, each with one line of help, or the plain reason it is greyed. The server checks the
 * choice with the same rule (endingRefusal) before anything is written.
 */
export function endingsFor(p: EndingPart): EndingChoices {
  const refuse = (refusal: string): EndingChoices => ({ options: [], refusal, suggested: null, partly: null });
  const already = endingOf(p);
  if (already) return refuse(`Already done: ${ENDING_LABEL[already]}.`);
  if (p.disposition === "scrap") return refuse("Already scrapped.");
  if (p.disposition === "fit_approved") return refuse("Already fitted as goodwill (approved by the owner).");
  if (p.is_active === false || p.removed_at) return refuse("Already removed from this job.");
  if (isExchanging(p)) return refuse("Wrong or faulty, being exchanged: give it its ending on Returns and leftovers (back to the supplier with the credit note).");
  if (p.issue_status === "confirmed") return refuse("With the technician: bring it back to Parts first (Hand over page, Back to Parts), then choose its ending.");
  const ordered = orderedQty(p);
  const here = deliveredQty(p);
  const shelf = fromOurShelf(p);
  const notOrderedYet = !p.order_status || p.order_status === "none" || p.order_status === "to_order";
  const partly = here > 0 && here + 0.005 < ordered ? `Only ${pcs(here)} of ${pcs(ordered)} arrived: the other ${pcs(ordered - here)} ${ordered - here === 1 ? "is" : "are"} cancelled with the supplier.` : null;
  const options: EndingOption[] = [
    {
      key: "cancelled",
      label: ENDING_LABEL.cancelled,
      help: shelf ? "Not taken from the shelf yet: it comes off the list." : notOrderedYet ? "Not ordered yet: it comes off the order list (and off an LPO still waiting)." : "Not delivered: the line is cancelled on the LPO and the LPO total goes down. Tell the supplier.",
      allowed: here <= 0,
      why: here > 0 ? (shelf ? "Taken from our own shelf: put it back in stock." : `Already delivered (${pcs(here)} here): return it, or keep it in stock.`) : null,
    },
    {
      key: "return",
      label: "Return to supplier",
      help: "Delivered: it goes back to the supplier; the credit note is awaited and recorded later (tracked on Returns and leftovers).",
      allowed: here > 0 && !shelf,
      why: shelf ? "Taken from our own shelf: there is no supplier to return it to." : here <= 0 ? "Not delivered yet: nothing to return. Choose Cancelled with the supplier." : null,
    },
    {
      key: "stock",
      label: "Keep in stock",
      help: shelf ? "Back onto our shelf: the stock count goes up again." : "Delivered: it goes onto our shelf; its cost moves from this job to stock.",
      allowed: here > 0,
      why: here <= 0 ? "Not delivered yet: nothing to put on the shelf." : null,
    },
  ];
  const suggested = options.find((o) => o.allowed)?.key ?? null;
  if (!suggested) return refuse("No ending fits this part.");
  return { options, refusal: null, suggested, partly };
}

/** The server's check of a choice: null when allowed, else the words (the same rule the dialog greys buttons with). */
export function endingRefusal(p: EndingPart, key: string): string | null {
  const c = endingsFor(p);
  if (c.refusal) return c.refusal;
  const o = c.options.find((x) => x.key === key);
  if (!o) return "Choose an ending: Cancelled with the supplier, Return to supplier, or Keep in stock.";
  return o.allowed ? null : (o.why ?? "This ending does not fit this part.");
}

/** The state a choice is stored as: a return with its credit note already in hand is "returned" at once. */
export const stateOfChoice = (key: EndingKey, creditNoteGiven: boolean): EndingState => (key === "cancelled" ? "cancelled" : key === "stock" ? "stock" : creditNoteGiven ? "returned" : "return_pending");

/** What goes in part_items.disposition: before the migration the two new states are written as NULL (see the top). */
export const storedDisposition = (state: EndingState, migrated: boolean): string | null => (migrated || state === "returned" || state === "stock" ? state : null);

export type PoLineFacts = { quantity: number; received_qty: number; unit_cost: number };
export type PoAfter = { total: number; status: string; /** No line left: the LPO is cancelled. */ cancel: boolean; /** The suppliers' charges leave with it (only when it was never ordered). */ releaseCharges: boolean; /** Words for the answer when an ordered LPO keeps a charge with no line left. */ chargeNote: string | null };

/**
 * An LPO after one of its lines ended: its total (active lines + its charges), its status (no line left = cancelled,
 * every line in = received), and what happens to a courier or freight charge. Charges leave with a never-ordered LPO;
 * an ordered one keeps them (the supplier may still bill the delivery) and the answer says so.
 */
export function poAfterEnding(po: { status: string; chargesAed: number }, lines: PoLineFacts[]): PoAfter {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const ordered = po.status === "ordered" || po.status === "partly_received" || po.status === "received";
  if (!lines.length) {
    if (po.chargesAed > 0 && ordered) return { total: round2(po.chargesAed), status: po.status, cancel: false, releaseCharges: false, chargeNote: `No part is left on it; its charges (AED ${po.chargesAed.toFixed(2)}) stay until the supplier says otherwise. If the supplier waives them, tap "Waived – remove" next to the charge under Supplier charges on this car's Parts page: the LPO is then cancelled.` };
    return { total: 0, status: "cancelled", cancel: true, releaseCharges: po.chargesAed > 0, chargeNote: null };
  }
  const total = round2(lines.reduce((a, l) => a + l.quantity * l.unit_cost, 0) + po.chargesAed);
  let status = po.status;
  if (po.status === "ordered" || po.status === "partly_received") {
    const allIn = lines.every((l) => l.received_qty + 0.005 >= l.quantity);
    const some = lines.some((l) => l.received_qty > 0);
    status = allIn ? "received" : some ? "partly_received" : po.status;
  }
  return { total, status, cancel: false, releaseCharges: false, chargeNote: null };
}

/** Days a return has waited for its credit note (whole days, never below 0). */
export function daysWaiting(sinceIso: string | null | undefined, nowMs: number): number {
  const t = sinceIso ? Date.parse(sinceIso) : NaN;
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

/** A credit note waiting longer than this is shown in amber on the list. */
export const CREDIT_NOTE_LATE_DAYS = 7;

type MessageLine = { name: string; partNumber: string | null; qty: number };

/**
 * What the supplier is told, ready to copy: the cancellation or the return, with the VIN and the part numbers. A part
 * only partly delivered also asks to cancel what never came (`notDelivered`), whatever its ending: a return, or kept
 * in stock (then that is the whole message).
 */
export function supplierMessage(state: EndingState, input: { lpo: string | null; vin: string | null; lines: MessageLine[]; notDelivered?: MessageLine[] }): string {
  const out: string[] = [`${input.lpo ? `${input.lpo} · ` : ""}OFJ Automotive`];
  if (input.vin) out.push(`VIN: ${input.vin}`);
  const item = (l: MessageLine) => `• ${l.partNumber ? `${l.partNumber} · ` : ""}${l.name.toUpperCase()} × ${pcs(l.qty)}`;
  const rest = (input.notDelivered ?? []).filter((l) => l.qty > 0);
  if (state === "cancelled") {
    out.push("", "Please cancel:", ...input.lines.map(item));
  } else if (state !== "stock" && input.lines.length) {
    out.push("", "We are returning:", ...input.lines.map(item), "", "Please send the credit note.");
  }
  if (rest.length && state !== "cancelled") out.push("", "Please cancel (not delivered):", ...rest.map(item));
  return out.join("\n");
}

/** The part only partly delivered: what was ordered on its LPO line and never came (0 = nothing to cancel). */
export const notDeliveredQty = (lineQty: number, delivered: number) => {
  const n = Math.round((lineQty - delivered) * 100) / 100;
  return n > 0.005 ? n : 0;
};

/**
 * What a part returned to its supplier is credited at, before VAT: the supplier's own credit note when its amount was
 * typed, else what the supplier BILLED for it (the invoice price on its LPO line, else the LPO price), else the job's
 * cost of it. ONE rule for the Zoho supplier credit and the "to be credited" figure on Returns and leftovers (an
 * ending sets the job's cost to 0, so the part's own cost is only the last resort).
 */
export function returnCreditOf(input: { qty: number; creditNoteAmount?: number | null; invoiceUnit?: number | null; lineUnit?: number | null; finalCost?: number | null; cost?: number | null }): { amount: number; unit: number; source: "credit_note" | "invoice" | "lpo" | "cost" } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const qty = input.qty > 0 ? input.qty : 1;
  const pos = (v: number | null | undefined) => (v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const typed = pos(input.creditNoteAmount);
  if (typed !== null) return { amount: round2(typed), unit: round2(typed / qty), source: "credit_note" };
  const invoice = pos(input.invoiceUnit);
  if (invoice !== null) return { amount: round2(qty * invoice), unit: round2(invoice), source: "invoice" };
  const lpo = pos(input.lineUnit);
  if (lpo !== null) return { amount: round2(qty * lpo), unit: round2(lpo), source: "lpo" };
  const own = pos(input.finalCost) ?? pos(input.cost) ?? 0;
  return { amount: round2(qty * own), unit: round2(own), source: "cost" };
}
