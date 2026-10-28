/**
 * THE inspection report layout (29 October 2026, section 8): one model, built here, drawn by the web report (the
 * customer's link and the staff preview, `InspectionReport`) and by the PDF (`renderReportPdf`) alike. Pure.
 *
 *   NEEDS ATTENTION · n   one line per finding, worst first (Dangerous / Replace now → Bad / Replace / Required →
 *                         Average / Low / Replace soon / Service due / Old tyre), each with its section on the right
 *   NOTE FROM THE WORKSHOP (only when written)
 *   one section per part or system, in a fixed order: BRAKES → TYRES → BATTERY → every other system that has a
 *   finding, a measurement or a photo (checklist order) → ROAD TEST → BODY; each = its worst chip (or ALL GOOD) +
 *   its measurements + its findings + its photos and videos: everything about one part together
 *   CHECKED AND PASSED · n, always last: only plain OK items without a measurement, a photo or a note
 *
 * Status names stay as they were; red is only for Dangerous and Replace now. Empty fields are left out, so older
 * reports (no disc thickness, no CCA …) stay clean. No part numbers, prices, staff names or internal notes.
 */
import { DISC_CONDITIONS, TYRE_CONDITIONS, TYRE_REPLACE_REASONS, isDiscItem, isPadItem, itemExtraWords, itemStatusLabel, needsAttention, discStatus, type ItemStatus } from "./inspection";

export type Tone = "red" | "dark" | "amber" | "green" | "grey";
export type Chip = { tone: Tone; text: string };

export type LayoutItem = {
  id: string;
  section_key: string;
  section_title: string;
  item_key: string;
  item_label: string;
  position: number;
  status: ItemStatus | null;
  style: string | null;
  remarks: string | null;
  dangerous: boolean;
  dangerous_reason: string | null;
  service_due?: boolean | null;
  recharge_needed?: boolean | null;
  fluid_qty?: number | string | null;
  fluid_unit?: string | null;
  fluid_grade?: string | null;
  disc_condition?: string | null;
  disc_action?: string | null;
  disc_thickness?: number | string | null;
  disc_minimum?: number | string | null;
};

export type LayoutInput = {
  items: LayoutItem[];
  /** The checklist's section keys in their order (the version the report was done with). */
  sectionOrder: string[];
  measurements: Record<string, unknown>;
  /** How many photos and videos each place has ("brakes.front_brake_pads", "tyre.fl", "measure.battery" …). */
  media: Record<string, { photos: number; videos: number }>;
  road: { done: boolean; flagged: { key: string; label: string; status: "bad" | "average"; statusLabel: string; remarks: string | null }[]; good: string[]; notPossible: string | null } | null;
  body: { findings: { id: string; panel: string; panelLabel: string; severityLabel: string; red: boolean; words: string[] }[]; airbags: boolean; structural: boolean } | null;
  /** Tyres older than this many years get an advisory (Settings > Inspection, default 5). */
  tyreOldYears: number;
  /** The tyre year pick-list's length ("Older" means older than that). */
  tyreListYears: number;
  /** The year the car was inspected in (for the tyres' age). */
  thisYear: number;
  managerNote: string | null;
};

export type Finding = {
  key: string;
  chip: Chip;
  /** 0 = Dangerous / Replace now, 1 = Bad / Replace / Required, 2 = advisory. */
  rank: number;
  title: string;
  reason: string;
  extra: string[];
  /** The section's title it belongs to (shown on the right in Needs attention). */
  section: string;
  /** The places whose photos and videos show it. */
  mediaKeys: string[];
  dangerous: boolean;
};
export type TableRow = { label: string; cells: string[]; chip: Chip | null };
export type Table = { head: string[]; rows: TableRow[] };
export type Line = { label: string; value: string; chip?: Chip | null };
export type Section = {
  key: string;
  title: string;
  chip: Chip;
  lines: Line[];
  tables: Table[];
  findings: Finding[];
  /** Good items that carry a photo, a video or a note: they belong with their part, not in the passed list. */
  good: { key: string; title: string; note: string; mediaKeys: string[] }[];
  /** Photos and videos of the section's measurements (tyres, pads, battery, vent …). */
  mediaKeys: string[];
  body?: LayoutInput["body"];
};
export type ReportLayout = {
  attention: Finding[];
  dangers: { title: string; reason: string | null }[];
  note: string | null;
  sections: Section[];
  passed: { title: string; items: string[] }[];
  passedCount: number;
  noIssues: boolean;
  /** Every place shown with a section (the rest of the videos go in their own block at the end). */
  placedKeys: string[];
};

