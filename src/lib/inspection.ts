/** The mechanical inspection: checklist shape, default sections, measurements, tyres, statuses and the completeness rules. */

export const ITEM_STATUSES = ["good", "average", "bad"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = { good: "GOOD", average: "AVERAGE", bad: "BAD" };

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
  const value = raw.trim().slice(0, 40);
  const tyre = /^tyre_(fl|fr|rl|rr|spare)_(cond|action)$/.exec(key);
  if (tyre) {
    if (tyre[2] === "cond") return cleanTyreConditions(value.split(",")).join(",");
    return TYRE_ACTIONS.some((a) => a.value === value) ? value : "";
  }
  return MEASUREMENTS.some((m) => m.key === key) ? value : null;
}

/** Compulsory numbers, fixed (not part of the editable checklist). Tyre conditions and actions sit beside them. */
export type MeasurementField = { key: string; label: string; unit?: string; kind: "number" | "year" | "choice"; choices?: { value: string; label: string }[]; group: string; optional?: boolean };

export const MEASUREMENTS: MeasurementField[] = [
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
  items: { key: string; label: string; sectionKey: string; status: ItemStatus | null; remarks: string }[];
  findings: { requestId: string; text: string; status: ItemStatus | null; found: string }[];
  measurements: Record<string, string>;
  hasPrescan: boolean;
};

export function reportProblemsOf(s: ReportState): ReportProblem[] {
  const out: ReportProblem[] = [];
  for (const f of s.findings) {
    const short = f.text.length > 28 ? f.text.slice(0, 26) + "…" : f.text;
    if (!f.status) out.push({ key: `req-${f.requestId}`, label: `${short}: not marked` });
    else if (!f.found.trim()) out.push({ key: `req-${f.requestId}`, label: `${short}: what was found` });
  }
  for (const i of s.items) {
    if (i.sectionKey === ROAD_TEST_SECTION_KEY) continue;
    const short = i.label.length > 28 ? i.label.slice(0, 26) + "…" : i.label;
    if (!i.status) out.push({ key: i.key, label: `${short}: not marked` });
    else if ((i.status === "average" || i.status === "bad") && !i.remarks.trim()) out.push({ key: i.key, label: `${short}: remark needed` });
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
  }
  for (const m of MEASUREMENTS) {
    if (m.optional || m.key.startsWith("tyre_")) continue;
    if (!s.measurements[m.key]?.trim()) out.push({ key: `m-${m.key}`, label: `${m.label}: missing` });
  }
  if (!s.hasPrescan) out.push({ key: "prescan", label: "Scan report missing" });
  return out;
}

/** The tyre action with the worst outcome decides the Tyres item: replace now = BAD, replace soon = AVERAGE. */
export function tyreItemStatus(measurements: Record<string, string>): ItemStatus | null {
  const actions = TYRE_POSITIONS.map((p) => measurements[`tyre_${p.key}_action`]).concat([measurements.tyre_spare_action ?? ""]);
  if (actions.includes("replace_now")) return "bad";
  if (actions.includes("replace_soon")) return "average";
  return null;
}
