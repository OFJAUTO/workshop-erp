# WAITING FOR APPLY

Database changes that are built, tested on the TEST database and pushed, waiting for the owner's "apply" on the live database. The code that needs them stays switched off on live until they are applied (`schemaReady`), so nothing live breaks while they wait.

**To apply them all in the morning:** turn auto mode off and reply **"apply"**. Then, for each file in the order below:

1. take a fresh backup;
2. run the file;
3. record it;
4. run the read-only live check (`npm run check:live`).

The backup taken before tonight's work is `backups/2026-11-01T19-33-29` (107 tables, 237,343 rows). A fresh one is taken again right before applying.

| # | Migration | Task | What it switches on | Backup |
|---|---|---|---|---|
| 1 | `20261202100000_quote_handback.sql` | Estimate back to the advisor (E-00055) | The hand-back ("Edited by Omar – check and send" + what changed), the banner, the advisor's Waiting on you line. It also puts E-00055 back with Anas. | `backups/2026-11-01T19-33-29` |
| 2 | `20261202110000_lpo_refusals_intake.sql` | LPO approvals + intake manifold | Refusing one LPO line ("Refused by Omar – reason"), the refused list on the LPO, and "Intake manifold" in the live checklist. It also fixes J-00317: the Al Tayer mount is marked refused, the Al Futtaim mount is added to LPO-00038 (you are told "1 part added to LPO-00038"), and Peter's revision request is closed. | `backups/2026-11-01T19-33-29` |

Already applied: `20261202090000_payments_anytime.sql` (1 November 2026, backup `backups/2026-11-01T16-47-48`).
