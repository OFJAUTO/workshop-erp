# Section 12 (list of 2 November 2026, built 3 November): Parts accounts + suppliers search

## What was wrong

- There was no one place where accounts could see the supplier side of the money. The facts were spread over the
  Parts desk, the LPO list, Supplier invoices, the LPO pages and Returns and leftovers, and nothing put the cost of a
  part next to what the customer was charged for it.
- Some problems could only be found by opening car after car: a part bought and fitted but never put on the customer's
  invoice, a part received without the supplier's invoice, a supplier price different from the LPO, a placeholder cost
  of AED 1.00, a supplier invoice that arrived after the customer's tax invoice was issued (the job's profit still counts
  the old cost).
- The Suppliers list had no search and no way to find the suppliers without a TRN or with money owed.
- Small faults found on the way: the "Paid to supplier (on the LPO)" button pointed at a place on the LPO page that did
  not exist (it opened at the top); the "VAT registered but no TRN" rule was written twice; the supplier invoices list
  stopped silently at 1,000 rows; "unpaid per supplier" added two suppliers of the same name together.

## What changed

### New page: Parts accounts (menu: "Parts accounts", accounts and the owner only)

Across the top, five boxes that follow the search, supplier and dates you choose:
**Parts bought** (what the parts cost us), **Charged to customers** (the parts on tax invoices), **Parts margin**,
**Owed to suppliers** (unpaid supplier invoices with VAT, plus invoices still to follow) and **Problems** (red when
something needs a look). Tap a box to open the list behind it.

Six tabs, one filter bar (search by plate, job number, VIN, part, LPO or invoice number; supplier; status; from / to
dates) and quick buttons on each tab:

1. **Parts lines** – every part bought for a car: car and job, part, supplier, LPO, quantity, cost (the supplier invoice
   price when there is one), selling price (the tax invoice, else the proforma, else the approved quotation), margin,
   and where it stands with four dots: Ordered · Received · Fitted · Invoiced. Each dot is its own fact: a part put on
   an early tax invoice while it is still with the supplier shows Received grey, says "Invoiced INV-… · not received
   yet" and still counts as Late from the supplier. Endings are shown instead when the part went back to the supplier,
   to stock, was scrapped, refused on the LPO, fitted as goodwill, and so on. A free comeback's parts sell for AED 0
   ("free comeback (warranty repair, the customer paid nothing)").
   Quick buttons: Parts bought · Bought, not invoiced yet · Invoiced · Late from the supplier · Returned, stock, refused….
2. **LPOs** – every LPO: supplier, car, amount before and with VAT, approved by whom and when, ordered, received, the
   supplier invoice and its match ("Matches LPO ✓", "Price changed"…), paid with method and reference.
   Quick buttons: **Approved but not ordered** · **Ordered but not received** · Received, invoice missing · Invoiced,
   not paid.
3. **Supplier invoices** – the same screen as before, now also here. The "Supplier invoices" menu link stays, and
   Parts still see that page. Mark checked and Query pressed inside this tab come back to this tab.
4. **Payments to suppliers** – one card per supplier: invoiced, paid, **unpaid** (with VAT), the oldest unpaid date,
   invoices still to follow and credits due from returns. "See the invoices" lists each one, paid ones with the date,
   method and reference; "Pay on the LPO" opens the LPO's payment box directly (a stock order without a car too). One
   supplier invoice split over two cars is paid LPO by LPO: once one LPO is paid it reads "Partly paid · AED x to pay",
   only the rest counts as unpaid, and there is one "Pay LPO-…" link for each LPO still to pay.
5. **Returns and credits** – parts returned to the supplier waiting for the credit note (red after 14 days, changeable
   in Settings > Money), parts scanned back to go to the supplier, and parts bought but still waiting for an ending.
   The credit note counts as on file when its number was typed on Returns and leftovers ("Returned to supplier") or its
   scan is there. A part never bought (marked not needed while its LPO still waited for approval) owes no credit and is
   not listed. The credit expected is what the part cost us, with VAT when the supplier is VAT registered.
