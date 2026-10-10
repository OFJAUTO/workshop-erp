/** The mechanical inspection: checklist shape, default sections, measurements, tyres, statuses and the completeness rules. */

/** Checklist items: GOOD, AVERAGE, BAD or N/A (does not apply; counts as answered, needs no remark, left out of the customer's report). */
export const ITEM_STATUSES = ["good", "average", "bad", "na"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
/** Customer requests and the road test have no N/A. */
export const CHECK_STATUSES = ["good", "average", "bad"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];
export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = { good: "GOOD", average: "AVERAGE", bad: "BAD", na: "N/A" };

/** The "Other" section is optional: an unmarked item there does not block the report. */
export const OPTIONAL_SECTION_KEY = "other";

export const INSPECTION_STATUSES = ["not_started", "in_progress", "submitted", "returned", "approved"] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];
export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  not_started: "Not started",
  in_progress: "Inspection in progress",
  submitted: "Submitted, waiting for the workshop manager",
  returned: "Sent back to the technician",
  approved: "Approved by the workshop manager",
};

export type ChecklistItem = { key: string; label: string };
export type ChecklistSection = { key: string; title: string; items: ChecklistItem[] };

/** The road test used to be a checklist section; it now belongs to the QC inspector. Old reports hide it. */
export const ROAD_TEST_SECTION_KEY = "diagnostics_and_road_test";

export const JOB_DEPARTMENTS = [
  { value: "mechanical", label: "Mechanical" },
  { value: "bodyshop", label: "Bodyshop" },
  { value: "both", label: "Both" },
] as const;
export type JobDepartment = (typeof JOB_DEPARTMENTS)[number]["value"];

/** Which side of the workshop a staff department belongs to. */
export function sideOfDepartment(departmentId: string | null | undefined): "mechanical" | "bodyshop" | null {
  if (departmentId === "mechanical") return "mechanical";
  if (departmentId === "bodyshop" || departmentId === "paint" || departmentId === "ppf_tint") return "bodyshop";
  return null;
}

/** Does this job concern the given side? "Both" concerns everyone. */
export function jobConcernsSide(jobDepartment: string | null | undefined, side: "mechanical" | "bodyshop" | null) {
  if (!jobDepartment) return true; // Cars gated in before the department question existed.
  if (!side) return true; // Office managers see everything.
  return jobDepartment === "both" || jobDepartment === side;
}