export const ALL_GOOD: Chip = { tone: "green", text: "All good" };
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown) => {
  const t = text(v).replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const mm = (v: unknown) => (num(v) === null ? "" : `${num(v)} mm`);

/** The chip and rank of an item (status names as they were; red only for Dangerous). */
function chipOf(i: Pick<LayoutItem, "dangerous" | "status" | "style" | "service_due">): { chip: Chip; rank: number } {
  if (i.dangerous) return { chip: { tone: "red", text: "Dangerous" }, rank: 0 };
  if (i.status === "bad") return { chip: { tone: "dark", text: itemStatusLabel("bad", i.style) }, rank: 1 };
  if (i.status === "average" && i.style !== "job") return { chip: { tone: "amber", text: itemStatusLabel("average", i.style) }, rank: 2 };
  if (i.service_due && i.status !== "na") return { chip: { tone: "amber", text: "Service due" }, rank: 2 };
  return { chip: { tone: "green", text: itemStatusLabel(i.status, i.style) || "Good" }, rank: 3 };
}

/** The worst chip of a list (ALL GOOD when nothing ranks below 3). */
function worst(list: { chip: Chip; rank: number }[]): Chip {
  const w = list.filter((c) => c.rank < 3).sort((a, b) => a.rank - b.rank)[0];
  return w ? w.chip : ALL_GOOD;
}

type Part = "brakes" | "tyres" | "battery";
/** The fixed part sections an item belongs to (wherever the checklist keeps it). */
function partOf(i: LayoutItem): Part | null {
  if (i.section_key === "brakes" || isPadItem(i.item_label) || isDiscItem(i.item_label) || /brake fluid|caliper|handbrake|parking brake/i.test(i.item_label)) return "brakes";
  if (/battery/i.test(i.item_label)) return "battery";
  if (/^wheels/.test(i.section_key) || /\btyres?\b|\bwheels?\b/i.test(i.item_label)) return "tyres";
  return null;
}
const PART_TITLE: Record<Part, string> = { brakes: "BRAKES", tyres: "TYRES", battery: "BATTERY" };

export const TYRE_ROWS = [
  { key: "fl", label: "Front left" },
  { key: "fr", label: "Front right" },
  { key: "rl", label: "Rear left" },
  { key: "rr", label: "Rear right" },
  { key: "spare", label: "Spare" },
] as const;

const isRear = (label: string) => /rear/i.test(label);
const discWords = (d: LayoutItem) => [mm(d.disc_thickness), num(d.disc_minimum) !== null ? `minimum ${mm(d.disc_minimum)}` : "", DISC_CONDITIONS.find((c) => c.value === d.disc_condition)?.label ?? ""].filter(Boolean).join(" · ");

/** A finding's short reason: the dangerous reason and the technician's remark, else what the measured answers say. */
function reasonOf(i: LayoutItem, m: Record<string, unknown>): string {
  const parts: string[] = [];
  if (i.dangerous && i.dangerous_reason) parts.push(i.dangerous_reason);
  if (i.remarks) parts.push(i.remarks);
  if (!i.remarks && isDiscItem(i.item_label)) parts.push(discWords(i));
  if (!i.remarks && isPadItem(i.item_label) && num(m[isRear(i.item_label) ? "pad_rear" : "pad_front"]) !== null) parts.push(`${num(m[isRear(i.item_label) ? "pad_rear" : "pad_front"])} mm left`);
  return parts.filter(Boolean).join(" · ");
}

export function buildReportLayout(input: LayoutInput): ReportLayout {
  const m = input.measurements;
  const items = input.items.filter((i) => i.status !== "na" && i.status !== null && i.section_key !== "diagnostics_and_road_test");
  const order = (key: string) => {
    const k = input.sectionOrder.indexOf(key);
    return k < 0 ? 999 : k;
  };
  const hasMedia = (key: string) => !!input.media[key] && input.media[key].photos + input.media[key].videos > 0;
  const findings: (Finding & { home: string })[] = [];
  /** Items whose answer is already shown in a section's table or lines (never repeated in Checked and passed). */
  const shownInTables = new Set<string>();

  /* ---- checklist items needing attention ---- */
  for (const i of items.filter(needsAttention)) {
    const part = partOf(i);
    const { chip, rank } = chipOf(i);
    const extra = itemExtraWords(i).filter((w) => !(w === "Service due" && chip.text === "Service due"));
    findings.push({ key: i.id, chip, rank, title: i.item_label, reason: reasonOf(i, m), extra, section: part ? PART_TITLE[part] : i.section_title.toUpperCase(), mediaKeys: [i.item_key, ...(isPadItem(i.item_label) ? [`measure.${isRear(i.item_label) ? "pad_rear" : "pad_front"}`] : [])], dangerous: i.dangerous, home: part ?? i.section_key });
  }

  /* ---- tyres: one row per tyre, Replace now / soon and old tyres as findings ---- */
  const tyreRows: TableRow[] = [];
  for (const p of TYRE_ROWS) {
    const tread = num(m[`tyre_${p.key}_tread`]);
    const yearText = text(m[`tyre_${p.key}_year`]);
    const year = num(yearText);
    const action = text(m[`tyre_${p.key}_action`]);
    const conds = text(m[`tyre_${p.key}_cond`]).split(",").filter(Boolean).map((c) => TYRE_CONDITIONS.find((x) => x.value === c)?.label ?? c);
    if (tread === null && !yearText && !action && !conds.length) continue;
    const age = year !== null ? input.thisYear - year : null;
    const old = (age !== null && age > input.tyreOldYears) || yearText.toLowerCase() === "older";
    const ageWords = age !== null ? `${age} years old` : `over ${input.tyreListYears} years old`;
    const danger = text(m[`tyre_${p.key}_danger`]) === "1";
    const plainGood = !conds.length || conds.every((c) => c === "Good");
    const condition = old ? (plainGood ? `Good, but ${ageWords}` : `${conds.join(", ")} · ${ageWords}`) : conds.join(", ");
    const chip: Chip | null = danger ? { tone: "red", text: "Dangerous" } : action === "replace_now" ? { tone: "red", text: "Replace now" } : action === "replace_soon" ? { tone: "amber", text: "Replace soon" } : old ? { tone: "amber", text: "Old tyre" } : action || tread !== null ? { tone: "green", text: "Good" } : null;
    tyreRows.push({ label: p.label, cells: [tread !== null ? `${tread} mm` : "", year !== null ? String(year) : yearText ? "Older" : "", condition], chip });
    const reasonCode = TYRE_REPLACE_REASONS.find((r) => r.value === text(m[`tyre_${p.key}_reason`]))?.label;
    const made = year !== null ? `made ${year}` : yearText ? "made before the year list" : "";
    if (action === "replace_now" || action === "replace_soon" || danger) {
      findings.push({ key: `tyre-${p.key}`, chip: chip ?? { tone: "amber", text: "Replace soon" }, rank: action === "replace_now" || danger ? 0 : 2, title: `${p.label} tyre`, reason: [danger ? text(m[`tyre_${p.key}_danger_reason`]) : "", tread !== null ? `${tread} mm tread` : "", made, reasonCode ? `reason: ${reasonCode.toLowerCase()}` : ""].filter(Boolean).join(" · "), extra: [], section: "TYRES", mediaKeys: [`tyre.${p.key}`], dangerous: danger, home: "tyres" });
    } else if (old) {
      findings.push({ key: `tyre-${p.key}-old`, chip: { tone: "amber", text: "Old tyre" }, rank: 2, title: `${p.label} tyre`, reason: `Good, but ${ageWords}${year !== null ? ` (made ${year})` : ""}: replacement advised`, extra: [], section: "TYRES", mediaKeys: [`tyre.${p.key}`], dangerous: false, home: "tyres" });
    }
  }

  /* ---- battery test ---- */
  const health = text(m.battery_health);
  const volts = num(m.battery_voltage);
  const cca = num(m.battery_cca);
  if (health === "replace") findings.push({ key: "battery-test", chip: { tone: "dark", text: "Replace" }, rank: 1, title: "Battery", reason: [volts !== null ? `${volts} V` : "", cca !== null ? `${cca} CCA` : "", "failed the battery test"].filter(Boolean).join(" · "), extra: [], section: "BATTERY", mediaKeys: ["measure.battery"], dangerous: false, home: "battery" });
  else if (health === "weak") findings.push({ key: "battery-test", chip: { tone: "amber", text: "Weak" }, rank: 2, title: "Battery", reason: [volts !== null ? `${volts} V` : "", "recharge and retest"].filter(Boolean).join(" · "), extra: [], section: "BATTERY", mediaKeys: ["measure.battery"], dangerous: false, home: "battery" });

  /* ---- road test ---- */
  if (input.road?.done) for (const r of input.road.flagged) findings.push({ key: `road-${r.key}`, chip: { tone: r.status === "bad" ? "dark" : "amber", text: r.statusLabel }, rank: r.status === "bad" ? 1 : 2, title: r.label, reason: r.remarks ?? "", extra: [], section: "ROAD TEST", mediaKeys: [], dangerous: false, home: "road_test" });

  /* ---- body (bodyshop findings) ---- */
  for (const b of input.body?.findings ?? []) findings.push({ key: `body-${b.id}`, chip: { tone: b.red ? "dark" : "amber", text: b.severityLabel || "Damage" }, rank: b.red ? 1 : 2, title: b.panelLabel, reason: b.words.filter(Boolean).join(" · "), extra: [], section: "BODY", mediaKeys: [`body.${b.panel}`], dangerous: false, home: "body" });

  /* ---- the sections ---- */
  const sections: Section[] = [];
  const of = (home: string) => findings.filter((f) => f.home === home).sort((a, b) => a.rank - b.rank);
  const chipFor = (fs: Finding[]) => worst(fs.map((f) => ({ chip: f.chip, rank: f.rank })));
  const measured = (i: LayoutItem) => (isDiscItem(i.item_label) && (num(i.disc_thickness) !== null || !!i.disc_condition)) || (isPadItem(i.item_label) && num(m[isRear(i.item_label) ? "pad_rear" : "pad_front"]) !== null);
  const goodWith = (pred: (i: LayoutItem) => boolean) =>
    items
      .filter((i) => pred(i) && !needsAttention(i) && !shownInTables.has(i.id) && (hasMedia(i.item_key) || !!i.remarks))
      .map((i) => ({ key: i.id, title: i.item_label, note: i.remarks ?? "", mediaKeys: [i.item_key] }));
  const mediaOf = (keys: string[]) => keys.filter(hasMedia);

  // BRAKES: Front and Rear with the pads and the discs, the brake fluid, the photos of pads and discs.
  {
    const axle = (side: "front" | "rear"): TableRow | null => {
      const onSide = (i: LayoutItem) => (side === "rear" ? isRear(i.item_label) : !isRear(i.item_label));
      const pad = items.find((i) => isPadItem(i.item_label) && onSide(i));
      const disc = items.find((i) => isDiscItem(i.item_label) && onSide(i));
      const padMm = num(m[`pad_${side}`]);
      const discCell = disc ? discWords(disc) || itemStatusLabel(disc.status, disc.style) : "";
      const padCell = padMm !== null ? `${padMm} mm` : pad ? itemStatusLabel(pad.status, pad.style) : "";
      if (!padCell && !discCell) return null;
      if (pad) shownInTables.add(pad.id);
      if (disc) shownInTables.add(disc.id);
      const statuses = [pad ? chipOf(pad) : null, disc ? chipOf({ ...disc, status: disc.status ?? discStatus(disc.disc_condition, disc.disc_action) }) : null].filter((c): c is { chip: Chip; rank: number } => !!c);
      const w = worst(statuses);
      return { label: side === "front" ? "Front" : "Rear", cells: [padCell, discCell], chip: statuses.length ? (w === ALL_GOOD ? { tone: "green", text: "Good" } : w) : null };
    };
    const rows = [axle("front"), axle("rear")].filter((r): r is TableRow => !!r);
    const fluid = items.find((i) => /brake fluid/i.test(i.item_label) && !/pipe|caliper|leak|hose/i.test(i.item_label));
    const lines: Line[] = [];
    if (fluid) {
      shownInTables.add(fluid.id);
      lines.push({ label: "Brake fluid", value: [itemStatusLabel(fluid.status, fluid.style), fluid.service_due ? "change due" : "", text(fluid.fluid_grade)].filter(Boolean).join(" · "), chip: chipOf(fluid).chip });
    }
    const fs = of("brakes");
    const good = goodWith((i) => partOf(i) === "brakes");
    const media = mediaOf(["measure.pad_front", "measure.pad_rear", ...items.filter((i) => shownInTables.has(i.id) && partOf(i) === "brakes" && !needsAttention(i)).map((i) => i.item_key)]);
    if (rows.length || lines.length || fs.length || good.length || media.length) sections.push({ key: "brakes", title: "BRAKES", chip: chipFor(fs), lines, tables: rows.length ? [{ head: ["", "Pads", "Discs", "Status"], rows }] : [], findings: fs, good, mediaKeys: media });
  }
  // TYRES: the size line and one row per tyre.
  {
    const size = [text(m.tyre_size_front) ? `Front ${text(m.tyre_size_front)}` : "", text(m.tyre_size_rear) ? `Rear ${text(m.tyre_size_rear)}` : ""].filter(Boolean).join(" · ");
    const fs = of("tyres");
    const good = goodWith((i) => partOf(i) === "tyres");
    const media = mediaOf(TYRE_ROWS.map((p) => `tyre.${p.key}`));
    if (tyreRows.length || size || fs.length || good.length || media.length) sections.push({ key: "tyres", title: "TYRES", chip: chipFor(fs), lines: size ? [{ label: "Tyre size", value: size }] : [], tables: tyreRows.length ? [{ head: ["", "Tread", "Made", "Condition", "Status"], rows: tyreRows }] : [], findings: fs, good, mediaKeys: media });
  }
  // BATTERY: the voltage, the test result, the CCA when entered.
  {
    const lines: Line[] = [];
    if (volts !== null) lines.push({ label: "Voltage", value: `${volts} V` });
    if (health) lines.push({ label: "Battery test", value: health === "good" ? "Good" : health === "weak" ? "Weak, recharge and retest" : "Replace", chip: health === "replace" ? { tone: "dark", text: "Replace" } : health === "weak" ? { tone: "amber", text: "Weak" } : { tone: "green", text: "Good" } });
    if (cca !== null) lines.push({ label: "CCA", value: String(cca) });
    const fs = of("battery");
    const good = goodWith((i) => partOf(i) === "battery");
    const media = mediaOf(["measure.battery"]);
    if (lines.length || fs.length || good.length || media.length) sections.push({ key: "battery", title: "BATTERY", chip: chipFor(fs), lines, tables: [], findings: fs, good, mediaKeys: media });
  }
  // Every other system with a finding, a measurement or a photo, in the checklist's order.
  const others = new Map(items.filter((i) => !partOf(i)).map((i) => [i.section_key, i.section_title]));
  if (num(m.vent_temp) !== null && !others.has("air_conditioning")) others.set("air_conditioning", "Air conditioning");
  for (const [key, title] of Array.from(others.entries()).sort((a, b) => order(a[0]) - order(b[0]))) {
    const fs = of(key);
    const good = goodWith((i) => !partOf(i) && i.section_key === key);
    const lines: Line[] = key === "air_conditioning" && num(m.vent_temp) !== null ? [{ label: "Vent temperature", value: `${num(m.vent_temp)} °C` }] : [];
    const media = key === "air_conditioning" ? mediaOf(["measure.vent"]) : [];
    if (!fs.length && !good.length && !lines.length && !media.length) continue;
    sections.push({ key, title: title.toUpperCase(), chip: chipFor(fs), lines, tables: [], findings: fs, good, mediaKeys: media });
  }
  if (input.road?.done && (input.road.flagged.length || input.road.good.length)) {
    const fs = of("road_test");
    sections.push({ key: "road_test", title: "ROAD TEST", chip: chipFor(fs), lines: input.road.good.length ? [{ label: "Good", value: input.road.good.join(", ") }] : [], tables: [], findings: fs, good: [], mediaKeys: [] });
  } else if (input.road?.notPossible) {
    sections.push({ key: "road_test", title: "ROAD TEST", chip: { tone: "grey", text: "Not possible" }, lines: [{ label: "Road test not possible", value: input.road.notPossible }], tables: [], findings: [], good: [], mediaKeys: [] });
  }
  if (input.body?.findings.length) {
    const fs = of("body");
    sections.push({ key: "body", title: "BODY", chip: chipFor(fs), lines: [...(input.body.airbags ? [{ label: "Airbags", value: "Deployed" }] : []), ...(input.body.structural ? [{ label: "Structure", value: "Chassis damage suspected: chassis measurement needed" }] : [])], tables: [], findings: fs, good: [], mediaKeys: [], body: input.body });
  }

  // A photo shows once: with its finding (or its good item) first, the section's own list keeps the rest.
  for (const s of sections) {
    const taken = new Set([...s.findings.flatMap((f) => f.mediaKeys), ...s.good.flatMap((g) => g.mediaKeys)]);
    s.mediaKeys = s.mediaKeys.filter((k) => !taken.has(k));
  }

  /* ---- needs attention: worst first, then in the report's own order ---- */
  const sectionRank = new Map(sections.map((s, k) => [s.key, k]));
  const attention: Finding[] = [...findings]
    .sort((a, b) => a.rank - b.rank || (sectionRank.get(a.home) ?? 99) - (sectionRank.get(b.home) ?? 99))
    .map((f) => ({ key: f.key, chip: f.chip, rank: f.rank, title: f.title, reason: f.reason, extra: f.extra, section: f.section, mediaKeys: f.mediaKeys, dangerous: f.dangerous }));

  /* ---- checked and passed: plain OK items only ---- */
  const inSections = new Set(sections.flatMap((s) => s.good.map((g) => g.key)));
  const plain = items.filter((i) => i.status === "good" && !needsAttention(i) && !i.dangerous && !inSections.has(i.id) && !shownInTables.has(i.id) && !i.remarks && !hasMedia(i.item_key) && !measured(i));
  const passedKeys = Array.from(new Map(plain.map((i) => [i.section_key, i.section_title])).entries()).sort((a, b) => order(a[0]) - order(b[0]));
  const passed = passedKeys.map(([key, title]) => ({ title: title.toUpperCase(), items: plain.filter((i) => i.section_key === key).sort((a, b) => a.position - b.position).map((i) => i.item_label) }));
  const placedKeys = Array.from(new Set(sections.flatMap((s) => [...s.mediaKeys, ...s.findings.flatMap((f) => f.mediaKeys), ...s.good.flatMap((g) => g.mediaKeys)])));
  return {
    attention,
    dangers: attention.filter((f) => f.dangerous).map((f) => ({ title: f.title, reason: f.reason || null })),
    note: input.managerNote?.trim() || null,
    sections,
    passed,
    passedCount: plain.length,
    noIssues: attention.length === 0,
    placedKeys,
  };
}

/** The chip colours, shared by the web report and the PDF. Red only for Dangerous and Replace now. */
export const TONE_COLOURS: Record<Tone, { bg: string; fg: string }> = {
  red: { bg: "#B3261E", fg: "#FFFFFF" },
  dark: { bg: "#111113", fg: "#FFFFFF" },
  amber: { bg: "#FBEFD5", fg: "#8A5A00" },
  green: { bg: "#E3F2E7", fg: "#1B6B2F" },
  grey: { bg: "#EDEDEF", fg: "#5F6368" },
};
