# Fixes from the first day of staff testing, 10 October 2026

Everything below was built, applied to the live database (three migrations, backup first in `backups/2026-10-10T14-23-23`) and tested by running it in a headless browser against a local copy of the site: 71 checks, all passing. The morning's three tasks were confirmed finished first: the test data is cleared (only staff, settings, lists, suppliers and the change log remain), the invoice Options card is gone, and every customer page and PDF follows `docs/ofj-invoice-design.html`.

## A. Bugs

- **A1 Add photo.** Two causes. A technician added to the car later (or after a reassignment) was refused by the upload rule, which only knew the inspection's first technician; now anyone on the car can add files. And phones hand over large or HEIC photos: the picker now has "+ Photo" (camera), "+ From gallery" (several at once) and "+ Video (60 s)"; every photo is redrawn as a JPEG of at most 2000 px before it goes up, so an 8 MB phone picture becomes a few hundred KB and shows everywhere.
- **A2 Checklist scrolls by itself / A3 quotation jumps to the top.** One guard for every form in the app (`FormGuard`, mounted once in the layout): the scroll position is remembered when a form is sent and put back when the same page comes back; a page refresh after an autosave is checked too. Tested: tapping BAD on item 7 of the checklist, adding and removing quotation lines, asking Parts for a part; the page stayed within a few pixels every time.
- **A4 Parts added several times from one tap.** Three locks. The same guard swallows a second tap on any button for five seconds (the button goes pale). Every change the quotation editor sends carries a key, so a retry after a dropped connection is the same change, never a second row (`client_key` on quotation lines and part requests, unique). Tested with a double tap on "Send to Parts": one request.
- **A5 Several technicians.** The assignment screen and the job card now show technicians as tap chips; tick one or more. The first ticked is the lead (does the inspection, name on the job). All of them get the car on their tablet. The planning card already allowed several.
- **A6 Add, remove, change technicians any time.** A "Technicians on the car" card on the job card and the work order: one tap adds a technician, "Take off" removes one (his clock stops, the lead passes to the next one, an unapproved inspection goes with it), "Make lead" moves the inspection and the name. Open from the first assignment until you confirm the work finished.
- **A7 WhatsApp preview without logo.** The served tags were correct, so the image itself was the suspect: WhatsApp wants a plain JPEG of 1200 by 630 under 300 KB with its size declared. Every customer link now sends `preview.jpg` (the logo on white with "Dubai", 19 KB) with width, height, type, secure URL, locale and the older `image_src` link some versions read. Send yourself one link after the deploy to confirm on your phone.
- **A8 Total / Partial in the deposit box.** Every payment box is the same three-tap form: method, Full amount or Partial, Record. Before the proforma exists, the deposit box knows the approved total less deposits taken, so Full amount is there too.

## B. Inspection

- **B1** The pre-scan gate is on. The technician attaches the PDF or asks "Scan not possible"; the manager approves that as before.
- **B2** The road test is a clear three-way choice at assignment with nothing pre-chosen: "Road test needed · QC inspector drives it first", "No road test · inspection starts now", "Not possible · write why below". A car that does not run is pre-set to Not possible.
- **B3** Quick remarks on every item: Noise, Crack, Broken, Leak, Worn, Loose, Missing, Corroded (Settings, one per line), shown before the remarks learned from earlier reports.
- **B4** Tyre size front and rear at the top of the Tyres card, with "Same as front". Typed as 275/40r20 or 275 40 20, saved as 275/40 R20. Required, shown on the manager's review, the customer's report and the PDF.
- **B5** The manager's review is one compact checklist: one line per item, BAD first, then AVERAGE, then anything not marked; GOOD and N/A folded under one line. Tap a line to open the remark, the parts rows, the edit history and the photos.

## C. Quotation, estimate, customer links

- **C1** Hours take 0.1 steps everywhere (checked: 1.3 h stays 1.3 h).
- **C2** A ready-made service is priced "By hours" or "Fixed price": one tap, one box, in Settings > Services.
- **C3** Only the customer's requests appear by themselves as headings on the quotation (all of them, with the technician's verdict: BAD, AVG, GOOD or Not checked). The report's findings sit in an amber reference list under the labour block, BAD first, each with "Add to quotation" (it becomes a heading with its line) and "Ask Parts". Nothing in that list stops sending; the count is a soft note.
- **C4** Settings > "Advisors can discount labour" (off by default). On: advisors get a small discount link on labour and service lines; parts are never discountable by advisors.
- **C5 and C6** Your correction applied: no "Prepared by" anywhere, no staff names on anything the customer sees (quotation, estimate, report, proforma, tax invoice, receipt, approval page, and all their PDFs); the line is also gone from `docs/ofj-invoice-design.html`. The only names are the "Call <advisor>" and WhatsApp buttons. Internally everything still records who prepared, issued and approved what.
- **C7** The customer's report shows findings, remarks and photos only (no "Needs" line, no parts list). The technician's notes block is titled "Workshop notes".
- **C8** The customer's quotation page has the section titles in the table header, bold subtotal and discount rows, and the design header and footer.
- **C9** "Bank transfer" is now "Bank details" on pages and PDFs.
- **C10** Each part line on the quotation, the estimate and their PDFs says "In stock", "Arrives in N days" (from the date Parts gave) or "To order".
- **C11** The approval page has two big buttons under the greeting: "Call <advisor first name>" and "WhatsApp".

