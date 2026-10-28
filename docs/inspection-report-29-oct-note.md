# The inspection report grouped by part (29 October 2026, section 8)

The customer's report link, its PDF and the staff preview on the inspection page now come from ONE layout, so they always say the same thing in the same order. Every report, old or new, is drawn this way; nothing in the stored reports changed.

## The order

1. The header and three boxes: **Vehicle** (car, plate, mileage, VIN), **Customer**, **Inspected** (date, job card, approved).
2. **Needs attention · n**: one line per finding, the worst first, each with its status chip, the item in bold, the short reason and the part's name on the right. Top right: "✓ 67 items checked and passed (last page)". Nothing wrong: a green **NO ISSUES FOUND**.
   - Order: Dangerous and Replace now (red) → Bad, Required, Empty, battery Replace (black) → Average, Low, Service due, Replace soon, Old tyre, battery Weak (amber).
   - Anything dangerous adds the red DANGEROUS TO DRIVE band with the safety text from Settings.
3. **Note from the workshop**, only when the manager wrote one.
4. One block per part, always in this order: **BRAKES → TYRES → BATTERY**, then every other system that has a finding, a measurement or a photo, in checklist order, then ROAD TEST and BODY. Each block has its title, one chip (the worst status, or ALL GOOD), its numbers, its findings, and its photos and videos underneath.
   - BRAKES: Front and Rear rows with the pads in mm and the discs ("26.5 mm · minimum 25 mm · Close to minimum"), the status; the brake fluid line.
   - TYRES: the tyre size line; Front left, Front right, Rear left, Rear right, Spare with Tread · Made · Condition · Status.
   - BATTERY: voltage, the test result, and the CCA when entered.
   - AIR CONDITIONING: the vent temperature.
5. **Checked and passed · n**, always last: three columns on a computer and in the PDF, one on a phone, a green tick per line. Only plain OK items with no measurement, photo or note; items already shown in a block's numbers (pads, discs, brake fluid) are not repeated.

Red is used only for Dangerous and Replace now. Status names are unchanged. Empty fields are left out, so older reports without disc thickness or CCA stay clean. No prices, part numbers added by the system, staff names or internal notes (a part number a technician typed into a remark is shown as typed).

## New settings and boxes

- Settings > Inspection: **Warn on tyres older than (years)**, default 5. An older tyre gets the amber OLD TYRE chip, "Good, but 10 years old" and an advisory line in Needs attention.
- The technician's form: **Battery CCA (optional)** under Battery test. The disc thickness and minimum boxes already existed.

## The PDF

- Pages: "Page X of Y" on every page.
- A block up to about half a page is never split: it moves whole to the next page.
- A longer block (many photos) continues on the next page only between findings or rows of photos. Its title, numbers and first finding always stay together, so no title sits alone at the foot of a page and no page is left half empty.
- When the last page would be nearly empty (under a fifth full), the report is drawn again slightly tighter. The tighter version is kept only if it really ends a page earlier.
- Up to four photos per place in the PDF, then "+n more photos on the online report". Every video is a picture card with "Watch video" linking to that video on the customer's page.
- J-00655: 6 pages (was 7 in the first draft). J-00016: 9 pages (was 12).

## Photos on the link

Every photo and video opens the section 7 viewer. Swiping goes through all of them in page order: all of one part, then on to the next.

## Proof

- `npm run test:report8`: 37 checks.
  - A test report with known answers, on a phone and as a PDF.
  - J-00655 on a phone (photo full screen, zoomed, swiped; video playing) and on a tablet.
  - J-00016 (the oldest report) on a phone and as a PDF.
  - The staff preview.
- Pictures are in `tests/browser/shots/report8/`.
