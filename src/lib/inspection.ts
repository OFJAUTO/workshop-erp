/** The mechanical inspection: checklist shape, default sections, measurements, statuses. Shared by screens and actions. */

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
  section("Diagnostics and road test", ["Road test: noises, vibration, pulling, gearbox behaviour, braking"]),
  section("Other", ["Other"]),
];

/** Compulsory numbers, fixed (not part of the editable checklist). */
export type MeasurementField = { key: string; label: string; unit?: string; kind: "number" | "year" | "choice"; choices?: { value: string; label: string }[]; group: string };

export const MEASUREMENTS: MeasurementField[] = [
  { key: "tyre_fl_tread", label: "Front left tread", unit: "mm", kind: "number", group: "Tyres" },
  { key: "tyre_fl_year", label: "Front left tyre year", kind: "year", group: "Tyres" },
  { key: "tyre_fr_tread", label: "Front right tread", unit: "mm", kind: "number", group: "Tyres" },
  { key: "tyre_fr_year", label: "Front right tyre year", kind: "year", group: "Tyres" },
  { key: "tyre_rl_tread", label: "Rear left tread", unit: "mm", kind: "number", group: "Tyres" },
  { key: "tyre_rl_year", label: "Rear left tyre year", kind: "year", group: "Tyres" },
  { key: "tyre_rr_tread", label: "Rear right tread", unit: "mm", kind: "number", group: "Tyres" },
  { key: "tyre_rr_year", label: "Rear right tyre year", kind: "year", group: "Tyres" },
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
