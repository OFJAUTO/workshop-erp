/**
 * Placeholder costs (2 November 2026, section 2: Q-00039's FRONT LH GRILL SURROUND MOULDING at AED 1.00 from "OFJ
 * Additional", sold at 871.00 = "87,000%"). THE one check of a part's net cost, pure so the Parts table, the server,
 * the LPO gate, the quotation and the tests all read the same answer. No server imports.
 *
 *   - a cost under AED 5 asks once "Is this the real price?" - skipped when the same part number was BOUGHT before at a
 *     similar price (real cheap parts exist: a genuine PLUG WASHER is AED 2.24);
 *   - a cost under half of what the same part number was last bought at, or of the same part on the other side of the
 *     same car, is flagged red and asked the same way;
 *   - "Yes, real price" is stored as the confirmed cost: a different cost later asks again;
 *   - a markup over 500% warns on the quotation (a placeholder cost hides behind it).
 * Stand-in suppliers ("OFJ Additional") and stand-in part numbers ("12", "OFJ") are rules of the row (parts-rows.ts).
 */
import { aed, cheapCostWarning, effectiveMarkupPercent, type MarkupMode } from "./quotes";
import { isOurStock, isPlaceholderSupplier, placeholderSupplierWords } from "./parts-rows";

export type CostLimits = {
  /** Under this net cost each (AED) the price is asked once. */
  askBelow: number;
  /** Under this share (%) of the last price paid for the same part number, or of the same part on the other side, it is flagged. */
  farBelowPercent: number;
  /** "A similar price" bought before: within this share (%) either way. */
  similarPercent: number;
  /** Above this markup (%) the quotation warns and asks once before it goes. */
  markupWarnPercent: number;
};
export const DEFAULT_COST_LIMITS: CostLimits = { askBelow: 5, farBelowPercent: 50, similarPercent: 20, markupWarnPercent: 500 };

const numOr = (v: unknown, d: number) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : d;
};
/** The limits from the settings rows (Settings > Money), each falling back to its default. */
export function costLimitsOf(s: Record<string, unknown>): CostLimits {
  return {
    askBelow: numOr(s.part_cost_ask_below_aed, DEFAULT_COST_LIMITS.askBelow),
    farBelowPercent: numOr(s.part_cost_far_below_percent, DEFAULT_COST_LIMITS.farBelowPercent),
    similarPercent: numOr(s.part_cost_similar_percent, DEFAULT_COST_LIMITS.similarPercent),
    markupWarnPercent: numOr(s.part_markup_warn_percent, DEFAULT_COST_LIMITS.markupWarnPercent),
  };
}

/** One price the same part number was really bought at: an LPO line (the supplier invoice price when there is one), an ordered part, the stock list. */
export type PaidPrice = { cost: number; where: string; on: string | null };
/** What a cost is compared with: the purchases of the same part number (newest first) and the same part elsewhere on the car. */
export type CostRefs = { bought: PaidPrice[]; twins: { label: string; cost: number }[] };

export type CostVerdict = { kind: "ask_cheap" | "far_below"; words: string };

