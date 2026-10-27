/**
 * The parts list gathered during the inspection: the technician picks parts from the owner's pool
 * (Settings > Parts list) under each finding, the list is reviewed at the end, the workshop manager
 * confirms it at approval, and one price request per part goes to the Parts desk. Shared by the
 * browser and the server; nothing here touches the database.
 */

export type PartsListEntry = {
  id: string;
  /** The pool part, or null for a custom part typed by the technician. */
  catalogue_id: string | null;
  name: string;
  qty: number;
  /** "Front left", "Rear", ... from PART_POSITIONS (or a free word for an odd case). */
  positions: string[];
  /** Where it came from: the checklist item key, "tyre:<pos>" or "measure:battery_health"; null when added at the end. */
  item_key: string | null;
  source: "item" | "tyre" | "measure" | "custom";
  note: string | null;
  /** "set" for parts sold per axle or per set. */
  unit?: "pc" | "set";
};

export type CatalogueRow = {
  id: string;
  category: string;
  name: string;
  needs_position: boolean;
  usage_count: number;
  /** Sold per set (brake pads, wiper blades...): the choice is Front / Rear and the quantity counts sets. */
  unit?: "each" | "set";
  /** Comes in pairs (control arms, discs, shock absorbers...): Front pair / Rear pair / All four, or one side only. */
  paired?: boolean;
  /** Parts offered alongside when this one is picked (a wear sensor with brake pads); never added by themselves. */
  goes_with?: string[];
};

/** The owner's order of the pool's categories in every picker; a category not listed goes at the end, alphabetically. */
export const CATEGORY_ORDER = ["Servicing", "Brakes", "Wheels and tyres", "Suspension and steering", "Engine", "Fuel and exhaust", "Cooling", "Air conditioning", "Transmission and driveline", "Electrical", "Other"] as const;

