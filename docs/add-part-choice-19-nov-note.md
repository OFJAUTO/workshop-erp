# Advisors: "+ Add a part" with a choice (19 November 2026, Section 5)

**Cause of the "OFJ Additional" lines:** an advisor who already knew a price had no proper way to say so on a job's quotation. A made-up supplier got the part through, and the send check then stopped it ("'OFJ Additional' is not a supplier").

## Now
"+ Add a part" opens one window first. Nothing is picked:
1. **SEND TO THE PARTS DESK TO PRICE**: as before (the part picker, then the desk prices it).
2. **I HAVE THE PRICE**: the part, how many, the **real supplier** (required; "OFJ…" stand-ins and "Our stock" are refused), the cost and the selling price.
   - It skips the desk's pricing, not its ordering: after approval it is "Approved – to order" for the desk.
   - The minimum markup, the profit display, the cost check and the check-before-send flags apply as to any part. A selling price below the minimum is refused in the window.
3. **FROM OUR STOCK**: pick the stock item (search). The cost comes from stock, the supplier is "Our stock", nothing is ordered. On an estimate the desk picks the stock item.
4. **CUSTOMER SUPPLIES IT**: no cost, no price. The line says "PART SUPPLIED BY CUSTOMER – NO WARRANTY ON THE PART" on the customer's documents. It never reaches the parts desk.
5. **PROVISIONAL AMOUNT**: one line "ADDITIONAL PARTS IF REQUIRED – UP TO AED X", approved by the customer up front.
   - On the approved quotation, **Use the provisional amount** turns it into real parts ("I have the price" or "From our stock"), with no new approval and never above what is left ("AED 440.00 left of AED 500.00").
   - A bought part is "Approved – to order" for the desk; a stock part is taken from the shelf.
   - On the bill the converted parts stand in its place; **whatever is not used never reaches the tax invoice**, and the agreed total follows.

"OFJ Additional" cannot be saved as a supplier on new lines: it is refused in "I have the price", in "Enter price myself", on estimates and on the parts desk.

## Live (read-only, 18 Nov): quotations with "OFJ Additional" parts today
For the advisors to convert. Not changed.
- **Q-00001 v1** · J-00016 · draft · ADARSH · 31 parts (LUBRICATOR HOSE, VALVE TENSIONER, ROLLER ROCKER ARM, …)
- **Q-00030 v1** · J-00609 · approved · ANAS · ENGINE FLUSH
- **Q-00039 v1** · J-00969 · approved · Omar · FRONT LH GRILL SURROUND MOULDING
- **Q-00045 v1** · J-00343 · draft · ADARSH · WINDSHIELD MOULDING STRIP

32 such parts sit on cars in the workshop. No estimate uses it.

## Assumptions
- After approval a provisional amount converts by "I have the price" or "From our stock". A part the desk must still price goes through the normal revision.
- A converted part's selling price is the one typed, else the cost plus the provisional line's markup (at least the minimum).

Test: `npm run test:s19-5` (11 checks, advisor, TEST). Proof: `docs/proof/2026-11-19-add-part/`.
