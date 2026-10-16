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
