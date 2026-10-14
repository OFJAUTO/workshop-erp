/**
 * The bodyshop's vocabulary, shared by the server and the screens: the package kinds behind the Settings pick list,
 * the sections (teams), the stage templates built from the packages, the due dates spread back from the handover
 * date, and who must sign the car off. Pure functions only; nothing here touches the database.
 */

export const BODYSHOP_KINDS = ["ppf", "coloured_ppf", "tint", "peelable_jambs", "peelable_full", "respray", "ppf_removal", "wash", "accident", "other"] as const;
export type BodyshopKind = (typeof BODYSHOP_KINDS)[number];
export const BODYSHOP_KIND_LABELS: Record<BodyshopKind, string> = {
  ppf: "Full PPF",
  coloured_ppf: "Coloured PPF",
  tint: "Window tint",
  peelable_jambs: "Peelable door jambs",
  peelable_full: "Full peelable colour change",
  respray: "Full respray",
  ppf_removal: "Old PPF removal",
  wash: "Wash",
  accident: "Accident repair",
  other: "Other",
};

/** The teams. The strip and refit team is led by the bodyshop manager himself. */
export const SECTIONS = ["strip_refit", "ppf", "paint", "detailing"] as const;
export type Section = (typeof SECTIONS)[number];
export type StageSection = Section | "electrical" | "qc" | "handover";
export const SECTION_LABELS: Record<StageSection, string> = {
  strip_refit: "Strip and refit",
  ppf: "PPF and tint",
  paint: "Paint",
  detailing: "Detailing",
  electrical: "Electrical",
  qc: "QC",
  handover: "Handover",
};
/** A person's department (staff.department_id) says which section is theirs. */
export function sectionOfDepartment(departmentId: string | null | undefined): Section | null {
  if (departmentId === "ppf_tint") return "ppf";
  if (departmentId === "paint") return "paint";
  if (departmentId === "detailing") return "detailing";
  if (departmentId === "bodyshop") return "strip_refit";
  return null;
}
export const DEPARTMENT_OF_SECTION: Record<Section, string> = { strip_refit: "bodyshop", ppf: "ppf_tint", paint: "paint", detailing: "detailing" };

export type StageDef = { key: string; label: string; section: StageSection; hours: number };
/** Every stage the bodyshop knows, in the order a car goes through them. */
export const STAGE_DEFS: StageDef[] = [
  { key: "removal", label: "Old PPF removal", section: "strip_refit", hours: 6 },
  { key: "repair", label: "Strip and repair", section: "strip_refit", hours: 12 },
  { key: "strip", label: "Strip", section: "strip_refit", hours: 4 },
  { key: "prep", label: "Prep (wash, polish, clean)", section: "detailing", hours: 6 },
  { key: "peelable", label: "Peelable paint", section: "paint", hours: 6 },
  { key: "paint_full", label: "Strip and paint", section: "paint", hours: 24 },
  { key: "paint", label: "Paint", section: "paint", hours: 12 },
  { key: "ppf", label: "PPF install", section: "ppf", hours: 16 },
  { key: "tint", label: "Tint", section: "ppf", hours: 3 },
  { key: "refit", label: "Refit", section: "strip_refit", hours: 4 },
  { key: "detail", label: "Final detail and check", section: "detailing", hours: 4 },
  { key: "clean", label: "Clean", section: "detailing", hours: 2 },
  { key: "electrical", label: "Electrical reset", section: "electrical", hours: 1 },
  { key: "qc", label: "QC", section: "qc", hours: 1 },
  { key: "handover", label: "Handover", section: "handover", hours: 0.5 },
];
export const stageDef = (key: string) => STAGE_DEFS.find((s) => s.key === key) ?? null;

/**
 * The stages a car needs, from the package kinds on its quotation. PPF: removal (if quoted), strip, prep, peelable
 * door jambs (if quoted), PPF install (+ tint), refit, final detail, electrical reset, QC, handover. Tint only: tint,
 * clean, QC, handover. Full peelable colour change or respray: strip and paint, detailing, QC, handover. Accident:
 * strip and repair, paint, refit, detailing, QC, handover. Wash only: clean, handover. Several kinds merge in order.
 */
