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

/* ---------------------------------------------------------------------------------------------------------------
   In and out (30 October 2026, batch 2 section 2): the gate-in reading against the final reading at gate-out, both
   in the car's own unit (the unit its dashboard shows, chosen at gate-in). ONE set of rules for the gate-out form,
   the gate-out action, the job card and the customer's invoice.
   --------------------------------------------------------------------------------------------------------------- */

/** Why the final reading could not be taken; the photo of the cluster is still required and the owner is told. */
export const UNREADABLE_REASONS: { key: string; label: string }[] = [
  { key: "battery", label: "Battery dead" },
  { key: "cluster", label: "Instrument cluster not working" },
  { key: "recovery", label: "Leaves on a recovery truck" },
  { key: "other", label: "Other" },
];
export const unreadableLabel = (key: string | null | undefined) => UNREADABLE_REASONS.find((r) => r.key === key)?.label ?? (key || "Not read");

/** A reading in the car's own unit: the miles as read for a car showing miles, else the km. */
export function readingOf(km: number | null | undefined, miles: number | null | undefined, unit: MileageUnit): number | null {
  if (km === null || km === undefined) return null;
  return unit === "mi" ? (miles ?? toMiles(km)) : km;
}

export type MileageInOut = { unit: MileageUnit; in: number | null; out: number | null; driven: number | null; drivenKm: number | null; unreadable: string | null };

/** The visit's readings and what was driven (null when a reading is missing). */
export function mileageInOut(i: { inKm: number | null; inMiles?: number | null; outKm: number | null; outMiles?: number | null; unit: MileageUnit; unreadable?: string | null }): MileageInOut {
  const inR = readingOf(i.inKm, i.inMiles, i.unit);
  const outR = readingOf(i.outKm, i.outMiles, i.unit);
  const driven = inR !== null && outR !== null ? outR - inR : null;
  return { unit: i.unit, in: inR, out: outR, driven, drivenKm: driven === null ? null : i.unit === "mi" ? Math.round(driven * KM_PER_MILE) : driven, unreadable: i.unreadable ?? null };
}

/** Checks the final reading typed at gate-out against the gate-in reading (both in the car's own unit). */
export function checkFinalReading(typed: number | null, inReading: number | null, unit: MileageUnit): { error: string } | { ok: true } {
  if (typed === null) return { error: `Enter the final ${unit} shown on the dashboard, or tick "Can't read it".` };
  if (inReading !== null && typed < inReading) return { error: `Final ${unit} (${formatThousands(typed)}) is lower than at gate-in (${formatThousands(inReading)}). Check the reading.` };
  return { ok: true };
}

/** "Mileage in 48,210 km · out 48,226 km · driven 16 km" (or "· out not read (Battery dead)"). */
export function mileageLine(m: MileageInOut): string {
  const u = m.unit;
  const parts = [m.in !== null ? `Mileage in ${formatThousands(m.in)} ${u}` : "Mileage in not recorded"];
  if (m.out !== null) parts.push(`out ${formatThousands(m.out)} ${u}`);
  else if (m.unreadable) parts.push(`out not read (${unreadableLabel(m.unreadable)})`);
  if (m.driven !== null) parts.push(`driven ${formatThousands(m.driven)} ${u}${u === "mi" ? ` (${formatThousands(m.drivenKm)} km)` : ""}`);
  return parts.join(" · ");
}

/** The customer's words (the invoice): "48,210 km" in and out - no distance driven, no internal reasons, never photos. */
export function customerMileage(m: MileageInOut): { in: string | null; out: string | null } {
  const show = (v: number | null) => (v === null ? null : `${formatThousands(v)} ${m.unit}`);
  return { in: show(m.in), out: show(m.out) };
}
