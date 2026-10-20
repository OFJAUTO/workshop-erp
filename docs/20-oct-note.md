# 20 October 2026 - the full batch (staff testing day 2)

Ten sections, one push per section. Migrations: `20261110090000_autel_scan_links.sql`,
`20261110120000_bodyshop_packages.sql`, `20261110150000_bodyshop_costing.sql`,
`20261110170000_aftercare_checks.sql`. New test: `npm run test:import` (25 checks); `test:preview`
grew to 37.

1. **WhatsApp previews.** Outside tests as Meta's robots showed production already answered 200 + og
   tags (no firewall change needed). The real gaps: bare links without https:// (WhatsApp Web skips
   previews on those) and a 300 px image. `shortFor` now returns the full https address, the preview
   carries og:url + a fresh 600×600 logo (`public/og/ofj-square-600.png` - new URL so Meta's cache
   cannot serve the old one) and every short route exports HEAD. Old links stay cached by WhatsApp for
   days; test with a brand-new one.
2. **Autel scan links.** An email from autel.com/auteltech.com with a report link has the report fetched
   at once (`src/lib/autel.ts`: every redirect hop must stay on their domains, 20 s cap, 35 MB cap; a
   page is kept after one look inside for the real PDF). VIN read from subject/body/FILE NAME/PDF;
   `inbound_scans.source_url/report_id/car_hint`; unmatched scans show "Looks like 2011 Porsche" one-tap
   suggestions; the owner's "Treat as a scan report" button on Other emails re-runs an email.
3. **Dealer PDF import.** `parseDealerBlocks` (price-import) + `readPdfPositionedLines` (pdf-read) read
   block layouts by position: hyphen-wrapped names joined, the part number its own field, net each from
   the Net price row, sum÷qty checked per line (amber flag), header VIN warns on a different car,
   totals must match "Total net price" (✓ shown), the branch/customer id pre-fills the supplier and the
   chosen supplier is remembered per customer id (`import_supplier_memory`). Fixture
   `tests/fixtures/supplier-mercedes-deira.pdf`; the OCR prompt flattens the same blocks.
4. **Brakes.** One checklist section (front discs, front pads, rear discs, rear pads, brake fluid,
   handbrake, then the rest; "Wheels and brakes" → "Wheels and tyres";
   `scripts/migrate-brakes-20-oct.mjs`). Pads = items with mm chips (2-10 + manual) writing the
   pad_front/pad_rear measurements, auto rating (≤3 Bad, <6 Average, ≥6 Good -
   `inspection_limits.pads_bad_max/pads_good_min`, editable), auto remark "3 mm – Replace now", a photo
   per axle (`measure.pad_front` media render on the PDF next to the reading), overridable. Old single
   answers copied to both axles, marked migrated.
5. **Labour hours per item.** Chips 0.3-4 h on every Bad/Average item (`inspection_items.labour_hours`),
   "Total labour: X h" with breakdown + one tap to the estimate; startQuotation turns hour-carrying
   items into labour lines (hours + rate pre-filled, Bad = urgent) unless a service covered the item;
   "Merge into another labour line…" joins lines so dismantling is never charged twice; the rate floor
   already existed in the save route.
6. **Full names.** The editor name box is a growing textarea on its own row (money boxes underneath);
   parts names wrap; no "…" anywhere (PDFs already wrapped).
7. **Packages.** Builder at Settings > Packages (seeded OFJ Full Protection Package); "+ Add a package"
   on bodyshop quotes with only-if ticks; ONE price; the include list is snapshotted on the line
   (`quotation_lines.package_key/package_items`) and shows on the quote PDF, proforma and tax invoice
   with warranties, time in workshop and the complimentary lines (`packageDetailsText`).
8. **Costing.** `film_rolls`/`film_usage`; film types in Settings (Gloss 1429/15 m, Matte 1524/15 m);
   rolls at /bodyshop/rolls; metres per car on the bodyshop job page (optional plotter photo); tint by
   roll (estimate = roll/10, corrected on Roll finished); waste allowance check tells the owner;
   consumables monthly ÷ cars; labour per SECTION at the bodyshop rate; the owner's REAL PROFIT card;
   the monthly report's hours-per-section/materials table; `package_cost_history` at closeJob feeds the
   advisor's no-numbers yellow/red price warning.
9. **Complimentary trips.** Package approval creates the pick-up and delivery trips (our truck, saved
   driver, "Complimentary (package)"); the advisor fills pin and date; costs still count.
10. **After-care.** Gate-out of a package job books the 10-day check (visit + `aftercare_checks`); day-8
    cron reminder with the ready message (`whatsapp_aftercare_template`); the leader's PIN sign-off on
    the job card (lifting edges / bubbles / dust + note); overdue = red "10-day check not done" badge.

Lessons: turbopack keeps STALE lib modules after appending exports (delete .next, restart - three times
today); Playwright fill() can miss React-19 controlled inputs (type with pressSequentially);
`part_requests` inserts need source_type AND source_key; settings.upsert needs the label column;
react-pdf line details render \n as line breaks, so one details string carries a package's whole list.
