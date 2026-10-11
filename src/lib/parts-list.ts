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
};

export type CatalogueRow = { id: string; category: string; name: string; needs_position: boolean; usage_count: number };

export const PART_POSITIONS = ["Front left", "Front right", "Rear left", "Rear right", "Front", "Rear", "Left", "Right"] as const;

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
      map.set(key, { key, name: e.name.trim(), qty: e.qty, positions: [...e.positions], catalogue_id: e.catalogue_id, item_key: e.item_key, source: e.source, note: e.note, entries: [e] });
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

/** "Brake pads × 2 · Front left, Front right". */
export function partsListLine(e: { name: string; qty: number; positions: string[] }) {
  return `${e.name} × ${e.qty}${e.positions.length ? ` · ${e.positions.join(", ")}` : ""}`;
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
    });
  }
  return out;
}

/** The battery follows the battery test: Replace adds one main battery. */
export function batteryEntriesFrom(m: Record<string, string | number | null | undefined>, catalogue: CatalogueRow[] = []): PartsListEntry[] {
  if (String(m.battery_health ?? "") !== "replace") return [];
  const row = catalogue.find((c) => /^main battery$/i.test(c.name)) ?? catalogue.find((c) => /battery/i.test(c.name)) ?? null;
  return [{ id: "measure-battery", catalogue_id: row?.id ?? null, name: row?.name ?? "Main battery", qty: 1, positions: [], item_key: "measure:battery_health", source: "measure", note: m.battery_voltage ? `${m.battery_voltage} V` : null }];
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
    const r = row ?? { id: `custom:${name}`, category: "Custom", name, needs_position: false, usage_count: 0 };
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
