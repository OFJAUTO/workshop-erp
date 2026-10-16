# 16 October 2026: staff review fixes, quote and deposit rules, parts table, tyres, services, workshop purchases, stickers

Delivery note for the owner. Each section says what changed, where to look, and what to click. Sections are added as they are finished.

## A. Staff review fixes (committed a6280af)

**A1. The parts list tick is live.** On the manager's review page the tick under the parts list turns green the moment it is saved, with no reload. If the review form's autosave changes the parts list afterwards, the tick turns into "Parts list changed: check again" at once. Approving without the tick is refused in words, and the moment the tick is saved again the refusal disappears. The cause was a tick drawn by the server that stayed green after the open form had already cleared it.

**A2. "Not allowed" on Preview PDF.** Every document PDF (quotation, estimate, proforma, tax invoice, receipt, LPO) opens for the owner, service advisors, workshop managers and accounts; LPOs open for Parts too. This works in "View as" and "Act as". Someone not signed in sees "You're not signed in. Sign in and try again."; a role that may not open documents sees "Your role can't open this document."; a made-up address is refused.

**B1 (first part).** The gate-in page no longer jumps to Mileage with red messages when it opens.

Proof: `npm run test:q` (21 checks).

## B. Gate-in and gate-out (committed 9f7fad7, migration 20261102090000)

**B1.** The inspection form, the quotation editor, the parts page and the gate-out page were checked as well: all open at the top with nothing focused and no red messages.

**B2. Back to details, Edit gate-in, removing photos.**
- The photos and video step has "← Back to details" next to the finish button. The photos already taken stay, the damage note is saved as typed, and the details form keeps what was typed. Save on the details form returns to the photos step.
- The job card's gate-in block has "Edit gate-in" until the car leaves (keys, keychain, fuel, mileage, cleanliness, condition, dash cam, major damage, old parts, notes). Every changed field is one line in the job's History, for example "16 Oct 2026, 09:30 · Omar · Keychain changed No → Yes". Nothing is written when nothing changed. The gate-in time and the person who gated the car in cannot be changed.
- Photos and videos can be added at any time ("Add photos or video" on the job card). Each photo and video has an X: anyone doing the gate-in can use it while the gate-in is still open; once the gate-in is finished only the owner can. One tap asks "Remove?", the second removes. Removed files are marked, never deleted, and the removal is written in the History. Anyone else is told "The gate-in is finished: only the owner can remove a photo or video now."

**B3. Gate-out prefill.**
- "Customer collects": the name and phone come from the customer's record, both editable.
- "Customer's driver collects": the drivers saved on the customer are one-tap choices (the first is ticked). "New driver" asks for name and phone and saves the driver on the customer (Customers > the customer > Contacts, relationship "Driver") for next time.
- "Delivery by recovery": the company is a one-tap choice (Our truck, the companies in Settings, Other company), then the driver's name, the address, the date and the fee. A company typed under "Other company" is added to the list by itself. The list is in Settings > "Recovery companies (gate-out)".
- Keys and keychain are prefilled from the gate-in. A different count shows an amber box: "Gate-in recorded 1 key, no keychain. Confirm 2 keys, no keychain?" with "Yes, confirm" and "No, back to 1 key, no keychain". After Yes the owner or workshop manager writes the reason (one tap from the chips); anyone else is told to ask one of them or correct the gate-in first. The server refuses a different count that was not confirmed.

Proof: `npm run test:r` (43 checks). The gate-out, notification and bodyshop suites still pass.

## C1. Road test results (committed 71cee1c)

The QC inspector's road test now shows at the top right, under "The customer says", on the finished report; as its own block under the requests in the advisor's quotation strip; on the first page of the customer's report link; and as its own section in the report PDF (before "Needs attention"). Bad items come first, then Average, each with its remark; the good items are one line ("Good: Vibration, Steering, …"). In the quotation strip every Bad or Average road test item has "+ Add job", which opens the picker for that item and marks it "✓ Quoted" once a job is on the quotation; a Bad item with no job is named in "Nothing quoted yet for". Proof: `npm run test:s` (19 checks).

## D. Quote and deposit rules, revisions, owner approval, services, parts table (migrations 20261102120000, 20261102123000)

**D1. The deposit is the advisor's choice.** In the quotation's Summary card: "Ask for a deposit" (off by default). On: one-tap "50% of parts", "100% of parts", "50% of total", an AED | % toggle and a box; the amount shows next to it and in the Summary as "Deposit required". Below it, in grey, the system's suggestion (the old rule: the Settings percentage of the parts when the parts are above the Settings threshold); the owner changes that rule in Settings > "Deposit suggestion". The customer sees "Deposit required: AED X" on the link and the PDF only when it is set. On "Quotation complete", when the parts are above the threshold and no deposit is set, the advisor is asked once: "No deposit on this quote. Send without a deposit?" with "Add deposit" (switches it on with the suggested amount) and "Send without deposit" (written in the quote history). Every deposit choice is written in the quote history.

