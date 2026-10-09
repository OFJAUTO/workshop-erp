# Round 2 delivery note (9 October 2026, evening)

Everything from the list "Fixes and improvements from today's full test run" is built and on the live site, except the items under "Not done" below. The database was backed up before the migration and before the test data was cleaned. The migration `20261016090000_round2_fixes_and_improvements.sql` is applied.

## A. Fixed

- **A1 Save assignments** on the work order: the error came from a save with nothing changed. It now says "Nothing changed" and saves when something did. "Assign all lines to" works.
- **A2 Lines listed twice (54 h)**: two versions of the same quotation were both marked approved, so both fed the work order. One version per number counts now; older versions are marked replaced when a newer one is approved. J-00018 was repaired. The invoice, QC checklist and profit use the same single source.
- **A3 Tablet My jobs 404**: the route is fixed; every technician page on the tablet address was walked through (My jobs, the car, clock in, start, mark a line done).
- **A4 QC silent save**: the QC form now lists what is missing, in red, at the bottom bar.
- **A5 Early buttons**: Gate out, Start quotation, Parts desk and Work order are grey with a one-line reason until their time; the owner can press them anyway and the override is logged on the job.
- **A6 Labour title filled with parts text**: suggested lines are "Attend to: <request>"; what the technician listed goes to Parts, not into the title.
- **A7 Parts notifications**: checked by role, not department. Peter did get them; the problem was the bell (see C).
- **A8 View as crash**: a grey "View only" wrapper instead of a crash; nothing can be clicked while viewing.
- **A9 Black crash screens**: friendly pages in our design for "not found" and errors.
- **A10 Bell over Exit**: the bell sits below the yellow bar.
- **A11 Left clipping** on the Parts job page and the quotation page: not reproduced at tablet or phone widths after the rebuild of both pages. Tell me the device and the page if it still shows.
- **A12 J-00019 stuck at technician confirm**: the confirm step is gone (F3); every pending part was moved to confirmed.

## B. Gate-in

- **B1** The car picture is the first item of the phone/QR checklist, "Car picture (for our dashboard)". Compulsory, internal only. A returning car reuses its picture. The PC forms no longer ask for it (a picture there is optional and replaces the old one).
- **B2** Wheel condition has "Total damage", in red.

## C. Notifications

A louder two-note chime, the bell wiggles and chimes gently every 45 seconds while something is unread, a stronger sound for owner approvals, per-person volume with a Test sound button, the unread count in the browser tab title, a "Click here to turn on sounds" bar when the browser blocks sound, and a pending count next to Parts in the menu.

## D. Inspection

- **D1** The assignment screen shows the numbered requests and the gate-in notes, with "Road test suggested" when the words mention noise, vibration, steering, turning or braking.
- **D2** The job card shows the road test as a green, amber or grey badge.
- **D3** Technician screen order: scan step (when the gate is on), road test results with BAD and AVERAGE first and GOOD folded away, customer requests, checklist.
- **D4** Scan report gate, behind the setting "Scan report gate" (OFF): step 1 is the scan report, "I have read the scan report" unlocks the checklist, "Scan not possible" asks the manager with one tap to approve. Manual attach stays. The timer starts at Start.
- **D5** Tap-first: each checklist item offers remarks and parts to tap, with autocomplete when typing. They learn from every approved report (remarks and parts per item, most recent first). The manager's review is the safety net.
- **D6** Parts needed are rows: part, quantity with + and −, unit. The quantity goes to the price request (one request per row), the quotation, the purchase order and the issue.
- **D7** Leak on any item that can leak: severity (Sweating / Dripping / Heavy leak) and repair (Gasket / Seal / Silicone reseal / Hose or pipe / Replace). One tap writes the remark and adds the part row.
- **D8** The checklist lines are split as asked and "Fuel lines, fuel pump and fuel leaks" is added (reports already started keep their old checklist).
- **D9** Fluids: quantity in litres with decimals (grams for A/C gas), one-tap grade, approval spec.
- **D10** Dangerous switch on BAD items and on tyres marked Replace now, reason required. When on: red badge on the job card, the technician screen, the report and the quotation; an immediate alert to the manager, the advisor and the owner; the quotation line is forced to Urgent; the customer sees the safety warning on the page and the PDF; declining needs the acknowledgement tick. All three texts are in Settings.
- **D11** Tyre year is a pick-list (this year back 15 years, then Older) with "Same as front left" and an age flag. Limits on typed numbers, in Settings: tread, pads, battery, vent temperature, fluids.
- **D12** Battery test has a photo slot and a "Continue on my phone" QR code: one minute, single use, countdown, New code. Every photo slot has a "Photo from my phone" code too. The voltage stays typed.
- **D13** Brake discs: condition Good / Close to minimum / Below minimum and action None / Skimming possible / Skimming not possible, replace. Sets AVERAGE or BAD; below minimum locks to replace. Optional measured and minimum thickness. The suggested quotation line says Skim or Replace.
- **D14** Big-job tags by the notes, with a reminder; the manager is told on submit.
- **D15** "Estimated hours for this job" before submit; the manager agrees or changes it (reason required when changed) when approving; the advisor sees "Workshop estimate" on the quotation with a warning when the quoted hours are lower; the quotation cannot be completed until the manager has agreed the hours.

