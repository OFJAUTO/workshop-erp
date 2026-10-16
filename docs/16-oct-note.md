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

## G1. Workshop orders (migration 20261102150000)

The Stock page's button is now **New workshop order**. The form asks what kind of goods with one tap: **Stock parts** or **Workshop consumables** (the items on the shelf list, each item marked as a part or a consumable in its details), or **Tools and equipment** (typed line by line: item, quantity, cost each). It goes through the same LPO flow (approval by the owner or the head accountant, Ordered, received line by line; a supplier invoice scan or "to follow" at delivery, a price more than AED 1 off flagged for accounts). Stock parts and consumables land on the shelf at delivery with the cost averaged in; tools are simply received. A tools order at or above Settings > "Fixed asset threshold" (AED 2,000 by default) is flagged **Fixed asset**: accounts are told when it is raised and again when it is approved, and the LPO list shows the flag. The supplier invoices tab on the LPO list groups the bills by kind: parts for jobs, stock parts, workshop consumables, tools and equipment. Issuing consumables to a job, low-stock alerts and Reorder work as before.

## H. Stickers (migration 20261102150000)

**H1. Part sticker, 40 × 30 mm.** The QR (about 20 mm) on the left; the logo and the job number on the right; a bold black strip along the bottom with the part name in capitals and "1 OF 2". One sticker per unit. It prints the moment a part is ticked **Received** (the sticker page opens and the print dialog follows by itself; Back returns to where you were), and after a delivery is recorded on an LPO page. A staff member who scans the QR lands on the job's parts trail at that part, with its LPO and the supplier's invoice number; anyone else sees only "OFJ Automotive: genuine part" and "Fitted on 16 Oct 2026".

**H2. Battery warranty and oil service stickers, 50 × 100 mm portrait.** Battery: logo, title, which battery, Installed, the black band "Warranty until" with the date and the months, the QR, the VIN large, "Valid for this vehicle only". The warranty period is chosen on the battery line of the quotation with one tap (12 / 24 / 36 months; the Settings length is the usual one) and the sticker and the warranty record follow it. Oil service: logo, title, serviced on and at, the black band "Next service, whichever comes first" with the date and the mileage, the plate and the VIN, the QR and "Scan to book your next service on WhatsApp", the phone. The QR opens WhatsApp to the number in Settings (the company phone when empty) with "Hi, I'd like to book a service for [PLATE]" already typed (the words are editable in Settings).

**Settings > Stickers.** Width and height of each sticker, the printer name shown on every print page ("Print on Printer 1 (40 × 30 mm)", "Print on Printer 2 (50 × 100 mm)"), the WhatsApp number and message, the usual warranty, the wording, a live preview at twice life size and a test print per sticker. Every sticker page is sized exactly to the sticker with no browser margins.

**Windows printer settings (do this once per printer, on the PC that prints):**
1. Settings > Bluetooth & devices > Printers & scanners > the label printer > Printer properties > Preferences (or Printing Defaults). Under Paper / Page Setup add a custom size: **Printer 1: width 40 mm, height 30 mm**; **Printer 2: width 50 mm, height 100 mm**. Orientation Portrait. Save it with a name such as "OFJ 40x30" or "OFJ 50x100" and set it as the default size for that printer.
2. In the same place set the gap/media type to "Label with gap" (or "Die-cut") and the darkness one step above the middle; speed medium.
3. In Edge or Chrome, when the sticker page opens: choose the printer, Paper size = the custom size you saved, **Scale 100%**, **Margins None**, and untick "Headers and footers" and "Background graphics" stays ticked. Tick "Remember my settings" where offered.
4. Print the test sticker from Settings > Stickers once per printer and adjust the darkness if the QR is light.

Proof: `npm run test:v` (28 checks).

## I. Scan reports read from the mailbox (migration 20261102160000)

**What changed.** The system reads the Google Workspace mailbox **scans@ofjauto.com** itself, every five minutes (Vercel cron `/api/cron/mailbox`) and on **Check the mailbox now** on the Scan reports page. Read only: nothing in the mailbox is moved, marked or deleted. For every new email it keeps the PDF and picture attachments, looks for the VIN in the subject, then the body, then inside the PDF's own text, and matches it to the open job for that car. A matched report lands under the job's Scan reports as pre-scan or post-scan by the car's stage (a pre-scan PDF also goes on the inspection as before); the car's advisor, the workshop manager of the department and the technician on the car are told **"Scan report received for [PLATE]"**. A report with no matching car waits in **Unmatched scans** on the Scan reports page, where the car is picked from the open cars with one tap (Attach) or Ignored; the owner and the workshop managers are told "Scan report with no matching car". An email with no report attached is kept under **Other emails** for the owner (as before). Each Gmail message is filed once: a second read never makes a second row. The page shows the state of the mailbox (Mailbox connected / Mailbox problem / Not checked yet, with the time of the last check and what came in). Until the three Google variables are in Vercel the page says "Mailbox not set up yet" and names them; once they are, the owner sees **Connect scans@ofjauto.com** until the one sign-in is done, then **Connected as scans@ofjauto.com** with **Disconnect**.

