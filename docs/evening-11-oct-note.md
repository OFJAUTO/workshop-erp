# Evening list of 11 October 2026: delivery note

Theme of the evening: screens show too much, so when in doubt, remove. Three rules now hold everywhere: an action appears once on a page; colours mean one thing (black is the next action, light grey the line you are on, light green with a tick is done or selected, amber is waiting, pink or red is an error or Dangerous); no unlabelled boxes and no staff names on customer pages.

Migration `20261022090000_evening_11_oct.sql` (applied; backup `backups/2026-10-11T19-35-51`). The services merge of E6 ran after a second backup (`backups/2026-10-11T20-28-04`).

## A. Customer links

One pattern for all five links (`CustomerFront`): a short first page with the header, the essentials, one big View button that opens the full document (with Download PDF and a way back), the single action, and the contact buttons. No line items, no small print, no footers on the first page.

- A1 approval link: plain header, the requests, the photos, the check-in details folded, one green box with the only Approve. No bar, no "Dear", no Questions line, no terms line, no TEL row, no "computer generated".
- A2 report link: the workshop note, "N items need attention" (dangerous items in red), View report, Call and WhatsApp.
- A3 quotation: full header, the total including VAT large, View quotation, one "Approved" button that asks "Approve this quotation for AED X?" and records the amount approved and whether the full document was opened (`quotations.viewed_full_at`; the job card says "opened the full quotation before approving" or not). No Declined on the customer side: the advisor marks it declined on the quotation page with an optional reason. "See your inspection report" sits inside the full document.
- A4 proforma: the amount due large, View proforma, Pay now, "Bank details" folded.
- A5 tax invoice and receipts: "Paid, thank you", View tax invoice, View receipt per payment.
- A6 money documents: one footer only, TEL, WEB and EMAIL stacked on a phone, TRN in the header only, "computer generated" on the tax invoice only.
- A7 no "Questions? name" anywhere; the VIN appears once.
- A8 rounding: Send rounds the total down to the nearest ten dirhams by itself and shows it to the customer as "Discount (rounding)"; "Round up to AED X instead" is one small link under the Send button. Why J-00147's proforma said "Rounding 8.09": Q-00013 (AED 29,451.50) was sent with the second, white "round up" button, which chose 29,460; the proforma copies the quotation total and showed the difference as "Rounding". Rounding down is now the default, and a downward rounding reads as a discount.
- A9 payment link: `payment_links` keeps every link with who set it and when it was opened. Staff see the link as plain text with "Don't open this link. It works once." and never a clickable link; the page never requests it. Pay now asks first, then opens the link once through `/api/pay/<token>`; the time is recorded, the advisor is told (`payment_link_opened`), the button turns into "Payment link opened at <time>", "Didn't complete the payment?" and WhatsApp; the advisor can replace the link; opening is not payment.

## B. The manager's review

- B1 one-tap notes: green with a tick when their sentence is in the note; tapping again removes the sentence; the green state follows hand edits; the five most used sit in a row, "More notes" opens the rest under the headings of `settings.manager_note_groups` (editor at Settings > Inspection); selected notes stay visible.
- B2 approval needs a note and the tick directly under the parts list ("I have checked the parts list", or "I confirm no parts are needed"); without it the approval refuses and scrolls there; who and when are recorded and the tick clears when the list changes.
- B3 and B4 the decision buttons live in a slim bar fixed to the bottom ("Send back to the technician", "Approve and send to the advisor"), as on the quotation ("Quotation complete", then "Send quotation"), the Parts page ("Pricing done") and the planning step.
- B5 every multi-select set turns light green with a tick when selected (quick remarks, big-job tags, tyre conditions, pickers).
- B6 spell check and auto-correct on every box.

## C. The parts list

- C1 the "Marked Bad" panel beside the technician's list: a tick when a part is listed, amber "No part listed" with "+ Add part" and "No part needed", a "Show Average" switch. Amber never blocks.
- C2 the quantity follows the positions.
- C3 parts sold per set (`part_catalogue.unit = set`: brake pads, brake shoes, wiper blades, spark plugs) ask Front or Rear and count sets: "Brake pads · front · 1 set".
- C4 "added at the end" is gone.

## D. The Parts pricing screen

- D1 header: car, job number, VIN with Copy. Nothing else.
- D2 one table; every row saves itself (600 ms after the last keystroke); Type is one compact control; the three-dot menu holds Add an option, Attach diagram, Ask the workshop manager, Not available, Already covered, Cannot source, Remove.
- D3 row states: being edited light grey with a black left edge, complete light green with a tick, not available amber; "4 of 7 priced" with a bar and "Show only unpriced". The same states and words everywhere a part is shown.
- D4 "Copy list for supplier": car, VIN, the opening line from Settings (`supplier_quote_opening_line`), one line per ticked part with position, quantity and part number; Copy and WhatsApp.
- D5 "Pricing done" in the bar tells the advisor; with parts still unpriced it asks "N parts have no price yet. Send what you have?"; afterwards "Sent to the advisor, <time>". A later price change tells the advisor and flags any quotation already sent (`quotations.parts_price_changed_at`).

