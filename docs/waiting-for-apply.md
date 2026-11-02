# WAITING FOR APPLY

Database changes that are built, tested on the TEST database and pushed, waiting for the owner's "apply" on the live database. The code that needs them stays switched off on live until they are applied (`schemaReady`), so nothing live breaks while they wait.

**To apply them all in the morning:** turn auto mode off and reply **"apply"**. Then, for each file in the order below:

1. take a fresh backup;
2. run the file;
3. record it;
4. run the read-only live check (`npm run check:live`).

The newest backup, taken at the end of the night after every task was live, is `backups/2026-11-02T00-19-36` (107 tables, 237,442 rows). The one before tonight's work is `backups/2026-11-01T19-33-29`. A fresh one is taken again right before applying.

Tonight's later tasks (confirm + undo, spell check while typing, C1–C4, the stale tests) needed no database change.

| # | Migration | Task | What it switches on | Backup |
|---|---|---|---|---|
| 1 | `20261202100000_quote_handback.sql` | Estimate back to the advisor (E-00055) | The hand-back ("Edited by Omar – check and send" + what changed), the banner, the advisor's Waiting on you line. It also puts E-00055 back with Anas. | `backups/2026-11-02T00-19-36` |
| 2 | `20261202110000_lpo_refusals_intake.sql` | LPO approvals + intake manifold | Refusing one LPO line ("Refused by Omar – reason"), the refused list on the LPO, and "Intake manifold" in the live checklist. It also fixes J-00317: the Al Tayer mount is marked refused, the Al Futtaim mount is added to LPO-00038 (you are told "1 part added to LPO-00038"), and Peter's revision request is closed. | `backups/2026-11-02T00-19-36` |
| 3 | `20261202120000_line_teams.sql` | Departments per line (J-00969) | Choosing a team per line by hand (the default teams already work without it), and J-00969's lines set: paint → Paint, remove and refit → Dismantle & refit, coding → Electrical, PDR → Outside work. | `backups/2026-11-02T00-19-36` |
| 4 | `20261202130000_supplier_invoice_query.sql` | Supplier invoices tab | "Query with Parts" on a supplier invoice (everything else in the tab already works). | `backups/2026-11-02T00-19-36` |
| 5 | `20261202140000_capitals.sql` | CAPITALS (B1) | The capitals trigger on every line table and the conversion of existing text (266 quotation and estimate lines including Q-00039, 34 proforma lines, 196 services, 166 parts list names, 15 work lines, 38 requests; tax invoices untouched). | `backups/2026-11-02T00-19-36` |
| 6 | `20261202150000_charges.sql` | Early charges + Pending charges (B2) | The charge lines (job card Charges card, CHARGES ALREADY INCURRED on the check-in, the invoice and declined-work invoice lines) and the Pending charges page with its proformas. | `backups/2026-11-02T00-19-36` |
| 7 | `20261202160000_supplier_price_changes.sql` | LPO price changes | The two limit settings (5% / AED 100) and LPO-00035-2: the wishbone links invoiced at 260 (the job cost follows; the customer price stays). | `backups/2026-11-02T00-19-36` |

Already applied: `20261202090000_payments_anytime.sql` (1 November 2026, backup `backups/2026-11-01T16-47-48`).
