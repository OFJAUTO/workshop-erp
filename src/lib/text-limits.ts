/**
 * The longest description a quotation, estimate, proforma or invoice line keeps (27 October 2026). The box shows a
 * live counter as the text grows; above the limit NOTHING is saved (the server refuses rather than cutting), so a
 * long description is never stored half.
 */
export const LINE_TEXT_MAX = 3000;
/** The counter appears from this length on. */
export const LINE_TEXT_COUNTER_FROM = 150;

export function tooLongWords(length: number, max = LINE_TEXT_MAX): string {
  return `Too long: ${length.toLocaleString("en-GB")} characters (the limit is ${max.toLocaleString("en-GB")}). Nothing was saved – shorten it by ${(length - max).toLocaleString("en-GB")}.`;
}

/** The counter under a description box: null while short, else the words and whether it is over. */
export function textCounter(length: number, max = LINE_TEXT_MAX): { words: string; over: boolean } | null {
  if (length < LINE_TEXT_COUNTER_FROM) return null;
  if (length > max) return { words: `${length.toLocaleString("en-GB")} / ${max.toLocaleString("en-GB")} characters – shorten by ${(length - max).toLocaleString("en-GB")}; nothing is saved until it fits`, over: true };
  return { words: `${length.toLocaleString("en-GB")} / ${max.toLocaleString("en-GB")} characters`, over: false };
}

/** A line description exactly as typed (trimmed), or the refusal words when it is over the limit. Never cuts. */
export function lineTextOrError(raw: unknown, max = LINE_TEXT_MAX): { text: string; error: null } | { text: null; error: string } {
  const text = String(raw ?? "").trim();
  return text.length > max ? { text: null, error: tooLongWords(text.length, max) } : { text, error: null };
}
