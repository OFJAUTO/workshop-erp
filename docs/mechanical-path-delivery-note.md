# The rest of the mechanical path: delivery note (9 October 2026)

Everything from the approved quotation to gate-out is built, tested end to end on a local copy with one car, and pushed live. This note lists what was built, every assumption made where the brief was open, and the settings to fill in before people use it. The step-by-step test is in `test-script-gate-in-to-gate-out.md`; sample PDFs of every document are in `samples/`.

## What was built

- **Company details and labour rate rules.** Legal name (English and Arabic), address lines, phone, website, email, TRN and the RAKBANK details are in Settings and appear on every PDF. The mechanical labour rate is AED 350 per hour with optional rates per make; the advisor can raise the rate on a line but never lower it (the standard rate is shown next to the box and a lower figure turns red and is refused); the owner can go lower; every change is logged on the quotation. The bodyshop rate setting exists but is empty.
- **One document template** for the quotation, estimate, inspection report, proforma, tax invoice, receipt, credit note and purchase order: logo and legal name header with the TRN block, big title with number, date, job card and advisor, customer and vehicle boxes, Services then Spare parts tables with VAT per line, one bold discount line, amount in words, payments received, bank transfer details, status box (Amount due, Balance due, Paid in full with the date, Cheque pending clearance), footer with prepared by, the computer-generated note, the terms link, a QR code to the customer page and page numbers, and the Tel / Web / Email row. Zero prices print as "Complimentary". Internal costs never print.
- **The dirham symbol** as a vector from Wikimedia Commons (public domain, CC0 1.0; the file is kept as `public/dirham.svg`), before the number and the same height as the digits, on every PDF and on the customer web pages (quotation and invoice). Staff screens keep "AED". A setting switches the documents back to the letters AED.
- **Parts ordering.** The To order list on the Parts desk groups approved parts by car and supplier; ticking them raises a numbered purchase order (PO-00001 and on). The owner or the head accountant approves it (bell with a chime); the PDF cannot be downloaded before approval. If the quotation carries an unpaid deposit, only the owner can approve, with a written reason. Parts marks it ordered with an expected date per line; late lines show red on the order, the list and the job card, and the hourly check sends a notification. Receiving is per line, partial allowed, with Wrong part or Damaged flagged for return. The supplier invoice number and a scan are compulsory, or "Invoice to follow" which sits in a pending list that turns red after the number of days in Settings; a different invoice price corrects the job cost and flags the difference. Profit stays provisional until the invoice is in. QR labels print one per part at the size in Settings (with a test print). Issue is by scanning or typing the label code, the technician ticks each part and types his PIN; there is no confirm-all; returns are scanned back. Nothing is issued unless it came in on an approved order or from stock. A consumables stock list with minimum levels is at Parts, Stock.
- **Work.** The car moves to Work when the quotation is approved and every part is issued (or none is needed). The manager's work order shows the lines with hours and no prices, assigns the whole job or single lines, shows the clock against the quote, the parts on the car, additional work found, and the Work complete button that stays grey until every line is done and every part confirmed. The technician's tablet has Start / Stop / Pause with one-tap reasons, one running clock per technician, Mark done with notes and photos per line, the dash cam and old parts reminders, Flag additional work (the manager approves, the advisor quotes it the normal way, the customer approves, the new line joins the work order). Clock in and out with the on-time and late report at Attendance. Clocked time against quoted hours is on the work order; the cost of that time is only on the owner's and accounts' screens.
- **QC.** The Cars for QC list with a notification; a checklist built from the job (customer complaints, work lines, parts fitted) plus the general checks from Settings; mileage at QC; the post-scan PDF or a written reason; Pass or Fail per item, with a remark on every Fail. Any Fail sends the car back to Work with the failed items shown in red on the technician's screen and the manager's work order, counts a rework against the technician, and the recheck lists only the failed items. All Pass sends the car to the wash. The technician who did the work cannot QC it.
- **Wash.** The wash list; Wash done with name, time and an optional photo by the manager, QC or the advisor; the advisor or the owner can skip it with a reason. Then the car is Ready.
- **Invoice and payment.** The advisor marks the car Ready to invoice; accounts build the invoice from the approved quotations, the additional work and the inspection fee (hidden lines excluded, prices locked), itemised or as one Labour charges line, with the Consumables line, a discount percent or an agreed total that works the discount out on labour and services within the limit and lands exactly on the agreed figure. Tax invoices are INV-00001 and on; a proforma can go out first. Cash, card, payment link and cheque, several payments per invoice, deposits apply automatically, a receipt PDF per payment. A cheque counts as unpaid until marked cleared; a bounce reverses it. Card and link payments carry the bank charge from Settings as an internal cost. An issued invoice is locked; accounts ask the owner for a credit note and the owner issues it. A job whose quotation was declined is invoiced for the inspection fee. A spreadsheet export (CSV) of invoices and payments is on the Invoices page.
- **Gate-out.** Customer collects, customer's driver collects, or delivery by recovery with address, date and time, our truck or an outside company with its fee, loading photos and the "Left the workshop" stamp, then "Delivered" with the name, time and a photo. The "Your car is ready" WhatsApp message with the invoice link and the balance. A balance due blocks the gate unless the owner or accounts approve the release with a reason; the keys must match gate-in (a different number needs a reason); dash cam reconnected and old parts handed over are ticked; handover photos or video, the collecting person's name and the confirmation tick. The gate-out time and user are locked and the job closes. A follow-up reminder with a WhatsApp template appears after the number of days in Settings.
- **Daily profit.** Profit per invoice is the selling price before VAT minus parts, Other and Recovery costs, stock used, clocked time at the cost rate and bank charges, counted on the invoice date, invoiced and collected shown separately, with the carry from earlier days of the month that resets monthly, green, yellow or red against the target. The Profit page lists every invoice with its figures; provisional ones are marked.
- **Job card stage cards** for Parts, Work, QC, Wash and Invoice with live state and buttons; Next step wording and dashboard wording for every new status; a notification with a chime at every hand-over; owner sees and can do everything; role limits are enforced in the database as well as on screen; managers, technicians and QC never see prices.