export function stageKeysFor(kinds: string[]): string[] {
  const k = new Set(kinds);
  const want = new Set<string>();
  const ppf = k.has("ppf") || k.has("coloured_ppf");
  const fullPaint = k.has("peelable_full") || k.has("respray");
  if (ppf) {
    if (k.has("ppf_removal")) want.add("removal");
    want.add("strip").add("prep");
    if (k.has("peelable_jambs")) want.add("peelable");
    want.add("ppf");
    if (k.has("tint")) want.add("tint");
    want.add("refit").add("detail").add("electrical").add("qc").add("handover");
  } else if (k.has("tint")) {
    want.add("tint").add("clean").add("qc").add("handover");
  }
  if (fullPaint) want.add("paint_full").add("detail").add("qc").add("handover");
  if (k.has("accident")) want.add("repair").add("paint").add("refit").add("detail").add("qc").add("handover");
  if (k.has("peelable_jambs") && !ppf) want.add("peelable").add("detail").add("qc").add("handover");
  if (k.has("ppf_removal") && !ppf) want.add("removal").add("detail").add("qc").add("handover");
  if (k.has("wash") && want.size === 0) want.add("clean").add("handover");
  if (k.has("other") && want.size === 0) want.add("detail").add("qc").add("handover");
  if (want.has("paint_full")) want.delete("paint");
  // "PPF install" reads "PPF install and tint" when both are on the car: the tint stage merges into it.
  if (want.has("ppf") && want.has("tint")) want.delete("tint");
  return STAGE_DEFS.filter((s) => want.has(s.key)).map((s) => s.key);
}
export const stageLabelFor = (key: string, kinds: string[]) => (key === "ppf" && kinds.includes("tint") ? "PPF install and tint" : key === "ppf" && kinds.includes("coloured_ppf") && !kinds.includes("ppf") ? "Coloured PPF install" : (stageDef(key)?.label ?? key));

const DAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function isWorkingDay(date: string, workingDays: string[]) {
  const open = new Set(workingDays.length ? workingDays : DAY_IDS.filter((d) => d !== "sun"));
  return open.has(DAY_IDS[new Date(date + "T12:00:00Z").getUTCDay()]);
}
export function addDaysIso(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The working days from the start to the promised day, both included; at least the promised day itself. */
export function workingDaysBetween(start: string, promised: string, workingDays: string[]): string[] {
  const days: string[] = [];
  let d = start <= promised ? start : promised;
  for (let i = 0; i < 400 && d <= promised; i++) {
    if (isWorkingDay(d, workingDays)) days.push(d);
    d = addDaysIso(d, 1);
  }
  return days.length ? days : [promised];
}
/**
 * Due dates spread back from the handover date: each stage ends when its share of the hours is used up, over the
 * working days between the start and the promised day. The handover stage lands on the promised day itself.
 */
export function spreadDueDates(hours: number[], start: string, promised: string, workingDays: string[]): string[] {
  const days = workingDaysBetween(start, promised, workingDays);
  const total = hours.reduce((a, h) => a + Math.max(0, h), 0) || 1;
  let used = 0;
  return hours.map((h, i) => {
    used += Math.max(0, h);
    // The handover lands on the promised day itself, even when that day is outside the working days (the customer was told it).
    if (i === hours.length - 1) return promised;
    const idx = Math.min(days.length - 1, Math.max(0, Math.ceil((used / total) * days.length) - 1));
    return days[idx];
  });
}

export type SignoffKey = "manager" | "ppf" | "detailing" | "paint";
export const SIGNOFF_LABELS: Record<SignoffKey, string> = { manager: "Bodyshop manager", ppf: "PPF leader", detailing: "Detailing leader", paint: "Paint leader" };
/** Who must sign before the car leaves: the manager and detailing always, PPF and paint when their stages ran. */
export function neededSignoffs(sections: string[]): SignoffKey[] {
  const out: SignoffKey[] = ["manager"];
  if (sections.includes("ppf")) out.push("ppf");
  out.push("detailing");
  if (sections.includes("paint")) out.push("paint");
  return out;
}
/** The sign-off key a person holds: the bodyshop manager, or a team leader by department. */
export function signoffKeyOf(roleId: string, departmentId: string | null | undefined): SignoffKey | null {
  if (roleId === "workshop_manager" && (departmentId === "bodyshop" || departmentId === "paint" || departmentId === "ppf_tint" || departmentId === "detailing")) return "manager";
  if (roleId === "team_leader") {
    const s = sectionOfDepartment(departmentId);
    return s === "ppf" ? "ppf" : s === "paint" ? "paint" : s === "detailing" ? "detailing" : null;
  }
  return null;
}