export function sortCategories(categories: string[]): string[] {
  const rank = (c: string) => {
    const i = CATEGORY_ORDER.findIndex((o) => o.toLowerCase() === c.toLowerCase());
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return [...categories].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export const PART_POSITIONS = ["Front left", "Front right", "Rear left", "Rear right", "Front", "Rear", "Left", "Right"] as const;
export const SINGLE_POSITIONS = ["Front left", "Front right", "Rear left", "Rear right"] as const;
/** The big buttons for a paired part or job: the positions and the quantity that goes with them. */
export const PAIR_CHOICES: { label: string; positions: string[]; qty: number }[] = [
  { label: "Front pair", positions: ["Front left", "Front right"], qty: 2 },
  { label: "Rear pair", positions: ["Rear left", "Rear right"], qty: 2 },
  { label: "All four", positions: ["Front left", "Front right", "Rear left", "Rear right"], qty: 4 },
];

/**
 * THE short form of a set of positions, used on every screen and document (owner's rule, 27 October 2026):
 * all four = "ALL 4" · all four + spare = "ALL 4 + SPARE" · FL+FR = "FRONT PAIR" · RL+RR = "REAR PAIR" ·
 * FL+RL = "LEFT SIDE" · FR+RR = "RIGHT SIDE" · one = its name · any other mix = the list.
 */
export function positionsWords(positions: string[] | null | undefined): string {
  if (!positions?.length) return "";
  const s = new Set(positions.map((p) => p.trim().toLowerCase()));
  const fl = s.has("front left"), fr = s.has("front right"), rl = s.has("rear left"), rr = s.has("rear right"), spare = s.has("spare");
  const four = fl && fr && rl && rr;
  if (four && s.size === 4) return "ALL 4";
  if (four && spare && s.size === 5) return "ALL 4 + SPARE";
  if (s.size === 2 && fl && fr) return "FRONT PAIR";
  if (s.size === 2 && rl && rr) return "REAR PAIR";
  if (s.size === 2 && fl && rl) return "LEFT SIDE";
  if (s.size === 2 && fr && rr) return "RIGHT SIDE";
  return Array.from(new Set(positions.map((p) => p.trim().toUpperCase()))).join(", ");
}

/** How many units a set of positions stands for (a pair is two, a "Front" axle job is one). */
export function positionsCount(positions: string[] | null | undefined): number {
  return new Set((positions ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean)).size;
}

/**
 * The warning when the ticked positions and the quantity disagree on a PER-UNIT line (tyres, pads sold per piece):
 * "5 positions ticked but qty is 4 – fix one". Axle positions (Front, Rear, Left, Right) are not units, so a line using
 * them never warns.
 */
export function positionsQtyMismatch(positions: string[] | null | undefined, qty: number | null | undefined): string | null {
  const n = positionsCount(positions);
  if (!n) return null;
  const unitPositions = (positions ?? []).every((p) => ["front left", "front right", "rear left", "rear right", "spare"].includes(p.trim().toLowerCase()));
  if (!unitPositions) return null;
  const q = Number(qty) || 0;
  return q === n ? null : `${n} position${n === 1 ? "" : "s"} ticked but qty is ${q} – fix one`;
}

/** The axles a set of positions touches, for a per-axle part offered alongside (a wear sensor for front pads). */
export function axlesOf(positions: string[] | null | undefined): ("Front" | "Rear")[] {
  const out = new Set<"Front" | "Rear">();
  for (const p of positions ?? []) {
    const l = p.toLowerCase();
    if (l.startsWith("front")) out.add("Front");
    if (l.startsWith("rear")) out.add("Rear");
  }
  return Array.from(out);
}

export function newEntryId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** A stored list, checked field by field. Anything odd is dropped rather than failing the save. */
export function cleanPartsList(raw: unknown): PartsListEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: PartsListEntry[] = [];
  const ids = new Set<string>();
  for (const x of raw.slice(0, 200)) {
    if (!x || typeof x !== "object") continue;
    const e = x as Record<string, unknown>;
    const name = String(e.name ?? "").trim().slice(0, 120);
    if (!name) continue;
    let id = String(e.id ?? "").trim().slice(0, 40) || newEntryId();
    while (ids.has(id)) id += "x";
    ids.add(id);
    const qtyRaw = Number(String(e.qty ?? "1").replace(",", "."));
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.min(999, Math.round(qtyRaw * 100) / 100) : 1;
    const positions = Array.isArray(e.positions) ? Array.from(new Set(e.positions.map((p) => String(p).trim().slice(0, 30)).filter(Boolean))).slice(0, 8) : [];
    const source = e.source === "tyre" || e.source === "measure" || e.source === "custom" ? e.source : "item";
    out.push({
      id,
      catalogue_id: typeof e.catalogue_id === "string" && /^[0-9a-f-]{36}$/i.test(e.catalogue_id) ? e.catalogue_id : null,
      name,
      qty,
      positions,
      item_key: e.item_key ? String(e.item_key).slice(0, 120) : null,
      source,
      note: e.note ? String(e.note).trim().slice(0, 300) || null : null,
      unit: e.unit === "set" ? "set" : "pc",
    });
  }
  return out;
}

export type MergedPartLine = {
  /** The name in lower case: the key the merged line and its price request share. */
  key: string;
  name: string;
  qty: number;
  positions: string[];
  catalogue_id: string | null;
  /** The first entry's origin: the price request keeps it so the part lands under the right labour line. */
  item_key: string | null;
  source: PartsListEntry["source"];
  note: string | null;
  unit: "pc" | "set";
  /** The entries behind the line. */
  entries: PartsListEntry[];
};

/** The same part picked in several places is one line: the quantities add up and the positions join. */
export function mergePartsList(list: PartsListEntry[]): MergedPartLine[] {
  const map = new Map<string, MergedPartLine>();
  for (const e of list) {
    const key = e.name.trim().toLowerCase();
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { key, name: e.name.trim(), qty: e.qty, positions: [...e.positions], catalogue_id: e.catalogue_id, item_key: e.item_key, source: e.source, note: e.note, unit: e.unit === "set" ? "set" : "pc", entries: [e] });
      continue;
    }
    cur.qty = Math.round((cur.qty + e.qty) * 100) / 100;
    for (const p of e.positions) if (!cur.positions.includes(p)) cur.positions.push(p);
    if (!cur.catalogue_id && e.catalogue_id) cur.catalogue_id = e.catalogue_id;
    if (e.note && !cur.note) cur.note = e.note;
    cur.entries.push(e);
  }
  return Array.from(map.values());
}