## Assumptions made where the brief was open

1. The two attached design files (ofj-invoice-design.html and ofj-logo.svg) never reached the project folder, so the documents follow the written description in the brief and use the existing logo file.
2. A part marked "in stock" by Parts never goes on a purchase order: at customer approval it counts as received from the shelf, gets a label and can be issued.
3. One purchase order per car and supplier; a second batch for the same car becomes a second order.
4. The head accountant is the accounts person with the "head accountant" tick on their staff record; the owner can always approve.
5. A credit note is issued by the owner only, after accounts ask for it from the invoice page; it credits a stated amount before VAT with a description.
6. Prepared by on an invoice is the job's advisor; on a credit note it is the person who issued it.
7. The invoice draft is not stored: options (itemised or combined labour, Consumables, agreed total or discount) are chosen when the invoice is issued and locked from then on.
8. Delivery by recovery closes the job at "Delivered", not at "Left the workshop"; the job shows "Out for delivery" in between.
9. Late parts are checked by the hourly job and notify Parts and the advisor once per line.
10. The bank charge on a card or link payment is taken from the two percentages already in Settings and recorded on the payment as an internal cost.
11. The spreadsheet export is a CSV file (opens in Excel and Google Sheets), one section for invoices and one for payments, with a date range.
12. QR labels print through the browser's print dialog at the size in Settings; the thermal printer is chosen there. The page lives outside the app frame so only the labels print.
13. The QC checklist keeps its items as a list inside the check record; editing the general checks in Settings changes future checks only.
14. The shift clock counts "late" against the opening hour in Settings; there is no roster yet.
15. The follow-up reminder is a card on the job card plus a notification to the advisor; nothing is sent automatically.
16. The purchase order uses the same currency setting as every other document.
17. An additional quotation can only move the promised date later, never earlier.

## Settings to fill in (Settings page)

- Legal name in Arabic (a transliteration is pre-filled; correct it).
- Address lines 1 to 3 (pre-filled from the brief), phone, email, website, TRN (pre-filled).
- Bank details (pre-filled from the brief): check the IBAN and account name.
- Currency on customer documents: dirham symbol (default) or AED.
- Next invoice number if the numbering should not start at INV-00001.
- Consumables line default amount (AED 50 pre-filled).
- Labour rate per make, if some makes have a higher standard rate.
- Part label size in millimetres (50 × 30 pre-filled); use "Test print a label".
- QC general checks, one per line (a starting list is pre-filled).
- Follow-up after gate-out in days (3 pre-filled).
- The "Your car is ready" and follow-up WhatsApp messages.
- Daily profit target and the yellow threshold, the technician cost rate per hour, the bank charge percentages for card and link, the discount limit, and the supplier-invoice pending days (these existed before; check them).
- The working days (used for the monthly profit carry).

## What is deliberately not built

Zoho Books, the bodyshop path (paint, PPF, tint) and the phone app. The data model leaves room for them: `jobs.department`, the empty bodyshop labour rate, `invoices` with a plain numbering that Zoho can take over, and the public customer pages that a phone app could reuse.