## E. Scan reports by email

Built: a receiving address on the system, matching by VIN in the subject (then the email body) to the open job, pre-scan or post-scan by the job's stage, an "Unmatched scans" list (menu: Scan reports) where the manager attaches a scan to a job by hand or ignores it, and notifications. A matched pre-scan attaches itself to the inspection report. See "What you need to do" for the three things only you can do.

## F. Parts desk

- **F1** Price requests go to Parts the moment the manager approves the report (this was already so; confirmed and kept).
- **F2** One row does everything: part number, description, quantity, type, cost, supplier, availability (in stock / days to arrive). Saved parts go straight onto the quotation.
- **F3** The technician confirm step is removed. "Ask workshop manager" on a part sends the part and the catalogue diagram; the manager answers Yes or No with one tap. It never blocks.
- **F4** Part type Genuine / OEM / Aftermarket / Used (list in Settings), brand box for anything not Genuine. The type follows the part to the quotation, the customer's page and PDF ("Aftermarket - Bosch" tag), the invoice, the purchase order and the label.
- **F5** Parts can add options for the same part; the advisor picks one with a radio button; the customer sees one quotation.
- **F6** "Already covered in another request" closes a request with one tap.
- **F7** Parts land on their own home screen (To price, To order, Deliveries expected). On a job card Parts see the approval, the inspection report and the Parts card; the invoice card is hidden and the quotation and invoice pages refuse the Parts role.
- **F8** The quotation has a status bar ("3 of 7 parts priced · waiting on Peter, 25 min"), Remind Parts after 30 minutes and Escalate to owner after 60 (both in Settings).

## G. Quotation

- **G1** After pricing the next step is "Finish the quotation". Send is grey until the quotation is complete and the missing things are listed in plain words. The advisor presses "Quotation complete"; only then does Send appear. The job card shows progress ("Parts 12 of 12 priced · Labour 4 of 9 lines done"). A button says Send only when it sends.
- **G2** Two blocks: labour and services on top, parts below as a compact table (name, type tag, availability, quantity, cost, markup %, selling, total). Advisors can change only the markup, from 5 upwards (minimum in Settings, owner only). "Set markup for all parts". Each part takes Urgent or Recommended from the work it belongs to, with a label saying which. Discounts are hidden from advisors; the owner has an "Owner discount" link on the row. Details open on tap. Block totals: parts cost, selling, margin.
- **G3** Labour description builder: Action / Component / Position pick-lists (actions and positions in Settings, components from the checklist). Services come first, free text last. Hours are remembered per description and per car model and filled in next time.
- **G4** The bank charge is an automatic hidden Fee line: total including VAT × 1.9% (Settings). One per quotation, untouchable by advisors, never shown to the customer, counted as a cost in profit until a payment is recorded, then the real charge counts (cash: none). The inspection fee stays separate and visible.
- **G5** Recovery line: trips (one way to the workshop / to the customer / two ways / a number), cost and price per trip, provider, Show / Hide. Suggested automatically when the car arrived on our recovery.

