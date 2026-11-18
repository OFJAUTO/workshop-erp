# Zoho queue: a bill at AED 0.00, and bills that differ (19 November 2026, Section 1)

## Case A – VEGA AUTO SPARE PARTS, invoice CSB08399/26, LPO-00089 (AED 16.80)
**Cause:** (b), not (a). LPO-00089 (a stock order, 1 × BOSCH BRAKE FLUID at 16.00) was never marked received in the ERP. Its status is still "ordered" and its received quantity is 0. A bill counts the delivered quantities, so it came to AED 0.00. The 16 Nov change (stock usage no longer sent to Zoho) does not touch stock purchase bills.

**Now:**
- When a supplier invoice is entered but nothing on the LPO is marked received, the bill is the supplier's paper: the invoiced (ordered) quantities, one line per part. It is marked "not marked received in the ERP". LPO-00089's bill is AED 16.80 on live now.
- A bill that still comes to AED 0.00, or whose total is not the invoice typed in the ERP, is **never sent**. Before the press, the queue shows "NOT SENT: …". If sent anyway it turns red with **Open the LPO and fix it**.
- A supplier payment already waits for its bill (it never posts first). SPAY-00041 waits for this bill.

## Case B – TRADING ENTERPRISES, bill 929515897, "Posted – differs" +288.00
**Cause:** supplier invoice 929515897 covers two LPOs: LPO-00062-1 (AED 2,393.00) and LPO-00062-5 (AED 288.00). Since 17 Nov (one invoice, several LPOs) Zoho correctly holds **one** bill of AED 2,681.00 carrying both LPOs' lines. The queue compared that one bill with LPO-00062-1 alone, which read +288.00. Nothing was edited, split or returned after posting.

**Now:**
- A posted bill is compared with its whole group ("LPO-00062-1 AED 2,393.00 + LPO-00062-5 AED 288.00 = AED 2,681.00"). 929515897 reads Posted ✓.
- A bill that really differs explains itself under the red line:
  - the ERP's bill now, LPO by LPO;
  - what Zoho holds and by how much it is off;
  - each invoice edit after posting (who and when, old → new, the remark);
  - each price flag and each returned part.
- **Update Zoho to match the ERP** shows that explanation first, then asks "Yes, update Zoho". It sends the bill at once. A bill already paid in Zoho is not changed: it says to correct it there.
- Already live since 5 and 17 Nov: an invoice edited after its bill posted, or an LPO added to an invoice after its bill posted, turns the bill red at once with the words of what to do. A return posts as a supplier credit against the bill.
- From now on each posted bill keeps its lines as posted, so a later difference can be named line by line.

## Live check (read-only, 18 Nov)
58 bills in the queue or posted: none differs from its invoice in the ERP, and none is at AED 0.00. Only LPO-00089 is not marked received (its bill is now AED 16.80 from the invoiced quantity).

Test: `npm run test:s19-1` (7 checks, accounts, TEST with the Zoho stand-in). Proof: `docs/proof/2026-11-19-zoho-bills/`.
