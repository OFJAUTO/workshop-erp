# 14 October 2026: inspection photos, PDF import, pricing, quote layout, discounts, commission, parts and LPO flow

Plain words on what changed, where to click, and what to expect. Migrations `20261027090000_quote_layout_commission_lpo.sql` and `20261027100000_inspection_media_remove.sql` (both applied; a backup was taken first).

## 1. Tyre and AC photos on the inspection

- Every tyre line (front left, front right, rear left, rear right, spare) has a small camera icon. Tap it, take one or several photos. The AC vent temperature reading has the same icon.
- Photos show as thumbnails with an X in the corner. The X removes the photo (it is kept in the database as removed, never deleted).
- The customer's report link and the report PDF show these photos next to the matching reading (the tyre or the vent).

## 2. PDF as a fourth import option

- Parts page > Import prices > **Upload PDF**. A PDF with text is read page by page: part number, name, quantity, price, availability in their own columns; totals, VAT and page footers are left out; the VIN is picked up when the PDF carries it.
- A scanned PDF (a picture, no text) goes through the screenshot reader page by page. That reader needs the environment key (see the afternoon note of 13 October); until it is set, the screen says so and asks for the file or the text instead.
- Everything after that is the same check screen, the same mapping screen, the same Apply and the same Undo last import.
- Sample: `docs/supplier-pdf-sample.pdf` (two pages, four parts, totals on the last page).

## 3. The photo viewer

- One viewer everywhere (inspection form, report link, job card media, gate-in photos): arrows, swipe, "2 of 5", X, Esc, tap outside. Videos play inside the viewer.

## 4. The photo buttons

- One row: **Photo**, **Gallery**, **Video**; "Photo from my phone" is a small phone icon in the same row.

## 5. The Saved tag

- A small tick next to the item name instead of a tag over the Bad button.

## 6. Pricing done

- **Pricing done** turns green, shows the time, and locks every row. An **Edit** button opens the rows again; the bar then says **Send updated prices**. Pressing it tells the advisor "Prices changed on [car]"; if the quotation was already sent to the customer, the message says so and asks for a revised version.
- The job board shows a green **Priced** chip on the car while the quotation is being built or waits for the customer.

## 7. Genuine / Aftermarket dropdown

- The Type column is wider; "Aftermarket" reads in full at 1366 and 1920.

## 8. Custom days

- Other… > type 15 > the one box says **15 days**. The days box shows only while typing.

## 9. Labour at cost from the estimate

- Each labour line has an **est.** box (default = the quoted hours). Labour at cost is "estimate × AED rate" until the work is done, then the clocked hours take over: the label says "Labour at cost (25 h estimate × AED 90)" or "(… clocked × …)".
- The owner's job summary shows hours quoted, hours estimated and hours clocked; the job report page has "Hours quoted", "Hours estimated" and "On the clock".

## 10. Outside work

- A fixed-price service line has an internal **our cost** box (default 0). It adds to the total cost and is never shown to the customer.

## 11. Parts margin

- The internal box shows the parts margin and "X parts not priced yet, margin incomplete" while prices are missing.

## 12. Parts markup

- Minimum 5%, no maximum. Below 5% goes back to 5% with "Minimum 5%" (the owner can go below). Above 100% the row turns amber and is asked about once: "Markup is 500%. Is that right?" with **Yes, keep it** or **Change**.

## 13. Commission

- In the grey internal box of the quotation: who (one tap from the list, or type a name that joins the list in Settings) and how much (fixed AED or % of the total before VAT). It adds to the cost. It is never on the customer link, the PDF, the proforma or the invoice.
- Reports > Monthly: a **Commissions** card lists every commission on the jobs of the month, plus unpaid ones from earlier months, each Paid or Not paid with a one-tap **Mark paid**. The monthly PDF carries the same list.

## 14. Discount

- **Discount** next to "+ Add a part": one box with a % | AED toggle. It applies to our own labour lines only. Shown in bold green as "Labour discount (10%): − AED 1,307.00" and "Round-off: − AED 4.26", before VAT, on the screen, the link, the PDF, the proforma and the tax invoice. The internal box reduces the profit by both. A revised quotation keeps the discount.

## 15 and 16. The layout

- Line numbers restart in each section. Three bordered boxes (Labour and services, Parts, Other charges) with a light grey heading bar (title left, "7 lines" right), columns #, Description, Qty, Rate, Amount, and a grey subtotal row each. Part availability as a small grey line under the name. Part numbers never. The totals box on the right: sections, Labour discount and Round-off in bold green, a thin line, Subtotal before VAT, VAT 5%, Grand total bold and larger. The proforma and the tax invoice follow the same layout.

## 17. Parts after approval: the LPO flow

- The "Planning: the approved parts" screen is gone. After the customer approves, the approved parts land on the Parts list by themselves. Parts see a short summary ("7 parts approved · 5 to order from 2 suppliers, AED … · 2 from our stock") and **one** button: **Send LPO for approval**.
- **Main LPO** (internal): one per job with every supplier, grouped by supplier with a subtotal each and a grand total. The owner or the head accountant gets a notification and approves with one tap.
- **Supplier LPOs**: at approval, one LPO per supplier is made, numbered from the main one: LPO-00012-1, LPO-00012-2, LPO-00012-3. Each card shows only that supplier's parts (part number, name, quantity, our agreed price, the VIN) with **Copy** (clean text), **PDF** (the supplier copy) and **Ordered**. Never the customer, the other suppliers or the selling prices.
- **Ordered** computes the arrival dates from the availability entered at pricing (counted from the day of ordering). The job card and the planning show "All parts here by [date]". One part's date is changed with a tap on its date chip.
- **Our stock** is a supplier choice at pricing: the part is in stock and skips the LPO. A car whose parts are all from stock goes straight to the workshop manager's planning.
- Receiving stays as it was (line by line on the supplier LPO; the technician confirms with his PIN at handover). The LPO list shows the main LPO while it waits; afterwards the supplier LPOs carry the state.

## 18. The sidebar logo

- Centred, a quarter bigger, with space before Home. (The app has no slide-out menu: on a phone the bar is a horizontal strip, where the logo is also bigger.)

## Checked at the end: nothing internal on anything the customer sees

Quotation and estimate PDFs, the customer links, the proforma and the tax invoice: no part numbers, no commission, no internal costs, no staff names. The test suite reads the PDFs back and checks the words.

## Tests

`npm run test:h` (tests/browser/test-h.mjs) against `npx next dev -p 3100`: PDF import, Type width, "15 days", Our stock, Pricing done / Edit / Send updated prices, the Priced chip, the estimate box, the labour discount, the commission, the markup rules, the quotation PDF words, the whole LPO flow with the supplier PDF words, the monthly commissions with Mark paid, the inspection icons, the viewer, the X, the Saved tick, the logo.
