# Time spent on a car + "Customer declined all work" – 29 October 2026 (batch 2, section 2)

## Time spent on this car (job card: owner, advisors, accounts)

ONE calculation, `src/lib/time-spent.ts` (`timeSpentFor`), ONE panel, `src/components/TimeSpentPanel.tsx`:

- Gate-in · who filled the form · from starting to finishing the gate-in form.
- Inspection · the technician · the inspection's own clock (`elapsed_minutes`, else started → submitted).
- Road test · the tester · started → done. QC · the inspector · started → finished.
- Work · each technician · their work sessions. Bodyshop · each person · their clockings.
- Wash · who washed it · "not clocked" (the wash has no start time).
- A step that happened without a clock reads "not clocked" in amber, never 0.
- Total clocked, its cost at the labour cost per hour (Settings, by department, AED 50 today) and its worth at the
  selling labour rate (Settings, AED 350 today).
- Car in the workshop: gate-in → now (or gate-out), clocked kept apart from waiting.
- Advisors' and Parts' time is not clocked and is left out (said under the total).

## [Customer declined all work] (job card and quotation, owner + advisors)

`src/lib/declined.ts` `declineAllWork`, button `src/components/DeclinedAllButton.tsx` (one centre window; the answer
shows in it):

- "Charge the inspection fee of AED 750 agreed at gate-in?" - pre-filled from the fee locked at gate-in. Another amount
  (or 0) needs the owner, or a reason from an advisor; the change is written to the job's history.
- The quotations are marked declined; every line stays in the quotation history.
- The invoice: ONE line "INSPECTION CHARGES" + VAT. Its cost is the real clocked time from the panel above, booked as
  LABOUR by `src/lib/profit.ts` (a declined car, or an invoice that is only INSPECTION CHARGES - the manual way of
  revising the quotation - ignores any typed "our cost"). Profit, the profit page, the target, the advisor bonus and
  the reports read it from there.
- The car goes to Ready to collect; the normal invoice and payment-link flow follows.
- No fee agreed at gate-in: no invoice; the time and the declined work are still saved.
- Fixed on the way: the one-line charge invoice (and the deposit invoice) sent an empty cost into a required column,
  so the invoice was saved WITHOUT its line. Both now save the line, and a failed line cancels the invoice and says
  so. No live invoice was affected (checked: none without lines).

## Declined work saved for later

- Every finding from the inspection report (worst first) and every quoted line no finding covers is saved on the car
  as DECLINED WORK with its status: Replace now (dangerous / replace now), Replace (bad / required), Advisory.
  Migration `20261129100000_declined_work_followup.sql`: `declined_work.severity`, `follow_up_due_at`,
  `followed_up_at/by`, `follow_up_note`, `done_at`; setting `declined_followup_days` (14).
- The customer's invoice (web page and PDF) says "Recommended work declined by the customer:" with each item and its
  status - customer-facing names only, no prices, no part numbers.
- Waiting on you (the car's advisor; cars without an advisor go to every advisor; the owner sees all), after 14 days:
  "Call <customer> about the declined work on <PLATE> (A/C compressor, …)", with Open and "Called ✓" on the row.
- When the car comes back: the gate-in form (owner and advisors) and the quotation screen ("Declined on earlier
  visits") list it with its status. The gate-in role's own screen keeps the 23 October rule (no earlier visits).

## Declined cars report (owner)

`/reports/declined` (fourth tab of Reports), `src/lib/declined-report.ts`: per month the number of declined cars, their
clocked time, its cost, the inspection fees charged (before VAT), the net and the time's worth at the selling rate,
car by car; and per advisor the inspections approved that month that turned into approved work (%).

## Tests

`npm run test:declined2` (16 checks): the J-00655 panel; a test car - an advisor's other amount without a reason is
refused and nothing is recorded; the owner charges AED 750 → INV with one INSPECTION CHARGES line (AED 750 + VAT 37.50,
no typed cost), the note on the customer's page and PDF, the quotation declined with every line, the declined work
saved with its status and follow-up date, Ready to collect, the report's cost = the clocked cost; the advisor's
follow-up row and "Called ✓". Screenshots and the invoice PDF in `tests/browser/shots/declined2/`.
