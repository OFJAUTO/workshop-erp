/** Mileage in kilometres or miles: conversion, display with thousands separators, and the "are you sure?" checks. */

export type MileageUnit = "km" | "mi";
export const KM_PER_MILE = 1.609344;

export function toKm(value: number, unit: MileageUnit) {
  return Math.round(unit === "km" ? value : value * KM_PER_MILE);
}

export function toMiles(km: number) {
  return Math.round(km / KM_PER_MILE);
}

/** "12,345" */
export function formatThousands(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^\d]/g, ""));
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-GB");
}

/** Digits only from what was typed, or null when empty. */
export function parseMileage(text: string): number | null {
  const digits = String(text ?? "").replace(/[^\d]/g, "");
  if (!digits) return null;
  return Number(digits.slice(0, 7));
}

/** "12,345 km (7,671 mi)" in the unit the advisor used first. */
export function describeMileage(km: number, unit: MileageUnit = "km") {
  const mi = toMiles(km);
  return unit === "mi" ? `${formatThousands(mi)} mi (${formatThousands(km)} km)` : `${formatThousands(km)} km (${formatThousands(mi)} mi)`;
}

export type MileageCheck = { kind: "high_for_age" | "lower_than_last" | "jump_since_last"; text: string };

/** Per year of age, more than this is unusual. */
export const HIGH_KM_PER_YEAR = 50000;

/**
 * Why the figure might be wrong: unusually high for the car's age, lower than the last recorded
 * mileage, or far more than the last visit suggests. The advisor can confirm and continue.
 */
export function mileageChecks(km: number, ctx: { modelYear: number | null; lastKm: number | null; lastVisitAt: string | null; unit?: MileageUnit; now?: Date }): MileageCheck[] {
  const out: MileageCheck[] = [];
  const now = ctx.now ?? new Date();
  const show = (v: number) => (ctx.unit === "mi" ? `${formatThousands(toMiles(v))} mi` : `${formatThousands(v)} km`);
  if (ctx.modelYear) {
    const age = Math.max(1, now.getFullYear() - ctx.modelYear + 1);
    if (km > age * HIGH_KM_PER_YEAR) out.push({ kind: "high_for_age", text: `${show(km)} is unusually high for a ${ctx.modelYear} model (over ${formatThousands(HIGH_KM_PER_YEAR)} km a year).` });
  }
  if (ctx.lastKm != null && km < ctx.lastKm) {
    out.push({ kind: "lower_than_last", text: `Lower than the last recorded mileage, ${show(ctx.lastKm)}.` });
  } else if (ctx.lastKm != null && ctx.lastVisitAt) {
    const days = Math.max(1, Math.round((now.getTime() - Date.parse(ctx.lastVisitAt)) / 86400000));
    const increase = km - ctx.lastKm;
    if (increase > Math.max(15000, days * 300)) {
      out.push({ kind: "jump_since_last", text: `${show(increase)} more than at the last visit, ${days} day${days === 1 ? "" : "s"} ago.` });
    }
  }
  return out;
}
