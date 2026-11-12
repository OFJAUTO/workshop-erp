# Suppliers: name edit, duplicates, merge – 13 November 2026 (Section 8)

**Why THE EMIRATES AMERICAN AUTOMATIC TRANSMISSION CO LLC's name would not save:** the database allows one supplier per name. Live's error log shows the rename refused four times (10 and 12 November) because the name typed was already used by ANOTHER supplier record. The screen only said "Couldn't save".

**Built:**
- **Renaming:**
  - A rename with the TRN untouched always saves.
  - The duplicate check never counts the supplier being edited.
  - When another supplier really has the name, the refusal says so in plain words ("another supplier is already called …") and links to that record (it is highlighted on the page).
  - A renamed supplier keeps its old name as "also known as" (searchable).
  - The Zoho vendor takes the new name at the next Sync to Zoho (OFJ TEST only until go-live).
  - Every change is in the change log.
- **Adding:** a supplier with a TRN already on the list shows the existing record instead of making a second one.
- **Merge suppliers (owner and accounts):** on Parts › Suppliers, the box "Suppliers sharing a TRN" lists each group. Choose the record to keep, give a reason, press Merge suppliers. Then:
  - everything moves to the kept supplier: its LPOs, supplier invoices, supplier payments and advances, lathe bills, returns, courier charges, stock items and the parts that named it;
  - the other record stays (inactive, "merged into …"); nothing is deleted;
  - its name is kept as "also known as" and is still found by a search;
  - the merge is logged.
  - Zoho: bills already posted stay under their vendor; new ones go to the kept supplier's vendor.

**Live, read-only check – suppliers sharing a TRN:**

| TRN | Suppliers |
|---|---|
| 100457186300003 | SPAREIN AUTOMOTIVE L.L.C · SPAREIN AUTO SPARE PARTS |
| 100072684200003 | TRADING ENTERPRISES COMPANY LLC · AL FUTTAIM MOTORS COMPANY LLC (the same group of companies; probably a TRN typed on the wrong one – check before merging) |
| 100243533500003 | THE EMIRATES AMERICAN AUTOMATIC TRANSMISSION CO LLC · CENTRAL MOTORS & EQUIPMENT · EMIRATES MOTOR COMPANY (inactive) (probably a TRN copied by mistake – check) |

**Proof (TEST):**
- `npm run test:s13-8` passes 12 of 12:
  - the rename saves and keeps the old name;
  - a clash refuses in words, with a link to the other record;
  - an existing TRN shows the existing record, and no second one is made;
  - the pair is listed and merged: the LPO moved, "also known as" kept, found by the old name, logged.
- Screenshots: `docs/proof/2026-11-13-suppliers/`.
- Waits for the apply: `20261215120000_supplier_merge.sql`. Until then:
  - the rename fix and the TRN check work;
  - the merge box and "also known as" do not show.
