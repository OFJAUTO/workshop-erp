# Section 3 (17 November 2026): the payment date on customer payments and settlements

**The cases:**
- "Record a payment" on E-00095 had no date field, so every payment was stamped with the day it was typed.
- On Accounts posting → Record a settlement, the calendar would not go earlier than that wrong payment date, and a date could not be typed.

## What changed

- **"Payment date" on every customer payment form** (the Record payment window on cars, customers, estimates and money pages, and the payment forms on the money page and the invoice page).
  - It starts on today and can be set earlier by picking from the calendar or by typing it (16/11/2026, 16-11-26 or 2026-11-16).
  - It is never in the future. The confirm question says "dated 14/11/2026" when the date is not today.
  - An earlier day is saved as noon Dubai time of that day, so every report puts it on the right day.
  - The deposit window ("Date received") follows the same rule.
- **ONE date box everywhere money gets a date:**
  - supplier payments, customer payments and corrections;
  - Record a settlement ("In bank on");
  - the bank report's settlement date.
  - The day can be typed or picked. The settlement date accepts any day from the (corrected) payment date onwards, and refuses the future.
- **"Correct this payment" for customer payments,** under each payment on the job's money page and on the invoice page (owner and accounts).
  - Date, method, reference and proof, with a compulsory reason. The method is not pre-selected.
  - The amount and the customer cannot be changed this way: void it and record it again.
  - The old values are kept in the history (who, when, old → new, why) and shown under the payment. Card and link fees are worked out again for a new method.
  - A payment in a bank settlement keeps its method, and its date cannot go after the settlement day (undo the settlement first).
- **Limits:**
  - **Advisors:** today, or up to 3 days back.
  - **Accounts and the owner:** any day in a month that is not closed.
  - **A day in a closed month needs the owner.** Accounts are refused in plain words ("October 2026 is closed: … ask the owner"); the owner may.
  - **Closed months** are set by the owner at **Settings → Money → "Books closed through"** (empty = no month closed).
- **A tax invoice's date is never changed silently.** When a payment is dated (or corrected) into another month than its tax invoice, accounts get a bell: "RCT-… is dated 30 Oct 2026 (October 2026) but its tax invoice INV-… is dated 2 Nov 2026 (November 2026). The tax invoice's date is not changed: check the VAT month."
- **Zoho (OFJ TEST until go-live):**
  - A payment already in Zoho that is corrected (date, method or reference) is taken back (deleted) and posted again with the corrected facts at the next Sync to Zoho.
  - One already moved to the bank in Zoho turns red for the accountant to correct by hand.
  - The TEST server has no Zoho connection, so the first real re-post is seen at Mathew's next Sync to Zoho.

## Proof (TEST)

- `npm run test:s17-3` passes 13 of 13, signed in as accounts (and the owner for the closed month). It covers: a typed earlier date saved on that day, the question naming the date, Correct this payment (no amount or customer box, no method pre-selected, the history), the Zoho re-post marker, the closed month refused for accounts and allowed for the owner, the month flag with the tax invoice's date unchanged, and the settlement date typed.
- `tests/unit/payment-date.test.mjs` passes 15 of 15.
- `test-supplier-pay-correct` passes 13 of 13 on the new date box.
- Screenshots in `docs/proof/2026-11-17-payment-date/` (1440 and 800 wide).

No database change (the closed-month setting is saved by the Settings form itself).
