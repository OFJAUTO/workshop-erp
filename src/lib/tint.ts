/**
 * Section 11 (21 October 2026): the tint specification per window - ONE vocabulary for the editor box,
 * every customer document, the job card, the tint tablet, the invoice and the warranty card. ONE scale
 * everywhere: "darkness %", written "50% darkness" (how customers here talk); never "VLT". The package
 * itself never stores a shade: the documents add it to the tint items from the job's specification.
 * Pure: no imports.
 */
export type TintWindow = "windshield" | "front_sides" | "rear_sides" | "rear_window" | "roof";
export type TintShade = "clear" | number;
export type TintRow = { on: boolean; coverage?: "clear" | "strip" | "full"; shade: TintShade | null; double: boolean };
export type TintSpec = { rows: Record<TintWindow, TintRow>; roofFitted: boolean };

export const TINT_WINDOWS: { key: TintWindow; label: string; short: string }[] = [
  { key: "windshield", label: "Windshield", short: "windshield" },
  { key: "front_sides", label: "Front side windows", short: "front sides" },
  { key: "rear_sides", label: "Rear side windows", short: "rear sides" },
  { key: "rear_window", label: "Rear window", short: "rear window" },
  { key: "roof", label: "Sunroof / panoramic roof", short: "roof" },
];
export const SHADES: TintShade[] = ["clear", 5, 10, 15, 20, 30, 35, 40, 50, 60, 70];
export const WINDSHIELD_COVERAGE: { key: "none" | "clear" | "strip" | "full"; label: string }[] = [
  { key: "none", label: "None" },
  { key: "clear", label: "Clear heat-rejection" },
  { key: "strip", label: "Top strip" },
  { key: "full", label: "Full" },
];

const blankRow = (): TintRow => ({ on: false, shade: null, double: false });
export function emptyTintSpec(): TintSpec {
  return { rows: { windshield: blankRow(), front_sides: blankRow(), rear_sides: blankRow(), rear_window: blankRow(), roof: blankRow() }, roofFitted: false };
}

/** The Standard preset: windshield clear heat-rejection · sides & rear 50% darkness · roof 50% darkness. */
export function standardTintSpec(): TintSpec {
  const s = emptyTintSpec();
  s.rows.windshield = { on: true, coverage: "clear", shade: "clear", double: false };
  for (const k of ["front_sides", "rear_sides", "rear_window", "roof"] as TintWindow[]) s.rows[k] = { on: true, shade: 50, double: false };
  s.roofFitted = true;
  return s;
}
export const DEFAULT_TINT_PRESETS: { name: string; spec: TintSpec }[] = [{ name: "Standard", spec: standardTintSpec() }];

export function cleanTintSpec(raw: unknown): TintSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { rows?: Record<string, unknown>; roofFitted?: unknown };
  if (!r.rows || typeof r.rows !== "object") return null;
  const out = emptyTintSpec();
  for (const w of TINT_WINDOWS) {
    const x = (r.rows as Record<string, Record<string, unknown> | undefined>)[w.key];
    if (!x) continue;
    const shadeRaw = x.shade;
    const shade: TintShade | null = shadeRaw === "clear" ? "clear" : typeof shadeRaw === "number" && SHADES.includes(shadeRaw) ? shadeRaw : null;
    const coverage = x.coverage === "clear" || x.coverage === "strip" || x.coverage === "full" ? x.coverage : undefined;
    out.rows[w.key] = { on: !!x.on, shade, double: !!x.double, ...(w.key === "windshield" && coverage ? { coverage } : {}) };
  }
  out.roofFitted = !!r.roofFitted;
  if (!out.roofFitted) out.rows.roof = blankRow();
  return out;
}

/** "50% darkness", "clear heat-rejection", with ", double layer" when doubled. */
export function shadeWords(shade: TintShade | null, double = false): string | null {
  if (shade === null) return null;
  const base = shade === "clear" ? "clear heat-rejection" : `${shade}% darkness`;
  return double ? `${base}, double layer` : base;
}

