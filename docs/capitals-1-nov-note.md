# CAPITALS saved in the text (1 November 2026, B1, Q-00039 / J-00969)

## The cause

Capitals were only a screen style (CSS). The text was saved as typed, and since the document rework of 31 October the PDF prints descriptions as saved. So Q-00039's PDF showed "night sky edition - painting of relative chrome parts" in small letters.

## What changed

- **Saved in capitals.** Every line staff type is SAVED in capitals: labour, services, parts, other charges, packages, the note on a line, and the note to the customer.
  - Live now: the quotation and estimate editor, part lines from the parts desk, and invoice lines made from a quotation.
  - After "apply", the database also raises every other way a line can be made (copies into a new version, lines filled in from the inspection, estimates carried over at gate-in, packages, work-order lines, customer requests, services and parts-list names).
- **A part's one name on every document:** "HEADLIGHT – FRONT LEFT · GENUINE". The side is added only when the name does not already say it, so "FRONT LH LIGHT" never gets "FRONT LEFT" a second time, and there is no separate side line under a part. The invoice uses the same name.
- **One legal name: "O F J AUTOMOTIVE WORKS L.L.C"** everywhere, held together so it never breaks over two lines:
  - the document header;
  - the bank details (the account name line now prints the legal name, on its own line);
  - the customer pages;
  - the link preview.
- **Test:** the PDF check compares the saved line text with what the PDF prints, capitals included (`npm run test:capitals`, 15 checks). The document layout test (`npm run test:docs`, 50 checks) still passes.

## Existing text (converted by the migration, letter case only, each change in the change log)

Counted on live, read-only, on 1 November 2026:

| What | Lines |
|---|---|
| Quotation and estimate lines (approved ones too) | 266 |
| Proforma lines | 34 |
| Services list names | 196 |
| Parts list names | 166 |
| Job card work lines | 15 |
| Customer requests | 38 |

Issued tax invoices (12 lines in small letters) and credit notes stay exactly as issued.

## Database (WAITING FOR APPLY)

Migration `20261202140000_capitals.sql` does three things:

- adds the capitals trigger to quotation lines, the note to the customer, new invoice lines, work lines, customer requests, services and the parts list;
- lets the quotation locks pass a change of letter case and nothing else;
- converts the existing text listed above.

Until it is applied, new lines typed in the editor are already saved in capitals, but Q-00039's existing lines stay in small letters on its PDF.

Spelling is the separate "spell check while typing" task.
