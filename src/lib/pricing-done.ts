/**
 * "Pricing done – send to advisor" (section 10, 3 November 2026). Pure: the bar at the bottom of the parts desk's
 * pricing screens (a job's parts and an estimate's parts), the server's send, the one notification and the to-do lists
 * all read these, so "3 of 4 priced" and "on the list" mean the same everywhere.
 *
 * The advisor hears about the pricing ONCE, when Parts press the button (with what changed folded into it), never once
 * per part. The per-part notices to him are held back only while a send is EXPECTED (awaitingSend): before the
 * customer's approval until the first send, or after Edit / a new part reopened the pricing. Every held notice keeps the
 * car on the parts desk's list until the send (review of 3 November 2026: a car past approval whose pricing was never
 * sent used to hold the notices with nothing asking for the send). After the customer's approval (planning) nothing is
 * held, and what was still held is sent by itself (src/lib/pricing-send.ts, releaseHeldPricing).
 */
import type { RowState } from "./parts-rows";
import { PAST_QUOTE } from "./parts-steps";
import { estimatePartState } from "./estimate-parts";

/** After the customer's approval the Parts step plans the order: the pricing bar is not shown and nothing is held. */
export const PLANNING_STATUSES: readonly string[] = ["approved", "waiting_parts"];

export type PricingLine = { key: string; name: string; state: RowState; /** What the row still needs, in words ("no part number"). */ missing: string[] };

export type PricingProgress = {
  priced: number;
  notAvailable: number;
  waiting: number;
  notFinished: number;
  /** Priced or not available: nothing more to do. */
  done: number;
  /** Every line that still counts (removed ones do not). */
  total: number;
  /** Every line on the screen, removed ones included (a pricing with only removed lines can still be sent). */
  count: number;
  /** Not finished or waiting for the owner's approval: listed instead of sending. */
  open: number;
  openLines: PricingLine[];
  /** "3 of 4 priced". */
  words: string;
  /** "1 not available · 1 waiting for owner approval" (empty when nothing else). */
  detail: string;
};

export function pricingProgress(lines: PricingLine[]): PricingProgress {
  const n = (s: RowState) => lines.filter((l) => l.state === s).length;
  const priced = n("priced");
  const notAvailable = n("not_available");
  const waiting = n("waiting_approval");
  const notFinished = n("not_finished");
  const total = lines.length - n("removed");
  const done = priced + notAvailable;
  const openLines = lines.filter((l) => l.state === "not_finished" || l.state === "waiting_approval");
  const detail = [notAvailable ? `${notAvailable} not available` : "", waiting ? `${waiting} waiting for owner approval` : "", notFinished ? `${notFinished} not finished` : ""].filter(Boolean).join(" · ");
  return { priced, notAvailable, waiting, notFinished, done, total, count: lines.length, open: openLines.length, openLines, words: total ? `${done} of ${total} priced` : "No parts yet", detail };
}

/** "1 part not priced yet" / "3 parts not priced yet". */
export const openLinesWords = (p: Pick<PricingProgress, "open">) => `${p.open} part${p.open === 1 ? "" : "s"} not priced yet`;

/**
 * The one notification's title: "All parts priced on E-00058", "Parts priced on J-00970: 3 of 4", "Prices updated on
 * J-00970"; "Parts changes on J-00970" when it went out by itself at the customer's approval (auto); "No parts left on
 * J-00970" when every part was taken off; "Parts not available on J-00970" when none could be priced.
 */
export function pricingDoneTitle(ref: string, p: Pick<PricingProgress, "open" | "done" | "total"> & { priced?: number }, again: boolean, auto = false): string {
  if (auto) return `Parts changes on ${ref}`;
  if (!p.total) return `No parts left on ${ref}`;
  if (again) return `Prices updated on ${ref}`;
  if (p.open) return `Parts priced on ${ref}: ${p.done} of ${p.total}`;
  if (p.priced === 0) return `Parts not available on ${ref}`;
  return `All parts priced on ${ref}`;
}

/**
 * The one notification's words: who priced how many, the lines still open (when sent with "Send what you have"), what
 * changed while pricing (folded in instead of one notice each), the quotation already with the customer and the next
 * step. `auto`: sent by itself at the customer's approval because Parts never pressed the button.
 */
