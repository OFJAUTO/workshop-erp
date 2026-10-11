# Rework: inspection, parts list and quotation, 11 October 2026 (morning list)

Your message stopped at "A7": everything from A7 onwards did not reach me. Built here: the main rule, and A1 to A6. No migration was needed. Tested with a new browser test that walks one car through the whole path and checks who is told at every hand-over (kept in the repository under `tests/`, see below), plus the two earlier suites.

## The main rule

- The quotation builder is now two plain lists: **Labour and services** (the advisor's own list: Add service, + Labour, Ask Parts for a part) and **Parts** (the parts list from the approved report, priced by Parts, the advisor sets the markup), then Other charges. The request headings, the BAD/AVG/GOOD badges, the "findings from the report not quoted" list, "Add to quotation" and "Not quoting this" are gone.
- Starting a quotation no longer pre-fills labour lines from the report. The parts requests the technician wrote on the report still go to Parts at approval and arrive on the quotation as the parts list.
- QC no longer lists the customer's requests as checklist items. The QC list is the work done (the labour list), the parts fitted, and the general checks from Settings.
- Findings stay where they belong: the technician's report, the manager's review, the customer's report page and PDF.

## A. Bugs

- **A1 Car picture.** The first item of the photo checklist (PC, tablet and the phone link) is a crop tool again: a frame in the dashboard tile's shape (16:10), pinch and drag on a phone, slider and drag on a PC, "Fit whole photo", "Use photo". Tapping the finished item reopens the crop with the current picture; its label reads "Done. Tap to replace." Nothing of it sits inside a form, so the old slider-value save error cannot come back.
- **A2 Notifications.** The data shows the manager (Mert) was told both times a car waited for a technician (10 October 05:14 and 11 October 05:40). What I changed anyway: every hand-over notification is now locked on (nobody can switch it off in their preferences), the overdue reminder for an unassigned car now goes to the department's manager as well as to you, and the new test `npm run test:notify` walks a car through all sixteen hand-overs and fails if the right person is not told. It is kept for future builds.
- **A3 View as and Act as per tab.** The mode now belongs to one browser tab: a second tab shows your own screens, closing the tab ends it, and switching between tabs switches the mode with it. The bar across the top is amber for viewing and red for acting, with Exit; the browser tab's title starts with "Viewing as …" or "Acting as …"; the bell in that tab shows that person's notifications.
- **A4 Tyres.** Each tyre has a Brand box. "Same as front left" copies the year, the brand and the tread, and for a rear wheel the size too. "Same as front" on the sizes stays.
- **A5 One tap.** "Submit to workshop manager" answers at once ("Submitting…"), saves everything typed so far before the server checks the report, and shows the server's answer in red next to the button if something is missing. The cause of the two taps: the last change was still saving when the first tap arrived, so the server saw an incomplete report and answered into a hidden box. Across the system, every submit button now dims, pulses and shows "…" the moment it is tapped (the ones that already say "Saving…" keep their word).
- **A6 Quantity.** Per-unit fixed-price services have − and + on the row.

## Found and fixed on the way

- The Parts page of a job in planning (after the customer approved) crashed with an error page, because a helper on the page was used before it was declared. The new hand-over test found it at step 9; fixed.
- The hand-over test walks: job card approved (advisor and manager told), assigned with a road test (technician and QC inspector), road test done (technician), report submitted (manager), report approved (advisor and Parts), parts priced (advisor), quotation approved by the customer (advisor, manager, Parts), parts planned (manager), released to the workshop (advisor and technician), handover (technician), job finished (manager), work confirmed (QC inspector and advisor), QC passed (advisor, you and the manager), ready with the proforma (advisor), paid with the tax invoice (advisor and accounts), gated out (you). All 46 checks pass.

## Tests kept in the repository

`tests/browser/`: `test-notify.mjs` (the hand-over walk), `test-a.mjs` (first-day fixes), `test-b.mjs` (overnight build), with `npm run test:notify`, `test:day1`, `test:overnight` and `test:cleanup`. `tests/README.md` says how to run them. They need the local server (`npx next dev -p 3100`) and the test secret in `.env.local`.

## Assumptions

- The main rule was applied as written: ratings, requests and findings were removed from the quotation builder and from QC. The Parts desk keeps the part request's label and the technician's words, because that is the parts list itself.
- Nothing from A7 onwards was built, because it did not arrive.
- Test runs use real document numbers (a proforma and a tax invoice per walk). The clean-up removes the documents, but the counters move on, as they always did during testing; your Clear test data button restarts them before go-live.
- The two earlier suites were kept and brought in line with the new rule (the quotation checks now expect no request headings and no findings list): the overnight suite passes 66 of 66, the first-day suite passes every check.

## Waiting for you

- The rest of the list, from A7.