## D. Parts

- **D1** The VIN with a Copy button on every Parts screen: the desk, the job's parts page, LPOs, handover, trail, questions.
- **D2** "Not available" on a requested part, with an optional note. The request closes, the advisor is notified, and the quotation shows an amber "Not available from Parts" box with the note.
- **D3** Supplier list at Parts > Suppliers (name, TRN, phone, email, address, payment terms; Parts, accounts and the owner edit). The LPO form picks from it (or types a new name, which is added). The LPO PDF prints the supplier's TRN, address, phone and terms.
- **D4** Purchase orders are called LPOs everywhere; new numbers run LPO-00001 onwards (PO-00001 from today keeps its number). The LPO shows the vehicle (make, model, year, plate, VIN), the job number, prepared by and approved by.
- **D5** LPO lines: part number and name on one line, then quantity and price.

## E. Manager

- **E1** Workshop managers, technicians, QC and gate-in see no proforma or invoice tile, no amounts and no money lines in the job history; after QC their job card says "QC passed and the car is ready. The advisor and accounts take it from here."
- **E2** The manager sets a time budget for the technicians on the work order (hours and a reason). The countdown on the tablet and the job summary use the budget; the price and the hours charged never change; the change is logged and shown on the job summary with the reason.

## F. Invoicing

- **F1 Proforma first.** When the car is Ready, the proforma (PRO-00001 onwards, "This is not a tax invoice" on the page) is prepared by itself from the approved quotation; deposits already taken count against it. The advisor presses "Send the proforma": the WhatsApp message carries the bank details, and the page has Bank details and Pay now. Payments are recorded against the proforma. At zero balance the tax invoice is generated by itself (next INV number, today's date, marked paid, payments moved across), accounts are told to check it, and the advisor is told "Tax invoice ready to send" (a second button, its own message in Settings). The customer's proforma link then shows the paid tax invoice and the receipts. Nobody can issue a tax invoice by hand while money is owed; the owner can, with a reason, and accounts are told. Gate-out still needs full payment or the owner's override. Job card tiles and next steps now say "Send the proforma", "Awaiting payment", "Tax invoice ready to send".
- **F2 Bank charges per method.** Card 2.26 %, payment link 1.75 %, cash 0, cheque 0, editable by the owner (Settings) and by accounts (a line at the top of Invoices). Each payment takes its own method's rate, split payments too; quotations assume the highest rate for the hidden Fee line until the money comes in; the note under the payment box shows the rate and the amount.

## G. Text tidiness

Names (customers, companies, makes, models, suppliers, brands) go to Title Case; plates, VINs, part numbers and TRNs to CAPITALS; descriptions, remarks, notes, requests and quotation lines to sentence case. It happens twice: in the box as the person leaves it (and the phone keyboard is told which case to use), and again in the database on save, so nothing shouty or all-lower-case gets through. Words typed with their own capitals (McLaren) stay; known words keep their form (BMW, AMG, A/C, ABS, TPMS, VIN, QC, LPO and about 90 more, editable in Settings > Known words). Existing entries were tidied once (the Ferrari model became "California"). Settings > "Print customer documents in CAPITALS" (off) prints every customer page and PDF in capitals when on.

## Assumptions

- The first ticked technician is the lead; the others can help on the tablet and see the car in My jobs.
- Taking the lead off the car passes the lead (and an unapproved inspection) to the next technician on it.
- "Add to quotation" from the findings list adds an empty labour line under that finding for the advisor to describe.
- Estimates have no customer requests, so their labour lines stay under "Other labour and services".
- The proforma is prepared when the car becomes Ready (after the wash, or an owner's move to Ready). If a car is already Ready with nothing prepared, "Prepare the proforma" on the job card does it.
- The quotation's hidden bank charge uses the highest of the four rates (2.26 %).
- Sentence case lowers a shouty or all-lower text; mixed-case text only gets its sentence starts capitalised, so brand names typed properly inside a description are kept.
- WhatsApp cannot be tested from here; the tags are the ones its documentation asks for.

## Not done or waiting for you

- WhatsApp preview: send yourself an approval or quotation link after the deploy and check the logo shows.
- D4: LPO-00001 starts with the next LPO; the one raised today stays PO-00001.