const money = aed;
const shortDate = (on: string | null) => (on ? new Date(on.length <= 10 ? `${on}T08:00:00Z` : on).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dubai" }) : "");
const within = (a: number, b: number, pct: number) => b > 0 && Math.abs(a - b) <= (b * pct) / 100 + 0.005;

/** The same part number was bought before at a similar price (one of the last five purchases). */
export function boughtSimilar(cost: number, refs: CostRefs | null, l: CostLimits = DEFAULT_COST_LIMITS): PaidPrice | null {
  return (refs?.bought ?? []).slice(0, 5).find((b) => within(cost, b.cost, l.similarPercent)) ?? null;
}

/** "less than half" at 50%, otherwise "under 70% of it": the words follow the setting (Settings > Money). */
export function belowShareWords(percent: number): string {
  const p = Math.round(percent * 100) / 100;
  return Math.abs(p - 50) < 1e-9 ? "less than half" : `under ${p}% of it`;
}

/**
 * THE check of one part's net cost each. Null when it can go: no cost yet (the row says so itself), the answer already
 * given for this very cost, a part from a stock item whose cost came from real deliveries (fromStock: an item whose
 * cost was only typed - in the picker or on the stock page - is judged like any typed cost), or nothing odd about it.
 */
export function partCostCheck(i: { cost: number | null | undefined; confirmedCost?: number | null; fromStock?: boolean }, refs: CostRefs | null, l: CostLimits = DEFAULT_COST_LIMITS): CostVerdict | null {
  const cost = Number(i.cost);
  if (i.cost === null || i.cost === undefined || !Number.isFinite(cost) || cost <= 0) return null;
  if (i.confirmedCost !== null && i.confirmedCost !== undefined && Math.abs(Number(i.confirmedCost) - cost) < 0.005) return null;
  if (i.fromStock) return null;
  const share = l.farBelowPercent / 100;
  const last = refs?.bought[0] ?? null;
  if (last && last.cost > 0 && cost < last.cost * share) {
    return { kind: "far_below", words: `Last bought at ${money(last.cost)}${last.where || last.on ? ` (${[last.where, shortDate(last.on)].filter(Boolean).join(", ")})` : ""}: ${money(cost)} is ${belowShareWords(l.farBelowPercent)}. Is ${money(cost)} the real price?` };
  }
  // The same part elsewhere on the car (its other side, the same number): the same share as the setting, one wording.
  const twin = cheapCostWarning(cost, refs?.twins ?? [], share);
  if (twin) return { kind: "far_below", words: `${twin.charAt(0).toUpperCase()}${twin.slice(1)}. Is ${money(cost)} the real price?` };
  if (cost < l.askBelow && !boughtSimilar(cost, refs, l)) return { kind: "ask_cheap", words: `${money(cost)} – is this the real price?` };
  return null;
}

/** Ordered, partly received or received: past pricing, the row is locked (to order is not: it can still be answered). */
export const isSettledStatus = (s: string | null | undefined) => s === "ordered" || s === "partly_received" || s === "received";

/**
 * What is wrong with the cost of a part already ordered or received (2 November 2026, J-00017's drain plug and
 * J-00609's engine flush from "OFJ Additional" at AED 1.00): judged on the cost that really stands - the supplier
 * invoice price or the stock average (final cost) when there is one, else the priced cost. Once a real final cost is
 * on the part, the stand-in supplier no longer matters (the money is right). Null when nothing is wrong.
 */
export function settledCostProblem(p: { cost_aed: number | string | null | undefined; final_cost_aed?: number | string | null; supplier: string | null | undefined }): string | null {
  const final = p.final_cost_aed === null || p.final_cost_aed === undefined || p.final_cost_aed === "" ? null : Number(p.final_cost_aed);
  const cost = final ?? (p.cost_aed === null || p.cost_aed === undefined || p.cost_aed === "" ? null : Number(p.cost_aed));
  if (cost !== null && Number.isFinite(cost) && cost <= 1) return `${money(cost)} is not a real price`;
  if (final === null && isPlaceholderSupplier(p.supplier)) return `"${String(p.supplier ?? "").trim()}" is not a supplier`;
  return null;
}

/** The question still waits: there is one, and the answer given (if any) was for another cost. */
export function costNeedsAnswer(v: CostVerdict | null, confirmedCost: number | null | undefined, cost: number | null | undefined): boolean {
  if (!v) return false;
  return !(confirmedCost !== null && confirmedCost !== undefined && cost !== null && cost !== undefined && Math.abs(Number(confirmedCost) - Number(cost)) < 0.005);
}

/**
 * The supplier's standard discount taken off a figure that was already the NET price (Q-00039: list 12,228.30 was the
 * net of the other side, less Gargash's 55% again = AED 5,502.73). A light note, never a block: the list price typed
 * equals a net already seen for this part (its other side on the car, or what it was bought at).
 */
export function discountTwiceNote(i: { list: number | null | undefined; discount: number | null | undefined }, seenNets: { label: string; net: number }[]): string | null {
  const list = Number(i.list);
  const disc = Number(i.discount);
  if (!(list > 0) || !(disc > 0)) return null;
  const hit = seenNets.find((s) => s.net > 0 && Math.abs(s.net - list) <= Math.max(0.01, list * 0.005));
  if (!hit) return null;
  return `Supplier discount ${Math.round(disc * 100) / 100}% applied – ${money(list)} was already the net price of ${hit.label}. Is ${money(list)} the LIST price?`;
}

type MarkupFields = { unit_cost: number | null; markup_percent: number | null; markup_mode?: MarkupMode | string | null; markup_aed?: number | null };
/** The markup in percent when it is above the warning limit (the cost is probably not real), else null. */
export function markupTooHigh(l: MarkupFields, limitPercent: number = DEFAULT_COST_LIMITS.markupWarnPercent): number | null {
  if (!(Number(l.unit_cost) > 0)) return null;
  const pct = effectiveMarkupPercent(l);
  return Number.isFinite(pct) && pct > limitPercent + 1e-9 ? Math.round(pct * 100) / 100 : null;
}
/** "Markup 87,000% – is the cost real? (cost AED 1.00, OFJ Additional)". */
export function markupTooHighWords(pct: number, cost: number | null | undefined, supplier?: string | null): string {
  return `Markup ${Math.round(pct).toLocaleString("en-GB")}% – is the cost real? (cost ${money(Number(cost) || 0)}${supplier ? `, ${supplier}` : ""})`;
}

/**
 * Why a line may not go on an LPO, and what fixes it: "confirm" = only the cost question is open and Parts can answer
 * it with "Yes, real price" on the Parts table (any part not ordered yet, approved ones included); "price" = the price
 * or the supplier itself is wrong (a new price, the real supplier); "stock" = a part from our own shelf.
 */
export type LpoProblem = { words: string; fix: "confirm" | "price" | "stock" };

/**
 * THE gate of an LPO line (2.2): a real cost before a part is ever ordered. The words name the part; null when it may
 * go on an LPO. Used when the LPO is raised, when parts join a waiting LPO, when it is approved and on the LPO page.
 */
export function lpoLineProblem(p: { description: string; cost_aed: number | null | undefined; supplier: string | null | undefined; availability?: string | null }, check: { ask: CostVerdict | null; hold: boolean; confirmed: boolean }): LpoProblem | null {
  const name = String(p.description ?? "").toUpperCase();
  const cost = Number(p.cost_aed);
  if (p.cost_aed === null || p.cost_aed === undefined || !Number.isFinite(cost) || cost <= 0) return { words: `${name}: no price yet`, fix: "price" };
  if (!String(p.supplier ?? "").trim()) return { words: `${name}: no supplier yet`, fix: "price" };
  if (isPlaceholderSupplier(p.supplier)) return { words: `${name}: ${placeholderSupplierWords(p.supplier)}`, fix: "price" };
  if (isOurStock(p.supplier) || p.availability === "in_stock") return { words: `${name}: from our stock – it is never on an LPO`, fix: "stock" };
  // AED 1.00 or less: real only when Parts said so; the answer can be given only once the database can keep it (hold).
  if (cost <= 1 && !check.confirmed) return { words: `${name}: ${money(cost)} is not a real price`, fix: check.hold ? "confirm" : "price" };
  if (check.ask && check.hold) return { words: `${name}: ${check.ask.words}`, fix: "confirm" };
  return null;
}

/** The one wording of what fixes the LPO lines that cannot go yet (raising it, approving it, the LPO page). */
export function lpoProblemAdvice(problems: LpoProblem[], approving: boolean): string {
  const confirmOnly = problems.length > 0 && problems.every((p) => p.fix === "confirm");
  const n = problems.length;
  if (approving) {
    return confirmOnly
      ? `Parts confirm the price on the Parts table (Yes, real price on the row), or refuse ${n === 1 ? "that line" : "those lines"}; then approve.`
      : `Refuse ${n === 1 ? "that line" : "those lines"} (Parts replace ${n === 1 ? "it" : "them"} with the real price), then approve.`;
  }
  if (confirmOnly) return `Tap Yes, real price on ${n === 1 ? "that row" : "those rows"} in the table when the price is real, or put the supplier's real price.`;
  return "Put the supplier's real price and the real supplier in the table first (a part the customer already approved: Remove: not needed, then Replace with the real price).";
}
