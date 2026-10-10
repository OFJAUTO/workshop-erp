# Morning note, 10 October 2026

Three things, done in order: the document design, the clear-out of every test record, and the invoice screen without options.

## 1. Document design

The files were at the root of the project, not in `docs/`; they are now `docs/ofj-invoice-design.html` and `docs/ofj-logo.svg`. The logo file is used as it is: `public/logo.svg` on every customer page and in the PDFs (drawn sharp from the SVG at print size). The document font is the same Plus Jakarta Sans as the screens, bundled in `public/fonts` (SIL Open Font License).

Every customer page and every PDF (tax invoice, proforma, credit note, receipt, quotation, estimate, inspection report, purchase order) now follows the design: white header with the logo on the left, the legal name and address beside the large TRN over a thick rule; the title with its numbers; the "Billed to" and "Vehicle" boxes; the Services and Spare parts tables with the section name in the header row, VAT and Total columns, the discount row in bold inside the table and a pale subtotal row; amount in words, payments received and the bank transfer lines on the left with the totals, "Total AED" on a thick rule, Paid, and the outlined Balance due box on the right; the footer row (prepared by, computer generated, terms, page) with the QR code and "Scan to view this invoice online"; the contact row with Tel, Web and Email. The invoice, receipt and quotation PDFs were rendered and checked against the design.

## 2. Test data cleared

**Backup, before anything was deleted:** `backups/2026-10-10T04-00-00` in the project folder (62 tables, 4,999 rows, one JSON file per table, plus `_settings-readable.json` and `_storage-objects.json`, the list of the 167 files that were in storage). The clear-out also saved a second copy of every table in the private storage bucket `backups` (folders `2026-10-10T04-22-19` and `2026-10-10T04-24-49`).

**To restore the backup** (only if ever needed): open a terminal in the project folder and run

```bash
node --env-file=.env.local scripts/db-restore.mjs backups/2026-10-10T04-00-00
```

It empties the tables in the folder, puts the rows back and sets the numbering after the highest number restored. Photos, videos and PDFs in storage are not in a backup; the 316 MB of test videos are gone for good.

**Deleted (rows):** jobs 17, gate-ins 17, gate-in media 139, job requests 38, job events 214, approvals 15, inspections 5 with 372 items, 12 findings, 8 media files and 1 change request, road tests 3, report links 3, quotations 5 with 50 lines and 21 events, part requests 17, part items 18, work lines 5, work sessions 2, QC rounds 1, washes 2, invoices 2 with 19 lines, receipts 3, gate-outs 2, bookings 3, shifts 2, upload links 286, notifications 182, vehicle photos 1, job files 1, vehicles 18, customers 25. **Files:** 139 gate-in videos and photos, 8 inspection photos, 1 job file, 19 car pictures (167 in all). Stock quantities set to zero (no stock items existed). No purchase orders, handovers, pauses, comebacks, scans or supplier invoices existed.

**Kept:** 12 staff accounts with their PINs, login methods and photos, 2 registered devices, all 111 settings, the inspection checklist, ready-made jobs, services (79 in 11 categories), suppliers, makes and models, and the system's own change log (3,231 entries, including the record of this clear-out).

**Numbering:** the next ones are C-00001, J-00001, Q-00001, E-00001, PO-00001, INV-00001, PRO-00001, CN-00001 and RCT-00001.

**Checks afterwards:** every list and tile (dashboard, jobs, assign, calendar, gate-in, parts, purchase orders, stock, QC, wash, invoices, profit, attendance, estimates, customers, cars, scoreboard, comebacks, pause log, scans, notifications, settings, team, workshop list, road tests, overrides, change log, wash board) loads clean with no error and no leftover count. A check car was gated in through the same path as the gate-in screen: it got C-00001 and J-00001, its job card and the dashboard showed it, and it was removed again.

**One thing to redo:** at 08:24 this morning someone gated in a Ferrari California on the live site, while the clear-out was still running; the second clear removed it with the check car. Gate it in again. Its model "CALIFORNIA" stayed in the makes and models list, marked for review.

**The button:** Settings now has "Testing phase: clear test data" (owner only, from the owner's own login). It makes the storage backup first, needs the words CLEAR TEST DATA typed, and shows what it deleted next to the button. The "Testing phase" switch in the Workshop floor card hides the button at go-live.

## 3. Invoice screen

The Options card is gone. The invoice is a straight copy of the approved quotation: the same lines, labour itemised per job, the same discount, the same rounded total (the VAT line takes the rounding, shown as "Rounding, as quoted"). Accounts press "Issue the tax invoice" and nothing else. Consumables, if charged, are a line in Other charges on the quotation.

"Attend to: tyre vibration" under Spare parts on J-00017: that line was created as a part line by an old version of the quotation builder (a request line turned into a "part" with a cost typed by the advisor, no part from Parts behind it) and the invoice put every line with a cost under Spare parts. Now a line goes under Spare parts only when it is a part the Parts desk entered (a part item with a name and a type); anything else is a service. The builder already refuses new part lines typed by the advisor on a quotation; a quotation with such a line can no longer be sent ("not a part from the Parts desk; use Ask Parts for a part").

## Assumptions

- The design file is for the tax invoice; the quotation, estimate, receipt, report and purchase order follow the same frame (header, boxes, tables, totals, footer) with their own titles and columns.
- A quotation that was sent before rounding existed keeps its exact total on the invoice.
- The media files were not downloaded before deletion: the owner said every record was a test, and the gate-in videos alone were 316 MB.
- The change log keeps the entries about deleted jobs; it is the system's own record and the owner asked to keep it.