**Removed.** The old Postmark webhook (`/api/inbound/scan`), its hidden address with "Show the address" / "Generate new token", the "How to set up" Postmark steps on the Scan reports page and the "Scan reports by email" card in Settings. The Postmark instructions in `docs/round-2-delivery-note.md` and `docs/overnight-11-oct-note.md` are superseded by this section.

**One-time set-up: the scans mailbox signs in once (changed the same evening, migration 20261103100000).** The first version asked for a service account with domain-wide delegation, which Google lets read every mailbox of ofjauto.com. It is replaced by a one-time sign-in as scans@ofjauto.com on Google's own page: the system then holds a read-only permission for that one account, and Google itself refuses it anything else. Nothing in Google Workspace admin is needed. The supplier LPO email (gmail.send) keeps its own set-up and is not affected.

Part 1, Google Cloud (about 5 minutes, signed in as the Workspace super admin, for example aljafomar@… or your admin account):
1. Open console.cloud.google.com. Top left, the project picker: pick the ERP project if one exists; otherwise **New project**, name "OFJ ERP", **Create**, then pick it.
2. Left menu (☰) **APIs & Services > Library**. Search "Gmail API", open it, **Enable**.
3. Left menu **Google Auth Platform** (on older screens: APIs & Services > OAuth consent screen). Press **Get started**. App name **OFJ ERP**, User support email: your address. **Next**. Audience: **Internal** (only ofjauto.com accounts can sign in; nothing goes to Google for review, and the permission never expires by itself). **Next**. Contact email: your address. **Next**, tick the agreement, **Create**.
4. Still in Google Auth Platform: **Data Access > Add or remove scopes**. In the filter type `gmail.readonly`, tick the one row `.../auth/gmail.readonly` ("Read all resources and their metadata"), **Update**, then **Save** at the bottom. Add nothing else.
5. **Clients > + Create client**. Application type **Web application**. Name "ERP scans mailbox". Under **Authorized redirect URIs** press **+ Add URI** and paste exactly:
   `https://erp.ofjauto.com/api/google/mailbox/callback`
   Leave "Authorized JavaScript origins" empty. **Create**.
6. A window shows the **Client ID** and the **Client secret**. Keep that window open for Part 2 (or press **Download JSON**; the secret is shown only once on newer screens). Afterwards delete any downloaded file, Recycle Bin too.

Part 2, Vercel (the only place the two values ever go):
7. vercel.com > project **workshop-erp** > **Settings > Environment Variables**. Add three, environment **Production**:
   - `GOOGLE_OAUTH_CLIENT_ID` = the Client ID (ends in `.apps.googleusercontent.com`).
   - `GOOGLE_OAUTH_CLIENT_SECRET` = the Client secret.
   - `SCANS_MAILBOX` = `scans@ofjauto.com` (if you already added it this afternoon, leave it).
   If you added `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_KEY` this afternoon for the mailbox, they are no longer used for it; keep them only if you want the supplier LPO email sent from the workshop's mailbox.
8. **Deployments**, the newest one, the three-dot menu, **Redeploy**.

Part 3, the one sign-in (in the ERP, signed in as yourself, the owner):
9. Open erp.ofjauto.com/scans. Press **Connect scans@ofjauto.com**.
10. Google's own sign-in page opens with scans@ofjauto.com filled in. Sign in as that account on Google's page (if this browser is already signed in to it, just pick it). The password is typed only on Google's page, never in the ERP, and the ERP never sees it.
11. Google shows "OFJ ERP wants to access your Google Account: Read all your email messages and settings". Press **Continue** (or **Allow**).
12. You are back on Scan reports with "Connected: scans@ofjauto.com, read only." The badge reads **Connected as scans@ofjauto.com**; the first check runs straight away, then every five minutes.
13. On the Autel scanner, set the report email recipient to scans@ofjauto.com.

