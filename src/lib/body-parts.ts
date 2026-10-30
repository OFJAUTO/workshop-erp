import type { CatalogueRow, PartsListEntry } from "./parts-list";

/**
 * Body, lights, glass and interior parts in THE parts picker (30 October 2026, night batch section 7). The owner's pool
 * (Settings > Parts list) had none, so advisors typed every bumper and headlight by hand. These built-in rows join the
 * pool in every picker (estimates, quotations, additional quotations, the bodyshop, the Parts desk) unless the owner's
 * list already has a part of the same name; migration 20261201140000 copies them into the owner's list so he can edit
 * them. A part that comes in sides asks which ones, and each side becomes its own line: "Headlight – front right".
 * Pure: no database.
 */

const C4 = ["Front left", "Front right", "Rear left", "Rear right"];
const FRONT2 = ["Front left", "Front right"];
const REAR2 = ["Rear left", "Rear right"];
const LR = ["Left", "Right"];
const FR = ["Front", "Rear"];

type BuiltIn = { category: "Body" | "Glass" | "Interior"; name: string; sides?: string[] };

export const BUILT_IN_PARTS: BuiltIn[] = [
  // BODY
  { category: "Body", name: "Bumper", sides: FR },
  { category: "Body", name: "Bumper grille", sides: FR },
  { category: "Body", name: "Radiator grille" },
  { category: "Body", name: "Bonnet" },
  { category: "Body", name: "Front wing / fender", sides: FRONT2 },
  { category: "Body", name: "Door", sides: C4 },
  { category: "Body", name: "Tailgate / boot lid" },
  { category: "Body", name: "Roof panel" },
  { category: "Body", name: "Side skirt", sides: LR },
  { category: "Body", name: "Wheel arch liner", sides: C4 },
  { category: "Body", name: "Mirror (complete)", sides: LR },
  { category: "Body", name: "Mirror housing", sides: LR },
  { category: "Body", name: "Mirror glass", sides: LR },
  { category: "Body", name: "Door handle", sides: C4 },
  { category: "Body", name: "Spoiler", sides: FR },
  { category: "Body", name: "Badge / emblem", sides: FR },
  { category: "Body", name: "Mouldings and trims", sides: C4 },
  { category: "Body", name: "Bumper bracket / reinforcement", sides: FR },
  { category: "Body", name: "Fog light cover", sides: FRONT2 },
  { category: "Body", name: "Tow hook cover", sides: FR },
  { category: "Body", name: "Washer jet", sides: LR },
  { category: "Body", name: "Number plate holder", sides: FR },
  // LIGHTS (inside Body, found by search too)
  { category: "Body", name: "Headlight", sides: FRONT2 },
  { category: "Body", name: "Tail light", sides: REAR2 },
  { category: "Body", name: "Fog light", sides: FRONT2 },
  { category: "Body", name: "Indicator", sides: C4 },
  { category: "Body", name: "Side repeater", sides: LR },
  { category: "Body", name: "Third brake light" },
  // GLASS
  { category: "Glass", name: "Windscreen" },
  { category: "Glass", name: "Rear screen" },
  { category: "Glass", name: "Door glass", sides: C4 },
  { category: "Glass", name: "Quarter glass", sides: C4 },
  { category: "Glass", name: "Sunroof / panoramic glass" },
  // INTERIOR
  { category: "Interior", name: "Seat", sides: C4 },
  { category: "Interior", name: "Seat cover / upholstery", sides: C4 },
  { category: "Interior", name: "Seat motor / switch", sides: C4 },
  { category: "Interior", name: "Door card / trim", sides: C4 },
  { category: "Interior", name: "Dashboard trim" },
  { category: "Interior", name: "Steering wheel" },
  { category: "Interior", name: "Centre console" },
  { category: "Interior", name: "Carpet", sides: FR },
  { category: "Interior", name: "Headliner" },
  { category: "Interior", name: "Seat belt", sides: C4 },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const SIDES = new Map(BUILT_IN_PARTS.filter((p) => p.sides).map((p) => [p.name.toLowerCase(), p.sides!]));

/** The sides a part comes in (Front left, Front right…), or null when it is one part (by its name, built-in or the owner's own). */
export function sidesOf(row: { name: string }): string[] | null {
  return SIDES.get(row.name.toLowerCase()) ?? null;
}

/** The owner's pool plus the built-in rows it does not have yet (matched by name). */
export function withBuiltInParts(catalogue: CatalogueRow[]): CatalogueRow[] {
  const have = new Set(catalogue.map((c) => c.name.toLowerCase()));
  const extra: CatalogueRow[] = BUILT_IN_PARTS.filter((p) => !have.has(p.name.toLowerCase())).map((p) => ({ id: `builtin:${slug(p.name)}`, category: p.category, name: p.name, needs_position: !!p.sides, usage_count: 0, unit: "each" as const }));
  return [...catalogue, ...extra];
}

/** "Headlight – front right": the part with its side, the same words as the damage outline. */
export const sidedName = (name: string, side: string) => `${name} – ${side.toLowerCase()}`;

/**
 * A sided part picked with several sides becomes one line per side ("Headlight – front left", "Headlight – front
 * right"), each quantity 1 and its own position; everything else stays as picked.
 */
export function splitSided(entries: PartsListEntry[]): PartsListEntry[] {
  const out: PartsListEntry[] = [];
  for (const e of entries) {
    const sides = sidesOf(e);
    if (!sides || !e.positions.length) { out.push(e); continue; }
    e.positions.forEach((p, i) => out.push({ ...e, id: i === 0 ? e.id : `${e.id}-${i}`, name: sidedName(e.name, p), positions: [p], qty: e.positions.length === 1 ? e.qty : 1 }));
  }
  return out;
}

/* ---------------------------------------------------------------- the forgiving search (7.3) */

/** Words people use for the same part. */
const SYNONYMS: [RegExp, string][] = [
  [/\bgrill\b/g, "grille"],
  [/\bhead\s+light/g, "headlight"],
  [/\bhead\s*lamp/g, "headlight"],
  [/\btail\s+light/g, "tail light"],
  [/\btail\s*lamp/g, "tail light"],
  [/\bfog\s*lamp/g, "fog light"],
  [/\bfender\b/g, "wing fender"],
  [/\bhood\b/g, "bonnet"],
  [/\btrunk\b/g, "boot tailgate"],
  [/\bwind\s*shield\b/g, "windscreen"],
  [/\bwindshield\b/g, "windscreen"],
  [/\bback\s*glass\b/g, "rear screen"],
  [/\brear\s*window\b/g, "rear screen"],
  [/\bside\s*mirror\b/g, "mirror"],
  [/\bwing\s*mirror\b/g, "mirror"],
  [/\bblinker\b/g, "indicator"],
  [/\bturn\s*signal\b/g, "indicator"],
  [/\bsun\s*roof\b/g, "sunroof"],
  [/\bpanoramic\s*roof\b/g, "panoramic glass"],
  [/\bseatbelt\b/g, "seat belt"],
  [/\bsteering\s*wheel\b/g, "steering wheel"],
  [/\broof\s*lining\b/g, "headliner"],
  [/\blogo\b/g, "badge emblem"],
];

/** The part people usually mean by a short word ("grill" is the radiator grille before the bumper grille). */
const USUAL = new Set(["radiator grille", "headlight", "tail light", "windscreen", "bumper", "door", "bonnet", "mirror (complete)"]);

const norm = (s: string) => {
  let t = ` ${s.toLowerCase().replace(/[–—-]/g, " ").replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  for (const [re, to] of SYNONYMS) t = t.replace(re, to);
  return t.trim();
};
const compact = (s: string) => norm(s).replace(/[^a-z0-9]/g, "");

/** Edit distance with an early stop (the search only cares about 0, 1 or 2). */
function distance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The parts matching what was typed, best first, forgiving spelling: "grill" finds Radiator grille, "head light" finds
 * Headlight, "bumpr" finds Bumper. Whole-name matches first, then every typed word found (or one letter or two off).
 */
export function searchParts(query: string, pool: CatalogueRow[], limit = 40): CatalogueRow[] {
  const q = norm(query);
  if (!q) return [];
  const qc = compact(query);
  const words = q.split(" ").filter(Boolean);
  const scored: { row: CatalogueRow; score: number }[] = [];
  for (const row of pool) {
    const name = norm(row.name);
    const nc = compact(row.name);
    const cat = row.category.toLowerCase();
    let score = 0;
    if (nc === qc) score = 100;
    else if (nc.startsWith(qc)) score = 80;
    else if (nc.includes(qc)) score = 60;
    else {
      const nameWords = name.split(" ");
      let hits = 0;
      for (const w of words) {
        if (nameWords.some((n) => n.startsWith(w) || w.startsWith(n) && n.length >= 3)) { hits += 2; continue; }
        if (w.length >= 4 && nameWords.some((n) => n.length >= 4 && distance(w, n.slice(0, Math.max(w.length, Math.min(n.length, w.length + 1)))) <= (w.length >= 7 ? 2 : 1))) { hits += 1; continue; }
        if (cat.includes(w)) { hits += 1; continue; }
        hits = -99;
        break;
      }
      if (hits > 0) score = 10 + hits * 5;
    }
    if (score > 0) scored.push({ row, score: score + Math.min(5, row.usage_count / 10) + (USUAL.has(row.name.toLowerCase()) ? 3 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name)).slice(0, limit).map((s) => s.row);
}

/* ---------------------------------------------------------------- from the damage list (7.4) */

/** The damage outline's panels as parts with their side: one tap adds "Headlight – front right". */
const PANEL_PART: Record<string, [string, string | null]> = {
  front_bumper: ["Bumper", "Front"],
  rear_bumper: ["Bumper", "Rear"],
  grille: ["Radiator grille", null],
  bonnet: ["Bonnet", null],
  headlight_l: ["Headlight", "Front left"],
  headlight_r: ["Headlight", "Front right"],
  tail_light_l: ["Tail light", "Rear left"],
  tail_light_r: ["Tail light", "Rear right"],
  front_fender_l: ["Front wing / fender", "Front left"],
  front_fender_r: ["Front wing / fender", "Front right"],
  door_fl: ["Door", "Front left"],
  door_fr: ["Door", "Front right"],
  door_rl: ["Door", "Rear left"],
  door_rr: ["Door", "Rear right"],
  mirror_l: ["Mirror (complete)", "Left"],
  mirror_r: ["Mirror (complete)", "Right"],
  windshield: ["Windscreen", null],
  rear_screen: ["Rear screen", null],
  roof: ["Roof panel", null],
  boot: ["Tailgate / boot lid", null],
};

/** Suggestions for the picker from the panels marked damaged (gate-in and the bodyshop findings), in outline order. */
export function damagePartSuggestions(panels: string[]): CatalogueRow[] {
  const seen = new Set<string>();
  const out: CatalogueRow[] = [];
  for (const key of panels) {
    const m = PANEL_PART[key];
    if (!m) continue;
    const name = m[1] ? sidedName(m[0], m[1]) : m[0];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ id: `dmg:${key}`, category: "From the damage list", name, needs_position: false, usage_count: 0, unit: "each" });
  }
  return out;
}
