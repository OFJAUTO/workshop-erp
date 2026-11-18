# Purchase returns and supplier credit notes (19 November 2026, Section 4)

## How a return started before today
Only two ways, both from the Parts page:
- a part's ⋯ → "Remove: not needed" → "Return to supplier", which also took the part off the customer's quotation;
- lowering a quantity after approval.

Each return was credited one part at a time (Purchase returns → the row → Record credit). There was no way to send back a wrong or damaged part and keep the job's need, no replacement on the same LPO, and no way to enter a credit note covering several parts.

## Now (no database change)
- **"Return to supplier" on the LPO** (parts desk and owner). One window:
  - the received parts going back, with how many;
  - why: Wrong part / Damaged / Not needed / Wrong price, nothing picked for you;
  - "Does the supplier send a replacement?" (Yes / No, nothing picked).
  - A part **with the technician** cannot be ticked: "he hands it back first (Parts → Returns and leftovers)".
  - The supplier's return window is shown per part: days left, past the window (a warning), or "takes no returns on electrical items and batteries" (blocked, except for the owner).
  - The parts going back leave the job's cost at once, and a purchase return (PR-) opens for each.
  - With a replacement: **one new line on the same LPO** "FRONT BUMPER – Replaces returned FRONT BUMPER + REINFORCEMENT, BUMPER", priced at what went back until its own invoice. A dearer replacement goes through the **cost went up** approval (17 Nov): the job's advisor, or the owner below the minimum markup.
- **"Enter the supplier's credit note"** (accounts and owner), on the LPO and as **"+ Enter a credit note"** on Purchase returns:
  - pick the invoice it refers to, tick the parts on the credit note with their amounts before VAT;
  - number, date and VAT (5% unless typed; none for a supplier that charges none);
  - the scan, with **Read the scan** (the same reader as the supplier invoices).
  - A part never started as a return becomes one with it.
- **What we owe:** the credit comes off that invoice's amount due in the supplier payment box ("less credit AED 892.50"). On an invoice already paid it stays as credit with that supplier (the existing "Credit to use" on Parts → Suppliers).
- **The LPO after returns:** Invoiced · Credited · Re-invoiced (replacements) · Net owed on this LPO, with the credit note numbers.
- **Zoho (OFJ TEST):** the supplier credit is posted per part, applied to the original bill, with the credit note number in its notes.
- **Supplier return window** (Parts → Suppliers → a supplier → Edit): days to return a part, days for their credit note, and "No returns on electrical items and batteries".
- **Fixed on the way:** the old per-return "Record credit" sent the amount **with** VAT to the Zoho supplier credit, which adds the 5% itself (5% too much). It now sends the amount before VAT.

## Assumptions
- A credit note covering several parts is posted to Zoho as one supplier credit per part (each applied to the bill, each carrying the credit note number), not as one credit with several lines. One credit with lines would need a new Zoho queue kind (a database change). Say if you want it.
- On a paid invoice the credit is shown as "Credit to use"; applying it to another invoice is still done in Zoho (the "apply advance" box works on supplier payments, not on credits).

## Proof on TEST (the three Sparein documents)
Invoice 17098 (1,086.75) → bumper and reinforcement back (wrong part), one replacement line at 985.00 (+135.00, sent for approval) → credit note 1857 (850.00 + 42.50 = 892.50) → replacement invoice 17174 (1,034.25).
- **LPO: invoiced 1,086.75 · credited 892.50 · re-invoiced 1,034.25 · net 1,228.50.**
- Pay box: 194.25 on 17098 + 1,034.25 on 17174.
- Job cost: clips 100 + lamp 85 + replacement 850 (985 once approved); the returned 850 has left.

Tests: `npm run test:s19-4` (16 checks, parts desk and accounts, TEST) and the unit test `supplier-return-rules`. Proof: `docs/proof/2026-11-19-purchase-returns/`.
