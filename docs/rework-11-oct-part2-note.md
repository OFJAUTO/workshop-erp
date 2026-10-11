# Rework, part 2: inspection, parts list and quotation (11 October 2026, the full list)

Part 1 (the main rule and A1 to A6) was built and deployed this morning (`docs/rework-11-oct-note.md`). This note covers everything from A7 onwards. One migration (`20261021090000_rework_11_oct.sql`, applied after a backup) and one data script (`scripts/migrate-checklist-11-oct.mjs`, run once) carry the new fields, the parts pool, the new checklist items and the merged jobs list.

## What is fixed (A7 to A12)

- **A7 Counter.** "x of y lines done" counts the labour and services rows only, and nothing is created on screen by itself any more, so the count starts at 0 of 0 on a fresh quotation.
- **A8 Capitals.** The "Print customer documents in CAPITALS" switch is gone and the setting is off. Good / Average / Bad and every list are in sentence case; the services and the part names typed in capitals were tidied once in the database, and the database tidies new ones as they are saved. Plates, VINs, part numbers and the TRN stay in capitals.
- **A9 Spell check.** On by default on every text box (the gate-in request lines use the standard box, which has it); the two plain boxes on the customer's quotation answer got it too.
- **A10 Parts screen.** Rebuilt (see E5): one row per part, no repeated titles, no "× 1 pc" twice.
- **A11 Owner overrides.** No amber "Owner override" notes before you act. Gate out and Start quotation show small and grey when you would be going ahead of the gate, with a muted "Normally after…" under them; the real next step stays the only black button. After an override the job card says it in plain words ("Quotation started by Omar before the inspection report was approved. Reason: owner's decision."; moves say "Moved to QC by Omar, 22:48. Reason: …").
- **A12 Tyre reason.** A tyre with more than 5 mm of tread marked Replace now asks one tap: Age, Damage, Uneven wear or Customer request. The report cannot be submitted without it. The reason shows on the review, on the customer's report and PDF, and on the quotation's reference strip.

## B. Customer links

- **B1** The approval link and the report link have a plain header: the full logo centred on a light grey band with the black line under it, no company block, no TRN. Quotation, estimate, proforma, invoice and receipt keep the full header.
- **B2** The "Dear …, your car was received…" paragraphs are gone; both pages start with the content.
- **B3** The approval is one light green box at the bottom: the fee note, the declaration tick, the name box and the one real Approve button. The bar at the bottom of the screen is a shortcut ("Approve ↓") that scrolls to the box.
- **B4** The report link reads in this order: the car and the customer, anything **Dangerous to drive** in a red box (with your safety wording), **Needs attention** (Bad first, then Average; Required service items; tyres to replace with tread, year and reason; the battery if it tested Replace; anything noted on the road test), **Checked and passed** folded (one line per section), **Measurements** folded, the **Workshop note**, the AED 750 fee note, then bold Call and WhatsApp buttons. No "Your requests" section, no staff names, no parts list. The PDF follows the same order.
- **B5** Every photo on a customer link opens in a full-screen viewer with swipe and an X; videos play where they are, muted until tapped. Nothing opens a new tab.
- **B6** The quotation link shows a small "See your inspection report" link at the top when a report link exists for the job.
- **B7** The full logo is used everywhere, including the black menu bar (the same file, inverted). Only the 20 mm part sticker uses the emblem alone (`public/logo-mark.svg`, cut from the logo file).

## C. Dashboards and the road test

- **C1 Waiting on you.** A panel at the top of the dashboard, My jobs, Cars for QC, Road tests, Parts and Gate in: every car whose next step is this person's move, oldest wait first, with what to do and one button. A manager sees his department; a technician the cars he is on; an advisor his own cars; Parts, QC, accounts and gate-in their own steps; you see everyone's, with the role on each line. The "Inspections to approve" card on the dashboard went, because the panel covers it.
- **C2 Pending road test.** A new real step. When you assign with "Road test needed", the car goes to Pending road test; the QC inspector's road test (done or not possible) moves it to Pending inspection and the inspection clock starts from there. Changing the road test choice on the job card moves the car between the two steps. The dashboard's Pending row has a "Road test" pill, the step track shows the Inspection step in two halves (road test, then inspection), the technician's inspection card is greyed with "Waiting for road test", and your per-job report shows the road-test wait inside the inspection time, counted on its own.

## D. The inspection

