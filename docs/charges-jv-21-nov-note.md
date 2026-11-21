# Edit a charge + Journal Voucher provider details (21 November 2026)

## Section 1 – Edit a charge after it is saved

Real case: J-01030 "DELIVERY CHARGES - SHANGAI GLOBAL AUTO PARTS" (cost 40.00, free). On live it is internal: free, never agreed by the customer, on no quotation. It is already on **JV-00009**.

**Where:** on the job card, under Charges, every saved charge now has an **Edit** button (owner, advisors, accounts). It changes:
- the description, type and trips;
- what the customer pays, and the Free tick;
- the provider, picked from the supplier list (or added as new; a known provider's TRN fills in);
- the cost and an internal note.

The bill keeps its own button on the charge row ("Supplier's bill or fuel receipt", with ×), as before.

**What can change depends on where the charge stands:**
- **Internal** (the customer has not agreed it yet): everything.
- **Agreed on the vehicle check-in, in a quotation (draft, sent or approved), or on an invoice:** the customer's wording and price are locked. The window says why: a revision of the quotation, a credit note, or "change it in the quotation". The provider, cost, note and bill can still be corrected.
- **Recorded in a Journal Voucher:** only accounts and the owner can change the cost. The voucher's line and total change with it, and the voucher's Zoho row goes again (or turns red "fix by hand" if it already reached Zoho).

**History:** every change is logged in the charge's own history (who, when, old value, new value; shown under Edit) and in the job's history. The server refuses a locked change even if the screen were bypassed.

**Removing:** unchanged. There is no remove button where there was none before.

## Section 2 – Journal Voucher: provider and invoice details when recording as paid

On live (read-only check): the Nabooda delivery (J-00343) is now on JV-00008. The Porter parking card (J-01016, 34.10) is still to record. All three providers are already in the supplier list with their TRNs.

**Record as paid:**
- Ticking a charge opens its own fields, all optional: provider name (from the supplier list, or typed as new), invoice number, invoice date, provider TRN. A known provider's TRN fills in by itself.
- **Same invoice for all ticked** copies the first ticked charge's provider and invoice to the others.
- **VAT follows the paperwork:**
  - With a TRN, the VAT is kept and goes to Zoho as reclaimable, against that provider (the Zoho expense carries the vendor).
  - With no TRN, VAT is refused in words. The row's own button "record it with no VAT" moves the VAT into the amount.
  - VAT that is not 5% of the amount before VAT is warned, with the button **Use 5%**.
- Each voucher stores the provider record, TRN, invoice number and date. The charge keeps the same provider record.
- **No receipt photo:** a button on the row, **Ask <the person who entered it> for the receipt**. That person gets a reminder that opens the job's charges, where they add the photo from a phone. Recording without a receipt stays possible; the voucher is tagged **No receipt**.
- "Who paid it?" stays not pre-selected, and recording still asks to confirm.

**Pay later:** uses the same provider box (supplier list).

**The voucher list** shows provider, TRN, invoice number and date, the reclaimable VAT and the "No receipt" tag. **Download Excel** carries the same columns.

## Database change (WAITING FOR APPLY #1)

`supabase/migrations/20261221090000_charge_edit_jv_provider.sql` (backup `backups/2026-11-21T06-44-15`) adds seven columns. Until "apply":
- dormant: Edit on a charge, the "Ask for the receipt" note on the charge, the No receipt tag, the voucher's link to the provider record;
- already live: the per-charge provider, invoice and TRN fields, the 5% check, VAT only with a TRN, the Excel export, the Zoho vendor on the expense.

## Proof (TEST)

- `tests/browser/test-charge-edit.mjs`: 14/14 (advisor and accounts).
- `tests/browser/test-jv-provider.mjs`: 18/18 (accounts).
- `test-s17-6-journal-voucher`: 14/14. Its fuel charge now carries a TRN, because VAT without a TRN is refused by the new rule.
- Unit tests: `charge-edit`.
- Screenshots: `docs/proof/2026-11-21-charge-edit/`, `docs/proof/2026-11-21-jv-provider/`.

## Assumptions

- **"Internal" means the customer has not agreed it yet.** A charge listed on a check-in that is not approved yet can still change, and the check-in then shows the new wording.
- **A charge in a draft quotation is also locked here:** its wording and price change in the quotation editor, one place only.
- **Who may edit a charge:** the same people who add charges (owner, advisors, accounts). Making a charge Free still needs the owner's approval when someone else does it.
- **The manual voucher (no car)** keeps its own simple provider box. The request named Record as paid.
- **VAT typed with no TRN is refused** rather than silently moved. The fix button does the move in one tap.