export function pricingDoneBody(a: { by: string; p: Pick<PricingProgress, "done" | "total" | "openLines" | "notAvailable">; changes?: string[]; sentQuotes?: string[]; revised?: string | null; estimate?: boolean; auto?: boolean }): string {
  const parts = a.auto ? ["Parts did not press Pricing done – send to advisor before the customer approved, so this comes by itself."] : [];
  parts.push(a.p.total ? `${a.p.done} of ${a.p.total} part${a.p.total === 1 ? "" : "s"} priced by ${a.by}${a.p.notAvailable ? ` (${a.p.notAvailable} not available)` : ""}.` : `Every part was taken off by ${a.by}.`);
  if (a.p.openLines.length) parts.push(`Not priced yet: ${a.p.openLines.map((l) => l.name.toUpperCase()).join(", ")}.`);
  const changes = (a.changes ?? []).filter(Boolean);
  if (changes.length) parts.push(`Changes: ${changes.slice(0, 8).join("; ")}${changes.length > 8 ? `; and ${changes.length - 8} more` : ""}.`);
  if (a.revised) parts.push(`${a.revised} is ready with the new prices: check it and send it to the customer.`);
  else if (a.sentQuotes?.length) parts.push(`${a.sentQuotes.join(", ")} was already sent to the customer: check it and send a revised version if needed.`);
  else parts.push(a.estimate ? "Your markup is on them: check the estimate and send it." : "Finish the quotation.");
  return parts.join(" ");
}

type JobPricing = { status: string; parts_pricing_done_at: string | null; parts_pricing_reopened_at: string | null };

/**
 * Sent to the advisor and not reopened since. `parts_pricing_reopened_at` means "changes wait for a send": Edit after
 * the send, a new part request, or (before any send) a per-part notice held back for the send.
 */
export const pricingSent = (j: Pick<JobPricing, "parts_pricing_done_at" | "parts_pricing_reopened_at">) => !!j.parts_pricing_done_at && !j.parts_pricing_reopened_at;

/** Sent before and opened again since (Edit, a new part): the bar says "Send updated prices". */
export const pricingEditing = (j: Pick<JobPricing, "parts_pricing_done_at" | "parts_pricing_reopened_at">) => !!j.parts_pricing_done_at && !!j.parts_pricing_reopened_at;

/** The job is in the pricing phase (the bar is shown): before the customer's approval, or after it once the work started. */
export const inPricingPhase = (j: Pick<JobPricing, "status">) => !PLANNING_STATUSES.includes(j.status);

/**
 * A send is expected: the pricing bar asks for it and the to-do lists keep the car until it is pressed. Before the
 * customer's approval until the first send (and again after Edit or a new part); past the approval only once the
 * pricing was opened again (additional work, a new part, Edit) - a car past approval that was never opened again
 * holds nothing, so nothing can wait for a send nobody is asked for.
 */
export const awaitingSend = (j: JobPricing) => inPricingPhase(j) && !pricingSent(j) && (!PAST_QUOTE.includes(j.status) || !!j.parts_pricing_reopened_at);

/** Per-part notices to the advisor wait for the send exactly while a send is expected (the same rule as the to-do list). */
export const holdPerPartNotices = awaitingSend;

/**
 * A job on the parts desk's to-do list: "to_price" while a request is open or a part is not priced (also after a send
 * with "Send what you have": the lines left open stay listed for the desk); "to_send" while a send is expected and
 * there is something to send (a part priced since the last send, or a change held for it). After the customer's
 * approval only open requests and unpriced parts count (the revision flow does the rest).
 */
export function jobPricingTodo(j: JobPricing, a: { openRequests: number; unpricedParts: number; pricedSinceSend: number }): "to_price" | "to_send" | null {
  if (a.openRequests > 0 || a.unpricedParts > 0) return "to_price";
  if (awaitingSend(j) && (a.pricedSinceSend > 0 || !!j.parts_pricing_reopened_at)) return "to_send";
  return null;
}

