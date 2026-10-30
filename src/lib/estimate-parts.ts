/**
 * Estimate parts (30 October 2026). Pure: the quotation editor, the parts desk and the send check all read these.
 *
 * An estimate has no job yet, so its part LINE carries the price itself:
 *   draft      named by the advisor, not sent to the parts desk yet
 *   with_desk  sent to the parts desk to price, waiting
 *   priced     the parts desk put the cost, supplier, part number and availability
 *   advisor    the advisor typed a price he already had (a dealer on the phone): counts as priced, the parts desk checks it
 *   checked    an advisor's price the parts desk checked
 * A part line on a job's quotation is never one of these: it comes from the Parts desk as a part item.
 */
export type EstimatePartLine = {
  id: string;
  line_type: string;
  title: string;
  quantity?: number | null;
  unit_cost?: number | null;
  part_item_id?: string | null;
  is_active?: boolean;
  left_off?: boolean;
  option_group?: string | null;
  chosen?: boolean;
  price_requested_at?: string | null;
  priced_at?: string | null;
  priced_by_advisor?: boolean;
  price_checked_at?: string | null;
};

export type EstimatePartState = "draft" | "with_desk" | "priced" | "advisor" | "checked";

/** True for a part line of an estimate (no part item behind it). */
export const isEstimatePart = (l: Pick<EstimatePartLine, "line_type" | "part_item_id">) => l.line_type === "part" && !l.part_item_id;

export function estimatePartState(l: EstimatePartLine): EstimatePartState {
  if (l.unit_cost === null || l.unit_cost === undefined) return l.price_requested_at ? "with_desk" : "draft";
  if (l.priced_by_advisor) return l.price_checked_at ? "checked" : "advisor";
  return "priced";
}

/** The chip on the line. "Priced by advisor" is internal only (never on a customer document). */
export const ESTIMATE_PART_WORDS: Record<EstimatePartState, string> = {
  draft: "Not sent to the parts desk",
  with_desk: "With the parts desk",
  priced: "Priced by the parts desk",
  advisor: "Priced by advisor · parts desk to check",
  checked: "Priced by advisor · checked by the parts desk",
};

/** Counted lines only: active, not left off, not an unused option. */
const counted = (l: EstimatePartLine) => l.is_active !== false && !l.left_off && !(l.option_group && l.chosen === false);

/** The estimate's part lines that still have no price, split by whether the parts desk has them. */
export function unpricedEstimateParts(lines: EstimatePartLine[]): { notSent: EstimatePartLine[]; withDesk: EstimatePartLine[] } {
  const open = lines.filter((l) => isEstimatePart(l) && counted(l) && (l.unit_cost === null || l.unit_cost === undefined));
  return { notSent: open.filter((l) => !l.price_requested_at), withDesk: open.filter((l) => !!l.price_requested_at) };
}

/** "2 parts still waiting for the parts desk" / "1 part not sent to the parts desk yet". */
export function waitingWords(n: number, sent: boolean): string {
  return `${n} part${n === 1 ? "" : "s"} ${sent ? "still waiting for the parts desk" : "not sent to the parts desk yet"}`;
}

/** An empty line (no name, no price) may simply be deleted. */
export const isEmptyPart = (l: EstimatePartLine) => isEstimatePart(l) && !(l.title ?? "").trim() && (l.unit_cost === null || l.unit_cost === undefined);
