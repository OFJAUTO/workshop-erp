# The provisional "additional parts" amount (20 November 2026, Section 4)

## Now
- **Where it shows:** the provisional amount ("ADDITIONAL PARTS IF REQUIRED – UP TO AED X") sits in the **PARTS** section: on the quotation screen (its own row at the end of the parts, "Provisional (counts as parts; costed when used)"), on the approved quotation and on the customer's quotation and estimate. It counts as parts in the totals and never as an unpriced part.
- **Profit:** it counts as **zero profit** until it is converted. The internal profit line says "Profit n% – plus AED 370.00 provisional, not yet costed", where n% is worked out on the costed work only.
- **Commission and bonus:** it never counts toward a commission percentage. It cannot reach the advisor bonus: only the converted real parts reach a tax invoice, and an unused amount is never invoiced (19 Nov, Section 5).

## Read-only live check (20 November)
- No quotation or estimate has an "additional parts" line under Other charges.
- Lines with the supplier "OFJ Additional" (advisors to convert; nothing was changed):
  - Q-00001 v1, J-00016, draft, 31 parts;
  - Q-00030 v1, J-00609, approved, 1 part;
  - Q-00039 v1, J-00969, approved, 1 part.

Tests: unit `provisional`, and `npm run test:s20-4` (3 checks, advisor, TEST, with the customer PDF read back). Proof: `docs/proof/2026-11-20-provisional/`.
