# Supplier invoices tab + notification (1 November 2026)

## What is live

- **Accounts are told when the invoice arrives.** When Parts mark parts received with the supplier invoice (or enter the invoice later on the LPO), accounts get one notice per invoice, for example:
  "Supplier invoice · SPARE HUB SPARE PARTS · INV 4512 · AED 1,040.00 + VAT · LPO-00035-2 J-00317 DUBAI W 64762 RAM LARAMIE · 2 parts received".
  One tap opens it in the tab. It also sits on accounts' Waiting on you until they check it.
- **Parts received without the invoice** show "Waiting for invoice". Parts already get the daily reminder. Entering the invoice later sends the notice above.
- **New tab: Invoices and payments > Supplier invoices** (owner, accounts and Parts; only accounts and the owner check or query).
  - One row per invoice: supplier · invoice no. · date · TRN · before VAT · VAT · total · LPO(s) · car(s) and job(s) · parts count · match · status.
  - Match: "Matches LPO ✓", "Price changed", "Quantity different", "Not linked to an LPO".
  - Status: Waiting for invoice → New → Checked by accounts → Sent to Zoho (bill) → Paid to supplier, plus "Queried with Parts".
  - Opening a row shows the invoice photo (zoomable; a PDF opens) next to the parts it covers, per car: part, quantity (and what was received), approved price and invoiced price.
  - Filters: supplier, date range, status, unpaid, match problems. Search by invoice number, plate, part name or LPO.
  - Totals at the top, with the unpaid total per supplier.
  - Export to Excel.
- **One invoice, several cars:** the same invoice number entered on several LPOs of the same supplier is ONE row split over them. Each car's share shows on its job card ("AED 400.00 of 920.00 + VAT").
- **Duplicates:** the same invoice typed on two LPOs, or the same supplier, date and amount under another number, gets a red "Possible duplicate of …".
- **Job card and LPO:** the job card lists its supplier invoices (number, its share, status, link), and the LPO links to its invoice.
- **Zoho:** the bill is now made when accounts press **Mark checked** (or when they decide the last price difference), no longer the moment Parts save the invoice. It still goes to OFJ TEST until go-live.
- **After the check, Parts cannot change the invoice.** Accounts query it back first.
- **The SUPPLIER INVOICES TO CHECK box** on the accounts dashboard opens the tab. Its count includes new invoices, those waiting for the invoice, queried ones and undecided price differences.

## Not finished

**Reading the invoice photo or PDF to fill in the number, date, amounts, VAT and TRN (point 5) is not built yet.** Parts still type them. The totals check (5% against the LPO, and the +5% "with VAT typed" slip) is already in place.

## Database (WAITING FOR APPLY)

Migration `20261202130000_supplier_invoice_query.sql` adds `purchase_orders.supplier_invoice_query/_at/_by` for "Query with Parts". Until it is applied, the Query button is greyed with a line saying so; everything else works.

## Proof

- `npm run test:supinvoices` (test database, 28 checks), screenshots in `tests/browser/shots/supplier-invoices/`.
- `tests/unit/supplier-invoice-rows.test.mjs`.
- The older `npm run test:supinv` (23 checks) still passes.
- The test does not post to OFJ TEST: the Zoho step is shown by the queued bills and a simulated bill id.
