/**
 * Tyres on the Parts table (16 October 2026, E5 and E6). A tyre row carries its details as one record: brand, model,
 * size, DOT year and the maker's marks; the row's name is built from them ("PIRELLI P ZERO 275/45 R20 N0 (2026)") so
 * the same words reach the quotation, the PDF, the customer's link, the proforma and the invoice. Pure, no server code.
 */
export type TyreSpec = { brand: string; model: string; size: string; year: string; marks: string[] };

/** Run-flat and the makers' approval marks offered as one-tap chips. */
export const TYRE_MARKS = ["Run-flat", "MO", "N0", "AO", "★"] as const;

const SIZE_RE = /\b(\d{3})\/(\d{2})\s?R\s?(\d{2})\b/i;

/** "275/45 R20" found anywhere in a name or a part number, or "". */
export function tyreSizeIn(text: string | null | undefined): string {
  const m = SIZE_RE.exec(String(text ?? ""));
  return m ? `${m[1]}/${m[2]} R${m[3]}` : "";
}

/** A row is a tyre when its name says so or carries a tyre size. */
export function isTyreName(name: string | null | undefined): boolean {
  const n = String(name ?? "");
  return /\btyres?\b/i.test(n) || SIZE_RE.test(n);
}

/** The bare generic name ("Tyre", "Tyres", "Tyre × 2") with no details yet. */
export function isGenericTyreName(name: string | null | undefined): boolean {
  return /^tyres?\b/i.test(String(name ?? "").trim()) && !SIZE_RE.test(String(name ?? ""));
}

/** The one name built from the details, in capitals: "PIRELLI P ZERO 275/45 R20 N0 (2026)". */
export function tyreName(s: TyreSpec): string {
  return [s.brand, s.model, s.size, ...(s.marks ?? []), s.year ? `(${s.year})` : ""]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

/** Brand and a full size are the least a tyre needs before it can be priced. */
export function tyreSpecComplete(s: Pick<TyreSpec, "brand" | "size"> | null | undefined): boolean {
  return !!s && !!String(s.brand ?? "").trim() && /^\d{3}\/\d{2} R\d{2}$/.test(String(s.size ?? ""));
}

/** The stored record, or null when there is none. */
export function parseTyreSpec(raw: unknown): TyreSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const spec: TyreSpec = { brand: text(r.brand), model: text(r.model), size: tyreSizeIn(text(r.size)) || text(r.size), year: text(r.year), marks: Array.isArray(r.marks) ? r.marks.map((m) => String(m)) : [] };
  return spec.brand || spec.model || spec.size || spec.year || spec.marks.length ? spec : null;
}

/** The DOT years offered with one tap: this year and the three before. */
export function tyreYears(now: Date = new Date()): string[] {
  const y = now.getFullYear();
  return [String(y), String(y - 1), String(y - 2), String(y - 3)];
}
