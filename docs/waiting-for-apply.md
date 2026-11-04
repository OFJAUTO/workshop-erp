# WAITING FOR APPLY

Database changes that are built, tested on the TEST database and pushed, waiting for the owner's "apply" on the live database. The code that needs them stays switched off on live until they are applied (`schemaReady`), so nothing live breaks while they wait.

**To apply them:** turn auto mode off and reply **"apply"**. Then, for each file in order:

1. take a fresh backup;
2. run the file;
3. record it;
4. run the read-only live check (`npm run check:live`).

## Waiting now

| # | Migration | What it adds | Backup taken first |
|---|---|---|---|
| 1 | `20261204090000_estimate_money.sql` (money from the estimate) | Invoices tied to an estimate (`invoices.estimate_id`, plain uuid), the bill-to block (`invoices.bill_to`, `quotations.bill_to`), `invoices.valid_until`, payment links and payment reports on an estimate (`payment_requests.estimate_id` + job optional, `payment_reports.estimate_id` + job optional), and the proforma WhatsApp template row. Until it is applied, live shows no estimate-proforma buttons (`estimateMoneyReady`); nothing half-works. | `backups/2026-11-04T11-08-18` (111 tables, 249,077 rows) |

## Applied on 3 November 2026, afternoon

The owner replied "apply" in manual mode (14:27 Dubai). A fresh backup was taken first: `backups/2026-11-03T10-27-22` (110 tables, 245,026 rows). Then:

1. the live rows each file touches were read (none of the six was recorded yet; every existing value fitted the new rules);
2. each file was run with `scripts/db-sql.mjs` and recorded with `scripts/db-record-migration.mjs`, in number order, all six without an error;
3. the same rows were read again;
4. `npm run check:live` was run (33 passed, 0 failed).

| # | Migration | What it did on live |
|---|---|---|
| 1 | `20261203140000_part_endings.sql` (section 7: removing an ordered part) | Added the two endings by name ("cancelled", "return_pending") and the supplier credit note's columns (number, amount, date, who and when) with the index for the "credit notes awaited" list. The one ending saved the old way before it is now named "cancelled". |
| 2 | `20261203150000_quote_charge_costs.sql` (section 8: quotation charges on the job card) | Added `charge_lines.origin` (every existing row "charge"; there were none), its checks and the one-cost-per-line index. The "Cost & bill" cost box is now open. |
| 3 | `20261203160000_part_units.sql` (section 9: quantity + unit) | Added the unit (pieces, litres, sets) to parts and quotation lines, and the asked quantity, who changed it, the list price and the supplier discount on quotation lines. 14 open oil and fluid parts became litres, with their requests (9 requests in litres now) and their 14 part lines on quotations still being prepared; 6 parts-list entries became litres. Nothing approved, ordered or invoiced changed. |
| 4 | `20261203170000_estimate_pricing_done.sql` (section 10: "Pricing done – send to advisor") | Added `quotations.parts_priced_at/by`, the estimate's own stamp of the send. No existing row changed. |
| 5 | `20261203180000_zoho_manual_sync.sql` (section 11: Zoho on manual) | Added the server-only `zoho_sync_runs` table (RLS on, no policies, only postgres and service_role hold rights), seeded `zoho_sync_mode` = manual and renamed the background job to "Zoho check". "Last syncs" and the one-sync-at-a-time lock are now on. |
| 6 | `20261203190000_parts_accounts.sql` (section 12: Parts accounts) | Added `suppliers.contact_name` and the setting `supplier_credit_wait_days` = 14. The "Contact person" box on Parts > Suppliers is now open. |

## Applied on 3 November 2026, morning

The owner replied "apply" in manual mode (07:50 Dubai). A fresh backup was taken first: `backups/2026-11-03T03-47-11` (109 tables, 242,890 rows). Then:

1. the live rows each file touches were read;
2. each file was run with `scripts/db-sql.mjs` and recorded with `scripts/db-record-migration.mjs`, in order;
3. the same rows were read again;
4. `npm run check:live` was run (33 passed, 0 failed).