/** "Brake pads × 2 · Front left, Front right", or for a set "Brake pads · front · 1 set". */
/** A part offered alongside one already picked: "Front brake pad wear sensor" with front brake pads. Offered, never added by itself. */
export type GoesWithOffer = { key: string; label: string; base: PartsListEntry; target: CatalogueRow; axle: "Front" | "Rear" | null };

export function goesWithOffers(entries: PartsListEntry[], catalogue: CatalogueRow[]): GoesWithOffer[] {
  const byId = new Map(catalogue.map((c) => [c.id, c]));
  const byName = new Map(catalogue.map((c) => [c.name.toLowerCase(), c]));
  const has = (name: string, axle: "Front" | "Rear" | null) => entries.some((e) => e.name.toLowerCase() === name.toLowerCase() && (!axle || !e.positions.length || e.positions.some((p) => p.toLowerCase().startsWith(axle.toLowerCase()))));
  const out: GoesWithOffer[] = [];
  for (const e of entries) {
    const c = (e.catalogue_id ? byId.get(e.catalogue_id) : undefined) ?? byName.get(e.name.toLowerCase());
    for (const name of c?.goes_with ?? []) {
      const target = byName.get(name.toLowerCase());
      if (!target || target.id === c?.id) continue;
      const axles = target.unit === "set" || target.needs_position ? axlesOf(e.positions) : [];
      const variants: ("Front" | "Rear" | null)[] = axles.length ? axles : [null];
      for (const axle of variants) {
        const key = `${target.id}|${axle ?? ""}`;
        if (out.some((o) => o.key === key) || has(target.name, axle)) continue;
        out.push({ key, label: axle ? `${axle} ${target.name.charAt(0).toLowerCase()}${target.name.slice(1)}` : target.name, base: e, target, axle });
      }
    }
  }
  return out;
}

/** The entry an accepted offer adds: same finding as the part it goes with, the axle as its position. */
export function offerEntry(o: GoesWithOffer): PartsListEntry {
  return { id: newEntryId(), catalogue_id: o.target.id, name: o.target.name, qty: 1, positions: o.axle ? [o.axle] : [], item_key: o.base.item_key, source: o.base.source === "tyre" || o.base.source === "measure" ? "item" : o.base.source, note: null, unit: o.target.unit === "set" ? "set" : "pc" };
}

export function partsListLine(e: { name: string; qty: number; positions: string[]; unit?: "pc" | "set" }) {
  if (e.unit === "set") return `${e.name}${e.positions.length ? ` · ${positionsWords(e.positions)}` : ""} · ${e.qty} set${e.qty === 1 ? "" : "s"}`;
  const words = positionsWords(e.positions);
  // A paired part reads "Lower control arm - front pair - 2".
  if (/pair|all four/.test(words)) return `${e.name} - ${words} - ${e.qty}`;
  return `${e.name} × ${e.qty}${e.positions.length ? ` · ${positionsWords(e.positions)}` : ""}`;
}

const TYRE_POS: { key: string; label: string; side: "front" | "rear" }[] = [
  { key: "fl", label: "Front left", side: "front" },
  { key: "fr", label: "Front right", side: "front" },
  { key: "rl", label: "Rear left", side: "rear" },
  { key: "rr", label: "Rear right", side: "rear" },
  { key: "spare", label: "Spare", side: "front" },
];

/**
 * The tyre entries follow the tyre answers: every position marked Replace now or Replace soon is a
 * tyre of that axle's size, so two fronts become "Tyre 275/40 R20 × 2 · Front left, Front right".
 */
