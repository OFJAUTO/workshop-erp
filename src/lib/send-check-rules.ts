/**
 * CHECK BEFORE YOU SEND (13 November 2026). Pure rules: which lines of what the parts desk is about to send look wrong,
 * each with a short reason. Used by the ONE window (src/components/CheckBeforeSend.tsx) at the four send points:
 * prices back to the advisor, an LPO for approval, an LPO to the supplier, a receipt.
 */

export type SendLine = {
  key: string;
  name: string;
  partNumber: string | null;
  /** The "No part number yet" tick (stored as NO NUMBER). */
  noNumberTicked?: boolean;
  qty: number;
  /** Our cost each (AED, before VAT). */
  price: number | null;
  supplier?: string | null;
  /** The last price we bought this part at (by part number), when known. */
  lastPrice?: number | null;
  /** What the customer's quotation said: quantity, the cost it was priced on, the selling total of the line. */
  quotedQty?: number | null;
  quotedCost?: number | null;
  quotedSell?: number | null;
  /** The supplier the part was priced with (a different supplier now is a flag). */
  pricedSupplier?: string | null;
};

const compact = (s: string | null | undefined) => String(s ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const WORD_NUMBERS = /^(PAD|PADS|DISC|DISCS|DISK|BLADE|BLADES|FILTER|BELT|BULB|MOUNT|SENSOR|PUMP|OIL|PART|NA|TBC|TBA|XXX+|0+)$/;

/** A part number that is not a real one: the part's own name, a word like PAD/DISC/BLADE, or 1234AA / 123AA. */
export function placeholderReason(l: Pick<SendLine, "partNumber" | "name" | "noNumberTicked">): string | null {
  const pn = String(l.partNumber ?? "").trim();
  if (!pn || pn.toUpperCase() === "NO NUMBER") return l.noNumberTicked || pn.toUpperCase() === "NO NUMBER" ? null : "No part number (tick \"No part number yet\" if the supplier gave none)";
  const c = compact(pn);
  if (c && c === compact(l.name)) return `Part number "${pn}" is just the part's name`;
  if (WORD_NUMBERS.test(c)) return `Part number "${pn}" is a word, not a part number`;
  if (/^\d{3,4}[A-Z]{2}$/.test(c)) return `Part number "${pn}" looks like a placeholder (like 1234AA)`;
  if (/^OFJ\d{0,3}$/.test(c)) return `Part number "${pn}" is a stand-in`;
  return null;
}

/** A price that looks like a typing slip: AED 0 or 1, or far from the last price we paid (under half, over double). */
export function priceReason(l: Pick<SendLine, "price" | "lastPrice">): string | null {
  if (l.price === null || l.price === undefined) return null;
  if (l.price <= 1) return `Price ${aed(l.price)} looks like a typing slip`;
  const last = Number(l.lastPrice) || 0;
  if (last > 1 && l.price < last * 0.5) return `${aed(l.price)} is far below the last price paid (${aed(last)})`;
  if (last > 1 && l.price > last * 2) return `${aed(l.price)} is far above the last price paid (${aed(last)})`;
  return null;
}

/** All the flags of one line (the duplicate check needs the whole list: flagsOf). */
export function lineFlags(l: SendLine): string[] {
  const out: string[] = [];
  const p = placeholderReason(l);
  if (p) out.push(p);
  const pr = priceReason(l);
  if (pr) out.push(pr);
  if (l.quotedQty !== null && l.quotedQty !== undefined && Math.abs(l.quotedQty - l.qty) > 0.005) out.push(`Quantity ${l.qty} but the customer's quote says ${l.quotedQty}`);
  if (l.price !== null && l.quotedCost !== null && l.quotedCost !== undefined && l.price - l.quotedCost > 0.005) {
    const diff = (l.price - l.quotedCost) * l.qty;
    const profit = l.quotedSell !== null && l.quotedSell !== undefined ? l.quotedSell - l.price * l.qty : null;
    out.push(`Cost ${aed(l.price)} is above the ${aed(l.quotedCost)} the quote was priced on (+${aed(diff).replace("AED ", "")}${profit !== null ? `; profit on this line now ${aed(profit)}` : ""})`);
  }
  if (l.supplier && l.pricedSupplier && l.supplier.trim().toLowerCase() !== l.pricedSupplier.trim().toLowerCase()) out.push(`Supplier ${l.supplier} is not the one it was priced with (${l.pricedSupplier})`);
  return out;
}

/** The flags of every line, with the same part listed twice (by part number, else by name) marked on both. */
export function flagsOf(lines: SendLine[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const seen = new Map<string, string[]>();
  for (const l of lines) {
    const k = compact(l.partNumber) && compact(l.partNumber) !== "NONUMBER" && !placeholderReason(l) ? `pn:${compact(l.partNumber)}` : `nm:${compact(l.name)}`;
    seen.set(k, [...(seen.get(k) ?? []), l.key]);
  }
  for (const l of lines) out[l.key] = lineFlags(l);
  for (const keys of seen.values()) if (keys.length > 1) for (const k of keys) out[k] = [...out[k], "The same part is listed twice"];
  return out;
}

export const flagCount = (flags: Record<string, string[]>) => Object.values(flags).reduce((a, f) => a + f.length, 0);
