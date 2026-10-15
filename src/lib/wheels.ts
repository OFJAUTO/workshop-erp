/** The four wheel photos taken at gate-in, in the order they are taken, and the conditions that can be ticked under each. */

// A walk round the car: front left, rear left, rear right, front right.
export const WHEEL_KINDS = ["wheel_fl", "wheel_rl", "wheel_rr", "wheel_fr"] as const;
export type WheelKind = (typeof WHEEL_KINDS)[number];

export const WHEEL_LABELS: Record<WheelKind, string> = {
  wheel_fl: "Front left",
  wheel_fr: "Front right",
  wheel_rl: "Rear left",
  wheel_rr: "Rear right",
};

export const WHEEL_CONDITIONS = ["none", "curbed", "scratched", "paint_fade", "bent", "total"] as const;
export type WheelCondition = (typeof WHEEL_CONDITIONS)[number];

export const WHEEL_CONDITION_LABELS: Record<WheelCondition, string> = {
  none: "None",
  curbed: "Curbed",
  scratched: "Scratched",
  paint_fade: "Paint fade",
  bent: "Bent",
  total: "Total damage",
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

/** What was ticked under each wheel photo at gate-in, one line per wheel, for the inspection's wheel item. */
export function wheelConditionLines(media: { kind: string; wheel_condition?: string[] | null }[]): { label: string; text: string }[] {
  return WHEEL_KINDS.filter((k) => media.some((m) => m.kind === k)).map((k) => {
    const row = media.find((m) => m.kind === k);
    const text = wheelConditionText(row?.wheel_condition);
    return { label: WHEEL_LABELS[k], text: text && text !== "None" ? text : "no damage noted" };
  });
}
