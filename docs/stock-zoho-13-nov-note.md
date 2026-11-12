# Stock purchases to Zoho – 13 November 2026 (Section 2)

**Cause of bill 9275779** (LPO-00070, MODEL AUTOMOTIVE PARTS EST, AED 94.50):
- The Zoho mapping sent stock purchases to Zoho's own "Inventory Asset".
- That is an inventory account. Zoho wants a Zoho item on every line that goes to one, so it refused the bill with "Item field under stock account cannot be empty".
- Payment SPAY-00018 waits behind the bill, because a payment never posts before the bill it pays.

**Built (option B, OFJ TEST only):**
- **The ERP is the only stock count.** On Settings > Zoho Books > Mapping, "Stock value (the ERP keeps the count)" lists only Other Current Asset accounts.
  - OFJ TEST makes "Parts stock (ERP count)" by itself.
  - A Zoho inventory account is refused in plain words, before anything is sent.
- **When a stock item is used on a job,** its cost moves from the stock value to "Stock used on jobs (cost)" in one Zoho journal. When nothing is picked for that account, Parts purchases is used.
  - The journal's reference names the job (`STK J-xxxxx …`). A second run finds it by that reference and never posts it twice.
  - A part put back on the shelf from a job moves the value back.
- **Saving the mapping puts the documents that failed on it back in the queue.**
- **Zoho's refusals are stored in plain words:** what Zoho refused, why, and the fix.
- **A supplier payment never applies more to a bill than the bill still owes in Zoho.** The rest stays as an advance with the supplier. This was the cause of SPAY-00003.

**Every failed document on the Zoho tab (live, read-only, 13 Nov):**

| Document | Cause | Fix |
|---|---|---|
| Bill 9275779 · LPO-00070 · MODEL AUTOMOTIVE PARTS EST · AED 94.50 | Stock value mapped to Zoho's Inventory Asset (needs a Zoho item per line). | The apply (data fix 2), then Sync to Zoho. SPAY-00018 follows by itself. |
| SPAY-00003 · VEGA AUTO SPARE PARTS · card · AED 657.00 | It applied more to bill CSB07824/26 (AED 656.25) than the bill owes in Zoho, so Zoho refused the whole payment. | Built: press **Retry**. The ERP now applies what the bill owes (656.25) and leaves 0.75 as an advance with the supplier. |
| Bill 11585944 · LPO-00025-1 · ABU DHABI MOTORS · differs AED 194.25 | The bill is already part paid in Zoho, so the ERP may not change it. | By hand in Zoho (Mathew), then "Done by hand". |
| INV-00013 · 1 fils | Zoho rounds the 5% on each line: 5,499.99 against the ERP's 5,500.00. | By hand in Zoho: add 0.01 round-off (Mathew), then "Done by hand". |
| STL-00022 card fees · 1 fils | Zoho rounds the 5% VAT on each fee line: VAT 39.17 against the bank's 39.18. | By hand in Zoho: correct the expense's VAT by 0.01 (Mathew), then "Done by hand". |

**Mathew chooses before go-live:**
- **A) Zoho also tracks every stock item:**
  - each shelf part becomes a Zoho item with its own quantity, and every bill line and every use on a job must name it;
  - two counts to keep equal (ERP and Zoho), and any item missing in Zoho stops the bill.
- **B) ERP only, Zoho holds the value (built, recommended):**
  - the ERP keeps the count and the average cost, and Zoho keeps one stock value account;
  - each use on a job moves its cost to the job in one journal, so nothing in Zoho has to match item by item.

**Proof (TEST):**
- `npm run test:s13-2` passes 9 of 9:
  - the stock is issued to a job;
  - its posting is queued;
  - the Sync preview shows "Stock used on jobs · AED 130.00";
  - a stand-in Zoho refusal is stored in plain words;
  - saving the mapping puts the failed bill back in the queue.
- Unit tests: `zoho-sync-rules`.
- Screenshots: `docs/proof/2026-11-13-stock-zoho/`.
- The TEST server has no Zoho connection, so the real journal and bill calls are proven only once Mathew presses Sync to Zoho on live (OFJ TEST).
