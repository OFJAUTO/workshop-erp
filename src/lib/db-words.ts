/**
 * NO RAW DATABASE WORDS TO STAFF (6 November 2026, after "vehicles_plate_rules" reached Adarsh's screen): THE rule,
 * pure, used by the server (dbWords in app-errors.ts, which also logs the raw text for the owner) and by the screens'
 * last safety net (Notice). A known refusal gets its own plain advice; any other database text becomes the one shared
 * sentence. Plain words we wrote ourselves pass through unchanged.
 */

export const SAVE_FAILED_WORDS = "Couldn't save – nothing was recorded. Try again or tell the owner.";
/** For a database problem in the middle of one of our own sentences ("Could not save the lines – …"). */
export const BEHIND_THE_SCENES = "a problem behind the scenes (the owner has the detail)";

/** Postgres / PostgREST / network signatures. Specific on purpose: our own sentences never carry them. */
const RAW_SIGNATURES = new RegExp(
  [
    String.raw`violates (check|foreign key|unique|not-null|exclusion|row-level security) (constraint|policy)`,
    String.raw`duplicate key value`,
    String.raw`null value in column`,
    String.raw`invalid input syntax for type`,
    String.raw`invalid input value for enum`,
    String.raw`column "?[\w.]+"? (of relation "?[\w.]+"? )?does not exist`,
    String.raw`relation "?[\w.]+"? does not exist`,
    String.raw`function [\w.]+\(.*\) does not exist`,
    String.raw`operator does not exist`,
    String.raw`value too long for type`,
    String.raw`out of range for type`,
    String.raw`numeric field overflow`,
    String.raw`date/time field value out of range`,
    String.raw`permission denied for (table|schema|function|relation|sequence|view)`,
    String.raw`row-level security`,
    String.raw`syntax error at or near`,
    String.raw`there is no unique or exclusion constraint`,
    String.raw`more than one row returned by a subquery`,
    String.raw`infinite recursion detected`,
    String.raw`record "\w+" has no field`,
    String.raw`Could not find the '[^']+' column`,
    String.raw`Could not find a relationship between`,
    String.raw`in the schema cache`,
    String.raw`JSON object requested, multiple \(or no\) rows returned`,
    String.raw`Results contain \d+ rows`,
    String.raw`canceling statement due to`,
    String.raw`deadlock detected`,
    String.raw`\bPGRST\d{3}\b`,
    String.raw`\bfetch failed\b`,
    String.raw`\bECONNRESET\b|\bETIMEDOUT\b|socket hang up`,
  ].join("|"),
  "i",
);

/** Known refusals in plain words: what the person can DO about it. */
const KNOWN: [RegExp, string][] = [
  [/vehicles_active_plate_idx/, "A car with this plate already exists."],
  [/vehicles_vin_key/, "A car with this VIN already exists."],
  [/vehicles_plate_rules/, "The plate didn't save. Untick “No number plate” to save a plate, or type the plate again."],
  [/vehicles_plate_emirate_check/, "Choose the emirate."],
  [/vehicles_vin_check/, "A VIN has exactly 17 characters."],
  [/customers_company_name_required/, "Type the company name – a company customer needs one."],
  [/row-level security|permission denied for/i, "You are not allowed to change this here. Ask the owner."],
  [/canceling statement due to|deadlock detected|\bfetch failed\b|\bECONNRESET\b|\bETIMEDOUT\b|socket hang up/i, "The database didn't answer in time – nothing was recorded. Try again."],
];

export function isRawDbText(text: string | null | undefined): boolean {
  return !!text && RAW_SIGNATURES.test(text);
}

/** Plain advice for a known refusal, or null. */
export function knownDbWords(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const [re, words] of KNOWN) if (re.test(text)) return words;
  return null;
}

/**
 * THE staff wording of any error text. Plain text passes through. Database text becomes the known advice or the
 * shared sentence; when it sits after one of our own sentences ("Could not save the lines: <raw>") our part is kept
 * and only the raw part is replaced, so "Saved, but …" never turns into "nothing was recorded".
 */
export function staffWords(text: string | null | undefined): string {
  const t = String(text ?? "");
  if (!isRawDbText(t)) return t;
  const known = knownDbWords(t);
  const at = t.search(RAW_SIGNATURES);
  const head = t.slice(0, at);
  const cut = Math.max(head.lastIndexOf(": "), head.lastIndexOf(" ("));
  const ours = cut > 0 ? head.slice(0, cut).trim() : "";
  if (ours && ours.split(/\s+/).length >= 3 && !isRawDbText(ours)) {
    return `${ours.replace(/[.:–-]+$/, "")} – ${known ? known.charAt(0).toLowerCase() + known.slice(1) : `${BEHIND_THE_SCENES}.`}`;
  }
  return known ?? SAVE_FAILED_WORDS;
}

/** The words for a database problem INSIDE one of our sentences (the known advice, or "a problem behind the scenes"). */
export function staffDetail(text: string | null | undefined): string {
  const t = String(text ?? "");
  if (!isRawDbText(t)) return t;
  return knownDbWords(t) ?? BEHIND_THE_SCENES;
}