/** One window's words, or null when nothing is fitted there. */
export function rowWords(key: TintWindow, row: TintRow): string | null {
  if (!row.on) return null;
  if (key === "windshield") {
    if (row.coverage === "clear" || (!row.coverage && row.shade === "clear")) return "clear heat-rejection";
    if (row.coverage === "strip") return `top strip${row.shade !== null && row.shade !== "clear" ? ` ${shadeWords(row.shade, row.double)}` : ""}`;
    return shadeWords(row.shade, row.double);
  }
  return shadeWords(row.shade, row.double);
}

const sameRow = (a: TintRow, b: TintRow) => a.on === b.on && a.shade === b.shade && a.double === b.double;

/** The side & rear words: one shade when all three agree, else split ("front sides 50% darkness · rear sides & rear window 70% darkness"). */
export function sidesWords(spec: TintSpec, limit = 0): string | null {
  const over = (r: TintRow) => limit > 0 && typeof r.shade === "number" && r.shade > limit;
  const mark = (r: TintRow, w: string | null) => (w && over(r) ? `${w} (${ABOVE_LIMIT_WORDS})` : w);
  const keys: TintWindow[] = ["front_sides", "rear_sides", "rear_window"];
  const on = keys.filter((k) => spec.rows[k].on && spec.rows[k].shade !== null);
  if (!on.length) return null;
  if (on.length === 3 && sameRow(spec.rows.front_sides, spec.rows.rear_sides) && sameRow(spec.rows.rear_sides, spec.rows.rear_window)) return mark(spec.rows.front_sides, rowWords("front_sides", spec.rows.front_sides));
  const groups: { keys: TintWindow[]; row: TintRow }[] = [];
  for (const k of on) {
    const g = groups.find((x) => sameRow(x.row, spec.rows[k]));
    if (g) g.keys.push(k);
    else groups.push({ keys: [k], row: spec.rows[k] });
  }
  const label = (k: TintWindow) => TINT_WINDOWS.find((w) => w.key === k)!.short;
  return groups.map((g) => `${g.keys.map(label).join(" & ")} ${mark(g.row, rowWords(g.keys[0], g.row))}`).join(" · ");
}

/** The windows darker than the owner's legal limit (darkness % above the limit). */
export function aboveLimit(spec: TintSpec | null, limit: number): { key: TintWindow; label: string; shade: number }[] {
  if (!spec || !(limit > 0)) return [];
  return TINT_WINDOWS.filter((w) => spec.rows[w.key].on && typeof spec.rows[w.key].shade === "number" && (spec.rows[w.key].shade as number) > limit).map((w) => ({ key: w.key, label: w.label, shade: spec.rows[w.key].shade as number }));
}

export const ABOVE_LIMIT_WORDS = "above the legal limit – customer's request";

/** The words a tint item on a document gets, from its own label: windshield, roof, or the sides & rear. */
export function tintWordsFor(label: string, spec: TintSpec | null, limit = 0): string | null {
  if (!spec) return null;
  const l = label.toLowerCase();
  const over = (keys: TintWindow[]) => aboveLimit(spec, limit).some((a) => keys.includes(a.key));
  const withLimit = (words: string | null, keys: TintWindow[]) => (words ? `${words}${over(keys) ? ` (${ABOVE_LIMIT_WORDS})` : ""}` : null);
  if (/wind(shield|screen)/.test(l)) return withLimit(rowWords("windshield", spec.rows.windshield), ["windshield"]);
  if (/roof|sunroof|panoramic/.test(l)) return spec.roofFitted ? withLimit(rowWords("roof", spec.rows.roof), ["roof"]) : null;
  if (!isTintText(label)) return null;
  // A tint item that names the sides or the rear carries those windows; one that names no window covers the whole car.
  if (/side|rear|door/.test(l)) return sidesWords(spec, limit);
  return tintSummary(spec, limit);
}

/** The decorate hook for packageDocOf: a tint item gets " · 50% darkness" added; nothing else changes. */
export function decorateTint(spec: TintSpec | null, limit = 0): (label: string) => string {
  return (label) => {
    let w = tintWordsFor(label, spec, limit);
    if (w && /heat[\s-]?rejection/i.test(label)) w = w.replace(/^clear heat-rejection/, "clear");
    return w ? `${label} · ${w}` : label;
  };
}

