import { knownDbWords } from "./db-words";
import { EMIRATES, PLATE_COUNTRIES, formatPlate } from "./types";

/**
 * NUMBER PLATES (6 November 2026, the AL TAMIMI Audi A8): THE plate rules, pure, read by the car form, its save, the
 * gate-in form and the tests. The cause of the raw error was the save never writing `has_plate`, so a car created
 * without a plate kept the flag even after a plate was typed, and the database rule refused. `plateFieldsOf` is now
 * the ONE place that turns the form into the stored fields, flag included.
 */

export type PlateInput = { noPlate: boolean; country: string; emirate: string; code: string; number: string };
export type PlateFieldsRow = { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null };

/** UAE plate code: 1-2 letters or digits (Dubai AA/DD, Abu Dhabi and Sharjah number codes like 1 or 16). */
export const UAE_CODE_RE = /^[A-Z0-9]{1,2}$/;
/** UAE plate number: 1-5 digits. */
export const UAE_NUMBER_RE = /^[0-9]{1,5}$/;
/** Other-country and export plates: letters, digits, space or dash, up to 12 characters. */
export const OTHER_NUMBER_RE = /^[A-Z0-9][A-Z0-9 -]{0,11}$/;

const clean = (s: string) => s.trim().toUpperCase();

/** The one format check, in plain words. Null = fine. */
export function checkPlateInput(d: PlateInput): string | null {
  if (d.noPlate) return null;
  if (!(PLATE_COUNTRIES as readonly string[]).includes(d.country)) return "Choose the plate country.";
  const code = clean(d.code);
  const number = clean(d.number).replace(/\s+/g, "");
  if (d.country === "UAE") {
    if (!(EMIRATES as readonly string[]).includes(d.emirate)) return "Choose the emirate.";
    if (!number) return "Type the plate number (1 to 5 digits), or tick No number plate.";
    if (!UAE_NUMBER_RE.test(number)) return "A UAE plate number is 1 to 5 digits (letters go in the Code box).";
    if (code && !UAE_CODE_RE.test(code)) return "The plate code is 1 or 2 letters or digits (AA, DD, 1, 16).";
    return null;
  }
  if (!clean(d.number)) return "Type the plate number, or tick No number plate.";
  if (!OTHER_NUMBER_RE.test(clean(d.number).replace(/\s+/g, " "))) return "The plate number can hold letters, digits, spaces and dashes (up to 12).";
  if (code && code.length > 5) return "The plate code is up to 5 letters or digits.";
  return null;
}

/** The form turned into the stored fields - `has_plate` INCLUDED (the missing piece behind the raw error). */
export function plateFieldsOf(d: PlateInput): PlateFieldsRow {
  if (d.noPlate) return { has_plate: false, plate_country: d.country || "UAE", plate_emirate: null, plate_code: null, plate_number: null };
  return {
    has_plate: true,
    plate_country: d.country,
    plate_emirate: d.country === "UAE" ? d.emirate : null,
    plate_code: clean(d.code) || null,
    plate_number: clean(d.number).replace(/\s+/g, ""),
  };
}

type PlateLike = { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null };

/** A real change of an EXISTING plate (a transfer): needs the remark. Adding a plate to a no-plate car never does. */
export function plateChanged(before: PlateLike, after: PlateFieldsRow): boolean {
  if (!before.has_plate || !before.plate_number) return false;
  if (!after.has_plate) return true; // a plate taken off is a change too
  return (
    before.plate_country !== after.plate_country ||
    (before.plate_emirate ?? "") !== (after.plate_emirate ?? "") ||
    (before.plate_code ?? "") !== (after.plate_code ?? "") ||
    before.plate_number !== after.plate_number
  );
}

/** One old plate as search text: the formatted words plus the compact form ("Dubai DD 23864 DD23864"). */
export function oldPlateEntry(v: PlateLike): string | null {
  if (!v.has_plate || !v.plate_number) return null;
  const words = formatPlate({ ...v, kind: "car", vin: null });
  const compact = [v.plate_code ?? "", v.plate_number].join("").replace(/\s+/g, "");
  return `${words} ${compact}`.trim();
}

/** Appends an entry to the stored old-plates text, once (" · " joined; searched with ilike). */
export function appendOldPlates(existing: string | null | undefined, entry: string | null): string | null {
  if (!entry) return existing ?? null;
  const items = String(existing ?? "").split(" · ").map((s) => s.trim()).filter(Boolean);
  if (items.includes(entry)) return existing ?? null;
  return [...items, entry].join(" · ");
}

/** "Genuinely no plate" reasons at gate-in (one must be picked when no plate is typed). */
export const NO_PLATE_REASONS = ["New car - not registered yet", "Export plate / leaving the country", "Trade or test plate", "Other"] as const;

/** The edit page's title: "Edit car · AUDI A8 · DUBAI DD 23864" / "Edit car · AUDI A8 · No plate yet". */
export function editCarTitle(carWords: string, v: PlateLike & { kind?: string | null; vin?: string | null }): string {
  const plate = v.has_plate && v.plate_number ? formatPlate({ ...v, kind: v.kind ?? "car", vin: v.vin ?? null }).toUpperCase() : "No plate yet";
  return ["Edit car", carWords.trim().toUpperCase() || null, plate].filter(Boolean).join(" · ");
}

/**
 * Database refusals in plain words (no raw constraint names to staff, ever). Null = not a known one: the caller logs
 * the raw error for the owner (logAppError) and shows the shared SAVE_FAILED words instead.
 */
export function friendlyVehicleError(message: string): string | null {
  return knownDbWords(message);
}
