# Proforma for an advance – 13 November 2026 (Section 6)

**The case:** PRO-00029 for estimate E-00082 (grand total AED 10,000.00, advance AED 8,000.00).

**Built:**
- **THE advance block,** one rule (`advanceMoneyRows` in `src/lib/doc-totals.ts`) used in three places: the proforma PDF, the customer's proforma page and the advance's receipt. Each number is printed once, in this order:
  - ESTIMATE TOTAL (INCL. VAT) 10,000.00
  - ALREADY PAID (only if any)
  - **ADVANCE PAYABLE NOW 8,000.00** (the large figure)
  - BALANCE AFTER THIS PAYMENT 2,000.00
  - and the small line "FINAL AMOUNT AS PER THE APPROVED QUOTATION".
- **Above the block:** the heading **ADVANCE PAYMENT** (no longer "Labour and services"), "ADVANCE AGAINST ESTIMATE E-…", and the estimate's section totals only (labour and services, parts, other charges).
- **The amount in words** is the advance payable now.
- **Fixed:**
  - The false "VAT included in this amount" beside the before-VAT figure is gone (the block replaces those rows).
  - "PROFORMA INVOICE – not a tax invoice" prints once. The proforma had also saved it in its own note: old ones are skipped when printed, and new ones no longer save it.
  - "Plate No plate" now reads "PLATE: NOT REGISTERED YET".
  - The car shows make and model in full (LAND ROVER RANGE ROVER SPORT).
- **The final tax invoice** prints the total, then "Less advance paid (INV-…/RCT-…)", then the balance due.
- **Bill to** starts with a choice:
  - **THE CUSTOMER** (default): the name and mobile come from the customer record and are never retyped.
  - **A COMPANY OR SOMEONE ELSE:** the company fields appear only then.
  - A one-line preview ("Bill to: …") shows before Issue.
- **One resend:** the estimate and quotation pages keep "Resend estimate/quote" in the header. The second "Send again" in the bottom bar is gone.

**Live, read-only check (the spelling difference):**
- There is ONE customer record for E-00082's customer.
- The other spelling was typed by hand into PRO-00029's bill-to company box (the old form pre-filled it as free text).
- Nothing was merged or changed on live. From now on, THE CUSTOMER uses the record.

**Proof (TEST):**
- `npm run test:s13-6` passes 14 of 14:
  - the bill-to choice and its preview;
  - the proforma issued with no retyped bill-to;
  - one resend;
  - in the PDF: ADVANCE PAYMENT, the block in order, the final-amount line, the proforma line once, no false VAT words, the section totals, the amount in words, no "Plate No plate";
  - the customer's page shows the block.
- Screenshots and the PDF: `docs/proof/2026-11-13-advance-proforma/`.
- No database change.
