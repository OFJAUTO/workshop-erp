# Section 5 (15 November 2026): supplier payments – choose, confirm, correct

## The case

SPAY-00032 (FUTURE TYRES TRADING L.L.C, AED 80.00) was recorded as bank transfer by mistake: it was cash. "Bank transfer" was pre-selected and nothing asked.

## What changed

- **No payment method is pre-selected** on the Supplier payments box. Nothing records until one is chosen; the box says so under the methods.
- **The question before recording:**
  - "Pay <supplier> AED <amount> by <METHOD> on <date>?", worked out from the form at the tap;
  - with **YES, RECORD** and **GO BACK AND EDIT** (going back keeps everything typed).
- **"Correct this payment"** on the LPO's payment history and on Supplier payments (accounts and the owner):
  - changes the method, date, reference and proof;
  - the method is not pre-selected there either;
  - a reason is compulsory, and the question has the same two buttons;
  - the history under the payment shows who, when, old → new and the reason;
  - the LPOs it paid follow (their "Paid to supplier" line);
  - the amount and the supplier cannot change here ("void it and record a new payment").
- **A corrected payment already in Zoho** is set to be taken back and posted again at the next Sync to Zoho: the old vendor payment (and its fee expense) is removed, and the corrected one is posted, so cash and bank are right (OFJ TEST until go-live).

## Every money choice that was pre-selected, now not

| Form | Was | Now |
|---|---|---|
| Supplier payments box (LPO page and Supplier payments) | Bank transfer | choose; YES, RECORD / GO BACK AND EDIT |
| Supplier payments box, money over the invoices | "Advance with the supplier" | choose Advance or Fee |
| LPO page "Paid to supplier" (older one-LPO form) | Bank transfer | choose (the server refuses without) |
| Pay the supplier in advance (LPO) | Bank transfer | choose |
| Lathe bill: the lathe shop | the first shop on the list | "Choose the lathe shop…" |
| Lathe bill: the one-payment form | Bank transfer | choose (the server refuses without) |
| Returns: how the supplier refunds | Transfer | choose |
| Returns: who carries the cost | Overhead | choose (a stored answer still shows when editing) |
| Commission payments | Cash | choose Cash or Bank transfer |
| Customer deposit (Record the deposit) | Cash | choose |
| THE customer payment form | the expected method, else the first | choose (only the method an advisor reported fills it in) |
| Combined / pending-charge receipts | Cheque | choose (a receipt being replaced keeps its method) |
| Advisor's "Payment received – send to accounts" | the customer's expected method, else Card | choose |
| Gate-in recovery type (it prices the recovery) | the first type | choose |

**Left as they are, on purpose:**
- **The card-settlement form's method:** it is the clearing account of the tab you opened, not a guess.
- **Stored answers shown again when editing** (a comeback's "at our cost", a part's "cost goes to"): they are the saved choice, not a default.
- **Film roll, ceramic and stock-entry choices:** materials and entry kinds, not money paid or charged.

A quick check (`tests/unit/no-money-preselect.test.mjs`, in `npm run test:unit`) fails if a pre-selected payment method, refund method, "cost goes to" or lathe shop comes back.

## Proof (TEST only)

- **`node --env-file=.env.test.local tests/browser/test-supplier-pay-correct.mjs`: 13 of 13,** as accounts. It covers:
  - nothing pre-selected, and nothing records without a method;
  - the exact question and its two buttons;
  - GO BACK AND EDIT keeps the typing;
  - recorded by transfer, corrected to cash with a reason;
  - the history kept;
  - the LPO following the correction;
  - no amount or supplier box in the correction;
  - a payment in Zoho marked to be taken back and posted again.
- Screenshots: `docs/proof/2026-11-15-supplier-pay-correct/`.
- No database change.

## NEEDS OMAR

- **Mathew or Aleemath corrects SPAY-00032 to cash:** Supplier payments → find SPAY-00032 in Payment history → "Correct this payment" → tap Cash → write the reason → Save the correction → YES, CORRECT IT. If it already reached Zoho, the next Sync to Zoho puts it right there too.
