/**
 * Quantity and unit of a part (section 9, 3 November 2026: E-00058's engine oil was "×1" on the parts desk with no way
 * to change it, and "7" meant litres only in people's heads). Pure and import-free: the Parts table, the estimate desk,
 * the quotation editor, the documents, the server checks and the unit tests all read these, so "8 L" means the same
 * everywhere.
 *
 *   pc   pieces (the default; documents print the number alone, as before)
 *   l    litres: engine oil, coolant, transmission and brake fluid; the cost is per litre
 *   set  sets: a set of pads, a kit; the cost is per set
 */
export const PART_UNITS = ["pc", "l", "set"] as const;
export type PartUnit = (typeof PART_UNITS)[number];

export const UNIT_CHOICES: { value: PartUnit; label: string; short: string }[] = [
  { value: "pc", label: "Pieces", short: "pcs" },
  { value: "l", label: "Litres", short: "L" },
  { value: "set", label: "Sets", short: "sets" },
];

/** A unit typed or stored anywhere ("each", "Ltr", "LITRE", "sets") as one of the three; null when it is none of them. */
export function cleanUnit(raw: unknown): PartUnit | null {
  const t = String(raw ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!t) return null;
  if (["l", "lt", "ltr", "ltrs", "litre", "litres", "liter", "liters"].includes(t)) return "l";
  if (["set", "sets", "kit", "kits"].includes(t)) return "set";
  if (["pc", "pcs", "piece", "pieces", "each", "ea", "unit", "units", "nos", "no", "pce"].includes(t)) return "pc";
  return null;
}

/** The unit to use: a recognised one, else pieces. */
export const unitOf = (raw: unknown): PartUnit => cleanUnit(raw) ?? "pc";

/** Part names sold in litres by default (the catalogue's own unit wins). */
export const DEFAULT_LITRE_WORDS = [
  "engine oil",
  "motor oil",
  "coolant",
  "antifreeze",
  "anti-freeze",
  "transmission oil",
  "transmission fluid",
  "gearbox oil",
  "atf",
  "gear oil",
  "differential oil",
  "diff oil",
  "axle oil",
  "transfer case oil",
  "transfer box oil",
  "brake fluid",
  "power steering fluid",
  "power steering oil",
];
/** An oil grade in the name ("0W-30", "OW30", "5W40", "75W-90"): a fluid. */
const OIL_GRADE = /(^|[^a-z0-9])[0-9o]{1,2}\s?w\s?-?\s?\d{2}([^0-9]|$)/i;
/** A part that only carries a fluid's name ("oil filter", "coolant hose", "drain plug"): counted in pieces. */
const NOT_A_FLUID = /\b(filters?|seals?|pumps?|cooler|pan|gaskets?|hoses?|pipes?|lines?|caps?|sensors?|housing|tanks?|reservoirs?|level|separator|radiator|thermostat|plugs?|washers?|valves?|bottle|switch|dipstick|o-?rings?|rings?|bolts?|covers?|elements?|mounts?|brackets?|screws?|clamps?|jets?)\b/i;

const words = (name: string) => ` ${String(name ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, " ").replace(/\s+/g, " ").trim()} `;

/** True when the name reads as a fluid sold by the litre (and not a part that only carries a fluid's name). */
export function isLitrePart(name: string, litreWords: readonly string[] = DEFAULT_LITRE_WORDS): boolean {
  const n = String(name ?? "");
  if (!n.trim() || NOT_A_FLUID.test(n)) return false;
  const w = words(n);
  return litreWords.some((x) => w.includes(` ${x.toLowerCase()} `)) || OIL_GRADE.test(n);
}

/**
 * The unit a new row starts with: the catalogue's own unit when it says sets or litres, else litres for a fluid's name,
 * else pieces. "each" in the catalogue is the old default for everything, so it never forces pieces on a fluid.
 */
export function defaultUnitFor(name: string, catalogueUnit?: string | null, litreWords: readonly string[] = DEFAULT_LITRE_WORDS): PartUnit {
  const cat = cleanUnit(catalogueUnit);
  if (cat === "set" || cat === "l") return cat;
  return isLitrePart(name, litreWords) ? "l" : "pc";
}

/** A quantity as text: "8", "6.5", "0.75" (never "8.00"). */
export function qtyNumber(q: number): string {
  const n = Number(q);
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 100) / 100);
}

