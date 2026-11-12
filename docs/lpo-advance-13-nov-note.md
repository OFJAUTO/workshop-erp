# Pay a supplier in advance against an LPO – 13 November 2026 (Section 4)

**The case:** LPO-00058-2 · TRADING ENTERPRISES COMPANY LLC · TRANSMISSION MOUNT for J-00317 · AED 1,251.60 incl. VAT, waiting for its invoice. Accounts could not record the advance.

**Built:**
- **"Pay in advance"** (owner and accounts) on any LPO still waiting for its invoice. It is on:
  - the LPO page (card "Advance to the supplier");
  - the Supplier invoices card (rows still waiting);
  - Supplier payments (a list, "Suppliers who want payment first").
- **The window:**
  - It asks for the amount (the LPO total with VAT is suggested, and it can be changed), the method, the date, the reference and the proof of payment.
  - It shows "Customer deposit on this job: none received" (or the amount).
  - It asks once, "Record an advance…?", before saving.
- **What it records:**
  - ONE supplier payment kept as an advance, linked to that LPO. The LPO shows "ADVANCE PAID AED 1,251.60 – 13 Nov 2026 (SPAY-…)".
  - The parts desk gets "Paid: confirm the order with <supplier>".
- **When the invoice is entered:**
  - The LPO shows "The invoice is in: apply the advance of AED …?". Accounts tap it once (the 11 November apply-advance step).
  - If the invoice is higher, the rest is due. If it is lower, the rest stays as an advance with the supplier.
- **The parts desk's workflow:**
  - "Supplier needs payment first" on the LPO (with a note).
  - Accounts get a bell and a task on Waiting on you.
  - Once paid, the parts desk is told.
- **Late parts:** accounts' Waiting on you lists "Advance paid, part not received" once the part is past its expected date.
- **Zoho (OFJ TEST only):** the advance posts as a vendor payment with nothing applied (an advance with the supplier). Applying it later re-runs the payment against the bill.
  - The TEST server has no Zoho connection, so the first real posting is seen at Mathew's next Sync to Zoho.

**Proof (TEST):**
- `npm run test:s13-4` passes 16 of 16: pay first, the accounts task, the window and its suggestion, the advance recorded and queued for Zoho, the parts desk told, ADVANCE PAID, the late-part task, and one tap to apply → LPO paid.
- Screenshots: `docs/proof/2026-11-13-lpo-advance/`.
- Waits for the apply: `20261215110000_lpo_advance.sql`. Until then the card does not show.

**Shared fix on the way:** the form's submit button (`SubmitButton`) now keeps its `data-*` hooks.
