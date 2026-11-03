/**
 * Finding a car by what people type (2 November 2026, section 3): the database keeps a plate's code and number apart
 * ("GG" and "13706"), while people type "GG 13706", "gg13706", "Dubai GG 13706" or "W-64762". ONE rule for the top
 * search and the Record payment window. Pure.
 */

/** Characters that would break a PostgREST filter (or are its wildcards) never reach it. */
export function cleanNeedle(q: string): string {
  return String(q ?? "").replace(/[%,()*_\\"]/g, " ").replace(/\s+/g, " ").trim();
}

/** "GG 13706" → { code: "GG", number: "13706" }; "13706" → { code: null, number: "13706" }; a name → null. */
export function plateParts(q: string): { code: string | null; number: string } | null {
  const t = cleanNeedle(q);
  const coded = /(?:^|[\s-])([A-Za-z]{1,3})\s*-?\s*(\d{1,6})$/.exec(t);
  if (coded) return { code: coded[1].toUpperCase(), number: coded[2] };
  const bare = /^(\d{1,6})$/.exec(t.replace(/[\s-]/g, ""));
  return bare ? { code: null, number: bare[1] } : null;
}

/**
 * The PostgREST or-filter for vehicles: the VIN, the plate number as typed (letters and digits only), and - when the
 * words end in a plate code and number - that code with that number.
 */
export function vehicleOrFilter(q: string): string {
  const t = cleanNeedle(q);
  const compact = t.replace(/[^\p{L}\p{N}]/gu, "");
  const parts = plateParts(t);
  const ors = [`vin.ilike.%${compact || t}%`, `plate_number.ilike.%${compact || t}%`];
  if (parts?.code) ors.push(`and(plate_code.ilike.${parts.code},plate_number.ilike.%${parts.number}%)`);
  else if (parts) ors.push(`plate_number.ilike.%${parts.number}%`);
  return ors.join(",");
}
