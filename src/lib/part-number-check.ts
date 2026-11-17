/*
 * THE part-number check (17 November 2026, Section 7; the cases BLADE78, FILTER69, FILTER859, FRONT PAD145, SOLITE859).
 * Pure (no server imports): the Parts page, the check-before-send window, the LPO approval screen, the weekly list and
 * the unit tests all read this ONE rule. A part number is flagged when it is not a real number:
 *  - it is the part's name, or a word of it, or a kind-of-part word (PAD, DISC, BLADE, FILTER…);
 *  - it is such a word (or words) with digits added ("BLADE78", "FRONT PAD145", "78BLADE", "FILTER-69");
 *  - a placeholder like 1234AA, or a stand-in (OFJ, OFJ1).
 * "No part number yet" (stored NO NUMBER) is the honest answer and is never flagged by this rule.
 */

/** Words that are the KIND of part, never its number. */
export const KIND_WORDS = new Set(["PAD", "PADS", "DISC", "DISCS", "DISK", "BLADE", "BLADES", "FLUID", "OIL", "FILTER", "FILTERS", "BELT", "BULB", "MOUNT", "MOUNTING", "SENSOR", "PUMP", "HOSE", "GASKET", "SEAL", "PLUG", "PLUGS", "WIPER", "BATTERY", "TYRE", "TIRE", "BRAKE", "BEARING", "SPRING", "SHOCK", "LINK", "ARM", "BUSH", "COIL", "VALVE", "PART", "PARTS", "FRONT", "REAR", "LEFT", "RIGHT", "KIT", "SET", "NA", "N/A", "TBC", "TBA", "XXX"]);

const compact = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export type PnVerdict = { kind: "name" | "word" | "word_digits" | "placeholder" | "standin"; words: string } | null;

/** Is this part number made up? null = it looks real (or "No part number yet"). */
export function madeUpPartNumber(partNumber: string | null | undefined, name: string): PnVerdict {
  const pn = String(partNumber ?? "").trim().toUpperCase();
  if (!pn || pn === "NO NUMBER") return null;
  const c = compact(pn);
  if (!c) return null;
  const nameWords = new Set(name.toUpperCase().split(/[^A-Z]+/).filter((w) => w.length >= 3));
  const known = (w: string) => nameWords.has(w) || KIND_WORDS.has(w);
  if (c === compact(name)) return { kind: "name", words: pn };
  if (/^OFJ\d{0,3}$/.test(c)) return { kind: "standin", words: pn };
  if (/^\d{3,4}[A-Z]{2}$/.test(c)) return { kind: "placeholder", words: pn };
  // Letters only: every word is the name's or a kind of part.
  if (!/\d/.test(pn)) {
    const words = pn.split(/[^A-Z]+/).filter(Boolean);
    if (words.length && words.every(known)) return { kind: "word", words: words.join(" ") };
    return null;
  }
  // A word (or words) with digits added, in either order: BLADE78, FRONT PAD145, FILTER-69, 78BLADE.
  const m = /^([A-Z][A-Z\s./_-]*?)[\s./_-]*(\d+)$/.exec(pn) ?? /^(\d+)[\s./_-]*([A-Z][A-Z\s./_-]*)$/.exec(pn);
  if (m) {
    const letters = (/^\d/.test(m[1]) ? m[2] : m[1]).split(/[^A-Z]+/).filter((w) => w.length >= 2);
    if (letters.length && letters.join("").length >= 3 && letters.every(known)) return { kind: "word_digits", words: letters.join(" ") };
  }
  return null;
}

/** The words shown on the line (Parts page, LPO approval screen) and in the check-before-send window. */
export function madeUpWords(partNumber: string | null | undefined, name: string): string | null {
  const v = madeUpPartNumber(partNumber, name);
  if (!v) return null;
  const pn = String(partNumber ?? "").trim();
  if (v.kind === "name" || v.kind === "word") return `"${pn}" is the part's name, not its number: enter the real number or tick "No part number yet".`;
  if (v.kind === "word_digits") return `"${pn}" is the part's name with a number added, not a real part number: enter the real number or tick "No part number yet".`;
  if (v.kind === "standin") return `"${pn}" is a stand-in, not a part number: enter the real number or tick "No part number yet".`;
  return `"${pn}" looks like a placeholder (like 1234AA): enter the real number or tick "No part number yet".`;
}
