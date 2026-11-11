# One LPO, several supplier invoices (10 November 2026, Section 3)

Real case: LPO-00043-3 had two parts that came on two separate supplier invoices, but they were recorded together under one number.

What is built (owner and accounts only, on the LPO page, card "Supplier invoices on this LPO"):
- "Not on this invoice yet": tick the lines (or part of a line) the first invoice does not cover; they show "Waiting for invoice".
- "Add another invoice": tick the lines and quantities it covers, then number, date, amount before VAT and VAT as printed.
- The card says "2 invoices · 1 line still waiting for an invoice" until every line is covered, then "fully invoiced".
- Each further invoice is checked, edited (with a remark), paid and sent to Zoho on its own, as its own bill. It is its own row on Supplier invoices and its own line in the payment box.
- Safety: a line (quantity) is never invoiced twice; an invoice number is never used twice on one LPO (on another LPO of the same supplier only with the same date = the same paper).
- "Split this invoice": moves lines from the first invoice to a new number, with both invoices' amounts and VAT as printed. A first invoice already in Zoho gets its bill reopened for correction. A paid invoice cannot be split.

LPO-00043-3 on live is NOT changed: accounts split it with the new button once the database change is applied.

Proof: `docs/proof/2026-11-10-several-invoices/d3-lpo-00043-3-split-1440.png` (the case recreated on TEST and split). Test: `test:sim` path d3, 12 checks.
