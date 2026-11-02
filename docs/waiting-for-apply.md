# WAITING FOR APPLY

Database changes that are built, tested on the TEST database and pushed, waiting for the owner's "apply" on the live database. The code that needs them stays switched off on live until they are applied (`schemaReady`), so nothing live breaks while they wait.

**To apply them:** turn auto mode off and reply **"apply"**. Then, for each file in order:

1. take a fresh backup;
2. run the file;
3. record it;
4. run the read-only live check (`npm run check:live`).

## Waiting now

The newest backup, taken read-only before this batch's database change, is `backups/2026-11-02T15-57-56` (109 tables, 242,238 rows). A fresh one is taken again right before applying.

| # | Migration | Task | What it switches on | Backup |
|---|---|---|---|---|
| 1 | `20261203090000_below_cost.sql` | Section 1: price calculation and nothing below cost (Q-00039) | The owner's "Approve below cost" with a reason kept on the line, for a typed price and for a discount that takes a line below its cost (before it, a price or discount below cost is refused for everyone, the owner too; a cost typed is always saved and flagged), and the automatic withdrawal of a Parts revision request when every part it names was taken off (never an advisor's request). It also withdraws Peter's waiting Q-00039 request ("Peter added FRONT RH HEAD LIGHT, AED 5,502.73": the part was removed as a duplicate this morning), marks that bell and Q-00020's already-answered bell read, and prices any early charge sitting on a quotation at its charge instead of its cost (none on live tonight). | `backups/2026-11-02T15-57-56` |

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
