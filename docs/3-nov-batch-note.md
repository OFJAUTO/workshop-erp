# 3 November 2026 batch: round-off, Zoho sync selection, STL-00005

## A1 · Optional round-off on every document (LIVE)

One **Round off** button, the same window everywhere:

- **Quotations, estimates, additional versions**: in the editor's Summary box, under the totals.
- **Proformas**: on the job's money page (Payments and invoice), in the money summary.
- **Pending charges**: on the open pending charge, next to Record payment.

What it does:

- Off by default. The window offers the nearest **AED 1 / 10 / 50 / 100, down or up**, and **"Set the total to"** (type the total including VAT).
- The round-off always adjusts the amount **before VAT**, and VAT is recalculated, so VAT is exactly 5% of the taxable amount and the total lands on the chosen number. On Q-00039's example: −8.13 → 36,123.81 + VAT 1,806.19 = **37,930.00**.
- It shows once as **"Round-off − AED 8.13"**: in the editor's Summary, on the customer's document and on the PDF.
- **Sending no longer rounds down by itself.** The old automatic round-down at Send is gone; a round-off is now always a person's own choice.

Limits (Settings > Money, two new boxes):

- Advisors may round **down up to AED 100** per document. More is stored but the quotation **waits for the owner** at Send ("round-off AED 119.05 (limit AED 100)"), exactly like a big discount; the owner approves from his box. On a proforma, above the limit is refused outright (the owner applies it there).
- Rounding **up is capped at AED 10** for everyone.
- A proforma (and so the tax invoice) can **never go above the approved quotation total**, and never below what is already paid.
- A round-off set early is dropped by itself if later line changes would turn it into an over-limit round-UP.

Carrying and money:

- A round-off agreed on the quotation **carries to the proforma and the tax invoice** unchanged; the proforma can take its own further round-off (within the caps).
- It counts in the shared profit calculation and the advisor bonus (through the one net figure), and posts to **Zoho** as the taxed negative "Round-off" line, as before - totals match to the fils because VAT is exactly 5% on both sides.

No database change: the two limit settings save by upsert. **WAITING FOR APPLY: nothing.**

Proof: `tests/unit/roundoff.test.mjs` (32 checks; every whole total from 1 to 20,000 lands exactly with VAT exactly 5%) and `npm run test:roundoff` (33 browser checks: the editor, the limits, the owner flow end to end, the customer approval, the proforma and tax invoice carry, the PDF printing ROUND-OFF once). The window is in the pop-up layout check.

## A2 · Zoho manual sync: choose items, confirm, why "still waiting" (LIVE)

On the Zoho Books page:

- A **tick box on every Waiting row**, with **Select all**, **Clear**, **Select by type** (tax invoices, payments, supplier bills, supplier payments, settlements, credit notes - whatever is waiting) and **Select by date** (up to a day). The button reads **"Sync 2 selected"** and sends only those.
- A **"Sync this"** button on every waiting row (Mathew's drawing) - the same window, one item.
- The confirm window always asks first, naming the book: **"Do you want to sync and record these 2 items to Zoho (OFJ TEST)?"** with the list, money in/out, Cancel and "Yes, sync and record…".
- **Dependencies**: a ticked item that needs another document first is named in the window. A parent still in the queue gets **"Add it to this sync"**; a parent that FAILED shows the reason and the fix link ("…waits for the GOLDEN ZONE supplier bill, which failed: needs its 15-digit TRN → Fix the supplier").
- **Why "still waiting"**: every waiting row on the page now says what it hangs on, with the link; every failed row's reason carries a fix link where one exists (TRN → the suppliers page, mapping → the mapping page).

### The item that is stuck right now (the "1 still waiting" of the last 4 syncs)

**The supplier payment of LPO-00035-2 (SPARE HUB SPARE PARTS)** - 854 tries. It waits for its bill, which is red with "Zoho said: You can specify Tax Treatment only for transactions within tax period." The cause is in our own data: the supplier invoice **2374 is dated 28/10/2016** - a typo for 2026 - and Zoho refuses a UAE-taxed bill dated before VAT existed. The fix (one minute): open LPO-00035-2, correct the supplier invoice date to 29/10/2026, then Retry on the red bill row - the payment follows by itself.

## A3 · STL-00005: card machine or payment link?

From the records (read-only):

- **STL-00005** (settled 02/11, statement ref 311026455340246): method stored **card machine**, 1 payment, gross 8,000.00, recorded as received **7,851.95** with fees **MSF 140.00 + transaction fee 1.00 + VAT 7.05 = 148.05**, difference 0, source: typed by hand (no bank file).
- Its payment **RCT-00041** (AED 8,000, auth B0A60C, recorded by hand - not through the Pay-now gateway): method **card**, and the ERP's own estimate at recording time was the card rate (bank_charge_aed 172.00).
- The Zoho posting went through (synced 02/11): transfer 7,851.95 clearing → bank, fee expense 148.05 **from the CARD clearing account**.

What the figures say: **140.00 + 1.00 + VAT is exactly the PAYMENT LINK structure** (1.75% of 8,000 + AED 1 per transaction). The card machine has no per-transaction fee: it would be 172.00 + VAT 8.60 = 180.60, net 7,819.40. Since the settlement figures were typed from the bank's payout, the bank itself settled this as a **payment link** transaction - so the most likely truth is: **the customer paid by payment link, and both the receipt (RCT-00041) and the settlement were recorded as "card machine" by mistake.**

Nothing was changed. When Mathew confirms against the bank statement (the terminal line will say M/… for link, E/… for the machine):

1. If it was a **link**: correct RCT-00041's method to payment link (void + re-record, keeping auth B0A60C), undo STL-00005 and record it again under the link method - the fees as typed are then right, and Zoho's transfer/expense move to the **link clearing account** (the undo re-opens the Zoho row by itself).
2. If it really was the **card machine**: the bank's payout would have been 7,819.40, so the typed 148.05/7,851.95 would not match the statement - undo STL-00005 and record it with MSF 172.00 + VAT 8.60 (the form pre-fills the 5%), and the AED 32.55 difference against what was typed shows up.

## Timing

Filled in at the end of Part A.
