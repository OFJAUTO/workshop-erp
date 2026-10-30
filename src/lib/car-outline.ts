/**
 * The car outline (top view, front at the top), shared by the inspection's bodyshop findings, the gate-in damage
 * marking and the bodyshop pre-work check - on screen (CarOutline) and in the PDFs (CarOutlinePdf). Pure data:
 * the panels with their shapes in a 240 x 480 box, and the words for the damage chips.
 * 30 October 2026 (night batch section 4): redrawn to look like a car (a rounded nose, the windscreen, the mirrors, a
 * bonnet longer than the boot) with FRONT / REAR / LEFT / RIGHT printed around it, and every panel named "Part –
 * position" ("Headlight – front right"). The keys never changed (saved marks keep their panels).
 */

export type PanelShape = { kind: "rect"; x: number; y: number; w: number; h: number; r?: number } | { kind: "circle"; cx: number; cy: number; r: number } | { kind: "path"; d: string };
/** Where a panel sits on the car, for the position check: which end, which side (the car's own). */
export type PanelPlace = { end?: "front" | "rear"; side?: "left" | "right" };
export type Panel = { key: string; label: string; shape: PanelShape | null; place?: PanelPlace };

/**
 * Left and right are the car's own left and right, as if sitting in the driver's seat. With the front at the top of
 * the picture, the car's RIGHT is on the right of the picture.
 */
export const CAR_PANELS: Panel[] = [
  { key: "front_bumper", label: "Front bumper", place: { end: "front" }, shape: { kind: "path", d: "M60 34 Q60 8 120 6 Q180 8 180 34 L180 40 L60 40 Z" } },
  { key: "grille", label: "Radiator grille", place: { end: "front" }, shape: { kind: "rect", x: 96, y: 42, w: 48, h: 12, r: 4 } },
  { key: "headlight_l", label: "Headlight – front left", place: { end: "front", side: "left" }, shape: { kind: "path", d: "M58 42 L92 42 L90 56 L62 56 Q56 50 58 42 Z" } },
  { key: "headlight_r", label: "Headlight – front right", place: { end: "front", side: "right" }, shape: { kind: "path", d: "M182 42 L148 42 L150 56 L178 56 Q184 50 182 42 Z" } },
  { key: "bonnet", label: "Bonnet", place: { end: "front" }, shape: { kind: "path", d: "M66 60 L174 60 L168 168 L72 168 Z" } },
  { key: "front_fender_l", label: "Front wing – left", place: { end: "front", side: "left" }, shape: { kind: "path", d: "M38 50 Q40 44 62 44 L68 170 L38 170 Q32 110 38 50 Z" } },
  { key: "front_fender_r", label: "Front wing – right", place: { end: "front", side: "right" }, shape: { kind: "path", d: "M202 50 Q200 44 178 44 L172 170 L202 170 Q208 110 202 50 Z" } },
  { key: "windshield", label: "Windscreen", place: { end: "front" }, shape: { kind: "path", d: "M74 172 L166 172 L156 218 L84 218 Z" } },
  { key: "mirror_l", label: "Mirror – left", place: { side: "left" }, shape: { kind: "path", d: "M36 186 L14 180 Q8 188 14 196 L36 196 Z" } },
  { key: "mirror_r", label: "Mirror – right", place: { side: "right" }, shape: { kind: "path", d: "M204 186 L226 180 Q232 188 226 196 L204 196 Z" } },
  { key: "door_fl", label: "Door – front left", place: { side: "left" }, shape: { kind: "rect", x: 38, y: 174, w: 30, h: 98, r: 4 } },
  { key: "door_fr", label: "Door – front right", place: { side: "right" }, shape: { kind: "rect", x: 172, y: 174, w: 30, h: 98, r: 4 } },
  { key: "roof", label: "Roof", shape: { kind: "rect", x: 84, y: 222, w: 72, h: 112, r: 8 } },
  { key: "door_rl", label: "Door – rear left", place: { side: "left" }, shape: { kind: "rect", x: 38, y: 276, w: 30, h: 88, r: 4 } },
  { key: "door_rr", label: "Door – rear right", place: { side: "right" }, shape: { kind: "rect", x: 172, y: 276, w: 30, h: 88, r: 4 } },
  { key: "rear_screen", label: "Rear screen", place: { end: "rear" }, shape: { kind: "path", d: "M84 338 L156 338 L164 366 L76 366 Z" } },
  { key: "quarter_l", label: "Quarter panel – rear left", place: { end: "rear", side: "left" }, shape: { kind: "path", d: "M38 368 L68 368 L70 430 Q46 432 40 424 Q34 396 38 368 Z" } },
  { key: "quarter_r", label: "Quarter panel – rear right", place: { end: "rear", side: "right" }, shape: { kind: "path", d: "M202 368 L172 368 L170 430 Q194 432 200 424 Q206 396 202 368 Z" } },
  { key: "boot", label: "Boot lid / tailgate", place: { end: "rear" }, shape: { kind: "path", d: "M74 370 L166 370 L168 428 L72 428 Z" } },
  { key: "tail_light_l", label: "Tail light – rear left", place: { end: "rear", side: "left" }, shape: { kind: "path", d: "M60 432 L90 432 L90 444 L64 444 Q58 440 60 432 Z" } },
  { key: "tail_light_r", label: "Tail light – rear right", place: { end: "rear", side: "right" }, shape: { kind: "path", d: "M180 432 L150 432 L150 444 L176 444 Q182 440 180 432 Z" } },
  { key: "rear_bumper", label: "Rear bumper", place: { end: "rear" }, shape: { kind: "path", d: "M60 446 L180 446 L180 452 Q180 474 120 476 Q60 474 60 452 Z" } },
  { key: "wheel_fl", label: "Wheel / rim – front left", place: { end: "front", side: "left" }, shape: { kind: "rect", x: 14, y: 92, w: 20, h: 54, r: 8 } },
  { key: "wheel_fr", label: "Wheel / rim – front right", place: { end: "front", side: "right" }, shape: { kind: "rect", x: 206, y: 92, w: 20, h: 54, r: 8 } },
  { key: "wheel_rl", label: "Wheel / rim – rear left", place: { end: "rear", side: "left" }, shape: { kind: "rect", x: 14, y: 372, w: 20, h: 54, r: 8 } },
  { key: "wheel_rr", label: "Wheel / rim – rear right", place: { end: "rear", side: "right" }, shape: { kind: "rect", x: 206, y: 372, w: 20, h: 54, r: 8 } },
  // Not a shape on the outline: a button of its own under it.
  { key: "chassis", label: "Chassis / structure", shape: null },
];

