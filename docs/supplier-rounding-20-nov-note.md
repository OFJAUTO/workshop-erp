# Rounding on supplier payments (20 November 2026, Section 3)

**The case:** LPO-00111-2, AL NABOODA AUTOMOBILES LLC, invoice 33192428.
- The invoice is AED 243.60 (232.00 + VAT 11.60). Mathew paid 243.50 in cash, and the invoice would stay "part paid" by 10 fils for ever.
- The payment is not recorded on live yet (read-only check).
- The same LPO showed two other faults:
  - the invoice is dated 27 October, before the LPO of 19 November;
  - "fully invoiced" sat next to "Some lines are not on … yet";
  - the edit panel said "Total with VAT: AED 0.00", because no total before VAT had been typed.

## Now
- **The invoice is never changed.** When a payment pays an invoice short, the pay box asks **"AED 0.10 less than … What is the difference?"** Nothing is picked; it is one of:
  - **ROUNDING:** closes the invoice. Only up to the limit (AED 1.00 by default; owner and accounts change it at the top of Supplier invoices).
  - **STILL OWED:** the invoice stays open. Above the limit a reason is required.
  - **DISCOUNT FROM THE SUPPLIER:** closes the invoice, with a reason.
- Above the limit, rounding is greyed and says why.
- **Payments already recorded:** under **Correct this payment** on the LPO, what a payment left owing can be closed as rounding or a discount.
- **Zoho (OFJ TEST):**
  - the bill stays at the invoice amount;
  - the vendor payment is posted at what was paid;
  - the difference becomes a supplier credit on the **Rounding** (or **Discount received**) account, applied to that bill.
  - Both accounts are new boxes in **Settings → Zoho Books → Account mapping**.
- **Rounding on the invoice:** an optional box in supplier invoice entry and in the edit panel, for the rounding line some suppliers print (e.g. −0.10). It counts in what the invoice asks.
- **Same-page fixes:**
  - (a) an invoice dated before its LPO is flagged amber on the LPO and in the edit panel; it never blocks.
  - (b) one true statement: the invoices summary says "fully invoiced", and the tool below it now reads "A line is missing from … ? Mark it here".
  - (c) the edit panel works out the total from the line prices as they are typed.

## Assumptions
- Rounding is written off with no VAT (it is a difference on the total).
- A positive rounding line on an invoice (the supplier rounds up) is stored and shown, but Zoho gets it by hand.

Test: `npm run test:s20-3` (8 checks, accounts, TEST) and unit `supplier-rounding`. Proof: `docs/proof/2026-11-20-supplier-rounding/`.

**NEEDS OMAR:** reply "apply" (WAITING FOR APPLY #2). Then Mathew records the AED 243.50 on LPO-00111-2 → **ROUNDING**. In Zoho Account mapping, check the two new accounts (Rounding Off, Discount Received) with the accountant.
