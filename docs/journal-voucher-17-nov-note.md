# Section 6 (17 November 2026): the Journal Voucher tab

## What the existing pages do (so nothing is built twice)

- **Pending charges** (`/pending-charges`): bills TO CUSTOMERS for cars that are not in the workshop (a recovery-only trip, a car that never came in, or one that left with a charge still open). Each has its own proforma until it is paid; then the tax invoice is issued by itself. It is about what the customer pays, not what we pay.
- **Recovery** (`/recovery`): the log of our drivers' and recovery companies' TRIPS. Each trip goes Claimed → Approved / Queried → Paid, the month is paid per driver or company, and it posts to Zoho as an expense with the trip list.
- **Neither one takes the cost an advisor types on a job ("Cost (we pay)") to accounts.** So the Journal Voucher is new.
  - It works on the same charge lines the advisor entered: one record, never two.
  - A recovery done as a trip stays on the Recovery page (it is paid there) and never shows here.

## What changed

- **"Journal Voucher" in the menu**, for accounts and the owner only (anyone else is refused by the server).
- **TO RECORD:** every charge cost entered on a job shows with:
  - the date, the job and car (a link to the job), the type, the provider;
  - the amount and VAT (both editable), the TRN, who entered it;
  - the receipt photo (or "No receipt photo").
- **Record as paid:** tick one or more charges and record them. Each charge gets its own voucher **JV-00001…**. The form asks:
  - **Who paid it?** Company cash, company card, bank transfer, or a staff member's own money (then: who). Nothing is pre-selected.
  - The payment date (type it or pick it), the reference and the proof.
  - A question before recording.
  - **An amount corrected from the receipt** shows "Cost corrected from the receipt: 100.00 → 90.00", and on recording the job's cost follows (logged in the job's history).
- **Pay later** (providers who bill monthly): tick several charges, type the provider's invoice number and date. That makes ONE unpaid voucher for all of them; **Record payment** on it later.
- **To reimburse:** per staff member who paid with his own money, the total owed, and **Mark reimbursed** (cash or bank transfer, the date, the reference).
- **Manual voucher:** an expense not tied to a car (type, what for, amount, VAT, provider, TRN, who paid, date, reference, proof).
- **Void** with a reason. The charge goes back to TO RECORD, and Zoho takes the expense back.
- **"Delivery"** is a fourth type on the job's charges form (and on Pending charges). Until the database change is applied, a Delivery charge saves as Other titled "DELIVERY …".
- **Account mapping** (Settings → Zoho Books → Account mapping). It has new boxes, pre-filled with your names:
  - Fuel charges → **Automobile Expense**
  - Recovery charges → **Recovery and transport**
  - Other charges → **Other Expenses**
  - Delivery charges → **Postage**
  - Paid by a staff member → **Employee Reimbursements** (a current liability, until he is paid back).
- **Zoho (OFJ TEST until go-live):** each paid voucher posts as an **expense** on its type's account, paid through the company cash, card or bank account, or the staff account. When the provider charged VAT, the VAT is input VAT (claimable). The description carries the voucher number, the job numbers, the provider, its TRN and invoice number. The proof is attached. A "pay later" voucher posts when it is paid.

## Waiting for apply

`supabase/migrations/20261219090000_journal_vouchers.sql`. The backup is `backups/2026-11-17T06-43-51`. The details are in `docs/waiting-for-apply.md`.

Until the apply, the page shows that it switches on with the apply, and nothing else on live changes.

## NEEDS OMAR

Mathew confirms: post these to Zoho as **expenses** (built, so VAT can be reclaimed), as **supplier bills** (for providers with a TRN, so the provider's balance shows in Zoho), or as **manual journals**.

## Proof (TEST, where the tables exist)

- `npm run test:s17-6` passes 14 of 14, signed in as accounts. The parts desk and an advisor are refused. It covers:
  - TO RECORD;
  - recording by a staff member's own money with a corrected amount, the job's cost following, waiting for Zoho;
  - To reimburse;
  - pay later and its payment;
  - reimbursing;
  - a manual voucher;
  - a void (the charge goes back);
  - Delivery on the charges form.
- `tests/unit/jv-rules.test.mjs` passes 10 of 10.
- Screenshots in `docs/proof/2026-11-17-journal-voucher/` (1440 and 800 wide).