/** "8 L", "6.5 L", "1 set", "2 sets", "4" (pieces print the number alone, as they always did). */
export function qtyWithUnit(q: number, unit: PartUnit | null | undefined): string {
  const n = qtyNumber(q);
  if (unit === "l") return `${n} L`;
  if (unit === "set") return `${n} ${Number(n) === 1 ? "set" : "sets"}`;
  return n;
}

/** What a document adds after a part's name: " · 8 L", " · 2 SETS"; nothing for pieces. */
export function unitSuffix(q: number, unit: PartUnit | null | undefined): string {
  if (unit !== "l" && unit !== "set") return "";
  return ` · ${qtyWithUnit(q, unit).toUpperCase()}`;
}

/** "each", "per litre", "per set": what the cost box is per. */
export function perUnitWords(unit: PartUnit | null | undefined): string {
  return unit === "l" ? "per litre" : unit === "set" ? "per set" : "each";
}

/** "/L", "/set", "" : the short mark after a cost per unit. */
export const perUnitMark = (unit: PartUnit | null | undefined) => (unit === "l" ? "/L" : unit === "set" ? "/set" : "");

/**
 * The unit a part REQUEST stands for (review of 3 November 2026): sets and litres as stored, else read from the name.
 * Nobody chooses pieces on a request (the inspection's parts list and older requests store "pc" for everything), so a
 * stored "pc" never hides the litre rule: "ENGINE OIL 0W-20" listed by the technician reaches Parts in litres.
 */
export const requestUnitOf = (label: string, stored: unknown): PartUnit => defaultUnitFor(label, cleanUnit(stored));

/**
 * − and + on a quantity box: one unit from the number itself (6.5 L + 1 = 7.5 L, never a jump to 8), never below 1 for
 * "−". Pieces and sets are whole already, so they step 1, 2, 3.
 */
export function stepQuantity(qty: number, by: 1 | -1): number {
  const n = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const next = Math.round((n + by) * 100) / 100;
  return by < 0 ? Math.max(1, next) : next;
}

/** The one quantity check (screen and server): above zero, not absurd, pieces and sets whole; litres to two decimals. */
export function checkQuantity(qty: number, unit: PartUnit | null | undefined): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return "The quantity must be above zero.";
  if (qty > 9999) return "That quantity is too large: check it.";
  if (unit !== "l" && Math.abs(qty - Math.round(qty)) > 1e-9) return unit === "set" ? "Sets are counted whole: 1, 2, 3…" : "Pieces are counted whole: 1, 2, 3… (litres: change the unit to L).";
  return null;
}