- **D1 Requests are a notice.** "The customer says:" at the top of the report, read only, and pinned in a thin bar while the technician scrolls (tap it to see the full text). Good / Average / Bad and the "what was found / what it needs" boxes are gone. The sections the customer's words point to carry a "Customer complaint" tag (the words per section are in Settings > Inspection checklist). At the end an optional box "Anything to tell the advisor about the customer's requests?" goes to the manager's review and to the quotation's reference strip. The report's completeness rules no longer count the requests.
- **D2 Two answer styles.** Every checklist item has a style in Settings > Inspection checklist: "Good / Average / Bad" for a part of the car, "OK / Required" for a service item. The new Service items section (engine oil service due, brake fluid change due, coolant change due, transmission oil service due, A/C gas recharge, software update / service reset) and Wheel alignment and Wheel balancing answer OK / Required. A Required item needs no remark; it shows on the review, on the customer's report as Required, and on the quotation's reference strip, where its matching job comes first under Suggested.
- **D3 Duplicates.** Removed: the "Tyres + valve + valve cover" line (the Tyres block judges each tyre) and "Main battery" (the battery test judges it). The old section is now "Wheels and brakes" with "Wheel bolts or nuts (with locking nut and key)"; the gate-in wheel damage ticks show under "Wheel condition + centre cap" ("At gate-in: Front left curbed · …"). Left in place for you to decide (listed below).
- **D4 Battery.** One tap: Good / Weak, recharge and retest / Replace. Replace is flagged like Bad: on the review, under Needs attention on the customer's report, as one "Main battery" line on the parts list, and on the quotation's reference strip.
- **D5 Tyre size.** Three numeric boxes, [width] / [profile] R [rim]; the cursor moves on by itself; a number outside 135 to 355, 20 to 85 or 13 to 24 turns red; "Same as front" on the rear. Saved on the car and filled in next visit; on an empty box the sizes other cars of the same model had are offered with one tap. The tyre lines on the parts list carry the size ("Tyre 275/40 R20 × 2 · Front left, Front right").
- **D6 Drafts.** The inspection already saved every tap; it now also returns to the place on the page where the technician was. The gate-in form and the QC checklist keep a draft in the browser (fields, choices, Pass/Fail taps, request lines) until Save or Finish, so a closed tablet loses nothing; the quotation saves every change as before.
- **D7 Manager's one-tap notes.** Sixteen ready notes on the report approval (editable in Settings > Inspection checklist), tapped in any combination and edited in the box; the most used come first on their own; "safe to drive" notes ask for a second tap. The note goes on the customer's report. A separate "Note for the advisor (internal)" never reaches the customer; it shows on the review and on the quotation's reference strip.

## E. The parts list

