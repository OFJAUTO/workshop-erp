/*
 * 13 November 2026, Section 3: change a part's supplier or price IN PLACE (the NISSAN PATROL Dubai FF 33052 case: the
 * parts desk removed five approved parts to change their supplier, added them again, and they lost the customer's
 * approval). THE rules, pure (no server imports), shared by the window, the server and the tests.
 *
 *  - The part keeps its row, so its link to the quotation, the job and the technician's request never breaks.
 *  - A reason is required; the history keeps old > new, who and when.
 *  - The owner approves only when the cost goes UP or the part type changes (Genuine to anything else). Cost down with
 *    the same type: no approval, logged.
 *  - The customer's approved price never changes from here (approved quotations stay locked): either we keep the
 *    customer's price and absorb the difference, or the quotation is revised.
 */

export type PartFacts = {
  supplier: string | null;
  cost: number | null;
  /** Days to arrive (0 = same day); null = in stock or not said. */
  days: number | null;
  availability: string | null;
  partNumber: string | null;
  partType: string | null;
  quantity: number;
};

export type PriceChoice = "keep" | "revise";

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number | null) => (n === null ? "no price" : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const daysWords = (f: PartFacts) => (f.availability === "in_stock" ? "in stock" : f.days === null ? "date not said" : f.days === 0 ? "same day" : `${f.days} day${f.days === 1 ? "" : "s"}`);
const same = (a: string | null, b: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** What changed, one phrase each ("supplier Al Tayer → Gargash", "cost 120.00 → 95.00", "2 days → same day"). */
export function changedPhrases(before: PartFacts, after: PartFacts): string[] {
  const out: string[] = [];
  if (!same(before.supplier, after.supplier)) out.push(`supplier ${before.supplier || "none"} → ${after.supplier || "none"}`);
  if (Math.abs((before.cost ?? 0) - (after.cost ?? 0)) > 0.004 || (before.cost === null) !== (after.cost === null)) out.push(`cost ${money(before.cost)} → ${money(after.cost)}`);
  if (daysWords(before) !== daysWords(after)) out.push(`${daysWords(before)} → ${daysWords(after)}`);
  if (!same(before.partNumber, after.partNumber)) out.push(`part number ${before.partNumber || "none"} → ${after.partNumber || "none"}`);
  if (!same(before.partType, after.partType)) out.push(`type ${before.partType || "not set"} → ${after.partType || "not set"}`);
  return out;
}

/** Genuine to anything else (or the other way) is a different part for the customer. */
export function typeChanged(before: PartFacts, after: PartFacts): boolean {
  return !same(before.partType, after.partType) && !!(before.partType || after.partType);
}

/** Cost up or a different part type: the owner approves it before it is applied. Cost down, same type: no approval. */
export function needsOwner(before: PartFacts, after: PartFacts): boolean {
  return (after.cost ?? 0) > (before.cost ?? 0) + 0.004 || typeChanged(before, after);
}

/**
 * WHO approves a change (17 November 2026, Section 4):
 *  - cheaper or the same cost, same part type: nobody (logged);
 *  - dearer, but the line still makes at least the minimum markup on the customer's price: the ADVISOR on that job, one tap;
 *  - below the minimum markup, another part type (Genuine to anything else), or the customer's price must change: the OWNER.
 * A part not on a quotation yet (no customer's price): a dearer cost is the advisor's (he prices it).
 */
export type ChangeApprover = "none" | "advisor" | "owner";
export function approverFor(before: PartFacts, after: PartFacts, sellEach: number | null, minMarkupPercent: number, choice: PriceChoice | null): ChangeApprover {
  if (typeChanged(before, after)) return "owner";
  if (choice === "revise") return "owner";
  const dearer = (after.cost ?? 0) > (before.cost ?? 0) + 0.004;
  if (!dearer) return "none";
  if (sellEach === null) return "advisor";
  const mk = markupPercentOf(sellEach, after.cost);
  return mk !== null && mk + 1e-9 >= minMarkupPercent ? "advisor" : "owner";
}

/** The markup on cost at a selling price each ((sell - cost) / cost), in percent; null without a cost. */
export function markupPercentOf(sellEach: number | null, cost: number | null): number | null {
  if (sellEach === null || cost === null || !(cost > 0)) return null;
  return r2(((sellEach - cost) / cost) * 100);
}

/** THE decision as the approver reads it: old and new supplier and price, the difference, delivery, profit before → after. */
export function decisionLines(before: PartFacts, after: PartFacts, sellEach: number | null): string[] {
  const qty = after.quantity || 1;
  const diff = r2((after.cost ?? 0) - (before.cost ?? 0));
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±");
  const out = [
    `Old: ${before.supplier || "no supplier"} · AED ${money(before.cost)} each`,
    `New: ${after.supplier || "no supplier"} · AED ${money(after.cost)} each`,
    `Difference: ${sign(diff)}${money(Math.abs(diff))} each${qty > 1 ? ` (${sign(diff)}${money(Math.abs(r2(diff * qty)))} on ${qty})` : ""}`,
    `Delivery: ${daysWords(before)} → ${daysWords(after)}`,
  ];
  if (sellEach !== null) out.push(`Profit on this line: AED ${money(profitOf(sellEach, before))} → AED ${money(profitOf(sellEach, after))} (customer pays AED ${money(sellEach)} each)`);
  else out.push("Not on an approved quotation yet: the advisor prices it.");
  return out;
}

/** What we absorb when the customer's price is kept: the extra cost on the whole quantity (never below 0). */
export function absorbOf(before: PartFacts, after: PartFacts): number {
  return Math.max(0, r2(((after.cost ?? 0) - (before.cost ?? 0)) * (after.quantity || 1)));
}

/** The line's profit at a selling price per unit, before and after (shown in the window before saving). */
export function profitOf(sellEach: number | null, facts: PartFacts): number | null {
  if (sellEach === null || facts.cost === null) return null;
  return r2((sellEach - facts.cost) * (facts.quantity || 1));
}

/** One history line: "REAR WIPER BLADE: supplier X → Y, cost 120.00 → 95.00 · Peter, 13 Nov 14:05: cheaper elsewhere". */
export function changeLine(name: string, before: PartFacts, after: PartFacts, by: string, when: string, reason: string): string {
  const what = changedPhrases(before, after);
  return `${name.toUpperCase()}: ${what.length ? what.join(", ") : "no change"} · ${by}, ${when}: ${reason.trim()}`;
}

/** The checks before anything is saved; null = fine. */
export function changeProblem(before: PartFacts, after: PartFacts, reason: string, choice: PriceChoice | null, approved: boolean): string | null {
  if (reason.trim().length < 3) return "Say why it changes (a better price, the supplier has none, a faster delivery…).";
  if (!changedPhrases(before, after).length) return "Nothing changed: change the supplier, the cost, the delivery time or the part number.";
  if (after.cost !== null && !(after.cost > 0)) return "The cost must be above 0.";
  if (!(after.supplier ?? "").trim()) return "Pick the supplier.";
  // The customer approved the old part: a dearer one, or another type, means choosing how the customer's price goes.
  if (approved && needsOwner(before, after) && !choice) return "Choose: keep the customer's price (we absorb the difference) or revise the quotation.";
  return null;
}

/* ---- Part numbers that are not real (the placeholder guard) ---- */

/** Words that are the KIND of part, never its number ("PAD", "DISC", "BLADE", "FLUID"). */
const GENERIC = new Set(["PAD", "PADS", "DISC", "DISCS", "DISK", "BLADE", "BLADES", "FLUID", "OIL", "FILTER", "BELT", "BULB", "MOUNT", "MOUNTING", "SENSOR", "PUMP", "HOSE", "GASKET", "SEAL", "PLUG", "PLUGS", "WIPER", "BATTERY", "TYRE", "TIRE", "BRAKE", "BEARING", "SPRING", "SHOCK", "LINK", "ARM", "BUSH", "COIL", "VALVE", "PART", "PARTS", "NA", "N/A", "TBC", "TBA", "XXX"]);

/** A "part number" that is only the part's name or a kind of part: null = it looks real. */
export function partNumberLooksLikeName(partNumber: string | null, name: string): string | null {
  const pn = (partNumber ?? "").trim().toUpperCase();
  if (!pn || pn === "NO NUMBER") return null;
  // A real number has a digit in it; letters only is a word.
  if (/\d/.test(pn)) return null;
  const words = new Set(name.toUpperCase().split(/[^A-Z]+/).filter(Boolean));
  const bare = pn.replace(/[^A-Z/]/g, "");
  if (GENERIC.has(bare) || words.has(bare) || pn.split(/[^A-Z]+/).filter(Boolean).every((w) => words.has(w) || GENERIC.has(w))) {
    return `"${partNumber}" is the part's name, not its number: enter the real number or tick "No part number yet".`;
  }
  return null;
}
