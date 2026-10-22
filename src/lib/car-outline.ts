/**
 * The car outline (top view, front at the top), shared by the inspection's bodyshop findings, the gate-in damage
 * marking and the bodyshop pre-work check - on screen (CarOutline) and in the PDFs (CarOutlinePdf). Pure data:
 * the panels with their shapes in a 240 x 480 box, and the words for the damage chips.
 */

export type PanelShape = { kind: "rect"; x: number; y: number; w: number; h: number; r?: number } | { kind: "circle"; cx: number; cy: number; r: number } | { kind: "path"; d: string };
export type Panel = { key: string; label: string; shape: PanelShape | null };

/** Left and right are the car's own left and right (the driver's side seen from the seat). */
export const CAR_PANELS: Panel[] = [
  { key: "front_bumper", label: "Front bumper", shape: { kind: "rect", x: 52, y: 8, w: 136, h: 30, r: 14 } },
  { key: "grille", label: "Grille", shape: { kind: "rect", x: 94, y: 40, w: 52, h: 14, r: 4 } },
  { key: "headlight_l", label: "Headlight left", shape: { kind: "rect", x: 56, y: 40, w: 34, h: 16, r: 6 } },
  { key: "headlight_r", label: "Headlight right", shape: { kind: "rect", x: 150, y: 40, w: 34, h: 16, r: 6 } },
  { key: "bonnet", label: "Bonnet", shape: { kind: "path", d: "M66 58 L174 58 L170 138 L70 138 Z" } },
  { key: "front_fender_l", label: "Front fender left", shape: { kind: "path", d: "M36 54 L62 58 L66 150 L36 150 Q30 100 36 54 Z" } },
  { key: "front_fender_r", label: "Front fender right", shape: { kind: "path", d: "M204 54 L178 58 L174 150 L204 150 Q210 100 204 54 Z" } },
  { key: "windshield", label: "Windshield", shape: { kind: "path", d: "M72 142 L168 142 L160 186 L80 186 Z" } },
  { key: "mirror_l", label: "Mirror left", shape: { kind: "rect", x: 12, y: 158, w: 22, h: 16, r: 5 } },
  { key: "mirror_r", label: "Mirror right", shape: { kind: "rect", x: 206, y: 158, w: 22, h: 16, r: 5 } },
  { key: "door_fl", label: "Front door left", shape: { kind: "rect", x: 36, y: 154, w: 30, h: 96, r: 4 } },
  { key: "door_fr", label: "Front door right", shape: { kind: "rect", x: 174, y: 154, w: 30, h: 96, r: 4 } },
  { key: "roof", label: "Roof", shape: { kind: "rect", x: 80, y: 190, w: 80, h: 132, r: 8 } },
  { key: "door_rl", label: "Rear door left", shape: { kind: "rect", x: 36, y: 254, w: 30, h: 86, r: 4 } },
  { key: "door_rr", label: "Rear door right", shape: { kind: "rect", x: 174, y: 254, w: 30, h: 86, r: 4 } },
  { key: "quarter_l", label: "Quarter panel left", shape: { kind: "path", d: "M36 344 L66 344 L66 418 L40 418 Q32 380 36 344 Z" } },
  { key: "quarter_r", label: "Quarter panel right", shape: { kind: "path", d: "M204 344 L174 344 L174 418 L200 418 Q208 380 204 344 Z" } },
  { key: "boot", label: "Boot", shape: { kind: "path", d: "M76 326 L164 326 L170 418 L70 418 Z" } },
  { key: "tail_light_l", label: "Tail light left", shape: { kind: "rect", x: 52, y: 420, w: 36, h: 14, r: 5 } },
  { key: "tail_light_r", label: "Tail light right", shape: { kind: "rect", x: 152, y: 420, w: 36, h: 14, r: 5 } },
  { key: "rear_bumper", label: "Rear bumper", shape: { kind: "rect", x: 52, y: 436, w: 136, h: 32, r: 14 } },
  { key: "wheel_fl", label: "Wheel / rim front left", shape: { kind: "rect", x: 14, y: 84, w: 18, h: 50, r: 8 } },
  { key: "wheel_fr", label: "Wheel / rim front right", shape: { kind: "rect", x: 208, y: 84, w: 18, h: 50, r: 8 } },
  { key: "wheel_rl", label: "Wheel / rim rear left", shape: { kind: "rect", x: 14, y: 350, w: 18, h: 50, r: 8 } },
  { key: "wheel_rr", label: "Wheel / rim rear right", shape: { kind: "rect", x: 208, y: 350, w: 18, h: 50, r: 8 } },
  // Not a shape on the outline: a button of its own under it.
  { key: "chassis", label: "Chassis / structure", shape: null },
];
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
