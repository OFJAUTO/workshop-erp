/** The four wheel photos taken at gate-in, in the order they are taken, and the conditions that can be ticked under each. */

export const WHEEL_KINDS = ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"] as const;
export type WheelKind = (typeof WHEEL_KINDS)[number];

export const WHEEL_LABELS: Record<WheelKind, string> = {
  wheel_fl: "Front left",
  wheel_fr: "Front right",
  wheel_rl: "Rear left",
  wheel_rr: "Rear right",
};

export const WHEEL_CONDITIONS = ["none", "curbed", "scratched", "paint_fade", "bent"] as const;
export type WheelCondition = (typeof WHEEL_CONDITIONS)[number];

export const WHEEL_CONDITION_LABELS: Record<WheelCondition, string> = {
  none: "None",
  curbed: "Curbed",
  scratched: "Scratched",
  paint_fade: "Paint fade",
  bent: "Bent",
};

export function isWheelKind(kind: string): kind is WheelKind {
  return (WHEEL_KINDS as readonly string[]).includes(kind);
}

/** "None" cannot sit beside another condition; otherwise any mix is allowed. */
export function cleanWheelConditions(values: string[]): WheelCondition[] {
  const picked = values.filter((v): v is WheelCondition => (WHEEL_CONDITIONS as readonly string[]).includes(v));
  const unique = Array.from(new Set(picked));
  if (unique.includes("none")) return ["none"];
  return WHEEL_CONDITIONS.filter((c) => unique.includes(c));
}

export function wheelConditionText(values: string[] | null | undefined) {
  if (!values || values.length === 0) return "";
  return values.map((v) => WHEEL_CONDITION_LABELS[v as WheelCondition] ?? v).join(", ");
}