## E. The quotation screen

- E1 the report strip: light grey with a black left edge, bold title, counts as small tags, an arrow on the right; the whole bar toggles it and remembers open or closed on the device. The amber "Nothing quoted yet for:" line lists every Bad finding in full. Inside: the customer's requests, the findings with "Quoted" or "+ Add job", the manager's notes.
- E2 lines: one button, "+ Add line"; a new line starts with "Labour" and "Service" and can be switched from its menu while still empty. A labour line has the name box, a small hours box labelled "h", the total and the menu; a service line has the name box, the price box labelled "AED", − and + for the quantity (per-unit services and anything typed by hand), the total and the menu. The name box works two ways: type and matching items from that kind's list appear underneath; or tap the arrow at the end to open that kind's picker. Hand-typed names are accepted and, used repeatedly, are offered in Settings. Settings > Labour jobs and services has two lists, Labour jobs (by hours) and Services (fixed price).
- E3 rows show their name; the hours box is five characters wide; "N of M lines done" counts named lines only; after picking, the cursor goes to the hours or price box; Enter moves to the next box like Tab.
- E4 the position is asked once, in one row of choices, then shows as small grey text after the name; "Change position" in the menu brings the row back.
- E5 the three-dot menu is a small pop-up anchored to the dots that closes on an outside tap: Mark as urgent, Add a note for the customer, Change position (only when the job has one), Change rate (Raise rate for advisors), Owner discount (owner), Remove in red last. Only the one box the chosen item needs opens under the row, with Done. Urgent and the note show as small tags after the name.
- E6 pickers: one line per row (name and how it is priced), no category text, no "Asks" and no "Sends to Parts"; the category column wraps on a phone and scrolls only up and down on a tablet; selected rows turn light green with a tick, with a counter and Done. Duplicates merged, see below.
- E7 parts: nothing about linking is shown or blocks sending; removing a labour line never removes a part; each part has "Leave off" (it stays greyed on the list, counts for nothing, is not ordered) and "Put back"; "+ Add a part" sends preventive items to Parts to price.
- E8 summary: "Internal (not shown to the customer)" on light grey with parts cost, labour at cost (hours × technician cost rate), recovery cost, other internal costs, the bank charge (rate, estimated), total cost, profit before VAT with the margin in colour (green from the good-margin setting, amber below, red when negative), then the labour margin and the parts margin. Owner and advisors.
- E9 the bank charge on the screen is now the rate times the grand total including VAT, computed live. What the old screen used: the stored hidden fee line, which the server had computed at an earlier total (AED 558.82 was 2.26% of AED 24,726.55, the total before later lines were added); the summary read that stored line while the grand total was live. The server still keeps the fee line (recomputed on every save and counted in profit until a payment is recorded), but the screen no longer depends on it.
- E10 recovery as one labelled row: Type (Normal, Full down, Closed box, each with a usual cost and price per trip in Settings > `recovery_types`, filled in when picked and editable), Trips (One way, Two ways, More with a number box), Cost per trip and Price per trip, the total; a second line with the provider (Our recovery, External with a name, Customer arranged) and Show to customer / Hide; one plain line under it saying what the customer sees and what it costs us, or "Hidden. Internal cost only, AED X". The customer sees "Recovery, closed box, two ways". Gate-in asks the same three types when the car came on our recovery and the quotation starts with that line.
- E11 other charges: one labelled row each (Charge, Cost, Price or Markup, Qty, Show / Hide), white when shown, light grey when hidden; no pink; a missing price is flagged on the box itself.

### E6: what was merged

Categories: "A/C" into "Air conditioning"; "Engine" and "Cooling" into "Engine and cooling"; "Service" into "Servicing"; "Fuel" into "Turbo, supercharger, exhaust", renamed "Fuel, turbo and exhaust"; "General" emptied and removed (its tyre jobs merged below, "Removing and refixing engine assembly to replace seals" moved to Engine and cooling); "Other" kept last with Outside work (Road test moved to Diagnostics).

