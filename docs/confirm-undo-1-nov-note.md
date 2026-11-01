# Confirm and undo for money actions (1 November 2026, B3)

## 1. A question before every money action

One tap opens a window that says exactly what will happen, with **Cancel** and a button that names the action (never just OK):

| Action | Where | The words (example) | Button |
|---|---|---|---|
| Record a payment or an advance | Record payment window, money page, invoice page | Record payment of AED 100.00 · against PRO-00002 · Cash | Yes, record payment |
| Full payment | the same | Confirm full payment … creates tax invoice INV-… | Yes, record and create tax invoice |
| Deposit | Waiting on you > Record the deposit | (already asked "Yes, record it") | Yes, record it |
| Paid to supplier | LPO page | Record payment to <supplier> · invoice <no.> · AED 420.00 (400.00 + VAT 20.00) · Bank transfer · ref TRF 5511 · proof attached ✓ / no proof attached | Yes, record payment |
| Reverse a supplier payment | LPO page, after the undo time | <supplier> · <LPO> · … · reason: <typed> | Yes, reverse it |
| Approve an LPO | LPO page | Approve · LPO-… · <supplier> · AED … before VAT · n lines | Yes, approve the LPO |
| Credit note | invoice page | A credit note against INV-… · AED … (before VAT) · <what is corrected> | Yes, issue the credit note |
| Refund on a credit note | credit note page | Money paid BACK to <customer> … · AED … · Cash / Bank transfer · ref … | Yes, record the refund |
| Card settlement | Card settlements | n card machine payments settled on <date>: AED … · net … into the bank, MSF … + fee … + VAT … · statement ref … | Yes, record the settlement |
| Settlement from the bank report | Card settlements > report | the report's figures, the date and the statement reference | Yes, record the settlement |
| Tax invoice before full payment | money page (owner), Pending charges | The tax invoice for J-… is numbered now … balance still to pay AED … · Reason: … | Yes, issue the tax invoice |

A box still empty (a reason, a cheque number, the note on an over-payment) is pointed at before the question opens.

"Paid to supplier" sits apart from the proof upload (its own dashed box), so a tap on one is never a tap on the other.

## 2. Undo for 10 minutes

After a payment, a deposit or "Paid to supplier" is confirmed, a black bar shows **"Payment recorded · Undo (9:58)"**, counting down:

- in the Record payment window,
- on the deposit window,
- on the payment's row on the money page and on the invoice page,
- on the LPO page.

Who may undo: the person who did it, or the owner. Undo is not offered while viewing as someone else.

What Undo does:
- **A receipt** is voided with the reason "Undone within 10 minutes by <name>". It stays on the record, struck through, and the job's history says who undid it.
- **"Paid to supplier"** comes off. The history says who undid it.
- **Zoho:** nothing reaches Zoho Books during those minutes. The five-minute worker holds payment, deposit and supplier-payment rows back until the time is over, and Undo deletes the waiting row.

A payment that completed the bill and made the tax invoice cannot be undone. The owner or the head accountant reverses it with a reason.

The time is a setting: **Settings > Money > "Undo within … minutes"** (1 to 60, default 10). The same box now also holds the supplier price limits from the LPO price change (5% / AED 100).

## 3. After the undo time: reversal with a reason

- **A receipt:** "Void this receipt" on the invoice page (the owner or the head accountant, as before), with a reason that stays on the record.
- **"Paid to supplier":** "Reverse this payment" on the LPO (owner or accounts), with a reason. It is logged and the owner is told.
- **Zoho now reverses itself.** Before, a void after posting turned the Zoho row red for the accountant to fix by hand. Now the worker takes the payment back in Zoho:
  - Zoho Books has no "void" for a customer payment or a vendor payment; deleting it is how a wrong payment is taken back there.
  - The invoice's or the bill's balance then opens again, exactly as in the ERP.
  - If Zoho refuses, the row turns red with Zoho's own words.
  - A payment that sits in the REAL book's opening balances after go-live is still reversed by hand, as before.

## Proof

- `npm run test:undo`: 34 checks on the test database, screenshots in `tests/browser/shots/undo/`. It covers:
  - the questions for a customer payment, for Paid to supplier and for an LPO approval;
  - Cancel and Go back change nothing;
  - the countdown bar;
  - Undo inside the window: the receipt is voided as undone and its Zoho row is dropped;
  - Undo for Paid to supplier: the stamp comes off and its Zoho row is dropped;
  - after a one-minute window: no Undo any more;
  - the owner reverses the receipt with a reason, and its Zoho row goes back to the worker;
  - the supplier payment is reversed with a reason, and its row goes back to the worker;
  - Settings > Money saves.
- `tests/unit/money-undo.test.mjs` (in `npm run test:unit`): the countdown, who may undo, which Zoho rows wait.

## Not proven here

The actual removal of the payment in **Zoho OFJ TEST** was not run. The test server has no Zoho connection of its own. The only Zoho connection is the live site's, and the standing rule says tests never call the live site's scheduled jobs with the secret.

The code path is the same worker that already posts these payments. To prove it in OFJ TEST, the test server needs its own Zoho connection:
1. Add `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` to `.env.test.local`.
2. Add `http://localhost:3102/api/zoho/callback` to the Zoho API console.
3. The owner signs in once on the test server's Settings > Zoho Books, choosing OFJ TEST.

## Assumptions

- "Reverse with a reason" keeps the existing rule for receipts: the owner or the head accountant, not every accounts login.
- Deleting the payment in Zoho is the reversal there, because Zoho has no void for payments.

## Database

No migration. The setting saves through Settings > Money without one.
