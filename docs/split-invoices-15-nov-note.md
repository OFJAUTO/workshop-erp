# Section 2 (15 November 2026): split supplier invoices – each part on exactly one invoice

## Step 0: what existed

Several invoices per LPO already existed (10 November): the LPO page's "Supplier invoices on this LPO" card with:
- Add another invoice;
- Split this invoice;
- Some lines are not on … yet;
- Edit for each further invoice.

The faults were in the edit screens:
- **Editing the first invoice** listed every line of the LPO, and compared it with the whole LPO's approved total.
- **Editing a further invoice** also listed every line of the LPO.
- **On Supplier invoices,** the row of a further invoice opened the FIRST invoice's edit form.

## What changed

- **Editing an invoice shows only its own lines,** with the quantity on that invoice. "Approved X → Invoiced Y" compares it only with what the LPO approved for those lines.
- **"Move to another invoice" on every line of the card.**
  - Choose how many (a quantity can be split, for example 2 of 4 spark plugs) and the invoice it goes to.
  - Its amount goes with it: quantity × the invoice price, else the LPO price.
  - Both invoices go back to unchecked, and a typed VAT goes back to 5% of the new amount.
  - A bill already in Zoho is corrected at the next Sync to Zoho (OFJ TEST until go-live).
  - It is kept in the invoice's edit history and on the job's history.
  - It is refused when either invoice is paid ("reverse the payment first").
  - For a new invoice number, "Split this invoice" stays the way: it asks for the new invoice's number, date and amounts.
- **The running check on the card:**
  - "Invoices total AED … of the LPO's AED …" ✓ (all with VAT);
  - amber when the invoices add up to more than the LPO, when a part sits on two invoices, or when a part is on none.
- **Never paid twice.** A payment (the Supplier payments box, or the older "Paid to supplier") is refused when it would pay a part that sits on another invoice already paid, or on another invoice in the same payment. The refusal names the part and both invoices.
- **On Supplier invoices,** a further invoice's row has "Edit this invoice (on LPO-…)", which opens its own form on the LPO page.

## Read-only check on live

Three LPOs have more than one invoice. None add up to more than the LPO, and nothing is overpaid:

| LPO | Supplier | Invoices | LPO incl. VAT | Invoices incl. VAT | Paid |
|---|---|---|---|---|---|
| LPO-00069-1 | SPAREIN AUTOMOTIVE | 2 | 1,134.00 | 1,118.25 | 0.00 |
| LPO-00076-4 | DUBLIN AUTO SPARE PARTS | 2 | 609.00 | 609.00 | 609.00 |
| LPO-00086-1 | PREMIER AUTO PARTS | 3 | 1,732.41 | 1,405.95 | 1,405.95 |

- **On LPO-00086-1 the stored figures were already right:**
  - invoice 1260925542 = AED 991.00 + 49.55 VAT for its 7 lines;
  - 1260925546 = the 4 spark plugs, AED 218.40;
  - 1260925555 = idler pully 2, AED 147.00.
- **The AED 1,732.41 you saw** is the whole LPO with VAT. The old edit form compared the invoice with it and listed all 9 lines; it now shows its 7 lines and their own value.
- Nothing on live was changed.

## Proof (TEST only)

- **`node --env-file=.env.test.local tests/browser/test-split-invoices.mjs`: 12 of 12,** as accounts. It covers:
  - the first invoice's edit has only its 2 lines and its own total;
  - the running check;
  - the further invoice's edit has only its line;
  - moving 2 of 4 spark plugs (AED 104 moves; 348 → 452 and 208 → 104), with the history entry;
  - the further invoice's row on Supplier invoices;
  - a part on two invoices is warned about and its double payment refused.
- Unit `lpo-invoice-move`: all pass.
- Screenshots: `docs/proof/2026-11-15-split-invoices/`.
- No database change.

## Assumptions

- **Moving a part to a brand-new invoice number uses "Split this invoice"** (it needs the new invoice's number, date and printed amounts). "Move" is between invoices already on the LPO.
- **The amount that moves** is the line's invoice price when one was entered, else the LPO price. Accounts can still correct the printed amount with Edit afterwards.
- **An invoice is never left with no part at all.** Change the invoice itself (Edit) instead.
