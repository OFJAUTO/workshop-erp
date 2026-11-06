# Plate can be added – 6 November 2026

**The case.** AL TAMIMI COMPANY LTD (C-00967), Audi A8, was saved without a number plate on its estimate and gated in as J-00985. Adarsh typed DUBAI DD 23864 on Cars → Edit and got the database's own words: `vehicles_plate_rules`.

**The cause, in one line.** The car form's save never wrote the "has a plate" flag. A car created without a plate kept "no plate" even after a plate was typed, and the database's rule refused the mix.

**The fix.** `plateFieldsOf` in `src/lib/plate-rules.ts` is now the ONE place that turns the form into what is stored, flag included. The car form (new car and edit) and the gate-in use it.

## What was built, point by point

1. **Cause** – above. The fix is in the one shared car form and its save.
2. **Add a plate any time.** From three places:
   - Cars → Edit (owner and advisors).
   - The job card: an "Add the number plate" button shows on a car with no plate, and opens Cars → Edit.
   - The gate-in form (everyone who gates a car in, the gate-in person included; on that form only).

   Typing a plate unticks "No number plate" by itself.
3. **Formats.**
   - UAE: the code is 1–2 letters or digits (AA, DD, 1, 16) and the number is 1–5 digits.
   - Other countries and export plates: letters, digits, spaces and dashes, up to 12.

   The database rule allows all of these. It only asks for a number when there is a plate, and an emirate for a UAE plate. Every UAE plate already on record fits.
4. **Gate-in asks.** A car with no plate gets an amber "Number plate" box on the gate-in form. Either type the plate, or tick "Genuinely no plate" and pick why:
   - New car – not registered yet
   - Export plate
   - Trade or test plate
   - Other (with a few words)

   Doing neither is refused in plain words. The plate added, or the reason there is none, goes on the job's history with the person's name.
5. **Changing a plate that is already there** (owner and advisors). A "Why is the plate changing?" box appears and must be filled in.
   - The history keeps the old plate, the new plate, the remark and who.
   - The old plate still finds the same car: in the top search, the Record payment window and Invoices and payments.
   - The edit page lists "Earlier plates of this car".
6. **The same car saved twice.** Saving a plate that is on another record shows: "This plate is on another car record: DUBAI GG 55555 · AUDI A8. Merge the two records? DUBAI GG 55555 · AUDI A8 is kept."
   - **Merge** moves everything from the duplicate to the kept record: jobs, estimates and quotations, invoices, payments, payment reports, bookings, declined work, battery warranties, pending charges, sticker links and photos. These are all 11 tables that point at a car, checked against the database.
   - The duplicate leaves the list (never deleted), with "Merged into … by …".
   - Its plate (and its earlier plates) keep finding the kept car.
   - Two records with different VINs are never merged: "These look like two DIFFERENT cars".
   - At gate-in, a plate already on another car is refused: "Gate THAT car in instead – or ask an advisor to merge the two records first."
7. **The new plate shows everywhere.** Every page reads the car record, so the plate appears at once on the job card, the lists, the search, the money pages and every document not yet issued. Issued tax invoices never change: each prints the car as it was when the invoice was issued (the invoice's own copy of the car). On live, no tax invoice has been issued on any of the five cars below.
8. **No raw database words to staff, anywhere.**
   - ONE rule, `src/lib/db-words.ts`, tells database text from plain words.
   - A known refusal gets its own advice: "The plate didn't save. Untick “No number plate” to save a plate…", "A car with this plate already exists.", "Type the company name…", "You are not allowed to change this here…" or "The database didn't answer in time…".
   - Anything else from the database becomes the one shared sentence: "Couldn't save – nothing was recorded. Try again or tell the owner."
   - When the database text sits inside one of our sentences ("Saved, but the login email could not be changed: …"), our part is kept, so a save that did happen is never called "nothing was recorded".
   - On the server, `dbWords` / `dbDetail` (in `src/lib/app-errors.ts`) do this in 201 places in 70 files, and write the raw text to the log.
   - The owner reads the log at Settings → **Problems behind the scenes** (owner only).
   - The notice box every form answer and page error goes through applies the same rule as a last safety net.
   - These keep the raw words on purpose: Zoho's stored reasons (owner and accounts need them word for word), the mailbox check result, and the browser's upload queue (it reads the text to decide what to do).
9. **The page title** is now "Edit car · AUDI A8 · DUBAI DD 23864", or "Edit car · AUDI A8 · No plate yet".
10. **Live list** of cars with no plate on record that are in the workshop (read-only; nothing about them was changed):

    | Job | Car | Customer | Advisor | Tax invoices |
    |---|---|---|---|---|
    | J-00985 | AUDI A8 | AL TAMIMI COMPANY LTD | Anas | 0 |
    | J-00858 | TOYOTA COROLLA | AL ALI PROPERTY INVESTMENTS LLC | Hamza | 0 |
    | J-00860 | TOYOTA COROLLA | AL ALI PROPERTY INVESTMENTS LLC | Hamza | 0 |
    | J-00972 | MERCEDES-BENZ G63 | SHUKRI ELITE CARS | Hamza | 0 |
    | J-00988 | FERRARI 488 | AMBER | none yet | 0 |

    Each advisor got a bell ("J-… · CAR: no number plate on record") linking to the car's edit page. J-00988 has no advisor yet, so by the app's own rule all three advisors were told.
11. **Tests** – below.

## Tests

- `npm run test:unit`: `plate-rules` (every emirate, letter and number codes, limits, plain refusals, the stored fields, plate change, old-plate entries, titles) and `db-words` (the AL TAMIMI text, the shared sentence, our sentences kept, plain words untouched).
- `npm run test:plate`: the AL TAMIMI case saving DUBAI DD 23864; ABU DHABI 16 94155; a plate change with the remark; the old plate searchable; the duplicate → merge; the gate-in "genuinely no plate" reason; the database refusing, with staff seeing plain words and the owner seeing the raw text.
- `test:sim` path **m**: a car with no plate → the gate-in asks → a duplicate plate refused in plain words with the typing kept → the real plate saved → the job card and the edit title show it.

## Assumptions

- Adding a plate to a car that has none needs no remark; only changing an existing plate does.
- Gate-in staff add a plate on the gate-in form only. Changing a plate and merging stay with the owner and the advisors.
- In a merge, the record kept is the one that already carries the plate.
- The five live cars were not changed (as asked); their advisors add the plates.

## Database

`20261206090000_plate_history.sql`: `vehicles.old_plates` (search text) and `vehicles.merged_into`. Applied on live on 6 November 2026, with the owner's "apply" (backup `backups/2026-11-06T04-25-07`).