/** The same rule from a job's raw rows: its open requests and its parts not ordered yet (priced since the last send or not). */
export function pricingTodoOf(j: JobPricing, requests: { status: string }[], parts: { is_active?: boolean | null; confirm_status?: string | null; order_status?: string | null; cost_aed: number | string | null; priced_at?: string | null; removed_at?: string | null; priced_by_advisor?: boolean | null }[]): "to_price" | "to_send" | null {
  const live = parts.filter((p) => p.is_active !== false && p.confirm_status !== "rejected" && !p.removed_at && (p.order_status ?? "none") === "none");
  return jobPricingTodo(j, {
    openRequests: requests.filter((r) => r.status === "open").length,
    // A part is priced when its whole row was (priced_at is written then): a cost alone is still to price.
    // The advisor's OWN price (Enter price myself, 5 November 2026) is already with the advisor: never "to send".
    unpricedParts: live.filter((p) => p.cost_aed === null || p.cost_aed === undefined || !p.priced_at).length,
    pricedSinceSend: live.filter((p) => !p.priced_by_advisor && p.cost_aed !== null && p.cost_aed !== undefined && !!p.priced_at && (!j.parts_pricing_done_at || p.priced_at > j.parts_pricing_done_at)).length,
  });
}

/* ---------------------------------------------------------------------------------------------------------------
   Estimates: the line carries its own price (no job yet). A line counts for the desk from the moment the advisor
   sends it; the estimate is sent back when the desk presses the button (quotations.parts_priced_at).
   --------------------------------------------------------------------------------------------------------------- */

export type EstimateDeskLine = { unit_cost: number | null; price_requested_at: string | null; priced_at?: string | null; priced_by_advisor?: boolean | null; price_checked_at?: string | null; quantity_changed_at?: string | null; left_off?: boolean | null };

/**
 * The last moment the desk had something to do on a line: sent to the desk, priced or checked. A quantity the advisor
 * changes afterwards is told to the desk on its own and never puts the estimate back on the desk's list (the price per
 * unit stands); a quantity the desk changes comes with its own save (priced again).
 */
export function estimateLineMoment(l: EstimateDeskLine): string | null {
  const all = [l.price_requested_at, l.priced_at, l.price_checked_at].filter((x): x is string => !!x).sort();
  return all.length ? all[all.length - 1] : null;
}

/** A desk line's state by THE estimate rule (src/lib/estimate-parts.ts): a cost alone is not a price, priced_at is. */
const deskStateOf = (l: EstimateDeskLine) => estimatePartState({ id: "", line_type: "part", title: "", unit_cost: l.unit_cost, price_requested_at: l.price_requested_at, priced_at: l.priced_at ?? null, priced_by_advisor: !!l.priced_by_advisor, price_checked_at: l.price_checked_at ?? null });

/**
 * What the parts desk still has to do on an estimate, from each line's own state (the same rule as the advisor's view
 * and the desk's bar): a line sent to the desk and not priced yet - nothing typed, or half-typed (a cost with no
 * finished row) - is to price whatever was sent before, so "Send what you have" never drops it; an advisor's own price
 * not checked yet is to check; a priced (or checked) line changed since the last send is waiting to be sent. Once the
 * send is known (`stampReady`: the estimate's own stamp, or its "Pricing done" event before that database change) a
 * finished estimate leaves the list; without it a priced line never keeps the estimate listed.
 */
export function estimateDeskTodo(lines: EstimateDeskLine[], partsPricedAt: string | null, stampReady: boolean): { toPrice: number; toCheck: number; pricedNotSent: number } {
  const live = lines.filter((l) => !l.left_off && (!!l.price_requested_at || !!l.priced_by_advisor));
  const sinceSend = (l: EstimateDeskLine) => !partsPricedAt || (estimateLineMoment(l) ?? "") > partsPricedAt;
  const states = live.map((l) => ({ l, s: deskStateOf(l) }));
  const toPrice = states.filter((x) => x.s === "with_desk").length;
  const toCheck = states.filter((x) => x.s === "advisor").length;
  const pricedNotSent = stampReady ? states.filter((x) => (x.s === "priced" || x.s === "checked") && sinceSend(x.l)).length : 0;
  return { toPrice, toCheck, pricedNotSent };
}
