# C4: the two lists (read from the live database on 2 November 2026, read-only)

## (a) Open jobs whose check-in was approved with the old "AED 750" wording

The customer read "an inspection fee of AED 750 will apply", with no mention of VAT. By the rule of 30 October 2026, such a fee is charged as that amount INCLUDING VAT:
- AED 750 = 714.29 + VAT 35.71
- AED 1,500 = 1,428.57 + VAT 71.43

The fee is charged only if no work is approved. 14 open jobs:

| Job | Stage now | Car | Approved | Fee read by the customer |
|---|---|---|---|---|
| J-00016 | waiting for the quotation | C 877 | 22 Oct | AED 1,500 |
| J-00017 | in work | E 55138 | 22 Oct | AED 1,500 |
| J-00317 | waiting for parts | W 64762 | 23 Oct | AED 750 |
| J-00460 | ready | M 60248 | 23 Oct | AED 750 |
| J-00343 | in inspection | Y 55055 | 24 Oct | AED 750 |
| J-00470 | waiting for the customer's approval | FF 48890 | 24 Oct | AED 750 |
| J-00491 | in work | S 41354 | 26 Oct | AED 750 |
| J-00492 | waiting for parts | V 26716 | 26 Oct | AED 750 |
| J-00493 | in work | GG 10280 | 26 Oct | AED 750 |
| J-00609 | ready | Z 16054 | 28 Oct | AED 750 |
| J-00860 | waiting for the quotation | VIN …0737198 (no plate) | 29 Oct | AED 750 |
| J-00861 | waiting for the inspection | GG 21341 | 29 Oct | AED 750 |
| J-00858 | waiting for the quotation | VIN …0737468 (no plate) | 30 Oct | AED 750 |
| J-00938 | waiting for the inspection | L 6879 | 30 Oct | AED 750 |

Jobs where work was approved (in work, waiting for parts, ready) will not be charged the fee, so for them the list is information only.

The ones that could still end with the fee are the cars before or at the quotation:
- J-00016
- J-00343
- J-00470
- J-00860
- J-00861
- J-00858
- J-00938

For these, the "Customer declined all work" button already charges the inclusive amount (`isOldFeeWording` / `inclusiveSplit`).

## (b) Places the customer sees "+ VAT" without the amount including VAT

**None found.**

- **Settings:** the only text with "+ VAT" is the inspection fee notice. It reads "AED [total] including VAT (AED [amount] + VAT)", so it shows the total first.
- **Charges on the check-in:** they read "AED 630.00 including VAT (AED 600 + VAT)".
- **Typed lines:**
  - no quotation line that the customer can see (open, not superseded) has "+ VAT" typed in;
  - no issued invoice line has it either.
- **Customer pages and PDFs:** the quotation, estimate, invoice, proforma, receipt, check-in, report, warranty, progress and handover pages and PDFs were searched. They show totals "including VAT" and the VAT as its own row; none prints "+ VAT" alone.
- **Staff-only screens:** these show "+ VAT" after a before-VAT figure by design:
  - the job card's inspection fee badge;
  - the Charges card;
  - the Pending charges list;
  - the inspection fee chooser, which also shows the customer's total.
