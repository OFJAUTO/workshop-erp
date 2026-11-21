# The final tax invoice after an advance (21 November 2026, urgent)

Case: J-01013, Range Rover Sport, Dubai U 19805.
- E-00082 became Q-00118, approved at AED 10,000.00.
- The advance of AED 8,000.00 (RCT-00089) has its own tax invoice, INV-00037.
- The balance of AED 2,000.00 was paid on 21 Nov. That receipt is **RCT-00106**, not RCT-00104: RCT-00104 is a payment-link payment on another car.

## Step 0

**Why INV-00037 was treated as the job's final tax invoice.** Every advance tax invoice is marked as an advance document. But three places took "the first tax invoice on the job" without looking at that mark:
- the job's money page;
- the job card;
- the step that prepares the final proforma (`ensureProforma`).

The last one was the real damage. When J-01013 reached Ready, that step found INV-00037, decided "this job already has its tax invoice" and stopped. As a result:
- no final proforma was made, so accounts had nothing to turn into a tax invoice;
- RCT-00106 could only be recorded as another deposit;
- the money page ticked "Tax invoice" and offered Gate out;
- the profit box was worked out on INV-00037 alone, because the profit list also counted advance invoices as sales.

**Was the 12 November request built?** Only half of it.
- The final tax invoice already printed "LESS ADVANCE PAID (INV-…)".
- But it did this as a *payment* line. It did not show the advance's taxable amount and VAT, and it did not split out what is invoiced now.
- And for J-01013 no final tax invoice could be made at all (the fault above).

**Live, read-only, 21 Nov.** Jobs with an advance tax invoice and no final tax invoice:

| Job | Status | Advance tax invoice | Advance | VAT on it | Approved total | Money received |
|---|---|---|---|---|---|---|
| J-01013 | Ready | INV-00037 (16 Nov) | 8,000.00 | 380.95 | 10,000.00 | RCT-00089 8,000.00 (transfer, cleared, on INV-00037) + RCT-00106 2,000.00 (cash, recorded as a deposit) |
| J-01029 | Waiting for parts | INV-00042 (18 Nov) | 800.00 | 38.10 | 800.00 | RCT-00099 800.00 (transfer, cleared, on INV-00042) |

No other job has an advance tax invoice, and no final tax invoice was ever issued after one. So no tax invoice already sent prints differently now.

## What changed

- **The rule:** an advance tax invoice is never the job's tax invoice. Every screen that looks for "the tax invoice" now leaves advance invoices out:
  - the money page, the job card, the Invoices list, Waiting on you;
  - profit, commission, complimentary jobs, the declined report, the document reminders;
  - the "issue tax invoice" check and the commission voucher.
- **The steps** for a job with an advance read: Proforma > Advance payment > Advance tax invoice > Job done > FINAL TAX INVOICE > Balance payment > Gate-out. "Tax invoice" is ticked only when the final one exists.
- **"Generate the final tax invoice"** (accounts and the owner):
  - It is on the money page under "What to do now", once the job is done, and the job card links to it.
  - It asks once to confirm and shows its answer next to the button.
  - It works whether or not the balance is paid. If the balance is still due, the tax invoice is issued with it still owing, and the next step is the balance payment.
  - It makes the final proforma from the job's real lines. The advance tax invoice and every payment on the job (RCT-00106 included) move onto it, and it becomes the final tax invoice at once.
- **The final tax invoice** (PDF, customer page, money page, invoice record) prints the lines, then each number once:
  - TOTAL VALUE OF THE WORK: 9,523.81 + VAT 5% 476.19 = AED 10,000.00
  - LESS ADVANCE ALREADY INVOICED – TAX INVOICE INV-00037 (16 NOV 2026): 7,619.05 + VAT 380.95 = − AED 8,000.00
  - THIS INVOICE: TAXABLE 1,904.76 + VAT 95.24 = AED 2,000.00
  - then the payments made on this invoice, and the balance.

  The advance's own receipt is paid on INV-00037 and is never counted again. VAT is charged once: 380.95 + 95.24 = 476.19. The amount in words is this invoice's amount.
- **The real total wins.**
  - More work than the estimate: this invoice is the difference.
  - An advance larger than the work: THIS INVOICE is 0.00 and a line "ADVANCE ABOVE THE WORK – CUSTOMER CREDIT (REFUND OR KEEP)" names the amount and its VAT. It is never a negative invoice.
- **Correct this payment** can now put a payment on the final invoice ("Put it on the final invoice PRO-/INV-…", never ticked by itself). An advance's own receipt stays on its advance invoice.
- **The money page and the Invoices row** show the job total (10,000.00), "Invoiced in advance 8,000.00 (INV-00037)", paid and balance. They never show the advance as the job total.
- **Gate-out** opens only once the final tax invoice exists. Without it, only the owner can release the car, with a reason written on the job.
- **Profit** is counted on the final tax invoice (the whole job). The advance invoice no longer counts as a sale, so it is never counted twice.
- **The advance tax invoice** no longer prints "VAT included in this amount" beside the before-VAT figure. New advance invoices no longer save those words. INV-00037 itself is unchanged in the database: the words are simply not printed.
- **Zoho** (unchanged on purpose):
  - an advance tax invoice does not go to Zoho; its money goes as a payment;
  - the final tax invoice goes to Zoho for the whole job (10,000.00, VAT 476.19), with both payments applied, so the balance there is 0.00 and VAT is counted once.

## Proof (TEST only)

`node --env-file=.env.test.local tests/browser/test-final-invoice.mjs` as accounts covers three cases:
- 10,000 with an 8,000 advance and the 2,000 paid as a deposit;
- the work grown to 12,000;
- the work cut to 7,000.

The PDF and screenshots are in `docs/proof/2026-11-21-final-invoice/`. Unit test: `final-invoice` (18 checks).

## Database change

None. This is live with the push.

## Assumptions

- Generating the final tax invoice before the balance is paid is allowed for accounts as well as the owner, on a job with an advance tax invoice. This is the order you gave: the final tax invoice comes before the balance payment.
- For an advance larger than the work, the refund or keep is not built as a new button. The final invoice names the credit. The refund goes through the existing credit-note and refund steps (Mathew with the accountant).
- Zoho keeps its current way: one invoice for the whole job with the advance applied as payments. The paper documents split the VAT as above, and the totals agree.
