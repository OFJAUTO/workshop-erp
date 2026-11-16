# Section 2 (16 November 2026): estimates – see and record an advance payment

Case: E-00082 / PRO-00029 / J-01013.

## Step 0: what existed

- The estimate's "Proforma & payment" card (built 4 November) could already record money, but only once a proforma was open.
- Its Record button sat inside the proforma and named no estimate.
- **The E-00082 fault:** once parts were ordered before the car came, the estimate counted a HELD job (J-01013) as "attached to a job". From that moment the whole money card disappeared from the estimate. That is why nobody could see PRO-00029 or record the AED 8,000.00 against it.
- **Live, read-only, 16 Nov:**
  - PRO-00029 is open, AED 8,000.00, unpaid;
  - no receipt exists for it;
  - J-01013 is held (car not here);
  - the AED 8,000.00 is **not recorded** in the ERP.

## What changed

- **THE PAYMENTS box** (one shared component, `AdvancePaymentsBox`) sits on every estimate, and on the job card of the job the estimate becomes. It shows:
  - **Advance requested:** each proforma with its amount, number and date;
  - **Received:** each receipt with its amount, date, method, receipt number and tax invoice, or **NOT RECEIVED YET** in red;
  - **Balance:** the advance still to receive, and what is left to pay on the estimate (on the job: the job's own balance). Cheques and transfers show as "waiting for the bank" and are not counted until cleared, as before.
- **It stays visible:**
  - after approval;
  - while the job is held (it says "Held as J-… (car not here yet) · the money follows the car");
  - after the car arrives: the estimate then says **"Payments are on J-…"** with a link, and the job card shows the same box.
- **"Record advance payment"** (owner and accounts) opens the existing Record payment window on that estimate.
  - Nothing is pre-selected: you choose the method, then fill in the amount, date, reference and proof as for any payment.
  - Recording asks to confirm, as every payment does.
- **Everyone else gets "Tell accounts: payment received":** the existing payment report, with the amount and a photo. Accounts then get the task.
- **No proforma needed.** Recording against an estimate with no proforma makes the proforma for the amount, the receipt and the advance tax invoice in one go. If the payment is refused, the proforma it made is voided again, so nothing is left half done.
- **Less than asked** shows as part received, with what is still to receive.
- **More than asked:** the proforma is settled. The extra gets its own receipt and stays as the customer's advance (shown in the box and as customer credit).
- **The advance follows the car:**
  - a held job keeps the money on the estimate until gate-in, which moves it (gate-in now also moves the money of a held job's estimate);
  - the final tax invoice PDF prints **LESS ADVANCE PAID (INV-…)**.
- **The old card's own Record and Report buttons** are hidden while the box shows, so there is one button each, never two.

## Proof (TEST only)

- `node --env-file=.env.test.local tests/browser/test-advance-box.mjs`: **23 of 23**, covering:
  - accounts, an estimate with no proforma: NOT RECEIVED YET, the estimate offered in the window, no method pre-selected, cash 1,000, then the proforma, the receipt and the advance tax invoice made, and the box reads received with the right balance;
  - a 500 proforma paid 700: 500 on the proforma, 200 kept as the customer's advance, named in the box;
  - an advisor: "Tell accounts", no Record;
  - a held job: the money stays on the estimate, the job opens, the estimate links to it and the job card shows the same box with the receipt;
  - the final tax invoice prints LESS ADVANCE PAID (INV-…).
- Unit `advance-payments`: all pass.
- `test-estmoney1`: 89 of 89. Its 4 list checks were stale: since 13 Nov the Estimates list opens on the Preparing tab, so the test now opens Approved.
- `test-payanytime` (B): 33 of 33. One check was stale: an advisor's payment link may not ask for more than the balance, so the test now asks 900 instead of 1,234.
- Screenshots in `docs/proof/2026-11-16-advance-box/`: the estimate at 1440 and 800, the advisor at 800, and the job card at 1440 and 800.

## Database change

None. This section is live with the push.

## Assumptions

- **"Received" counts cleared money only.** A cheque or transfer shows on its own line until the bank clears it, as everywhere else.
- **An advance recorded with no proforma is asked and paid at once:** the proforma is for exactly the amount received.
- **More than a proforma owes is split in two:** one receipt for the proforma, one for the extra (customer credit), rather than refused.
- **On the job card, the box shows only when an advance was asked or paid on the estimate.** Jobs that never had one do not get an empty box.

## NEEDS OMAR: the AED 8,000.00 on E-00082

1. Open **Estimates**, then **E-00082** (it is under the **Approved** tab).
2. In the **PAYMENTS** box it says NOT RECEIVED YET under PRO-00029. Tap **Record advance payment**.
3. The window opens on "Estimate E-00082 · car not here yet · Proforma PRO-00029".
4. Choose how it was paid (for a transfer, the proof photo and reference), check the amount reads **8,000.00** and the date, then tap **Record** and **Yes**.
5. The receipt and the advance tax invoice appear at once (a transfer or cheque waits for "cleared" as usual). The box then reads "Advance received".

Accounts (Mathew) can do the same steps. An advisor taps **Tell accounts: payment received** instead.