Jobs (the kept name first): Brake pad replacement ← Front/Rear brake pad replacement; Brake disc replacement ← Front/Rear brake disc replacement; Brake disc skimming ← Front/Rear brake disc skimming; Shock absorber replacement ← Front/Rear shock absorber replacement; Tyre replacement (fitting and balancing) ← Tyre replacement and the four "Replace <position> tyre (fitting and balancing)" jobs; Air suspension strut replacement ← Air strut replacement; Lower arm replacement ← Control arm replacement (the generic one dropped in favour of Lower and Upper arm); Stabiliser link replacement ← Stabilizer link replacement; Stabiliser bush replacement ← Stabilizer bush replacement and Stabiliser bar bushing replacement; Brake fluid change ← Brake fluid flush; Brake caliper overhaul ← Brake caliper service; Tyre pressure sensor replacement ← TPMS sensor replacement; Front crankshaft seal replacement ← Front crank seal replacement; Drive belt replacement ← Serpentine belt replacement; Belt tensioner and pulley replacement ← Tensioner and pulley replacement; Engine oil and filter change ← Oil and filter change; Transmission service (oil and filter) ← Transmission oil service; Driveshaft replacement ← Drive shaft replacement; A/C gas recharge ← A/C gas refill; Fault diagnosis (per hour) ← Diagnosis (per hour); Software update or coding ← Software update / coding. Every merged job keeps the union of positions-asked, suggestions and parts; quotation lines that pointed at a removed job now point at the kept one. 171 active jobs became 143, 19 categories became 13. Kept apart on purpose: "Wheel balancing" (by hours) and "Road force wheel balancing" (fixed price); "Tyre fitting (per tyre)" and the tyre replacement job.

## F. Handover and the states of a part

- F1 the technician ticks what he has in his hands (all ticked to start) and types his PIN; an unticked part goes back to Parts as "Not received by the technician" and Parts are told. The same ticks at the counter ("Sign here").
- F2 "Job finished" refuses while a part approved for the car has not been received by a technician, naming the parts.
- F3 signing on behalf: the owner with no PIN, the workshop manager with his own PIN, never another person's PIN.
- F4 the messages say what to do: "That PIN doesn't match Amin. Try again, or tick 'I sign instead'."
- F5 exactly one state per part (`src/lib/part-state.ts`), the same words on the handover page, the parts trail, the technician's screen and the owner's list.
- F6 "Wrong or faulty part" (wrong part, damaged, does not fit, faulty, with a note): the part goes back to Parts for the supplier and the correct part is raised at once on the Parts desk to order; the car shows "waiting for the correct part"; Parts and the manager are told.
- F7 "Not needed" (with a reason) and then one ending chosen by Parts: Returned to supplier with credit note (number and optional scan), Moved to stock, or Fit on this car with approval (the owner approves it as goodwill, the cost written against the job).
- F8 the owner's list at `/parts/no-home` (link on the Parts desk): every part without an ending; the hourly job tells the owner once a part has waited three working days.
- F9 the parts trail shows every part with its state and the times behind it, and every handover with "not received" marks.

## G. The technician's buttons

Before work: a black "Start work". Working: a green block "Working" with the time, "Pause" beside it. Paused: an amber block "Paused · reason" with the time and "Resume" ("Resume work" after a break or the end of a shift). Clock in and out: the button says what pressing does and a green tag shows "Clocked in · time".

## H. Stickers

- H1 every print button opens the sticker page in a new tab: the handover's stickers from the waiting box, the trail's reprint, the test prints in Settings, and the oil service sticker (the details typed on the job card travel with the link and are saved at the same time).
- H2 the battery warranty sticker: the logo, the title, one line saying which battery with the brand and model ("Main battery · Varta E39", or "Auxiliary battery"), the installed date beside the QR, "Warranty until" and its date in a solid black band, the VIN larger and bolder with "Valid for this vehicle only" under it, even margins. Checked as a PDF rasterized at 60 × 60 mm, one sticker per page; the print page uses the same millimetre sizes.

## Tests

`npm run test:notify` 53 of 53, `npm run test:day1` 72 of 72, `npm run test:overnight` 66 of 66 on a clean dev server; `npx tsc --noEmit`, `npx eslint . --max-warnings=0` and `npm run build` clean. The tests were brought in line: the manager's tick and bar, the Parts table that saves itself, "Not available" in the row menu, the handover ticks, "Start work", the sticker print link.

## Assumptions

- The report strip's amber "Nothing quoted yet" line lists Bad and dangerous findings; Average findings still show inside the strip with "+ Add job" but never turn the line amber.
- "Remembers open or closed per person" for the strip is remembered on the device (the browser), the same as the dashboard sort.
- A part "Moved to stock" is recorded as its ending with a note (shelf or bin); it does not create a consumables stock row.
- Goodwill records the part's cost against the job on the part row (`goodwill_cost_aed`); the customer's invoice is unchanged because the part was already on the approved quotation.
- The single-select chips inside the recovery row (type, trips, provider, Show / Hide) are black when active, as the list asked for Show / Hide; multi-select sets elsewhere are green with a tick.
- Clock in and out, road test, QC and wash buttons already named their action; only the clock-in state tag was added.

## Not done

- Zoho Books, the bodyshop path and the phone app, as before.
- The services merge removed duplicates by name; jobs with different names that may mean the same thing (for example "Wheel balancing" and "Road force wheel balancing") were left for you to decide.