Safety built in: the sign-in is accepted only for the address in `SCANS_MAILBOX`; signing in as anyone else is refused and that permission is handed straight back to Google. Only the owner sees Connect and Disconnect. The permission is stored encrypted in a table only the server can read. If Google withdraws it (the scans password is changed, or the access is removed in that account's Google Account > Security > Third-party access), the page shows "Mailbox problem" with the Connect button and you are told once; press Connect and sign in again. **Disconnect** on the page hands the permission back to Google at once.

If you did the domain-wide delegation steps this afternoon: admin.google.com > Security > Access and data control > API controls > **Manage Domain Wide Delegation**, find the client with `gmail.readonly`, and **Delete** it (keep a `gmail.send` one only if the supplier LPO email uses it).

**Still to delete outside the code** (nothing in the system refers to them any more): the Postmark account and its "OFJ scans" server, if one was ever created; the forwarding rule in the Gmail settings of scans@ofjauto.com, if one was set up; the `inbound` MX record at Squarespace, if it was added. The unused `inbound_scan_token` row in Settings stays in the database (harmless) until the next tidy-up migration.

**The real Autel report test** has to wait for steps 1 to 13: locally there is no Google key, so the proof test feeds reports through the same code the mailbox reader uses (`POST /api/e2e/mailbox`, local only). Once you say the variables are in Vercel, I run the check against the live system with one real report and show the result (the job it landed on, the notifications, the Scan reports page).

Proof: `npm run test:w` (26 checks: VIN in the subject, VIN only inside the PDF, unmatched then Attach, one row per Gmail message, the old route gone, the cron refusing without the secret; and the sign-in: Connect goes to Google's page with the one read-only permission, scans@ofjauto.com filled in and a one-time check value, only the owner may connect, a mismatched or cancelled answer stores nothing, the stored permission is encrypted, Connected as / Mailbox problem / Disconnect on the page, the owner told once). The dev server for this test runs with test values for the three Google variables. The staff-day suite's email section was rewritten for the mailbox (`npm run test:day1`).

Lessons: a Next.js route file that renders JSX must be `route.tsx`; a path removed from the public prefixes answers with a redirect to the login page, not 404, so a "gone" check accepts either; a bash heredoc with an apostrophe inside fails as a whole, so long notes go through a file written by the editor and appended.

## Section by section

| Section | State |
|---|---|
| A1, A2, B1 (first part) | Done (commit a6280af, test-q). |
| B1 to B3 | Done (commit 9f7fad7, migration 20261102090000, test-r). |
| C1 | Done (commit 71cee1c, test-s). |
| D1 to D6 | Done (commit 1fba9b4, migrations 20261102120000 and 20261102123000, test-t). |
| E1 to E6 | Done (commit dc0f7d5, migration 20261102140000, test-u). E6's move of existing tyre rows found nothing to move. |
| F1 | Done (commit dc0f7d5). |
| G1 | Done (commit a086ea9, migration 20261102150000, test-v). |
| H1, H2 | Done (commit a086ea9, test-v). The Windows printer settings are above. |
| Mailbox 1 to 4 | Done in the code (migrations 20261102160000 and 20261103100000, test-w). Reading is by a one-time sign-in as scans@ofjauto.com, not domain-wide delegation. The Google, Vercel and sign-in steps are yours (13 steps above). |
| Mailbox 5, the real Autel report | Not done yet: it needs the Google keys in Vercel first. I run it the moment you say they are in. |

## Assumptions

- Deposit "% of parts" is a share of the parts' selling price before VAT; "% of total" is a share of the quotation total including VAT; an AED deposit is as typed. The deposit "Tax invoice" option folds into the final invoice the same way a deposit proforma does.
- "Override / Wait" on the owner's LPO notification: the notification opens the LPO page, where Override asks for the one-tap reason; Wait is simply leaving it.
- A priced part that changes an approved quotation asks the owner once per part; the owner's Allow is used by one revision.
- Outside work never takes the labour discount and shows "our cost" only to staff.
- Existing tyre rows: none had the size in the part number box, so nothing was migrated; new ones are told to use the name.
- The fixed-asset flag applies to Tools and equipment orders only, at or above the Settings amount (AED 2,000 by default), judged on the order's total before VAT.
- Sticker sizes default to 40 × 30 mm (part) and 50 × 100 mm (battery and oil service); the part QR is about 19 to 20 mm. The oil sticker's WhatsApp number falls back to the company phone from Settings when the sticker number is empty.
- One part sticker per unit prints the moment a part is ticked Received; a part received in several deliveries prints the units of that delivery.
- Mailbox sign-in: the Google app is "Internal" (only ofjauto.com accounts), so Google does not review it and the permission does not expire by itself; it ends when the scans password is changed, the access is removed in that account, or Disconnect is pressed.
- Mailbox: the reader looks back three days and takes up to 30 emails per run; pictures (JPG, PNG) are kept and attached but only the subject, body and PDF text are read for the VIN; the first VIN found wins; a car matches when it has an open job with that VIN (the newest gate-in if several).
- Mailbox notifications go to the advisor(s) of the car (who gated it in or sent its approval), the workshop manager(s) of the car's department and the technician on it; unmatched reports go to the owner and the workshop managers.
- The five-minute cron needs the Vercel Pro plan the project already has.