/** The words printed around the outline (bold capitals), placed in its frame (the viewBox below). */
export const OUTLINE_VIEWBOX = "-34 -26 308 532";
export const OUTLINE_LABELS = [
  { text: "FRONT", x: 120, y: -8, rotate: 0 },
  { text: "REAR", x: 120, y: 498, rotate: 0 },
  { text: "LEFT", x: -16, y: 240, rotate: -90 },
  { text: "RIGHT", x: 256, y: 240, rotate: 90 },
] as const;
export const PANEL_LABEL: Record<string, string> = Object.fromEntries(CAR_PANELS.map((p) => [p.key, p.label]));
export const panelLabel = (key: string) => PANEL_LABEL[key] ?? key.replace(/_/g, " ");

export const DAMAGE_TYPES = [
  { value: "scratch", label: "Scratch" },
  { value: "dent", label: "Dent" },
  { value: "crack", label: "Crack" },
  { value: "broken", label: "Broken" },
  { value: "paint_damage", label: "Paint damage" },
  { value: "misaligned", label: "Misaligned" },
  { value: "missing", label: "Missing" },
  { value: "previous_repair", label: "Previous repair" },
] as const;
export const SEVERITIES = [
  { value: "minor", label: "Minor" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
] as const;
export const BODY_ACTIONS = [
  { value: "polish", label: "Polish" },
  { value: "paint", label: "Paint" },
  { value: "repair_paint", label: "Repair & paint" },
  { value: "replace", label: "Replace" },
  { value: "ppf_wrap", label: "PPF / wrap" },
] as const;
export const damageWords = (values: readonly string[] | null | undefined) => (values ?? []).map((v) => DAMAGE_TYPES.find((d) => d.value === v)?.label ?? v).join(", ");
export const severityLabel = (v: string | null | undefined) => SEVERITIES.find((s) => s.value === v)?.label ?? "";
export const actionLabel = (v: string | null | undefined) => BODY_ACTIONS.find((a) => a.value === v)?.label ?? "";

/** How a marked panel is coloured: severe and moderate red, minor (or no severity given) amber. */
export type PanelTone = "amber" | "red";
export function toneOf(mark: { severity?: string | null } | null | undefined): PanelTone | null {
  if (!mark) return null;
  return mark.severity === "severe" || mark.severity === "moderate" ? "red" : "amber";
}

/** A gate-in or pre-work marking: per panel, the damage seen and a note. */
export type PanelMarks = Record<string, { damage: string[]; note?: string | null; severity?: string | null }>;

/** Cleans a marking from the browser: known panels only, known damage words only, short notes. */
export function cleanPanelMarks(input: unknown): PanelMarks {
  const out: PanelMarks = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!PANEL_LABEL[k] || !v || typeof v !== "object") continue;
    const raw = v as { damage?: unknown; note?: unknown; severity?: unknown };
    const damage = Array.isArray(raw.damage) ? raw.damage.map(String).filter((d) => DAMAGE_TYPES.some((t) => t.value === d)) : [];
    const note = typeof raw.note === "string" ? raw.note.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    const severity = SEVERITIES.some((s) => s.value === raw.severity) ? String(raw.severity) : null;
    if (damage.length || note) out[k] = { damage, note: note || null, severity };
  }
  return out;
}

/** "Front bumper: Scratch, Dent · Rear door left: Paint damage": one line for messages and lists. */
export function marksWords(marks: PanelMarks): string {
  return Object.entries(marks)
    .map(([k, m]) => `${panelLabel(k)}: ${[damageWords(m.damage), m.note].filter(Boolean).join(" – ")}`)
    .join(" · ");
}