6. **Problems** – red first:
   - Bought, never charged (fitted or received, the car invoiced or gone, the part on neither the tax invoice nor a
     live proforma; a car released on credit with its proforma unpaid IS charged, the customer owes it)
   - Bought, not on the quotation (open car: caught before the invoice)
   - Received, no supplier invoice (red after 7 days)
   - Price different from the LPO (red while it waits for the owner's OK or is queried)
   - Placeholder cost (the Parts desk's "Prices to fix" list for open cars, and AED 1.00 costs on cars that left)
   - Cost changed after invoicing ("INV-00003 counts the cost as AED 500.00, the supplier invoice makes it AED 520.00:
     the job's profit is overstated by AED 20.00")
   - Supplier invoice to look at (possible duplicate, or a query still open)
   - Credit note missing
   - Supplier without TRN

**Export this tab** gives the tab as an Excel file with the same filters (on Supplier invoices: Unpaid, Match problems
and the car too); **Export everything** gives one file with six sheets. Dates in the file are Dubai days.

### Suppliers list (Parts > Suppliers)

- A search box: name, phone (however it is typed, mobiles and landlines alike: "052 956 2232" finds
  "+971 52 956 2232", "04 555 1212" finds "+971 4 555 1212"), TRN, email, contact person, notes.
- Two quick buttons: **VAT registered but no TRN** and **Unpaid balance**. Each supplier with money owed shows
  "Unpaid AED x (n)"; tap it to open that supplier's payments (accounts and the owner) or their unpaid supplier
  invoices (Parts).
- A new box **Contact person** on each supplier (it appears once the database change below is applied).

### Small fixes

- "Paid to supplier (on the LPO)" now opens the LPO page at its payment box.
- One rule for "VAT registered but no TRN" (Suppliers list, LPO page, Parts accounts).
- The supplier invoices list reads every row (no silent stop at 1,000). A read that fails says so in words on
  Parts accounts, Supplier invoices, Suppliers and the exports; on the job card and accounts' Waiting on you it is
  logged and the rest of the page still shows; after receiving parts or entering an invoice, a failure to tell
  accounts is logged and never turns the finished save into an error.
- Unpaid per supplier is kept per supplier, never merged by name.

### Review fixes (3 November, after an independent review)

- The **Parts bought** box opens the list its figure is made of (a new "Parts bought" quick button), like Charged and
  Margin.
- Each Ordered · Received · Fitted · Invoiced dot is its own fact (see Parts lines above); dates in the status are plain
  ("Ordered, expected 5 Nov 2026").
- A split supplier invoice paid on one LPO: only the rest is unpaid everywhere (Payments to suppliers, the Owed box,
  the suppliers list), with a Pay link to each LPO still to pay and a paid/unpaid line per LPO on the opened invoice.
- Mark checked and Query show their answer inside the opened invoice, next to the buttons.
- "Export this tab" on Supplier invoices carries Unpaid, Match problems and the car.
- The Paid to supplier box now exists on a stock order's LPO page (no car).
- A typed credit note number counts as on file; a never-bought part is not under Returns and credits.
- A car released on credit (proforma unpaid) is not "Bought, never charged"; a free comeback's parts sell for AED 0.
- A part replacing one marked not needed before ordering carries the approved quotation line (never a false "Bought,
  not on the quotation").
- A part on a main LPO still waiting for approval shows its own supplier (not "2 suppliers") and stays under the
  supplier filter.
- Landline phone search in either format; Excel dates as Dubai days.

## What the database change does (waiting for "apply")

Migration `20261203190000_parts_accounts.sql` adds only the supplier's **contact person** and the setting **"Supplier
credit note: days to wait"** (14). The Parts accounts page works fully without it; until it is applied the Contact
person box simply does not show. Nothing on live is changed by it.

## Lists you asked for

The page itself is the list. What the researcher read on live on 2 November (read-only, before this build) that the
Problems tab will show on day one:

| Problem | How many | Which |
|---|---|---|
| Placeholder cost (AED 1.00) | 3 | J-00609 ENGINE FLUSH (on INV-00002), J-00017 DRAIN PLUG AND WASHER, J-00969 FRONT LH GRILL SURROUND MOULDING (on LPO-00037-1 at AED 1.00) |
| Cost changed after invoicing | 2 | INV-00003: FRONT RH and FRONT LH WISHBONE LINK, invoice counts 500.00 each line, supplier invoice makes it 520.00 (profit overstated AED 40 in total) |
| Price different from the LPO (accepted) | 2 | LPO-00035-2, the same two wishbone links, +10.00 each |
| Ordered but not received | 2 | LPO-00037-1, LPO-00037-2 (J-00969) |
| Supplier without TRN | 2 suppliers | VAT registered, TRN missing: always under Parts > Suppliers > "VAT registered but no TRN"; under Problems once one of their invoices is entered |
| Bought, never charged | 0 | |
| Received, no supplier invoice | 0 | |

## What staff need to do

- **Accounts**: open **Parts accounts** from the menu each morning; look at **Problems** first (red ones), then
  **Payments to suppliers > Unpaid only** for what is due. Check supplier invoices from the Supplier invoices tab as
  before.
- **Parts**: type the TRN of the two suppliers listed under "VAT registered but no TRN" (Parts > Suppliers), and fill the
  contact person and phone of the suppliers you call, once the database change is applied.
- **Owner**: for "Cost changed after invoicing" the job's profit still counts the old cost; this build only shows it.
  Correcting the tax invoice's cost automatically is a separate small change (not built here).

## Joined with sections 7 and 9 (3 November 2026, when merged)

- **Removing an ordered part (section 7)**: a part cancelled with the supplier, sent back to the supplier or kept in
  stock is written inactive with "removed", so before joining it vanished from Parts accounts. Now every part with an
  ending is listed with section 7's own words and costs AED 0 on the job. Returns and credits: "Return to supplier –
  credit note awaited" waits for the credit note (red after the days set in Settings > Money, with a link to record it on
  Returns and leftovers); returned with the credit note = on file, with the credit note's number, date and amount once
  section 7's database change is applied; cancelled with the supplier = nothing to credit, unless the LPO was already paid
  ("Cancelled after the LPO was paid: credit due", amber); kept in stock = not on the tab. The credit expected is section
  7's figure (the credit note amount, else the supplier invoice price on the LPO line, else the LPO price). A part ended
  after its tax invoice stays red under Problems until the invoice's cost is corrected.
- **Units (section 9)**: quantities read "8 L", "2 sets" by section 9's one rule, from the part's own unit once its
  database change is applied.

## Not built in this section

- Recording the supplier's credit note on a part cancelled after its LPO was paid: section 7 records credit notes on
  returned parts only, so such a part stays amber under Problems until the supplier payment is reversed on the LPO.
- Updating the cost on an already issued tax invoice when the supplier invoice arrives later (shown as a problem only).
