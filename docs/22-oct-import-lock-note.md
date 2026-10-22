# Parts import fix and safety lock (22 October 2026)

## What went wrong
The Autovivo Spare Parts quotation Q-2206129 (Lamborghini Urus, VIN ZPBEC3ZL2RLA32299) prints
"Sl No. | Part No. | Description | Qty | Price | Total" with the Part No. column empty on every line. The PDF reader
took the cells left to right, so every value slid one column: qty "1.00" became the name, the price the quantity,
the description the part number, the total the net each (BUMPER CARRIER 4,350 × 4,350 = AED 18,922,500; cost bar
AED 6,857,262,976). A later screenshot import put the line numbers 1 to 20 into the part number.

## The fix
- **Columns by their headings.** `src/lib/pdf-cells.ts` keeps each PDF cell's left and right edge;
  `alignRowsToHeadings` in `src/lib/price-import.ts` finds the heading row and puts every cell under the heading
  it sits beneath. The real column edges are learnt from the data (descriptions share a left edge, numbers a right
  edge), so a short word like PROTECTION never slips into the empty Part No. column. An empty column stays empty.
  If qty × price ≠ total as placed, the figures are read again from the right.
- **"Sl No."** is its own column type (`serial`, also "Line no." on the mapping screen), never a part number; a
  part-number column holding only 1, 2, 3… is cleared (`finishLines`); the screenshot reader is told the same.
- **Every line is checked** (`lineChecks`): red when qty × price ≠ total (±0.01); amber when qty is over 50 or a line
  is over AED 500,000. A missing quantity is worked out from total ÷ price when it divides exactly.
- **Supplier charges.** A priced line that is not a part (courier, freight, shipping, handling, customs… or a priced
  line without a Sl No. in a numbered table) is kept apart: table `supplier_charges` (migration
  `20261116090000_supplier_charges.sql`), `src/lib/supplier-charges.ts`. It goes on the supplier's LPO as an
  "Other charge" (the main LPO when raised, the supplier's own LPO at approval; the LPO total, card, page and PDF
  include it), counts as an internal cost (Parts cost bar, the quotation's internal box, the profit, the target,
  the low-profit check) and never reaches the customer. The Parts page lists it under "Supplier charges" with
  Remove (until it is on an LPO). "Undo last import" removes it too.
- **Totals.** "Total + VAT = Net Total" is worked out by arithmetic, whatever the labels say; a total written as
  one text ("Net Amount: 2,518.00") is read; priced lines already above the supplier's total count as a mismatch.
- **The safety lock** (`importLock`, the same rule on the screen and again on the server in `applyImport`): Apply
  is locked when the lines do not add up to the supplier's total ("Lines add up to AED 6.9 bn but the PDF total is
  AED 255,394 – check the red lines"), or when a red or amber line is not skipped or ticked "Checked against the
  PDF". A wrong supplier total can be passed only with a typed reason, written in the job history and on the import
  (`price_imports.totals_override/totals_sum_aed/totals_expected_aed`). Applies to PDF, screenshot, paste and file.
- **Supplier pre-filled** from the company name in the PDF (`companyInText`, `supplierMatches`): "AUTOVIVO SPARE
  PARTS LLC" = "Auto Vivo Italian Luxury Car Parts" on our list.
- A part number that is only a line number is cleared when the supplier's paper leaves it blank.

## J-00016 (Dubai C 877)
The broken PDF lines had already been deleted on the Parts page. The 20 rows from the screenshot import (part
numbers "1" to "20") were updated in place by a fresh import of this PDF (their availability, 20 days, kept; the
wrong part numbers cleared) and lines 21 to 62 were added: 62 parts = AED 247,894.00, plus COURIER CHARGE AED
7,500.00 as a supplier charge; Our cost AED 255,394.00 + VAT 12,769.70 = 268,163.70. Done as Omar through the
import screen; the job history says so. The rows say "No part number" until Parts types them, and the remaining
42 lines also need their availability; each part joins the draft quotation Q-00001 once its row is complete.

## Tests
- `npm run test:import` (no server): every supplier PDF is a permanent check - Mercedes Deira (17 lines),
  Autovivo Q-2206129 (62 parts + courier, every line compared, totals 255,394.00 / 12,769.70 / 268,163.70, the old
  broken reading blocked), the Al Tayer style sample, and the lock's rules. 63 checks.
- `npm run test:importlock` (dev server): the PDF through the real screens, Apply, the courier on the main and the
  supplier LPO and in the LPO PDF, and the lock on the broken reading. 30 checks. Screenshots in
  `tests/browser/shots/import-*.png`.
- The fixture `tests/fixtures/supplier-autovivo-q2206129.pdf` is rebuilt in the supplier's layout from the values
  the importer read out of the owner's PDF (`make-supplier-autovivo.mjs`, data in `...expected.json`): the original
  file was sent as a picture only. Copy the original PDF over it under the same name and the tests use it.
