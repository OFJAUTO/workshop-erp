/**
 * The pure rules of the pre-send spelling check (23 October 2026): which words to look at, and which look like
 * keyboard mash ("afqghjk", "wdwdwdw"). The dictionary itself lives on the server (src/lib/spell.ts).
 */

export type SpellIssue = { word: string; kind: "misspelled" | "mash"; suggestions: string[]; context: string };

/** A built-in workshop dictionary: car words a general English dictionary flags. The owner adds more in Settings. */
export const WORKSHOP_WORDS = [
  "PPF", "ODIS", "PIWIS", "TPMS", "OBD", "ECU", "ABS", "ESP", "DSC", "DPF", "EGR", "VIN", "AED", "VAT", "OFJ", "LPO", "QC", "OEM", "ATF", "CVT", "DCT", "DOT", "TCU", "BCM", "SRS",
  "Urus", "Huracan", "Huracán", "Aventador", "Revuelto", "Cullinan", "Ghost", "Phantom", "Wraith", "Dawn", "Spectre", "Bentayga", "Mulsanne", "Brabus", "AMG", "Maybach", "Cayenne", "Macan", "Taycan", "Panamera",
  "Lamborghini", "Ferrari", "Porsche", "McLaren", "Bentley", "Rolls", "Royce", "Mercedes", "Benz", "BMW", "Audi", "Lexus", "Toyota", "Nissan", "Range", "Rover", "Defender", "Bugatti", "Maserati", "Tesla",
  "stabiliser", "stabilizer", "stabilisers", "stabilizers", "wishbone", "wishbones", "R1234yf", "R134a", "tyre", "tyres", "kerb", "bonnet", "boot", "windscreen", "windshield", "aircon", "A/C",
  "caliper", "calipers", "rotor", "rotors", "subframe", "driveshaft", "driveshafts", "propshaft", "CV", "bushes", "bushing", "bushings", "gasket", "gaskets", "sump", "turbo", "turbocharger", "supercharger",
  "intercooler", "coilover", "coilovers", "struts", "tie", "TPMS", "headlamp", "headlamps", "taillight", "taillights", "foglamp", "foglamps", "wiper", "wipers", "unclip", "refit", "refitted", "resealed", "reseal",
  "skimming", "skim", "rewire", "recoding", "coding", "reprogramming", "calibration", "recalibration", "realignment", "detailing", "ceramic", "polish", "polishing", "wrap", "wrapped", "matte", "gloss",
  "ok", "OK", "pcs", "pc", "km", "kms", "mm", "nm", "Nm", "ltr", "ltrs", "hrs", "qty",
];

const VOWELS = /[aeiouy]/i;

/** Keyboard mash: a made-up run of letters, not a word anyone would write. */
export function isMash(word: string): boolean {
  const w = word.toLowerCase();
  if (!/^[a-z]+$/.test(w) || w.length < 5) return false;
  // The same one or two letters over and over: "wdwdwdw", "aaaaa", "asasas".
  if (/^(.{1,2})\1{2,}.?$/.test(w)) return true;
  const vowels = (w.match(/[aeiouy]/g) ?? []).length;
  if (!VOWELS.test(w) && w.length >= 5) return true;
  if (vowels / w.length < 0.2 && w.length >= 6) return true;
  // Five consonants in a row hardly ever happen in English ("afqghjk" has "fqghjk").
  if (/[bcdfghjklmnpqrstvwxz]{5,}/.test(w)) return true;
  // Rows of the keyboard typed across: "asdf", "qwer", "hjkl", "zxcv".
  if (/(asdf|sdfg|dfgh|fghj|ghjk|hjkl|qwer|wert|erty|rtyu|tyui|yuio|uiop|zxcv|xcvb|cvbn|vbnm)/.test(w)) return true;
  return false;
}

/** Words that are never checked: anything with a digit (part numbers, sizes, R1234yf), links, emails, codes. */
export function skipToken(word: string, textIsAllCaps: boolean): boolean {
  if (word.length < 3) return true;
  if (/\d/.test(word)) return true;
  if (/[@/\\:]/.test(word)) return true;
  // A short word in capitals inside normal text is an abbreviation (TPMS, ECU, DSC).
  if (!textIsAllCaps && word.length <= 5 && word === word.toUpperCase()) return true;
  return false;
}

/** The words of a text with where they start, for the check and for the one-tap fix. */
export function tokens(text: string): { word: string; index: number }[] {
  const out: { word: string; index: number }[] = [];
  // Links, email addresses and web addresses are never words: blanked out (same length, so positions stay right).
  text = text.replace(/(https?:\/\/|www\.)\S+|\S+@\S+\.\S+|\b[\w-]+\.(com|ae|net|org|io|co)\b\S*/gi, (m) => " ".repeat(m.length));
  const re = /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*[A-Za-zÀ-ÿ]|[A-Za-zÀ-ÿ]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // Possessives and wrapped hyphens are checked on their own parts.
    for (const part of m[0].replace(/['’]s$/i, "").split(/-/)) {
      if (part) out.push({ word: part, index: m.index + m[0].indexOf(part) });
    }
  }
  return out;
}

/** "…replace due to excessive temperature afqghjk…": the words around a finding, for the list. */
export function contextOf(text: string, index: number, word: string): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + word.length + 30);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** Replace one word in a text (whole word, first match from a given position): the one-tap fix. */
export function replaceWord(text: string, word: string, replacement: string): string {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^A-Za-zÀ-ÿ])${esc}(?=$|[^A-Za-zÀ-ÿ])`);
  return text.replace(re, (_m, pre: string) => `${pre}${replacement}`);
}
