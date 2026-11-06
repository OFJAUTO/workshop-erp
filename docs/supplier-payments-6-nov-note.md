# Supplier payments with their amount – 6 November 2026 (Section 4, from Mathew)

**Status:** the code is live but switched off until you apply `20261207110000_supplier_payments.sql` (WAITING FOR APPLY, backup `backups/2026-11-06T16-59-40`). Until then the old "Paid to supplier" button (one LPO, in full) stays.

## What Mathew gets once it is applied

On an LPO page (Supplier invoice → **Paid** box), for the owner and accounts:

- **How it was paid:** Bank transfer, Card, Cash, Cheque or **Payment link**. Each method has its own "Paid from" account for Zoho (Settings → Zoho Books → Mapping; empty = the bank account).
- **Amount paid (incl. VAT):** compulsory, filled in with what is still due, can be changed.
- **Several invoices at once:** every unpaid invoice of that supplier is listed; tick the ones this payment covers. The money is spread oldest first, and each line's amount can be typed.
- **Paid less:** the invoice shows "Part paid · balance AED X" and stays on the unpaid list.
- **Paid more:** the box asks what the extra is: **Advance with <supplier>** (the default) or **Fee / charge** (an expense, e.g. a payment-link surcharge).
- **Advances:** shown on Parts accounts (Payments to suppliers), on the Suppliers list ("Advance with GARGASH AED 175.00") and offered as a tick on that supplier's next invoice.
- **Supplier balance** everywhere = invoices − payments − advances used (one calculation).
- **History** on the LPO page: payment number (SPAY-…), who, when, method, reference, amount, how much went on this invoice. A payment can be **voided** by the owner or accounts with a written reason; its invoices become unpaid again.
- **Zoho:** each payment goes to the Zoho queue as ONE vendor payment across its bills (the extra as an unused amount, or a fee as an expense), sent with "Sync to Zoho" like everything else.

## Proof (TEST database)

`npm run test:sim` path r – 10 checks, all green: exact by payment link, less (part paid), more as an advance, more as a fee, one payment over two invoices oldest first, the advance used on the next invoice, every payment queued for Zoho. Unit test `tests/unit/supplier-payments.test.mjs` (16 checks).

Screenshots in `docs/proof/2026-11-06-supplier-payments/`:
- `r1-payment-box-link-1440.png` – the payment box with "Payment link" and the amount.
- `r3-supplier-advance-1440.png` – the Suppliers list with "Advance with E2E GARGASH PAY AED 175.00".

## Not proven yet (NEEDS OMAR)

The Zoho posting itself was not sent to OFJ TEST from here (no Zoho connection on the test server, and OFJ TEST has a 1,000-calls-a-day limit). After you apply the migration, the first real supplier payment will wait in Zoho Books → Sync to Zoho; please check it once in OFJ TEST before going live.

## Fixed on the way

- After a payment, the box now starts again from the new amounts (it used to keep the old figure).
- The save reads the invoices afresh after writing (Next.js re-used the earlier answer within the same save, so a fully paid invoice could stay "unpaid").