**D2. The LPO waits for the deposit.** The LPO page says "Deposit AED 28,027 not received yet." Only the owner can approve without it, with a one-tap reason that is written on the job. Notifications: customer approves with a deposit → advisor and accounts "Deposit AED X to collect: [car, customer]"; deposit recorded → Parts and the owner "Deposit received: LPO can be approved" with the LPO link; LPO sent for approval while the deposit is short → the owner "LPO waiting, deposit not received: override?" (open the LPO to override with a reason, or wait); not received after the waiting limit (Settings > payment waiting hours, 24 h by default) → advisor and accounts reminded once, and the owner's dashboard shows "Deposits not received" until it arrives. The deposit receipt (RCT number) says "Advance payment (deposit) against quotation Q-…", the job, the amount, the method, the date and "Balance remaining"; it opens from the job's money page ("Receipt") and goes to the customer with "Send receipt" (WhatsApp message from Settings > "WhatsApp: deposit receipt", Share PDF; the customer opens it with the quotation's own link). The proforma and the tax invoice list "Less deposit received (RCT-00012)" with the balance due. Accounts see "Deposits received, not yet on an invoice" on their dashboard. Settings > "Deposit document": "Receipt only" (the usual) or "Tax invoice for the deposit" (a tax invoice for the advance as well, which folds into the final one as "Less deposit invoiced (INV-…)").

**D3. Revising after the customer's approval needs the owner.** On an approved quotation the advisor's Revise is greyed with "Ask owner to revise" (a one-tap reason). The owner sees "Revision requested" under "Before sending" with "Allow one revision" and "Decline". After Allow the advisor's Revise is live once; the owner revises directly without asking. A part priced or added by Parts after the approval asks the owner by itself: "Peter added ENGINE MOUNT, AED 1,200: allow revised quote?"; Allow makes the new version with the change and tells the advisor to send it. Everything is in the quote history (requested, allowed, declined, used).

**D4. The owner's approval box** (quotations above the Settings limit) sits in the right column directly under "Before sending", with the note box, Approve and Ask for changes. Advisors see "Waiting for owner approval (…above AED 25,000…)". After approval: a light green "Approved by Omar, 16 Oct 2026, 11:45". The owner's notification opens the page with Approve focused (one tap).

**D5. Services.** Wheels and tyres: WHEEL ALIGNMENT, WHEEL BALANCING, ROAD FORCE WHEEL BALANCING, TYRE FITTING (PER TYRE), PUNCTURE REPAIR and the new TPMS SENSOR PROGRAMMING are fixed-price services (prices in Settings > Services, editable on each quotation). Servicing: MINOR SERVICE (AED 750), MAJOR SERVICE, A/C GAS RECHARGE (the copy under Air conditioning retired). New category "Outside work": LATHE CHARGES (per piece, with a quantity) and FUEL INJECTOR SERVICE (BOSCH); outside work shows an "our cost" box on the line for whoever quotes and never takes the labour discount (Settings > Services has an "Outside work" tick for any service). "Wheel alignment: required" (or any Required job with a matching service) on the approved report puts the service line on the quotation when it starts. A job typed by hand in the picker can be saved to the list with one tap ("+ Add … and save it to the list"): it lands under "Custom" for the owner to tidy.

**D6. Parts table.** Long part names wrap onto up to three lines and the row grows; the List and Disc % boxes are narrower; the full name shows on hover (and in the rename window on a tap).

Proof: `npm run test:t` (61 checks).

Lessons: the dev server did not pick up changes to `src/lib/pdf/*` (the PDF routes kept the old module) until it was restarted with `.next` deleted; a `String.replace` replacement text with `$&` corrupts the file, so patch scripts use split/join or a function replacer.

## E. Parts table, tyres, menus (migration 20261102140000)

**E1. Capitals.** Part names, work lines and invoice lines show in capitals on the Parts table, the LPO page, the work order and the invoice pages (saved as typed, shown in capitals; notes and remarks stay as written). Customer documents already did.

**E2. Availability words.** An imported availability that is a plain number is the supplier's stock: "Supplier stock: 653"; a negative figure reads "Out of stock"; "Back order at the supplier" and "Supplier to confirm" stay for the rest. The 37 stored notes that read "Supplier to confirm (653)" were reworded.

**E3. Set for ticked.** Tick parts on the Parts table and a bar appears: one availability, one supplier and/or one type, then Apply. Each ticked row is saved as if typed (the supplier's discount and net follow as usual).

**E4. Menus.** Every three-dot menu (Parts table rows, quotation labour and service lines) is drawn on top of the whole page, never clipped by a table or card, and opens upwards when there is no room below. Tap outside or Escape closes it.

**E5. Tyre quick picks.** A tyre row on the Parts table has "Tyre details": brand (one tap from Settings > Tyre brands, or typed), model per brand (one tap, or typed; saved under the brand for next time in Settings > Tyre models), the size as three boxes prefilled from the inspection (front or rear by the row's positions), the DOT year with one tap, and the chips Run-flat, MO, N0, AO, ★. The name builds itself: "PIRELLI P ZERO 275/45 R20 N0 (2026)".

**E6. Tyre lines.** The built name is what the quotation, the PDF, the customer's link, the proforma and the invoice show. A tyre cannot count as priced without a brand and a full size ("Not finished: tyre size and brand needed"); a tyre needs no part number. A generic "Tyre" with the size typed into the part number box is told "Add the details to the name. Part numbers aren't shown to customers." Existing tyre rows with the size in the part number box: none were found in the data, so nothing had to move.

## F1. VIN in every car header

The header of every car page (job card, parts, quotation, inspection, money page, gate-out, work order, technician screen, QC, road test, photos, gate-in details, bodyshop) shows "VIN WDD…" with a Copy button; a car without a VIN shows "VIN: add at gate-in". Internal only: nothing the customer sees.

Proof: `npm run test:u`.