export function slugKey(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function section(title: string, labels: string[]): ChecklistSection {
  const key = slugKey(title);
  const seen = new Set<string>();
  return {
    key,
    title,
    items: labels.map((label) => {
      let k = slugKey(label);
      while (seen.has(k)) k += "_x";
      seen.add(k);
      return { key: `${key}.${k}`, label };
    }),
  };
}

/** The owner's starting checklist. Editable in Settings; every report keeps the version it was done with. */
export const DEFAULT_CHECKLIST: ChecklistSection[] = [
  section("Engine bay", [
    "Bonnet shocks + lever/cable",
    "Engine covers",
    "Engine oil cap",
    "Engine oil level and condition",
    "Engine oil filter",
    "Engine air filter + housing/pipes/connector/hoses",
    "Serpentine belt + auxiliary belts",
    "Idler / tensioner / pulley",
    "Spark plugs",
    "Ignition coil + wiring",
    "Valve cover",
    "Wiper tank + pipes/connector/hoses + wiper blades",
    "Brake fluid",
    "Supercharger / turbo system + brake vacuum pump",
    "Engine oil cooler",
    "Transmission oil cooler",
    "Engine mounts",
  ]),
  section("Cooling", ["Coolant tanks + pipes/connector/hoses + water pump + thermostat", "Radiator + pipes/connector/hoses", "Water pump + thermostat"]),
  section("Oil leaks", ["Engine top side", "Engine front side", "Engine mid/lower portion", "Engine rear side"]),
  section("Transmission and driveline", [
    "Transmission mounts",
    "Transmission mechanical",
    "Transmission electrical",
    "Transfer case",
    "Drive shaft + aux shaft + bushings/coupler/bearing",
    "Differential bushes",
    "Front differential oil leak",
    "Rear differential",
    "Transmission and differential fluid condition",
  ]),
  section("Steering and suspension", [
    "Shock mounts + connectors",
    "Power steering rack bushes/leak/play + boots + tie rod",
    "Stabilizer leak/bushes/electrical fault + link rod + stabilizer bar bush",
    "Lower arms",
    "Upper arms",
    "Front shock absorbers (air / hydraulic)",
    "Height level sensor",
    "Rear suspension arms/bushes",
    "Rear shock absorbers",
    "Wheel alignment",
  ]),
  section("Underbody", ["Undercovers + bolts/fasteners/clips", "Exhaust + O2 sensor + catalyst", "Fuel tank + cover", "Fender liner"]),
  section("Wheels, tyres and brakes", [
    "Wheel bearing",
    "Wheel bolts",
    "Wheel condition + centre cap",
    "Tyres + valve + valve cover",
    "Brake discs",
    "Brake pads",
    "Brake fluid pipes / caliper leak / piston jam",
    "Brake dust cover",
  ]),
  section("Electrical", [
    "Battery + aux battery",
    "Front headlights",
    "Rear tail lamps + brake light",
    "Side view mirrors",
    "Alternator / starter motor",
    "Infotainment system",
    "Parking sensors",
    "Seats",
    "Gear shifter",
    "Parking brakes",
    "Electric power steering",
    "Tyre pressure sensor",
    "Dashboard warning lights",
    "Horn",
    "Windows, sunroof and central locking",
    "Interior lights",
  ]),
  section("Air conditioning", ["A/C compressor / expansion valve / condenser / evaporator / pipes", "Cabin filter"]),
  section("Other", ["Other"]),
];

/** Tyres: four positions, plus an optional spare. */
export const TYRE_POSITIONS = [
  { key: "fl", label: "Front left" },
  { key: "fr", label: "Front right" },
  { key: "rl", label: "Rear left" },
  { key: "rr", label: "Rear right" },
] as const;
export const TYRE_CONDITIONS = [
  { value: "good", label: "Good" },
  { value: "worn_out", label: "Worn out" },
  { value: "cracked", label: "Cracked" },
  { value: "uneven_wear", label: "Uneven wear" },
  { value: "bulge_cut", label: "Bulge or cut" },
  { value: "puncture_repair", label: "Puncture or repair" },
] as const;
export const TYRE_ACTIONS = [
  { value: "none", label: "None" },
  { value: "replace_soon", label: "Replace soon" },
  { value: "replace_now", label: "Replace now" },
] as const;

/** "Good" stands alone; the other conditions combine. Stored as a comma-separated list. */
export function cleanTyreConditions(values: string[]) {
  const allowed = new Set(TYRE_CONDITIONS.map((c) => c.value));
  const unique = Array.from(new Set(values.filter((v) => allowed.has(v as (typeof TYRE_CONDITIONS)[number]["value"]))));
  if (unique.includes("good")) return ["good"];
  return TYRE_CONDITIONS.map((c) => c.value).filter((v) => unique.includes(v)) as string[];
}

/** Cleans one saved measurement value: tyre conditions and actions must be known choices; everything else is free text. Returns null when the key is not allowed. */
export function cleanMeasurementValue(key: string, raw: string): string | null {
  const value = raw.trim().slice(0, key.endsWith("_reason") ? 200 : 40);
  const tyre = /^tyre_(fl|fr|rl|rr|spare)_(cond|action|danger|danger_reason)$/.exec(key);
  if (tyre) {
    if (tyre[2] === "cond") return cleanTyreConditions(value.split(",")).join(",");
    if (tyre[2] === "danger") return value === "1" ? "1" : "";
    if (tyre[2] === "danger_reason") return value;
    return TYRE_ACTIONS.some((a) => a.value === value) ? value : "";
  }
  if (key === "tyre_size_front" || key === "tyre_size_rear") return tyreSizeText(value);
  return MEASUREMENTS.some((m) => m.key === key) ? value : null;
}

/** Compulsory numbers, fixed (not part of the editable checklist). Tyre conditions and actions sit beside them. */
export type MeasurementField = { key: string; label: string; unit?: string; kind: "number" | "year" | "choice" | "text"; choices?: { value: string; label: string }[]; group: string; optional?: boolean };

/** "275/40R20", "275 40 20" or "275/40 r20" all become "275/40 R20"; anything else is kept as typed, in capitals. */
export function tyreSizeText(raw: string): string {
  const t = raw.trim().toUpperCase().slice(0, 20);
  const m = /^(\d{3})\s*[\/ ]?\s*(\d{2})\s*[\/ ]?\s*(?:Z?R)?\s*(\d{2})$/.exec(t);
  return m ? `${m[1]}/${m[2]} R${m[3]}` : t;
}

export const MEASUREMENTS: MeasurementField[] = [
  { key: "tyre_size_front", label: "Tyre size front", kind: "text", group: "Tyres" },
  { key: "tyre_size_rear", label: "Tyre size rear", kind: "text", group: "Tyres" },
  ...TYRE_POSITIONS.flatMap((p) => [
    { key: `tyre_${p.key}_tread`, label: `${p.label} tread`, unit: "mm", kind: "number" as const, group: "Tyres" },
    { key: `tyre_${p.key}_year`, label: `${p.label} tyre year`, kind: "year" as const, group: "Tyres" },
  ]),
  { key: "tyre_spare_tread", label: "Spare tread", unit: "mm", kind: "number", group: "Spare tyre", optional: true },
  { key: "tyre_spare_year", label: "Spare tyre year", kind: "year", group: "Spare tyre", optional: true },
  { key: "pad_front", label: "Front brake pads", unit: "mm", kind: "number", group: "Brake pads" },
  { key: "pad_rear", label: "Rear brake pads", unit: "mm", kind: "number", group: "Brake pads" },
  { key: "battery_voltage", label: "Battery voltage", unit: "V", kind: "number", group: "Battery test" },
  {
    key: "battery_health",
    label: "Battery health",
    kind: "choice",
    choices: [
      { value: "good", label: "Good" },
      { value: "weak", label: "Weak" },
      { value: "replace", label: "Replace" },
    ],
    group: "Battery test",
  },
  { key: "vent_temp", label: "A/C vent temperature", unit: "°C", kind: "number", group: "Air conditioning" },
];

export function measurementMissing(values: Record<string, string | number | null | undefined>) {
  return MEASUREMENTS.filter((m) => {
    if (m.optional) return false;
    const v = values[m.key];
    return v === undefined || v === null || String(v).trim() === "";
  });
}

export function checklistItems(checklist: ChecklistSection[]) {
  return checklist.flatMap((s) => s.items.map((i) => ({ ...i, sectionKey: s.key, sectionTitle: s.title })));
}

/** Validates a checklist edited in Settings. */
export function cleanChecklist(input: unknown): ChecklistSection[] | string {
  if (!Array.isArray(input)) return "The checklist must be a list of sections.";
  const out: ChecklistSection[] = [];
  const keys = new Set<string>();
  for (const s of input) {
    if (!s || typeof s !== "object") return "Bad section.";
    const title = String((s as { title?: unknown }).title ?? "").trim();
    if (!title) return "Every section needs a title.";
    const key = String((s as { key?: unknown }).key ?? "").trim() || slugKey(title);
    if (keys.has(key)) return `Two sections share the key ${key}.`;
    keys.add(key);
    const items: ChecklistItem[] = [];
    for (const i of (s as { items?: unknown[] }).items ?? []) {
      const label = String((i as { label?: unknown }).label ?? "").trim();
      if (!label) return `An item in "${title}" has no name.`;
      let ikey = String((i as { key?: unknown }).key ?? "").trim() || `${key}.${slugKey(label)}`;
      while (keys.has(ikey)) ikey += "_x";
      keys.add(ikey);
      items.push({ key: ikey, label });
    }
    if (items.length === 0) return `The section "${title}" has no items.`;
    out.push({ key, title, items });
  }
  if (out.length === 0) return "Add at least one section.";
  return out;
}

export function formatMinutes(min: number) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/* ---------------------------------------------------------------------------
   Completeness: the same rules on the technician's screen and on the server.
   Keys are the anchors the bottom bar jumps to.
   --------------------------------------------------------------------------- */

export type ReportProblem = { key: string; label: string };

export type ReportState = {
  items: { key: string; label: string; sectionKey: string; status: ItemStatus | null; remarks: string; dangerous?: boolean; dangerous_reason?: string }[];
  findings: { requestId: string; text: string; status: ItemStatus | null; found: string }[];
  measurements: Record<string, string>;
  /** The technician's estimated hours; null or undefined when the screen does not ask for them. */
  estimatedHours?: string | null;
  /** The scan step when the gate is on. */
  scan?: { required: boolean; read: boolean; approved: boolean };
};

export function reportProblemsOf(s: ReportState, opts: { limits?: InspectionLimits } = {}): ReportProblem[] {
  const out: ReportProblem[] = [];
  if (s.scan?.required && !s.scan.read && !s.scan.approved) out.push({ key: "prescan", label: "Scan report: read it, or get Scan not possible approved" });
  for (const f of s.findings) {
    const short = f.text.length > 28 ? f.text.slice(0, 26) + "…" : f.text;
    if (!f.status) out.push({ key: `req-${f.requestId}`, label: `${short}: not marked` });
    else if (!f.found.trim()) out.push({ key: `req-${f.requestId}`, label: `${short}: what was found` });
  }
  for (const i of s.items) {
    if (i.sectionKey === ROAD_TEST_SECTION_KEY) continue;
    const short = i.label.length > 28 ? i.label.slice(0, 26) + "…" : i.label;
    if (!i.status) {
      if (i.sectionKey !== OPTIONAL_SECTION_KEY) out.push({ key: i.key, label: `${short}: not marked` });
    } else if ((i.status === "average" || i.status === "bad") && !i.remarks.trim()) out.push({ key: i.key, label: `${short}: remark needed` });
    if (i.dangerous && !(i.dangerous_reason ?? "").trim()) out.push({ key: i.key, label: `${short}: why is it dangerous?` });
  }
  for (const p of TYRE_POSITIONS) {
    const tread = s.measurements[`tyre_${p.key}_tread`];
    const year = s.measurements[`tyre_${p.key}_year`];
    const cond = s.measurements[`tyre_${p.key}_cond`];
    const action = s.measurements[`tyre_${p.key}_action`];
    if (!tread?.trim()) out.push({ key: `m-tyre_${p.key}_tread`, label: `${p.label} tread: missing` });
    if (!year?.trim()) out.push({ key: `m-tyre_${p.key}_year`, label: `${p.label} tyre year: missing` });
    if (!cond?.trim()) out.push({ key: `m-tyre_${p.key}_cond`, label: `${p.label} tyre condition: not marked` });
    if (!action?.trim()) out.push({ key: `m-tyre_${p.key}_action`, label: `${p.label} tyre action: not marked` });
    if (s.measurements[`tyre_${p.key}_danger`] === "1" && !(s.measurements[`tyre_${p.key}_danger_reason`] ?? "").trim()) out.push({ key: `m-tyre_${p.key}_action`, label: `${p.label} tyre: why is it dangerous?` });
  }
  for (const m of MEASUREMENTS) {
    if (m.optional || (m.key.startsWith("tyre_") && m.kind !== "text")) continue;
    if (!s.measurements[m.key]?.trim()) out.push({ key: `m-${m.key}`, label: `${m.label}: missing` });
  }
  if (opts.limits) out.push(...limitProblems(s.measurements, opts.limits));
  if (s.estimatedHours !== undefined && s.estimatedHours !== null && !(Number(String(s.estimatedHours).replace(",", ".")) > 0)) out.push({ key: "estimate", label: "Estimated hours for this job: missing" });
  return out;
}

/** "12 of 99 done": every required answer on the report, for the neutral progress shown before Submit is tapped. */
export function reportProgressOf(s: ReportState, opts: { limits?: InspectionLimits } = {}): { done: number; total: number } {
  const required =
    s.findings.length +
    s.items.filter((i) => i.sectionKey !== ROAD_TEST_SECTION_KEY && i.sectionKey !== OPTIONAL_SECTION_KEY).length +
    TYRE_POSITIONS.length * 4 +
    MEASUREMENTS.filter((m) => !m.optional && (!m.key.startsWith("tyre_") || m.kind === "text")).length +
    (s.estimatedHours !== undefined && s.estimatedHours !== null ? 1 : 0) +
    (s.scan?.required ? 1 : 0);
  const open = reportProblemsOf(s, opts).length;
  return { done: Math.max(0, required - open), total: required };
}

/** The tyre action with the worst outcome decides the Tyres item: replace now = BAD, replace soon = AVERAGE. */
export function tyreItemStatus(measurements: Record<string, string>): ItemStatus | null {
  const actions = TYRE_POSITIONS.map((p) => measurements[`tyre_${p.key}_action`]).concat([measurements.tyre_spare_action ?? ""]);
  if (actions.includes("replace_now")) return "bad";
  if (actions.includes("replace_soon")) return "average";
  return null;
}

/* ---------------------------------------------------------------------------
   Round 2 (9 October 2026): leaks, fluids, brake discs, parts rows, the Dangerous
   switch, number limits, tyre years, big-job tags, the estimated hours.
   --------------------------------------------------------------------------- */

export const LEAK_SEVERITIES = [
  { value: "sweating", label: "Sweating" },
  { value: "dripping", label: "Dripping" },
  { value: "heavy", label: "Heavy leak" },
] as const;
export const LEAK_REPAIRS = [
  { value: "gasket", label: "Gasket" },
  { value: "seal", label: "Seal" },
  { value: "reseal", label: "Silicone reseal" },
  { value: "hose", label: "Hose or pipe" },
  { value: "replace", label: "Replace" },
] as const;
export const DISC_CONDITIONS = [
  { value: "good", label: "Good" },
  { value: "close_to_minimum", label: "Close to minimum" },
  { value: "below_minimum", label: "Below minimum" },
] as const;
export const DISC_ACTIONS = [
  { value: "none", label: "None" },
  { value: "skim", label: "Skimming possible" },
  { value: "replace", label: "Skimming not possible, replace" },
] as const;
export const PARTS_UNITS = ["pc", "set", "pair", "litre", "kg", "m"] as const;

/** One line of "Parts needed": the part, how many, the unit. The quantity follows the part to the price request and the quotation. */
export type PartsRow = { part: string; qty: number; unit: string };

export type InspectionLimits = { tread_max: number; pads_max: number; battery_max: number; vent_min: number; vent_max: number; fluid_max: number; tyre_years: number };
export const DEFAULT_LIMITS: InspectionLimits = { tread_max: 12, pads_max: 20, battery_max: 16, vent_min: -5, vent_max: 40, fluid_max: 30, tyre_years: 15 };
/** The limits from Settings on top of the defaults. */
export function inspectionLimitsOf(settings: { inspection_limits?: unknown }): InspectionLimits {
  const raw = (settings.inspection_limits ?? {}) as Partial<Record<keyof InspectionLimits, number | string>>;
  const out = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(DEFAULT_LIMITS) as (keyof InspectionLimits)[]) {
    const n = Number(raw[k]);
    if (raw[k] !== undefined && raw[k] !== "" && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** Items that can leak: anything with oil, coolant, fluid, a pump, cooler, hose, seal, rack or shock in the name. */
export function isLeakItem(label: string) {
  return /leak|oil|coolant|fluid|pump|cooler|hose|seal|gasket|rack|shock|differential|transmission|turbo|supercharger|radiator|a\/c|compressor|condenser|evaporator|pipes|sump|cover/i.test(label);
}
/** Items that are a fluid: a quantity, a grade and an approval spec can be recorded. */
export function isFluidItem(label: string) {
  return /oil level|fluid|coolant tank|gas level|brake fluid|washer/i.test(label) && !/leak|pipes|caliper/i.test(label);
}
export function isDiscItem(label: string) {
  return /brake disc/i.test(label);
}
/** Litres for everything except A/C gas, which is weighed in grams. */
export function fluidUnitFor(label: string, current: string | null | undefined) {
  if (current) return current;
  return /gas|a\/c|refrigerant/i.test(label) ? "g" : "l";
}
/** The grades that make sense for this fluid, from the list in Settings. */
export function fluidGradesFor(label: string, grades: string[]) {
  const l = label.toLowerCase();
  if (/brake/.test(l)) return grades.filter((g) => /dot/i.test(g));
  if (/coolant/.test(l)) return grades.filter((g) => /^g1\d/i.test(g));
  if (/gas|a\/c|refrigerant/.test(l)) return grades.filter((g) => /^r\d/i.test(g));
  if (/transmission|differential|gear|transfer/.test(l)) return grades.filter((g) => /atf|cvt|dct|w-9/i.test(g));
  if (/oil|engine/.test(l)) return grades.filter((g) => /^\d+w-\d+$/i.test(g));
  return grades;
}
/** The remark written for the technician when a leak's severity or repair is tapped. */
export function leakRemark(severity: string | null | undefined, repair: string | null | undefined) {
  const s = LEAK_SEVERITIES.find((x) => x.value === severity)?.label;
  const r = LEAK_REPAIRS.find((x) => x.value === repair)?.label;
  return [s ? `${s} leak` : "", r ? `repair: ${r.toLowerCase()}` : ""].filter(Boolean).join(" · ");
}
/** The part a leak repair needs, added to the parts rows on its own. */
export function leakPartFor(repair: string | null | undefined, label: string): string | null {
  switch (repair) {
    case "gasket":
      return `Gasket, ${label}`;
    case "seal":
      return `Seal, ${label}`;
    case "reseal":
      return "Silicone sealant";
    case "hose":
      return `Hose or pipe, ${label}`;
    case "replace":
      return label;
    default:
      return null;
  }
}
/** Brake discs: the condition and the action set the item's status. Below minimum means BAD and replace. */
export function discStatus(condition: string | null | undefined, action: string | null | undefined): ItemStatus | null {
  if (condition === "below_minimum" || action === "replace") return "bad";
  if (condition === "close_to_minimum" || action === "skim") return "average";
  if (condition === "good" && (!action || action === "none")) return "good";
  return null;
}
/** Parts rows from the browser, cleaned: a name, a quantity of at least 1, a known unit. */
export function cleanPartsRows(input: unknown): PartsRow[] {
  if (!Array.isArray(input)) return [];
  const out: PartsRow[] = [];
  for (const r of input.slice(0, 30)) {
    if (!r || typeof r !== "object") continue;
    const part = String((r as { part?: unknown }).part ?? "").trim().slice(0, 120);
    const qtyRaw = Number((r as { qty?: unknown }).qty);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.round(qtyRaw * 100) / 100 : 1;
    const unitRaw = String((r as { unit?: unknown }).unit ?? "pc").trim().slice(0, 12);
    const unit = (PARTS_UNITS as readonly string[]).includes(unitRaw) ? unitRaw : "pc";
    out.push({ part, qty, unit });
  }
  return out;
}
/** "Brake pads × 1 set" lines, for the old free-text field and the Parts desk. */
export function partsRowsText(rows: PartsRow[]) {
  return rows.filter((r) => r.part.trim()).map((r) => `${r.part.trim()} × ${r.qty} ${r.unit}`).join("\n");
}
/** Tyre years: this year back the set number of years, then "Older". */
export function tyreYearOptions(thisYear: number, years: number) {
  const out: { value: string; label: string }[] = [];
  for (let y = thisYear; y >= thisYear - years; y--) out.push({ value: String(y), label: String(y) });
  out.push({ value: "older", label: "Older" });
  return out;
}
/** A road test is suggested when the customer's words mention noise, vibration, steering, turning or braking. */
export function roadTestSuggested(texts: string[]) {
  return texts.some((t) => /nois|vibrat|steer|turn|brak|pull|shak|judder|rattl|knock|clunk|hum|whin|wobbl|drift/i.test(t));
}
/** Typed numbers outside the sensible range are problems, so a slip of the finger is caught on the spot. */
export function limitProblems(m: Record<string, string>, limits: InspectionLimits): ReportProblem[] {
  const out: ReportProblem[] = [];
  const num = (k: string) => {
    const v = m[k];
    if (!v?.trim()) return null;
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  };
  const check = (key: string, label: string, min: number, max: number, unit: string) => {
    const n = num(key);
    if (n !== null && (Number.isNaN(n) || n < min || n > max)) out.push({ key: `m-${key}`, label: `${label}: ${min} to ${max} ${unit}` });
  };
  for (const p of [...TYRE_POSITIONS, { key: "spare", label: "Spare" }]) check(`tyre_${p.key}_tread`, `${p.label} tread`, 0, limits.tread_max, "mm");
  check("pad_front", "Front brake pads", 0, limits.pads_max, "mm");
  check("pad_rear", "Rear brake pads", 0, limits.pads_max, "mm");
  check("battery_voltage", "Battery voltage", 0, limits.battery_max, "V");
  check("vent_temp", "A/C vent temperature", limits.vent_min, limits.vent_max, "°C");
  return out;
}
/** The form's state for one checklist item, from a stored row. */
export function toItemState(i: { item_key: string; item_label: string; section_key: string; status: ItemStatus | null; remarks: string | null; parts_needed: string | null; edited_by_name?: string | null; dangerous?: boolean | null; dangerous_reason?: string | null; leak_severity?: string | null; leak_repair?: string | null; fluid_qty?: number | string | null; fluid_unit?: string | null; fluid_grade?: string | null; fluid_spec?: string | null; disc_condition?: string | null; disc_action?: string | null; disc_thickness?: number | string | null; disc_minimum?: number | string | null; parts_rows?: unknown }) {
  const s = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));
  return {
    key: i.item_key,
    label: i.item_label,
    sectionKey: i.section_key,
    status: i.status,
    remarks: i.remarks ?? "",
    parts_needed: i.parts_needed ?? "",
    editedBy: i.edited_by_name ?? null,
    dangerous: !!i.dangerous,
    dangerous_reason: i.dangerous_reason ?? "",
    leak_severity: i.leak_severity ?? "",
    leak_repair: i.leak_repair ?? "",
    fluid_qty: s(i.fluid_qty),
    fluid_unit: i.fluid_unit ?? "",
    fluid_grade: i.fluid_grade ?? "",
    fluid_spec: i.fluid_spec ?? "",
    disc_condition: i.disc_condition ?? "",
    disc_action: i.disc_action ?? "",
    disc_thickness: s(i.disc_thickness),
    disc_minimum: s(i.disc_minimum),
    parts_rows: cleanPartsRows(i.parts_rows),
  };
}
