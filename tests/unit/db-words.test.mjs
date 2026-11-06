// No raw database words to staff (6 November 2026): THE rule that turns database text into plain words.
//   node --import ./tests/unit/register.mjs tests/unit/db-words.test.mjs        (npm run test:unit)
const { staffWords, staffDetail, isRawDbText, knownDbWords, SAVE_FAILED_WORDS, BEHIND_THE_SCENES } = await import("../../src/lib/db-words.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// The AL TAMIMI case, word for word as it reached Adarsh.
const plateRaw = 'new row for relation "vehicles" violates check constraint "vehicles_plate_rules"';
check("the plate refusal is database text", isRawDbText(plateRaw));
check("…and becomes the plain advice (untick No number plate)", /Untick “No number plate”/.test(staffWords(plateRaw)) && !/vehicles_plate_rules|violates/.test(staffWords(plateRaw)), staffWords(plateRaw));
check("a duplicate plate → plain words", staffWords('duplicate key value violates unique constraint "vehicles_active_plate_idx"') === "A car with this plate already exists.");
check("a company with no name → plain words", /company name/.test(staffWords('new row for relation "customers" violates check constraint "customers_company_name_required"')));

// Anything else from the database: the ONE shared sentence.
for (const raw of [
  'invalid input syntax for type uuid: "pay:abc"',
  'null value in column "cost_aed" of relation "invoice_lines" violates not-null constraint',
  'insert or update on table "vehicles" violates foreign key constraint "vehicles_customer_id_fkey"',
  "column qr_links.id does not exist",
  "Could not find the 'old_plates' column of 'vehicles' in the schema cache",
  "JSON object requested, multiple (or no) rows returned",
  'value too long for type character varying(20)',
]) check(`raw → shared sentence: ${raw.slice(0, 50)}…`, staffWords(raw) === SAVE_FAILED_WORDS, staffWords(raw));
check("no permission → ask the owner", /not allowed/.test(staffWords("new row violates row-level security policy for table \"jobs\"")));
check("a time-out → try again (nothing recorded)", /didn't answer in time/.test(staffWords("canceling statement due to statement timeout")));

// Our own words keep their part; only the raw part is replaced.
const ours = "Saved, but the login email could not be changed: duplicate key value violates unique constraint \"users_email_key\"";
check('"Saved, but …" stays true (never "nothing was recorded")', staffWords(ours).startsWith("Saved, but the login email could not be changed – ") && !/nothing was recorded|violates/.test(staffWords(ours)), staffWords(ours));
check("Could not save the order lines: <raw> → our sentence + behind the scenes", staffWords('Could not save the order lines: insert or update on table "x" violates foreign key constraint "y"') === `Could not save the order lines – ${BEHIND_THE_SCENES}.`);
check("inside a sentence: the detail words", staffDetail("column qr_links.id does not exist") === BEHIND_THE_SCENES && staffDetail(plateRaw).startsWith("The plate didn't save"));

// Plain words pass through untouched (our sentences never carry database signatures).
for (const plain of [
  "Type the car’s number plate, or tick \"Genuinely no plate\" and pick why.",
  "This plate is already on DUBAI GG 44444 · AUDI A8. Gate THAT car in instead.",
  "Could not save the customer.",
  "This job does not exist any more.",
  "A login with that email already exists.",
  "Password should be at least 8 characters.",
  "",
]) check(`plain passes through: "${plain.slice(0, 40)}"`, staffWords(plain) === plain && !isRawDbText(plain));
check("knownDbWords: null for an unknown text", knownDbWords("Could not save.") === null);

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
process.exit(failed ? 1 : 0);
