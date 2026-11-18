/**
 * PURCHASE RETURNS AND SUPPLIER CREDIT NOTES - the pure rules (19 November 2026, Section 4; Sparein, invoice 17098,
 * credit note 1857, replacement invoice 17174). The LPO page, the Purchase returns page, the suppliers page and the
 * tests read them.
 */
export const RETURN_REASONS = [
  { key: "wrong_part", label: "Wrong part" },
  { key: "damaged", label: "Damaged" },
  { key: "not_needed", label: "Not needed" },
  { key: "wrong_price", label: "Wrong price" },
] as const;
export type ReturnReasonKey = (typeof RETURN_REASONS)[number]["key"];
export const reasonLabel = (k: string) => RETURN_REASONS.find((r) => r.key === k)?.label ?? k;

/** Electrical items and batteries (a supplier may take no returns on them). */
export function isElectricalOrBattery(name: string): boolean {
  return /\bBATTER(Y|IES)\b|\bELECTRIC|\bMODULE\b|\bECU\b|\bSENSOR|\bCONTROL UNIT\b|\bRELAY\b|\bFUSE\b|\bIGNITION COIL\b|\bALTERNATOR\b|\bSTARTER MOTOR\b/i.test(name);
}

/** A supplier's return window (Settings, per supplier). Blank = no limit. */
export type ReturnRules = { returnDays: number | null; creditDays: number | null; noElectrical: boolean };
export const NO_RULES: ReturnRules = { returnDays: null, creditDays: null, noElectrical: false };

export function returnRulesOf(setting: unknown, supplierId: string | null | undefined): ReturnRules {
  if (!supplierId || !setting || typeof setting !== "object") return NO_RULES;
  const r = (setting as Record<string, unknown>)[supplierId];
  if (!r || typeof r !== "object") return NO_RULES;
  const o = r as Record<string, unknown>;
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null);
  return { returnDays: n(o.returnDays), creditDays: n(o.creditDays), noElectrical: o.noElectrical === true };
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/**
 * May this part go back, and how much time is left? blocked = the supplier takes no returns on it (electrical or a
 * battery); late = past the return window; warn = 2 days or fewer left. Words for the parts desk.
 */
export function returnWindowOf(rules: ReturnRules, part: { name: string; receivedDay: string | null }, today: string): { blocked: boolean; late: boolean; warn: boolean; words: string | null } {
  if (rules.noElectrical && isElectricalOrBattery(part.name)) return { blocked: true, late: false, warn: true, words: "This supplier takes no returns on electrical items and batteries." };
  if (rules.returnDays === null || !part.receivedDay) return { blocked: false, late: false, warn: false, words: null };
  const left = rules.returnDays - daysBetween(part.receivedDay, today);
  if (left < 0) return { blocked: false, late: true, warn: true, words: `Past the supplier's ${rules.returnDays}-day return window (by ${-left} day${left === -1 ? "" : "s"}): ask them before sending it back.` };
  if (left <= 2) return { blocked: false, late: false, warn: true, words: `${left === 0 ? "Last day" : `${left} day${left === 1 ? "" : "s"} left`} to return it (the supplier's ${rules.returnDays}-day window).` };
  return { blocked: false, late: false, warn: false, words: `${left} days left to return it.` };
}

/** The credit note's VAT (5% of the net unless typed) and total. */
export function creditTotals(net: number, typedVat: number | null, chargesVat: boolean): { net: number; vat: number; total: number } {
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const vat = chargesVat ? (typedVat ?? r2(net * 0.05)) : 0;
  return { net: r2(net), vat: r2(vat), total: r2(net + vat) };
}

/** An LPO's money after returns: invoiced, credited, re-invoiced (replacements), net. */
export function lpoNetOf(m: { invoiced: number; credited: number; reinvoiced: number }): { invoiced: number; credited: number; reinvoiced: number; net: number } {
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return { invoiced: r2(m.invoiced), credited: r2(m.credited), reinvoiced: r2(m.reinvoiced), net: r2(m.invoiced - m.credited + m.reinvoiced) };
}

/** "Replaces returned FRONT BUMPER + REINFORCEMENT, BUMPER". */
export const replacesWords = (names: string[]) => `Replaces returned ${names.map((n) => n.toUpperCase()).join(" + ")}`;
