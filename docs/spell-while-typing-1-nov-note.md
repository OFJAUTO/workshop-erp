# Spell check while typing (1 November 2026)

## What staff see

- In every box where words are typed (quotation lines, notes, remarks, reasons, messages), a word the dictionary does not know gets a **red dotted underline** a moment after typing stops.
- **Tapping the word** opens a small box under the text with:
  - the suggestions, in the same capitals ("ADN" offers "AND");
  - **Ignore** (for this page);
  - for the owner and the service advisors only, **Add to dictionary**. The word is then never underlined again, for anyone.
- Keyboard mash ("WDWDWDW") says "looks like random typing" and offers **Remove it**.
- **Nothing is ever blocked.** Sending no longer asks about spelling: the "Check the spelling before sending" panel is gone from the send window.

## Never underlined

- **The shared dictionary.** These are read from the database every five minutes:
  - customer, contact, staff and supplier names;
  - every make and model;
  - the parts list and the services;
  - tyre brands and models, premium brands, recovery companies;
  - the known words and the words added with "Add to dictionary" (Settings > Workshop dictionary).
- **Built-in workshop words and abbreviations:** PPF, TPMS, ECU, ODIS, R1234yf, stabiliser, wishbone and so on. A short word in capitals inside normal text counts as an abbreviation.
- **Boxes that are never checked:**
  - names, phones, emails, plates, VINs;
  - part numbers, addresses, amounts, prices, quantities;
  - references, codes, auth codes, cheque numbers, TRNs, links;
  - search boxes;
  - the customer's own name on the approval page.
- **Arabic** is never checked.

The browser's own red underline is switched off in these boxes, because it does not know the workshop's words. The phone keyboard's autocorrect and sentence capitals stay on.

## How it works

- **One component** (`SpellHost`) sits on every staff page. It watches the box being typed in and draws the underline on a see-through layer exactly over the box.
- **The rules** (`src/lib/spell.ts`): the British and American dictionaries plus the shared dictionary, asked through `/api/spell`.
- **Adding a word:** `/api/spell/fix` (the owner and the service advisors).

## Proof

`npm run test:spell5` on the test database, screenshots in `tests/browser/shots/spell/`:
- "ADN" is underlined in a quotation line, and the tap offers "AND", which replaces it;
- the names line (customer, staff member, supplier, make, model, TPMS, ECU) has nothing underlined;
- a new word is added to the dictionary and is then accepted for the owner too;
- the new-customer form checks none of its name, phone, email, TRN, address, plate or VIN boxes;
- the send window opens with no spelling question.

## Database

No migration.
