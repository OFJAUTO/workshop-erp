# Fixes from the testing of 12 October 2026: delivery note

Last night's consolidated list (A to H, including the A9 payment link) was checked first against its wording: every item is in and live; nothing was left over. Then the thirteen points of today.

Migrations `20261023090000_fixes_12_oct.sql` and `20261023093000_lpo_token_default.sql`, applied after a backup (`backups/2026-10-12T14-00-52`).

## 1. LPO: two versions

- The internal view on the LPO page is unchanged: job card, car, prepared by, approved by, expected dates, urgency. It gained "Sent to supplier · time · by whom" in the record.
- The supplier copy is the only LPO that leaves the system, from Supplier copy (PDF), Send to supplier and Copy: LPO number and date, the supplier, the VIN only in the vehicle box, the lines with part number and name in full, list price, discount %, net, VAT and total, the amount in words, the note, then "Approved electronically. This order was issued by the OFJ Automotive system and needs no signature or stamp." with the date and time and a QR code. No job card, no expected dates, no Deliver to, no urgency, no names.
- The QR opens `/lpo/<token>`, a public page showing only the LPO number, supplier, date, total and Valid, Cancelled or Superseded by LPO-n. The supplier's link is `/api/pdf/lpo/<token>`, approved orders only.
- Suppliers carry a default discount % and, optionally, one per part type (Suppliers page; the owner and accounts edit, Parts see). Parts enter the list price; the discount gives the net cost, editable per line; the net cost is what the markup, the quotation, the LPO and the profit use. LPO lines keep the list price and discount for the supplier copy.

## 2. Gate-in photos and videos in sync

One source of truth: the checklist the server computes from the recorded files. Every upload now hands that checklist back to the screen the moment the file is recorded, so a tick turns green only when the gate-in counts the item as done. States: Uploading with progress, Processing in amber while the file is recorded, Done in green, Failed in red with Retry. The PC page refreshes live and polls every four seconds while something is missing, so a phone upload shows within seconds without a refresh, "Finish later (video pending)" included. Checked by a test that uploads through the phone link while the PC page is open: the row turned Done on its own.

## 3. Parts pricing table

Columns from the left, sized to their content: Part, Qty, Part number, Type, List, Disc %, Net, Supplier, Availability, the three-dot menu. The part number box takes about twenty characters; once saved it shows as plain text in full with a Copy button, and wraps inside the row when long. On a small laptop the part number and type move to a second line inside the row. Discount fills in from the supplier (per part type when set) and Net is calculated; a net typed by hand recalculates the discount. Availability is "In stock" or "Order", and Order shows "arrives in [n] days". Supplier is a list from the supplier page with "+ Add a supplier…" at the bottom; no free typing. The menu column stays narrow; menus near the bottom open upwards and sit above the fixed bar. "Lower arm" and "Upper arm" were corrected to the control arms in the data (requests, parts, quotation lines, saved lists); the parts pool already had only the control arm names. The parts list warns "Appears twice for Front left" when the same part is picked twice for one position.

## 4. Customer links open the PDF

View opens the PDF itself in a new tab: "View quotation (PDF)", "View estimate (PDF)", "View report (PDF)", "View proforma (PDF)", "View tax invoice (PDF)", "View receipt (PDF)". The HTML full views are gone. The first page keeps the header, customer and vehicle, the total or amount and its one action, and stays open behind the PDF. The PDF is rendered on request, so it always shows the latest version; opening the quotation PDF is what now records that the customer read the full document. Not tested on a real iPhone or Android from WhatsApp: the PDF routes answer with the inline content type that phone browsers open directly.

## 5. Advisors on each other's quotations

Any advisor opens, edits and sends any quotation, revised quotation, proforma or invoice. The car keeps its own advisor. Who prepared and who sent are recorded on quotations (created by, sent by) and now on invoices (sent by, sent at). The car's advisor is told when someone else starts on his quotation and when someone else sends it. One person edits at a time: the screen takes a lock every half minute and releases it on leaving; others see "<name> is editing this quotation" and can read it but not change it (saves are refused) until he leaves or a minute and a half passes without his heartbeat.

## 6. Expected payment method

"Customer will pay by" in the internal part of the quotation: Not sure (default, card rate), Card 2.26%, Payment link 1.75%, Cash, Cheque and Bank transfer 0%. It sets the estimated bank charge only, never shows to the customer and never restricts how they pay; the real charge replaces it at payment. "Bank transfer" (0%, its own rate in Settings) is a payment method when recording payments.