| # | Migration | What it did on live |
|---|---|---|
| 1 | `20261203101000_stock_test_leftover.sql` (section 2 review fixes) | The made-up stock item "Rear brake discs · E2E-DISC-1" (left by a browser test on 16 October, used by no part) is switched off. It no longer shows in "From our stock…". Nothing else changed. |
| 2 | `20261203110000_payment_reports.sql` (section 3: payment hand-over) | Added the payment reports table: RLS on, read for owner, accounts and advisors, select-only for logged-in staff, nothing for anon. It has the audit, stamp and no-delete triggers and is in the live feed. Also added the photo kind `payment_report` (the 13 existing kinds kept; no existing file changed) and the setting "remind after 4 working hours" with its label. The advisors' "Payment received – send to accounts" button switches itself on within a minute (`paymentReportsReady`). |

## Applied on 2 November 2026, evening

The owner replied "apply" in manual mode, twice. For each file:

1. a fresh backup was taken;
2. the live rows it touches were read;
3. the file was run with `scripts/db-sql.mjs` and recorded with `scripts/db-record-migration.mjs`;
4. the same rows were read again;
5. `npm run check:live` was run (33 passed, 0 failed).

| # | Migration | Backup | What it did on live |
|---|---|---|---|
| 1 | `20261203090000_below_cost.sql` (section 1) | `backups/2026-11-02T19-18-47` | Added the below-cost approval columns and `quotations.revision_request_parts`. Withdrew Peter's waiting Q-00039 request ("FRONT RH HEAD LIGHT, AED 5,502.73"; the part had been removed as a duplicate), with the reason. Marked that bell and the revision bells already answered as read. Re-priced 0 lines: no early charge sat on a quotation being prepared. Q-00027 v2's open advisor request is left for the owner to decline by hand. |
| 2 | `20261203100000_part_costs.sql` (section 2) | `backups/2026-11-02T19-26-11` | Applied at 19:26 UTC, before section 2's review. The review changed nothing in this file (compared with the applied copy afterwards). Its one extra change is in Waiting now above. This file added the "Yes, real price" columns on parts and estimate lines, and the estimate line's stock item. It seeded four limit rows: ask under AED 5, flag under 50%, similar within 20%, warn over 500%. 445 part numbers that were line numbers or "OFJ" now read NO NUMBER; 188 are on active parts, including J-00969's "12". There were 0 estimate lines to change. |

## Applied on 2 November 2026, morning

The owner replied "apply". A fresh backup was taken first: `backups/2026-11-02T03-51-29` (107 tables, 237,493 rows). The seven files were then run in order with `scripts/db-sql.mjs` and recorded with `scripts/db-record-migration.mjs`. Each file runs as one transaction.

Before applying, the live rows each file touches were read again; nothing had changed overnight. Afterwards, `npm run check:live` gave 33 passed, 0 failed. The features switch themselves on within a minute (`schemaReady` asks again every minute while not ready), with no new deploy.

| # | Migration | What it did on live |
|---|---|---|
| 1 | `20261202100000_quote_handback.sql` | Hand-back columns. E-00055 v2 is back with Anas as "Edited by Omar – check and send" (Total 18,850.00 → 16,425.97), and Anas was told. |
| 2 | `20261202110000_lpo_refusals_intake.sql` | Refused-line columns, and "Intake manifold" in the checklist. J-00317: the Al Tayer mount is refused (the owner's reason kept), and the Al Futtaim mount replaces it on LPO-00038, which still waits for approval (12 lines, AED 5,651.00, "2 suppliers"; the owner and the head accountant were told "1 part added"). Peter's revision request on Q-00020 is closed. |
| 3 | `20261202120000_line_teams.sql` | The line's team column. J-00969 (Q-00039): PDR → Outside work, remove and refit → Dismantle & refit, coding → Electrical, the two paint lines → Paint. |
| 4 | `20261202130000_supplier_invoice_query.sql` | "Query with Parts" on supplier invoices. |
| 5 | `20261202140000_capitals.sql` | The capitals triggers. Existing text is in capitals now: 482 quotation and estimate lines, 3 notes to the customer, 22 proforma lines, 15 work lines, 38 requests, 196 services and 166 parts list names. Issued tax invoices and credit notes are untouched (6 lines with small letters kept as issued). |
| 6 | `20261202150000_charges.sql` | The charge tables (server only: RLS on, no access for anon or logged-in users) and the 7-day reminder setting. |
| 7 | `20261202160000_supplier_price_changes.sql` | The two limit settings (5% / AED 100). LPO-00035-2: the invoice price is 260.00 on both lines (accepted), the job's part cost is 260.00, and the supplier invoice amount is 1,040.00. |

## Applied before

- `20261202090000_payments_anytime.sql` (1 November 2026, backup `backups/2026-11-01T16-47-48`).