/** The whole specification in one line, for the job card, the tablet and the WhatsApp message. */
export function tintSummary(spec: TintSpec | null, limit = 0): string | null {
  if (!spec) return null;
  const over = (k: TintWindow) => aboveLimit(spec, limit).some((a) => a.key === k);
  const parts: string[] = [];
  const ws = rowWords("windshield", spec.rows.windshield);
  if (ws) parts.push(`windshield ${ws}${over("windshield") ? ` (${ABOVE_LIMIT_WORDS})` : ""}`);
  const sides = sidesWords(spec, limit);
  if (sides) parts.push(/^(front|rear)/.test(sides) ? sides : `sides & rear ${sides}`);
  const roof = spec.roofFitted ? rowWords("roof", spec.rows.roof) : null;
  if (roof) parts.push(`roof ${roof}${over("roof") ? ` (${ABOVE_LIMIT_WORDS})` : ""}`);
  return parts.length ? parts.join(" · ") : null;
}

/** "old → new" for the change log, in the same words as the documents. */
export function tintChangeWords(before: TintSpec | null, after: TintSpec | null): string {
  return `${tintSummary(before) ?? "no tint chosen"} → ${tintSummary(after) ?? "no tint chosen"}`;
}

/** Whether two specifications say the same thing (compared after cleaning, so key order never matters). */
export function sameTintSpec(a: TintSpec | null, b: TintSpec | null): boolean {
  return JSON.stringify(a ? cleanTintSpec(a) : null) === JSON.stringify(b ? cleanTintSpec(b) : null);
}

/**
 * A quotation or invoice line that is tint work: a tint service (bodyshop kind "tint"), a line whose name says
 * tint or window film, or a package with a tint item. Packages never store a shade; the documents add it.
 */
export function lineIsTint(l: { title?: string | null; description?: string | null; package_items?: unknown }, serviceKind?: string | null): boolean {
  if (serviceKind === "tint") return true;
  const snap = l.package_items && typeof l.package_items === "object" ? (l.package_items as { items?: { label?: string }[] }) : null;
  if (snap && Array.isArray(snap.items)) return snap.items.some((i) => isTintText(i?.label));
  return isTintText(l.title ?? l.description ?? "");
}

/** The words under a tint line that is NOT a package (a "Window tint" service): its windows and shades. */
export function lineTintWords(l: { title?: string | null; description?: string | null; package_items?: unknown }, serviceKind: string | null | undefined, spec: TintSpec | null, limit = 0): string | null {
  if (!spec || (l.package_items && typeof l.package_items === "object")) return null;
  if (!lineIsTint(l, serviceKind)) return null;
  const label = l.title ?? l.description ?? "";
  return tintWordsFor(isTintText(label) ? label : `${label} tint`, spec, limit);
}

/**
 * The tint cost and time effect for the package estimate: each fitted window group carries a share of
 * the per-car tint cost (sides & rear make the standard car), a double layer doubles its share and adds
 * the Settings hours for that window.
 */
export function tintCostFactor(spec: TintSpec | null, doubleLayerHours: number): { factor: number; extraHours: number } {
  if (!spec) return { factor: 1, extraHours: 0 };
  const share = { windshield: 1 / 3, front_sides: 1 / 3, rear_sides: 1 / 3, rear_window: 1 / 3, roof: 1 / 3 } as Record<TintWindow, number>;
  let factor = 0;
  let doubled = 0;
  for (const w of TINT_WINDOWS) {
    const r = spec.rows[w.key];
    if (!r.on || (w.key === "roof" && !spec.roofFitted)) continue;
    factor += share[w.key] * (r.double ? 2 : 1);
    if (r.double) doubled += 1;
  }
  return { factor: Math.round(factor * 100) / 100 || 1, extraHours: doubled * doubleLayerHours };
}

/** Whether a document line or package item is tint work at all. */
export function isTintText(s: string | null | undefined): boolean {
  // A check visit ("tint recheck", "10-day check") names tint but fits none (30 October 2026).
  return /\btint(s|ing|ed)?\b|window film|wind(shield|screen) film|roof film/i.test(s ?? "") && !/re-?check|\bcheck\b|inspect|after-?care/i.test(s ?? "");
}
