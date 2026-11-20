# Purchase returns: every way a return can end (20 November 2026, Section 1)

**The case:** LPO-00103-1, AL TAYER MOTORS LLC, BLEEDING SCREW (LR055301) ×1, AED 47.25 incl. VAT, for J-01027.
- Received on 18 Nov against WIP 58399, wrong size, returned. It was never with the technician; there was no invoice and nothing was paid.
- **Cause:** the Returns path asked for a "credit note number" for every return. "WIP - 58399" was typed there.
  - The part became "Returned – credit note in".
  - A supplier credit was queued for Zoho, against a bill that does not exist.
  - The LPO kept "Invoice missing".

## Now
ONE box on the LPO, **"How did this return end?"**, for every returned part. The system suggests the ending from the facts, in words; nothing is ticked for you. A greyed ending says why.

| Ending | When | Who |
|---|---|---|
| Supplier's credit note | only when a supplier invoice exists for the part | accounts / owner |
| Refund from the supplier | it was paid | accounts / owner |
| Paid, no invoice: stays with the supplier as an advance | paid, no invoice | the parts desk asks, **accounts confirm the amount**; it then shows in "Use the supplier's advance" |
| RETURNED BEFORE INVOICING | no invoice, nothing paid | parts desk |
| Exchanged | a line "… – replaces returned …" is added to the same LPO | parts desk |

Other rules:
- A credit note is refused when there is no supplier invoice. A no-invoice return queues no Zoho supplier credit.
- **Correct how this return was settled** (accounts and owner, a reason is required). The return stays. The old ending and its credit note are kept in the history, marked voided. A queued Zoho credit is withdrawn ("NOT SENT"); one already in Zoho turns red, to be voided there by hand.
- When every part on an LPO went back before invoicing, the LPO says **"No invoice expected"**. The "Invoice missing" tag, the daily reminder, the "costs still arriving" profit note and the bill all stop.
- If a supplier invoice is typed later on that LPO, an amber warning names the returned part.
- The part's cost leaves the job (as before). A part with the technician must be handed back first.

## Assumptions
- An advance from a paid return lowers the paid payment's line on that LPO. That payment then counts as an advance with the supplier. If the payment was already in Zoho, its row turns red so it can be unapplied by hand.
- The refund and credit note forms are unchanged; the box records their ending.

Test: `node --env-file=.env.test.local tests/browser/test-s20-1-return-endings.mjs` (13 checks, parts desk + accounts, TEST) and unit `return-ending-rules`. Proof: `docs/proof/2026-11-20-return-endings/`.

**NEEDS OMAR:** reply "apply" (WAITING FOR APPLY #1). Then Mathew opens LPO-00103-1 → **Correct how this return was settled** → RETURNED BEFORE INVOICING → reason → **Save the correction**. Not changed on live by me.