## H. Owner tools

- **H1** "Act as" next to "View as" on the Team page: the owner does the person's work from their screen; a black bar shows it, and everything is saved and logged as "Omar, on behalf of <name>". The change log also records the owner as the person who made the change.
- **H2** The owner rule was checked on every gate built so far: the owner can start the inspection before the road test, start the quotation before the report is approved, send a quotation without "Quotation complete", gate out early, and reach every role's page. Each early step is written on the job as an override.

## What you need to do

**1. Create the account: Postmark** (postmarkapp.com). Free for 100 emails a month, then USD 15 a month. Create a server called "Scans". Open it, Message Streams, "Default Inbound Stream", Settings. In "Webhook" paste the address shown in Settings under "Scan reports by email" (it ends with `?token=...`; keep it private). Save.

**2. Add exactly one DNS record at Squarespace** (Domains, DNS settings, Custom records, Add record):

| Type | Host (name) | Priority | Data (value) |
|---|---|---|---|
| MX | `inbound` | 10 | `inbound.postmarkapp.com` |

This makes `anything@inbound.ofjauto.com` deliver to Postmark. Nothing on `ofjauto.com` itself changes: no existing record, no MX of the website or the office email. Then in Postmark, server Settings, Inbound, "Inbound domain forwarding": type `inbound.ofjauto.com` and press Verify (allow up to an hour after adding the record).

**3. Forward the mailbox**: in the mail settings of `scans@ofjauto.com`, forward everything to `scans@inbound.ofjauto.com`. (Until the DNS record is live you can forward to the server's own address instead, shown in Postmark as `<long code>@inbound.postmarkapp.com`.)

**4. Test**: email a PDF to scans@ofjauto.com with the VIN of an open job in the subject. Within a minute it shows on the Scan reports page and on the job. When that works, turn on "Scan report gate" in Settings.

**5. Settings to look at** (all have sensible values already): Part types; Bank charge on quotations (1.9); Remind Parts after (30) and Escalate (60); the Inspection card (gate, limits, fluid grades, big-job tags, labour actions and positions, the three safety texts to have checked legally).

## Assumptions I made

- The VIN is read from the email subject, then the email body. The PDF itself is not read (see Not done).
- "Waiting on Peter, 25 min" counts plain minutes since the oldest open request or unpriced part, not working minutes.
- Profit: hidden Recovery/Other costs and the quotation's bank charge count against the invoice until a payment is recorded; then the recorded bank charge replaces the estimate. The profit line says "bank charge estimated until payment".
- A part takes Urgent/Recommended from the work line of the request it came from; a part with no matching line is Urgent.
- Act as: records are saved under the acted-for person (so their own screens and checks work), the note says "Omar, on behalf of <name>", and the database change log holds the owner's login. The tablet idle lock does not apply while acting.
- The phone session opened by a quick code lasts two hours.
- Pre-scan or post-scan: a scan that arrives while the car is in Work, QC, wash, ready or delivery is a post-scan; before that, a pre-scan.
- The tap-first suggestions start empty and fill as reports are approved; the Settings page does not edit them line by line (they live in one setting, `item_suggestions`).
- Reports started before this round keep their old checklist and show the new fields empty.
- The customer sees the safety warning in English and Arabic on the page; the PDF shows English only (the PDF font has no Arabic).

## Not done

- Reading the VIN inside the PDF when the subject has none: the unmatched list covers it for now.
- The red DANGEROUS badge shows on the job card, the technician screen, the report and the quotation, not yet on the dashboard and workshop lists.
- Comparing the estimated hours with the hours actually clocked: the figures are stored; the comparison screen is for the time-clock phase.
- The bodyshop path and the phone app, as before.
