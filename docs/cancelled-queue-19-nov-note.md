# Cancelled documents leave the Zoho queue (19 November 2026, Section 2)

Real case: RCT-00091 (AED 12,600.00, a duplicate on J-00493) was voided by Mathew on 17 Nov, but its Zoho row kept waiting.

**Cause:** a void only told Zoho when the receipt had already reached Zoho. A void before that left the row waiting. The Sync preview called it "nothing to send", but it stayed in the queue and in the waiting count.

## THE rule, one for every document type
`src/lib/zoho-cancelled.ts` covers receipts and deposits, supplier payments, combined payments, tax invoices, credit notes, supplier bills, "Paid to supplier", journal vouchers, card and bank settlements, lathe bills and commission payments.
- **Cancelled or voided before it reached Zoho:** it leaves the queue at once. It stays in the history as "NOT SENT – CANCELLED BEFORE SYNC: RCT-… was voided before it reached Zoho. Nothing was sent." and reads **Not sent** (never "Posted ✓").
  - This happens on the void itself (receipt void, the 10-minute undo, a bounced cheque, supplier payment void, journal voucher void, lathe bill void, settlement undo).
  - It also happens whenever the Zoho page opens, before the Sync preview, on the five-minute tick, and inside the row runner itself. So the main **Sync to Zoho** button can never send a cancelled document.
- **Cancelled or voided after it reached Zoho:** its reversal is queued by itself and done by the next sync. Accounts never remove it in Zoho by hand.
  - Receipts, supplier payments, combined payments and journal vouchers were already reversed this way.
  - New: an **undone card or bank settlement** now takes its transfer and its bank fee back out of Zoho (it used to say "the accountant removes … by hand").
- The 10-minute undo used to delete its queue row outright. Now the row is kept, marked not sent (no hard deletes).

## Live check (read-only, 18 Nov)
8 rows waiting or red. One has a cancelled document: **RCT-00091 – voided, not in Zoho**. It leaves the queue the first time anyone opens Zoho Books or presses Sync after this goes live. No document posted to Zoho and cancelled afterwards is still waiting for its reversal.

Test: `npm run test:s19-2` (8 checks, owner and accounts, TEST with the Zoho stand-in). Proof: `docs/proof/2026-11-19-cancelled-queue/`.