## 7. Typing

No screen redraws itself under someone's fingers any more: every live refresh (a saved change, a change by someone else, the poll) waits until nobody has typed for a moment. The Parts table keeps each row's key stable (a request's row no longer remounts when its part is first saved), saves about a second after the last keystroke or when a box is left, and shows figures as they are typed. The quotation keeps the screen's values for any line with an unsaved change. Checked by typing quickly into the markup box: the cursor stays, the box shows what was typed, and the last value is what is saved.

## 8. PDF page layout

Fixed order: header, customer and vehicle, line tables, totals, amount in words, note, bank details, footer. The totals never split; the bank details are one block at the bottom of the last page, directly above the footer. A table that continues repeats its column headings. Page 2 onwards has a compact header (logo, document type and number); the full company block and TRN are on page 1 only; the footer with Tel, Web, Email and the page number is on every page. Checked with a one-page quotation and a three-page one.

## 9. Parts receipt on the technician's screen only

"Sign here" and the technician's PIN box are gone from the Parts screen; Parts see "Waiting for <technician> to confirm", then "received by <technician>, <time>". The technician's screen has "Parts for this car" directly under Start work / Pause: "<n> parts waiting for you" with Receive parts (the card lights up; the bell chimes), then the line-by-line confirmation with his PIN, below it what he has received and what is still on order with its expected day, and "Report a wrong or faulty part". On a shared tablet he sees only his own parts. The owner (no PIN) and the workshop manager (his own PIN) can still sign for a technician from the handover page.

## 10. WhatsApp messages

The proforma message no longer carries the bank details (they sit behind "Bank details" on the proforma page and in the PDF). Before payment the message, its preview and the link say proforma: the address is `/proforma/<token>` with the preview "OFJ Automotive, Your Proforma"; the same page shows the tax invoice once paid. Wording: "<car> is ready. Your proforma and the amount due are here: <link>. Once payment is received, your car is ready to collect." Every message the system writes is now one or two short lines plus the link (approval, report, quotation, estimate, proforma, tax invoice); the stored messages were updated.

## 11. Fixed bars and Sign out

Every fixed bottom bar spans the content area only, never the menu. Sign out (or Lock on a PIN login) sits under the person's name and photo: tap it to open a small menu. It can no longer be covered.

## 12. Quantities and bundled lines

Parts can change the quantity on the pricing table with − and + or the box. The row then says "Technician asked for 1, Parts changed to 2"; the advisor and the workshop manager are told; the quotation follows, and a sent quotation is flagged for the advisor like a price change; the LPO uses the Parts quantity; per-set parts count sets. "Split into separate parts" in the row's three-dot menu turns one row into several, each with its own name and quantity, priced on their own. The workshop manager (and the technician before submitting) has Rename and Split on the parts list.

## 13. Part names

Tap the name, or "Edit part name" first in the menu: pick from the parts pool or type a name (spell check on). The row keeps "Technician wrote: <original>". The new name is used on the quotation, the LPO, the handover list and the invoice; a sent quotation is flagged. Hand-typed names used more than once are offered to the owner as before.

## Tests

`tests/browser/test-c.mjs` (new, `npm run test:c`): 67 of 67 checks for the thirteen points. The other suites on the same clean dev server: notify 55 of 55, day 1 72 of 72, overnight 66 of 66. `npx tsc --noEmit`, `npx eslint . --max-warnings=0` and `npm run build` clean. Test rows removed afterwards.

## Assumptions

- "Superseded by LPO-n" shows when `superseded_by` is set; no screen sets it yet (no LPO replaces another today), so the verification page shows Valid or Cancelled in practice.
- A supplier's discount is taken when the supplier is picked on a row; a net typed by hand overrides it for that line.
- The lock is per person, not per tab; the owner is held by it like anyone else.
- "Chimes" is the notification bell's tone on the handover notification, which cannot be switched off.
- On the continuation pages the bank details sit at the bottom of the last page even when that page holds only the amount in words; the totals block stays whole on the page before.

## Not done

- Testing the PDF links on a real iPhone and Android from WhatsApp (no phone here); the links answer inline PDF, which both open in the browser.
- A flow that marks an LPO superseded.
