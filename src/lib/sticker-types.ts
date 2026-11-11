/**
 * WARRANTY STICKER TYPES (11 November 2026, Section 12). Pure. Battery first and the oil service sticker are built in;
 * the owner adds more on the Stickers tab, one per line "Name = months", with "= batch" when the sticker must carry a
 * batch number (PPF and tint only by default: no other sticker shows a batch).
 */
export type WarrantyType = { key: string; label: string; months: number; batch: boolean; builtIn: boolean };

export const BUILT_IN_TYPES: WarrantyType[] = [
  { key: "battery", label: "Battery", months: 0, batch: false, builtIn: true },
  { key: "service", label: "Oil service (next service)", months: 0, batch: false, builtIn: true },
];

export const DEFAULT_EXTRA_TYPES = "PPF film = 120 = batch\nWindow tint = 60 = batch";

const keyOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** The owner's lines read into types; a line without a name or months is left out. */
export function readExtraTypes(text: string): WarrantyType[] {
  const out: WarrantyType[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split("=").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const label = parts[0].slice(0, 40);
    const months = Math.round(Number(parts[1]));
    if (!label || !Number.isFinite(months) || months <= 0 || months > 600) continue;
    const key = keyOf(label);
    if (!key || BUILT_IN_TYPES.some((t) => t.key === key) || out.some((t) => t.key === key)) continue;
    out.push({ key, label, months, batch: parts.slice(2).some((p) => /^batch$/i.test(p)), builtIn: false });
  }
  return out;
}

export function writeExtraTypes(types: WarrantyType[]): string {
  return types.filter((t) => !t.builtIn).map((t) => `${t.label} = ${t.months}${t.batch ? " = batch" : ""}`).join("\n");
}

/** Every warranty sticker type, battery first. */
export function warrantyTypesOf(stored: unknown): WarrantyType[] {
  const text = typeof stored === "string" ? stored : DEFAULT_EXTRA_TYPES;
  return [...BUILT_IN_TYPES, ...readExtraTypes(text)];
}

/** The warranty end date: the start day plus the type's months. */
export function warrantyUntil(startIso: string, months: number): string {
  const d = new Date(startIso.slice(0, 10) + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** A batch number as printed: capitals, letters, digits, dash and slash only, at most 24. */
export function cleanBatch(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9\-/ ]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
}