export function tyreEntriesFrom(m: Record<string, string | number | null | undefined>, catalogue: CatalogueRow[] = []): PartsListEntry[] {
  const tyreRow = catalogue.find((c) => c.name.toLowerCase() === "tyre") ?? null;
  const out: PartsListEntry[] = [];
  for (const p of TYRE_POS) {
    const action = String(m[`tyre_${p.key}_action`] ?? "");
    if (action !== "replace_now" && action !== "replace_soon") continue;
    const size = String(m[p.side === "front" ? "tyre_size_front" : "tyre_size_rear"] ?? "").trim();
    const brand = String(m[`tyre_${p.key}_brand`] ?? "").trim();
    out.push({
      id: `tyre-${p.key}`,
      catalogue_id: tyreRow?.id ?? null,
      name: /^\d{3}\/\d{2} R\d{2}$/.test(size) ? `Tyre ${size}` : "Tyre",
      qty: 1,
      positions: [p.label],
      item_key: `tyre:${p.key}`,
      source: "tyre",
      note: [brand ? `currently ${brand}` : "", action === "replace_now" ? "replace now" : "replace soon"].filter(Boolean).join(", ") || null,
      unit: "pc",
    });
  }
  return out;
}

/** The battery follows the battery test: Replace adds one main battery. */
export function batteryEntriesFrom(m: Record<string, string | number | null | undefined>, catalogue: CatalogueRow[] = []): PartsListEntry[] {
  if (String(m.battery_health ?? "") !== "replace") return [];
  const row = catalogue.find((c) => /^main battery$/i.test(c.name)) ?? catalogue.find((c) => /battery/i.test(c.name)) ?? null;
  return [{ id: "measure-battery", catalogue_id: row?.id ?? null, name: row?.name ?? "Main battery", qty: 1, positions: [], item_key: "measure:battery_health", source: "measure", note: m.battery_voltage ? `${m.battery_voltage} V` : null, unit: "pc" }];
}

/** Replaces the entries of one automatic source (tyres, battery) with a fresh set; returns the same list when nothing changed. */
export function withAutoEntries(list: PartsListEntry[], source: "tyre" | "measure", fresh: PartsListEntry[]): PartsListEntry[] {
  const kept = list.filter((e) => e.source !== source);
  const next = [...kept, ...fresh];
  const same = next.length === list.length && next.every((e, i) => JSON.stringify(e) === JSON.stringify(list[i]));
  return same ? list : next;
}

const STOP = new Set(["and", "with", "the", "for", "cover", "covers", "system", "side", "front", "rear", "left", "right", "upper", "lower", "mid", "portion", "level", "condition", "leak", "leaks", "fault", "electrical", "mechanical", "pipes", "pipe", "connector", "hoses", "hose", "aux"]);

/** The pool parts that fit a checklist item, by the words they share with its name, learned names first. */
export function suggestCatalogue(label: string, catalogue: CatalogueRow[], learned: string[] = []): CatalogueRow[] {
  const words = label.toLowerCase().split(/[^a-z0-9/]+/).filter((w) => w.length >= 4 && !STOP.has(w));
  const stem = (w: string) => w.replace(/(ers|er|es|s|ing)$/, "");
  const stems = words.map(stem);
  const out: CatalogueRow[] = [];
  const seen = new Set<string>();
  for (const name of learned) {
    const row = catalogue.find((c) => c.name.toLowerCase() === name.toLowerCase());
    const r = row ?? { id: `custom:${name}`, category: "Custom", name, needs_position: false, usage_count: 0, unit: "each" as const };
    if (!seen.has(r.id)) {
      seen.add(r.id);
      out.push(r);
    }
  }
  for (const c of catalogue) {
    if (seen.has(c.id)) continue;
    const cw = c.name.toLowerCase().split(/[^a-z0-9/]+/).map(stem).filter(Boolean);
    if (stems.some((s) => cw.some((x) => x.startsWith(s) || s.startsWith(x)))) {
      seen.add(c.id);
      out.push(c);
    }
  }
  return out.slice(0, 14);
}

/**
 * What one sticker of a part says about where it goes: with one position per unit (four tyres, four positions) the
 * n-th sticker names its own position (FRONT LEFT); otherwise every sticker carries the short form (ALL 4 + SPARE).
 */
export function stickerPosition(positions: string[] | null | undefined, index: number, count: number): string | null {
  const list = Array.from(new Set((positions ?? []).map((p) => p.trim()).filter(Boolean)));
  if (!list.length) return null;
  if (list.length === count && index >= 1 && index <= count) return list[index - 1].toUpperCase();
  return positionsWords(list) || null;
}
