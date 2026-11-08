# Send LPO for selected parts – 8 November 2026 (Section 3, Peter)

## What changed

- The parts page's **Approved parts** card now lists every approved part still to order with a **tick box**.
  "Select all approved" and "Only <supplier>" are shortcuts. **Send LPO for selected (n)** opens a preview per
  supplier (parts and AED incl. VAT by THE supplier VAT rule), then **Send for approval**. The rest stay
  "Approved – to order" for a later LPO. The answer shows next to the button.
- **Only eligible lines can be ticked**: approved, finished (price, supplier, part number or "No part number", a
  tyre's size and brand), on no LPO, not from stock, not received, not removed, no cost under AED 5 (the 2 Nov
  "Real price?" rule is reused), no repeated part number. Every other line says why; the blocking ones in red.
- **Repeated part numbers**: the same number on different parts of one job (1234AA on the air filter and the
  battery) is red on the tick list AND on the parts table, and cannot go on an LPO until fixed or set to
  "No part number". The same part split left/right is never a repeat. Rule: `src/lib/lpo-select.ts`.
- **"Approved – to order" never shows on a line that cannot be ordered**: it reads "Approved – cannot order yet".
- The card says **"x of y approved parts on an LPO"**; the step bar says "Waiting for the owner or accounts · 3 of 8
  parts on LPO" or "3 of 8 parts on LPO – send the rest", and the approval step is only green when nothing is left.
- With an LPO already waiting for approval, the ticked parts **join it** ("Add selected to LPO-…"): one request at a
  time.
- Since the desk decides now, nothing is put on an LPO by itself any more on a job whose LPOs are made from ticked
  parts (`addPartsToOpenLpo` skips them; older LPOs keep the old behaviour).
- The server checks the ticks again with the same rule (`lpoSelectRows` in `src/lib/lpo-select-data.ts`,
  `sendSelectedLpo` in `parts/lpo-actions.ts`).

## Assumptions

- The ticks are in the Approved parts card (the pricing table's own ticks stay for pricing actions: bulk delete and
  "Set for n ticked").
- Estimates turned into jobs use the same job parts page, so they get the same flow.

## Item 7 – live, read-only (8 November 2026)

Nothing was changed. The bells to the parts desk are on WAITING FOR APPLY
(`supabase/data-fixes/2026-11-08-lpo-check-bells.sql`).

| Job | Problem | Note |
|---|---|---|
| J-00990 | Part number 124AA on AIR FILTER and DRIVE BELT | both on LPO-00062, waiting for approval |
| J-00016 | 30 parts at AED 1.00 from "OFJ Additional" | not approved yet |
| J-00343 | WINDSHIELD MOULDING STRIP at AED 1.00 | not approved yet |
| J-00017 | B11137578304 / B11137578305 each on two different gaskets | already received (history, no bell) |
| J-00975 | A2203570191 on the inner and outer axle boots | already received |
| J-00981 | 123AA on the windshield and the glass moulding | already received |
| J-00986 | 1234 on the door latch actuator and the tailgate latch | already received |

- No approved line is unfinished on an open job right now.
- J-00989's BMS MODULE (AED 1.00) was already removed from the job, so it is not on the list.

## Proof

- `tests/browser/shots/sim/w1-lpo-select-repeated.png` (ticks, red repeated part numbers)
- `tests/browser/shots/sim/w2-lpo-select-preview.png` (the preview per supplier)
- `npm run test:sim` path w: 10 of 10. Unit test `tests/unit/lpo-select.test.mjs`.
