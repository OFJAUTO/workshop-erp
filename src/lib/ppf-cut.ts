/**
 * Section 10 (21 October 2026): the PPF cutting method - ONE vocabulary for the quotation editor, every
 * customer document (under the PPF item, with a one-sentence explanation), the job card and the PPF
 * tablet (a big badge), the invoice and the warranty card ("OFJ Bespoke PPF – Gloss · Hand-cut · Full
 * body · 10-year warranty"), and the monthly report (hand-cut against pre-cut). Pure: no imports.
 * "OFJ Bespoke" is the PPF product's name (23 October 2026), so the cutting methods never use the word Bespoke.
 */
export type CutMethod = "hand" | "machine" | "mixed";

export const CUT_METHODS: { key: CutMethod; chip: string; long: string; short: string; badge: string; recommended?: boolean }[] = [
  { key: "hand", chip: "Hand-cut", long: "Hand-cut – edges wrapped, seamless finish", short: "Hand-cut", badge: "HAND-CUT", recommended: true },
  { key: "machine", chip: "Pre-cut", long: "Machine pre-cut – computer-cut pattern", short: "Machine pre-cut", badge: "PRE-CUT" },
  { key: "mixed", chip: "Mixed", long: "Mixed – hand-cut and machine pre-cut", short: "Mixed cut", badge: "MIXED" },
];

/** The one sentence behind the ⓘ on the customer's documents. */
export const CUT_EXPLAIN = "Hand-cut film is trimmed on your car and wrapped around the panel edges so no seams or edges show; pre-cut film is cut by a machine from a pattern and stops just short of the edges.";

/** A PPF line's method: what was chosen, else hand-cut (the default and the recommendation). */
export function cutOf(method: string | null | undefined, note?: string | null): (typeof CUT_METHODS)[number] & { note: string | null } {
  const m = CUT_METHODS.find((c) => c.key === method) ?? CUT_METHODS[0];
  return { ...m, note: m.key === "mixed" && note ? note.trim() || null : null };
}

/** The full customer words: "Hand-cut – edges wrapped, seamless finish", with the note for Mixed. */
export function cutWords(method: string | null | undefined, note?: string | null): string {
  const c = cutOf(method, note);
  return c.note ? `${c.long} (${c.note})` : c.long;
}

/** Whether a piece of text is about paint protection film. */
export function isPpfText(s: string | null | undefined): boolean {
  return /\bppf\b|paint protection film/i.test(s ?? "");
}

/** A quotation or invoice line that carries PPF: a PPF service, or a package with a PPF item in it. */
export function lineIsPpf(l: { title?: string | null; package_items?: unknown }, serviceKind?: string | null): boolean {
  // Taking OLD film off is not a film install: no cutting method, never the warranty's coverage.
  if (serviceKind === "ppf_removal" || /remov/i.test(l.title ?? "")) return false;
  if (serviceKind === "ppf" || serviceKind === "coloured_ppf") return true;
  const items = (l.package_items && typeof l.package_items === "object" && Array.isArray((l.package_items as { items?: unknown }).items) ? ((l.package_items as { items: { label?: string }[] }).items) : []) as { label?: string }[];
  if (items.some((i) => isPpfFilmItem(i.label))) return true;
  // A plain line counts only when it IS film being fitted: "Ceramic coating for PPF" names PPF but is a coating.
  return !l.package_items && isPpfFilmItem(l.title);
}

/** A package item that IS film being fitted: PPF words, but never a coating, a tint or taking old film off. */
export function isPpfFilmItem(label: string | null | undefined): boolean {
  return isPpfText(label) && !/ceramic|coating|remov|tint/i.test(label ?? "");
}

/** The film's finish for the warranty: Matte (matte, stealth, satin) or Gloss (gloss, clear), else the film colour. */
export function ppfFinishOf(words: string, filmColour?: string | null): string {
  return /\bmatte?\b|\bstealth\b|\bsatin\b/i.test(words) ? "Matte" : /\bgloss(y)?\b|\bclear\b/i.test(words) ? "Gloss" : filmColour ? filmColour : "Gloss";
}
