/**
 * Text tidiness, the same rules as the database triggers (erp_title_case, erp_sentence_case,
 * erp_upper_code): names in Title Case, codes in CAPITALS, descriptions in sentence case. Words
 * typed with their own capitals (McLaren) are left alone; known words (BMW, A/C) keep their form.
 */
export type TextCase = "title" | "sentence" | "upper";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export function applyKnownWords(text: string, known: string[]): string {
  let out = text;
  for (const kw of known) {
    if (!kw) continue;
    out = out.replace(new RegExp(`(^|[^A-Za-z0-9])${escape(kw)}($|[^A-Za-z0-9])`, "gi"), (m, a, b) => `${a}${kw}${b}`);
  }
  return out;
}

export function titleCase(text: string, known: string[] = []): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return t;
  const words = t.split(" ").map((w) => {
    if (w === w.toUpperCase() || w === w.toLowerCase()) return w.toLowerCase().replace(/(^|[^a-z0-9])([a-z])/g, (m, a, b) => a + b.toUpperCase());
    return w;
  });
  return applyKnownWords(words.join(" "), known);
}

export function sentenceCase(text: string, known: string[] = []): string {
  let out = text.trim();
  if (!out) return out;
  const letters = out.replace(/[^A-Za-z]/g, "");
  if (letters && (letters === letters.toUpperCase() || letters === letters.toLowerCase())) {
    out = out
      .split(" ")
      .map((w) => (/[0-9/\-]/.test(w) ? w : w.toLowerCase()))
      .join(" ");
  }
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  out = out.charAt(0).toUpperCase() + out.slice(1);
  return applyKnownWords(out, known);
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
