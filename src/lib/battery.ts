/** A battery by its name or type: main or auxiliary, any brand. Pure, so the quotation editor can use it in the browser. */
export function isBatteryPart(p: { description?: string | null; part_type?: string | null; sticker_kind?: string | null }): boolean {
  if (p.sticker_kind === "battery") return true;
  if (p.sticker_kind === "part") return false;
  return /\bbatter(y|ies)\b/i.test(p.description ?? "") || /\bbattery\b/i.test(p.part_type ?? "");
}

/** The warranty lengths offered with one tap on a battery line. */
export const WARRANTY_CHOICES = [12, 24, 36] as const;
