# Afternoon list of 13 October 2026: delivery note

One migration after a backup (`backups/2026-10-13T14-24-16`): `20261026090000_clear_bulk_import.sql`. Browser test `tests/browser/test-g.mjs` (`npm run test:g`; with `--clear` it also presses Clear test data at the end).

## A. Clear test data

- **Why it failed.** The button backed up every table as one JSON file per table into the backups bucket; the change log (`audit_log`, 28,854 rows, 61 MB on disk because every entry held the whole row before and after) made one file larger than the project's upload limit, and the clear stopped before deleting anything.
- **What fills the change log.** Not keystrokes. Two things: every inspection creates about a hundred checklist rows (11,721 inserts of `inspection_items`), and every autosave of a quotation line or a Parts row writes one entry holding the full row twice (4,146 updates of `quotation_lines`, 1,652 of `quotations`, 835 of `part_items`). The entries were big, not many.
- **Change log slimmed.** `write_audit_log` now stores only the columns that changed (plus the id) on an update, and a run of saves by the same person on the same row within a minute is one entry (the first "before", the latest "after"). Inserts and deletes keep the whole row. Nothing already logged was touched.
- **The clear.** While the testing phase is on, the backup skips the change log (it is kept anyway), reads every other table 1,000 rows at a time and writes gzip-compressed files of at most 2,000 rows each; a table that cannot be saved is reported and the clear goes ahead. The tables to empty are found by following the foreign keys from jobs, cars and customers (so nothing is missed: approvals, inspections, quotations, proformas and invoices, receipts and payments, bookings, part requests and parts, LPOs, imports, scan reports and emails, photos, videos and job files, notifications, clock records, assignments, QR links, battery warranties, payment links, upload failures, quick codes, loose items), minus what stays (staff and PINs, settings, lists, suppliers and their discount log, the parts pool, stock items, makes and models, devices, the change log). Everything is truncated in one database call and the numbering restarts at 00001; then the files of those jobs are removed from storage 100 at a time. Every step can be repeated: a second press carries on where the first stopped.
- **Run.** Done at the end of the test run, with two dummy cars and their photos added first (see the report for the counts before and after).

## B. Import prices: fixes

1. Paste from email reads both forms: tab-separated rows in the Land Rover order (WipNo, Product, Description, Quantity, Unit Price(AED), Total, LineNo, Availability) and one value per line with blank lines between the values (Outlook or Gmail as plain text). Blank lines are ignored everywhere; the heading run gives the number of values per part; with no headings the pattern of numbers and words gives it, and the mapping screen lets Parts change it.
2. Totals at the bottom (Gross Amount, Vat, Net AED, Subtotal, Total, Grand total and the like) are never parts; they feed the cross-check only. Headings and blank lines are ignored.
3. Headings are read by meaning: Product, Part, Part No, Part* → part number; Description, Designation, Name → name; Unit Price, Net Price, Price → price; Quantity, Qty; Availability, Stock, ETA; List Price → list; Total → line total. Price wins over Total.
4. The mapping screen: the first five lines as read, one dropdown above each column (Part number, Name, Qty, Price, Availability, Ignore), filled in by itself from the data (codes with digits, the longest words, small whole numbers, prices with decimals, availability words), changed with one tap, then one Import button. For a one-value-per-line paste with no headings there is a "Values per part" box. The mapping is remembered for the supplier when the import is applied.
5. Mercedes B2BConnect (sheet "Parts"): Net Price is our cost, List Price is kept for reference, Part*, Quantity* and Designation are read. Matching ignores spaces, dashes and dots: "A 167 330 68 00" matches a row saved as "A1673306800".
6. Screenshot import: the reading path was checked with a 19-line Land Rover table (`docs/landrover-screenshot-sample-lines.txt`, the text the reader gets from a picture): every line with its price, the lines adding up to the Gross Amount 17,293.00. The picture itself could not be run: no screenshot file was in the docs folder and the ANTHROPIC_API_KEY is not set.
7. Availability phrases go to the line's availability, never the price: "in stock" or "available" = Same day (ordered today, here today), "1 day-1 psc" = Next day, "2 days" = 2 days, "back order" = a "Back order at the supplier" note with the box left open, "will update" or anything unclear = a "Supplier to confirm" note. The note shows on the row's status line (`part_items.availability_note`).
8. Undo last import: `price_imports` records each import with what every line added or changed (`price_import_lines`, before and after); "Undo last import (n)" above the Parts table takes back exactly that (added parts go, changed parts get their earlier figures back, the quotation lines follow); nothing else on the job moves.
9. Part numbers were checked again on every customer output: the quotation, estimate, proforma, invoice and receipt PDFs, the customer pages, the WhatsApp templates. None carries a part number. They stay on internal screens, the LPO and the supplier list.

## C. Bulk delete on the Parts table

- A tick box on every row and Select all in the heading; "Delete all" (red, left of Show only unpriced) reads "Delete 2 ticked" when rows are ticked. One question ("Delete 12 parts?" with "3 ordered parts are kept" when it applies), no reason, no approval.
- Ticked rows go, or every unordered row of the job when none is ticked. Parts already ordered, received, issued or fitted are kept and counted. Deleted rows vanish at once (inactive under one batch id, off every list and off the quotation); the other rows keep their place.
- "12 parts deleted · Undo" stays for a minute; Undo brings the whole batch back, lines and all.

## Assumptions

- A supplier's "in stock" means the supplier has it, so it is ordered today and here today (Same day), not our own stock.
- "Back order" and "will update" leave the availability box open with a note; the row stays Not finished until Parts set a date.
- Deleted parts are inactive rows with a batch id, never erased (the change log and the no-delete rule stay).
- Rows added on the screen and not yet saved are removed locally by Delete all.
- The mapping is remembered on the supplier when the import is applied with a supplier chosen; the separate save button is gone.
- The change-log trigger merges updates within 60 seconds by the same person on the same row.

## Not done

- The screenshot picture test itself (no picture, no key).
