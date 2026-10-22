/**
 * Text tidiness. Section 5 (21 October 2026): NOTHING changes the capitals a person typed - "OFJ"
 * stays OFJ, names and notes keep their own form. The old Title Case and sentence case are gone for
 * good (the database functions erp_title_case / erp_sentence_case were neutered the same day); what
 * remains is whitespace tidy and CAPITALS for codes (plates, VINs, part numbers), which never destroy
 * what was meant. Screens and documents still DISPLAY names in capitals by CSS and textTransform.
 */
export type TextCase = "title" | "sentence" | "upper";

export function applyKnownWords(text: string, known: string[]): string {
  // Kept for compatibility: with no case conversion left, the typed form already wins.
  void known;
  return text;
}

export function titleCase(text: string, known: string[] = []): string {
  void known;
  return text.trim().replace(/\s+/g, " ");
}

export function sentenceCase(text: string, known: string[] = []): string {
  void known;
  return text.trim();
}

export function upperCode(text: string): string {
  return text.trim().toUpperCase();
}

export function tidyText(text: string, mode: TextCase, known: string[] = []): string {
  if (mode === "upper") return upperCode(text);
  if (mode === "title") return titleCase(text, known);
  return sentenceCase(text, known);
}

/** The known words the app layout publishes for the browser (a meta tag), read once per blur. */
export function knownWordsFromPage(): string[] {
  if (typeof document === "undefined") return [];
  const meta = document.querySelector('meta[name="erp-known-words"]');
  const content = meta?.getAttribute("content") ?? "";
  return content.split("|").map((w) => w.trim()).filter(Boolean);
}
