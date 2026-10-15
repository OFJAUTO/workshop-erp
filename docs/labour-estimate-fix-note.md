# Labour estimate fix (15 October 2026): the "1,400 h" bug

## What went wrong

On Q-00004 the internal box read "Labour at cost (1400.0 h estimate × AED 90) = AED 126,000" and the profit went to −4,367%.
Each labour line had 350 in the small box labelled "est.", which the internal cost read as estimated hours (4 lines × 350 = 1,400 h).
The change log shows the figures were typed into that box by hand: it was the only other box on the line, the hourly rate was
hidden in the three-dot menu, and "est." read like "estimate of the rate". The customer documents were right throughout; only
the internal cost was wrong.

## What changed

1. **Three labelled boxes on every hour-based labour line.** Hours (quoted to the customer, with "h"), Est. h (our internal
   estimate, a small grey box seen by the owner only, defaulting to the quoted hours) and the rate, labelled AED/h. The "Est. h"
   label sits on the estimate box and never on the rate box. The rate still has its menu entry (Change rate / Raise rate).
2. **Internal labour cost = the Est. h boxes added up × the hourly cost rate** (AED 90 in Settings). Never the rate, never the
   quoted hours. Once the work is clocked, the clocked hours take over as before.
3. **The footer and the internal box use the same numbers:** "Workshop estimate X h · quoted Y h" under the labour card is the
   same X the internal box multiplies. The manager's figure from the inspection approval is added at the end when it differs
   ("at approval the manager put 3 h").
4. **Existing quotes fixed** by migration `20261029090000_fix_labour_estimates.sql`: every active labour line whose estimate
   equalled its rate, was over 50 h, or was more than three times its quoted hours, went back to the quoted hours. One quotation
   was affected: **Q-00004 v1**, four lines (Lower arm replacement 3 h, Upper arm replacement 3 h, Stabiliser bush replacement
   2 h, Stabiliser link replacement 1.5 h). A backup was taken first (`backups/2026-10-15T07-04-55`).
5. **Safety check.** An Est. h over 50 h turns the box and its label amber with the reason on the line ("Check Est. h: 350 is
   not hours (the rate is 350 AED/h). Labour at cost uses the quoted 3.0 h until it is fixed."), and the internal box says
   "Est. h flagged, quoted hours used". Estimates totalling more than three times the quoted hours do the same for the whole
   quotation in the footer. In both cases the quoted hours stand in for the flagged figures, so profit never jumps.
6. **Test** `tests/browser/test-j.mjs` (`npm run test:j`): four lines of 3, 3, 2 and 1.5 h at AED 350 give
   "Labour at cost (9.5 h estimate × AED 90) = AED 855.00"; one estimate changed to 2.5 h gives 9.0 h and AED 810.00; the rate
   typed into Est. h shows the amber warning and the cost keeps the quoted hours; the customer PDF text is identical before and
   after, and the customer link shows the same total and no estimate or cost rate. 18 checks pass; the editor regression suite
   (test-h, 65 checks) still passes.

The rules live in `src/lib/quotes.ts` (`estimateOf`, `estimateLineSuspect`, `ESTIMATE_MAX_LINE_HOURS`, `ESTIMATE_TOTAL_FACTOR`,
and `quoteTotals` returning `labourEstimateEntered`, `estimateSuspectLineIds`, `estimateTotalSuspect`); the boxes in
`QuoteEditor.tsx` (`data-labour-boxes`, `data-estimate`, `data-rate`, `data-estimate-warning`, `data-estimate-footer`,
`data-labour-cost`).

## Assumptions

- A flagged estimate is replaced by the line's quoted hours in the cost (the owner asked for a warning "instead of silently
  using it"; the quoted hours are the safest stand-in and the warning says so).
- The 50 h line limit and the three-times total limit are fixed in the code, not settings.
- Est. h stays visible to the owner only (profit viewers), as before; advisors see Hours and AED/h and the footer line.
- The rate box saves on leaving it; the server still refuses a rate below the standard for anyone but the owner.
- Rows wrap on narrow screens: the name on the first line, the three boxes with the total and menu on the second.