- **E1 The pool.** Settings > Parts list: 125 parts in 11 categories to start (brakes, suspension and steering, engine, cooling, electrical, servicing, wheels and tyres, transmission, fuel and exhaust, air conditioning, other), each with "position asked" where it matters. Add, rename, reorder, remove, new categories.
- **E2 Picking.** On any Average or Bad item the technician taps "+ Parts": a window with Suggested (the parts that fit the item's name, plus what was picked on earlier reports), Most used, the categories and a search box; several parts are ticked, each with its quantity and position (Front left, Rear…); a part not in the pool is added as a custom part; one Done. Leak repairs still add their gasket or seal by themselves. Tyres marked Replace and a battery marked Replace add their own lines.
- **E3 The gathered list.** A "Parts list" card at the end of the inspection shows everything picked, one line per part with the total quantity and all the positions, where each came from, − and +, remove, and "+ Add a part" for anything else. The same part picked on several items is one line.
- **E4 Confirmed at approval.** The manager sees the list on the review (and can change it while reviewing), taps "Parts list checked" and approves; the confirmed list becomes one price request per line for Parts, with the quantity, the positions, the note and the pool link. Custom parts typed on reports are counted and offered to you in Settings > Parts list ("Add to list" or "Dismiss"); the pool counts how often each part is picked so Most used stays true.
- **E5 Parts screen.** One table: Part · Qty · Part number · Type · Cost · Supplier · Availability. A request is a row to fill (the part name and quantity are there already, the position under them); Save puts it on the quotation. A priced part is a row with its figures and a small "⋯" menu for Change, Add another option, Ask workshop manager, Remove and the diagram. Nothing from the report but the parts and the Dangerous flag.
- **E6** "Ask Parts for a part" on the quotation is now "+ Add a part": the same pool window; each part picked becomes a price request with its quantity and position.
- **E7** Removing a job line that has parts under it asks "Remove its parts too?"; Cancel keeps the parts on the quotation, unlinked, to be put under another job.
- **E8** No findings on the Parts page, the planning card, the work order, the handover or the LPO; the "Dangerous to drive" flag shows in the header of the Parts page, the work order and the handover.

## F. The quotation

- **F1 Reference strip.** Folded at the top: "From the report · 2 requests · 3 findings · manager's note". Open it to see the customer's words, the technician's note on them, each Bad / Average / Required finding (with "+ Add job" that opens the picker on that finding's suggestions), the tyres, the battery, the manager's note and the internal note. A soft amber "Nothing quoted yet for: …" on the strip when a finding has no job; it never blocks.
- **F2 Rows.** One thin line per job: name (with its positions), hours or − / + for per-unit services or "per job", the total, and a "⋯" menu with Position, Urgent, Details, Change job, Raise rate (the owner can lower), Owner discount and Remove. Nothing folds or expands any more.
- **F3 One "+ Add".** One window for every job and service (the ready-made labour jobs joined the services list as hourly jobs, 90 of them): Suggested first (from the report), then Most used, the categories, a search box, "+ Add … as a custom job" and "Edit the list" to Settings > Jobs and services, which now has the pricing, usual quantity, time allowance, "asks the position" and "suggested for" (which report findings the job answers) on every service, and the custom jobs typed on quotations as suggestions to adopt.
- **F4** After a job is added only its number is asked: hours for hourly jobs, − / + for per-unit ones.
- **F5** A job marked "asks the position" (brake pads, discs, shock absorbers, arms, bearings, lights, tie rods, stabilisers: 24 to start) asks "Front, rear or both?" on its row; the choice sets the positions and the quantity (per-unit) or the hours (default hours × positions).
- **F6** One job on several positions is one row; positions can be changed in the ⋯ menu. The customer's page, the PDF and the invoice show "Brake pads · front and rear".
- **F7** Tyres: a "Replace tyres" row is made when the quotation starts, with the count of tyres marked Replace as the quantity and the positions on it (a service with "tyre" and "fit" or "replace" in its name is used when there is one, else a labour line). The Parts block is the confirmed list with the markup only and "Set markup for all" on top; the position shows under each part.

## Tested

The three browser suites ran against the local server with this build: the hand-over walk (`npm run test:notify`) passes 53 of 53 checks, the first-day suite (`test:day1`) 71 of 71, the overnight suite (`test:overnight`) 66 of 66. The walk now also checks the Pending road test step both ways, the parts list tick before approval, the one-tap manager note, the price request carrying the position, the Parts table without findings, and the two gate-in draft forms load. Type check and lint are clean; the production build passes. Test rows were removed afterwards with `npm run test:cleanup`.

## Improved on my own

- Pending road test is a real step with its own time, not a flag.
- The technician's "Tyre" lines carry the axle's size, so Parts know which tyre.
- The one-tap notes learn their order from use; the parts pool learns Most used; custom parts and custom jobs are offered to you for adoption instead of being lost.
- Every submit on the review needs the parts list ticked only when there are parts; a report without parts approves as before.
- The hand-over walk test gained checks for the new step, the parts list, the one-tap note, the Parts table and the position carried through.

## D3: duplicate checklist items left for you

The pairs below say the same thing twice in different sections. I removed only the two sure ones (the tyre line and the main battery line). Tell me which of these to drop and I will remove them in Settings > Inspection checklist (you can also do it there yourself, one tap each):

- Engine bay "Brake fluid" · Wheels and brakes "Brake fluid pipes / caliper leak / piston jam" · Service items "Brake fluid change due"
- Engine bay "Engine oil level and condition" · Service items "Engine oil service due"
- Cooling "Coolant tanks + pipes/connector/hoses + water pump + thermostat" and "Water pump + thermostat" (the first line names the pump and thermostat too)
- Cooling "Coolant tank" · Service items "Coolant change due"
- Transmission "Transmission and differential fluid condition" · Service items "Transmission oil service due"
- Air conditioning "A/C gas level" · Service items "A/C gas recharge"
- Electrical "Tyre pressure sensor" (also judged with the tyres)
- Electrical "Parking brakes" (also under brakes)
- Electrical "Electric power steering" · Steering "Power steering rack bushes/leak/play + boots + tie rod"
- Engine bay "Fuel lines, fuel pump and fuel leaks" · Underbody "Fuel tank + cover"
- Steering "Height level sensor" (part of the air suspension line)

## Assumptions

- "Required" needs no remark and no photo; "Bad" and "Average" still need a remark.
- The tyre reason is asked above 5 mm of tread, the figure you gave; the measurement box is unchanged.
- The customer's requests are no longer a completeness rule, so a report can be submitted without a word on them; the optional end box is the technician's way to speak to the advisor.
- The "Checked and passed" and "Measurements" blocks on the customer's report open with a tap; the PDF prints them in full.
- Call and WhatsApp buttons on the report go to the advisor who sent the link (else the one who gated the car in); first name only, as on the approval link.
- A part's "position asked" and a job's "asks the position" start from my keyword tagging (brake pads, discs, shocks, arms, bearings, lights, tie rods, stabilisers); change any of them in Settings.
- The manager's internal note is shown to you, the manager and the advisor; never to the technician or the customer.
- The old "Parts needed" rows on reports written before today still reach Parts the old way, so nothing in flight is lost.

## Not done

- Zoho Books, the bodyshop path and the phone app, as before.
- The removal of the duplicate checklist items above, until you choose.

## Waiting for you

- Your choice on the duplicate items (D3).
- A look at the parts pool and the "suggested for" tags in Settings; both are starting points.