/** A typed quantity as a number (comma or dot), rounded to two decimals; null when it is not a number. */
export function parseQuantity(raw: unknown): number | null {
  const t = String(raw ?? "").trim().replace(",", ".").replace(/[^\d.]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Who asked for, or changed, a quantity. */
export type QtyWho = "technician" | "advisor" | "parts" | "owner" | "manager";
const WHO_LABEL: Record<QtyWho, string> = { technician: "Technician", advisor: "Advisor", parts: "Parts", owner: "The owner", manager: "The manager" };

/** The person's role as one of the askers (a parts person or anyone else counts as Parts). */
export function whoOfRole(role: string | null | undefined): QtyWho {
  switch (role) {
    case "technician":
    case "team_leader":
      return "technician";
    case "service_advisor":
      return "advisor";
    case "owner":
      return "owner";
    case "workshop_manager":
      return "manager";
    default:
      return "parts";
  }
}

/**
 * Who asked for a job part (review of 3 November 2026). A request from the inspection (it carries the inspection) or
 * from the additional work a technician raised is the technician's, whoever put it on the list (the workshop manager
 * approving the report, the advisor starting the quotation, the manager approving the additional work); any other
 * request is its maker's (the advisor's "+ Add a part", Parts); a part with no request is whoever added it.
 */
export function askerOfRequest(r: { inspection_id?: string | null; source_key?: string | null } | null | undefined, creatorRole: string | null | undefined, addedByRole?: string | null): QtyWho {
  if (!r) return whoOfRole(addedByRole ?? "parts");
  if (r.inspection_id || String(r.source_key ?? "").startsWith("additional:")) return "technician";
  return creatorRole ? whoOfRole(creatorRole) : "technician";
}

/**
 * The one wording of a quantity change, on the row, in the history and in the notices: "Advisor asked 1, Parts
 * changed to 8 L". The ask keeps its own unit when it had one ("asked 7 L").
 */
export function quantityChangeWords(a: { askedBy: QtyWho; asked: number; askedUnit?: PartUnit | null; changedBy: QtyWho; now: number; unit: PartUnit | null | undefined }): string {
  const changer = WHO_LABEL[a.changedBy];
  return `${WHO_LABEL[a.askedBy]} asked ${qtyWithUnit(a.asked, a.askedUnit ?? "pc")}, ${a.changedBy === "owner" || a.changedBy === "manager" ? changer.toLowerCase() : changer} changed to ${qtyWithUnit(a.now, a.unit)}`;
}

/* ---------------------------------------------------------------------------------------------------------------
   9.3: the quantity used last time on the same model. Names vary ("Engine oil", "ENGINE OIL - 5W30", "OW-30 FE
   GENUINE OIL LL-01-2L"), so parts are matched by a KIND read from the name (fluids), else the catalogue entry, else
   the cleaned name.
   --------------------------------------------------------------------------------------------------------------- */

const FLUID_KINDS: [string, RegExp][] = [
  ["fluid:brake", /\bbrake fluid\b|\bdot ?[345]\b/i],
  ["fluid:power_steering", /\bpower steering (fluid|oil)\b/i],
  ["fluid:transfer", /\btransfer (case|box) oil\b/i],
  ["fluid:diff_front", /\bfront (diff|differential)\b/i],
  ["fluid:diff_rear", /\brear (diff|differential)\b/i],
  ["fluid:diff", /\b(diff|differential|axle) oil\b|\bgear oil\b/i],
  ["fluid:transmission", /\btransmission (oil|fluid)\b|\bgearbox oil\b|\batf\b/i],
  ["fluid:coolant", /\bcoolant\b|\banti-?freeze\b/i],
  ["fluid:engine_oil", /\b(engine|motor) oil\b/i],
];

/** The kind of part a name is, for matching the same part across cars: "fluid:engine_oil", "cat:<id>", "name:BRAKE PADS". */
export function partKindOf(name: string, catalogueId?: string | null): string | null {
  const n = String(name ?? "").trim();
  if (!n) return catalogueId ? `cat:${catalogueId}` : null;
  if (isLitrePart(n)) {
    for (const [kind, re] of FLUID_KINDS) if (re.test(n)) return kind;
    if (OIL_GRADE.test(n)) return "fluid:engine_oil";
  }
  if (catalogueId) return `cat:${catalogueId}`;
  const clean = n.toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return clean ? `name:${clean}` : null;
}

/** One earlier use of a part on a car: a job's part or an estimate's line. */
export type QtyMemoryRow = {
  name: string;
  catalogueId?: string | null;
  qty: number;
  unit: PartUnit;
  /** "J-00017" or "E-00058". */
  ref: string;
  /** When it was priced or made (newest wins). */
  at: string;
  makeId: string | null;
  modelId: string | null;
  /** "ROLLS-ROYCE GHOST 2012": the car it was for. */
  car: string;
};

export type QtyMemory = { qty: number; unit: PartUnit; ref: string; car: string; sameModel: boolean };

/**
 * The quantity used last time for the same kind of part: on the same model first (the newest), else on the same make
 * (naming that model). Rows with no kind, no quantity or from the screen's own job or estimate (`exclude`) never count.
 */
export function lastQuantity(rows: QtyMemoryRow[], want: { name: string; catalogueId?: string | null }, car: { makeId: string | null; modelId: string | null }, exclude: readonly string[] = []): QtyMemory | null {
  const key = partKindOf(want.name, want.catalogueId);
  if (!key) return null;
  const same = rows.filter((r) => r.qty > 0 && !exclude.includes(r.ref) && (partKindOf(r.name, r.catalogueId) === key || (!!want.catalogueId && r.catalogueId === want.catalogueId)));
  const newest = (list: QtyMemoryRow[]) => [...list].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0] ?? null;
  const onModel = car.modelId ? newest(same.filter((r) => r.modelId === car.modelId)) : null;
  if (onModel) return { qty: onModel.qty, unit: onModel.unit, ref: onModel.ref, car: onModel.car, sameModel: true };
  const onMake = car.makeId ? newest(same.filter((r) => r.makeId === car.makeId)) : null;
  if (onMake) return { qty: onMake.qty, unit: onMake.unit, ref: onMake.ref, car: onMake.car, sameModel: false };
  return null;
}

/** "Last time on CULLINAN 2021: 7 L (E-00058)" / "On ROLLS-ROYCE GHOST 2012: 6 L (J-00017)". */
export function qtyMemoryWords(m: QtyMemory): string {
  return `${m.sameModel ? "Last time on" : "On"} ${m.car.toUpperCase()}: ${qtyWithUnit(m.qty, m.unit)} (${m.ref})`;
}
