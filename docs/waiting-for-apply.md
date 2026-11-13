# WAITING FOR APPLY

Database changes that are built, tested on the TEST database and pushed, waiting for the owner's "apply" on the live database. The code that needs them stays switched off on live until they are applied (`schemaReady`), so nothing live breaks while they wait.

**To apply them:** turn auto mode off and reply **"apply"**. Then, for each file in order:

1. take a fresh backup;
2. run the file;
3. record it;
4. run the read-only live check (`npm run check:live`).

## Waiting now

### FIRST: back orders (URGENT, J-00317, 13 November 2026)

Apply this one first, ahead of the 8 below. A live backup was taken first: `backups/2026-11-13T04-57-14` (129 tables, 280,605 rows).

| # | What | What it does on live | Size |
|---|---|---|---|
| 0 | `supabase/migrations/20261216090000_back_orders.sql` | Adds the server-only `back_orders` table, one row per part fitted on a later visit: the part, the line that charges it, the labour hours moved, the money that moves, who pays when, the follow-up job, the status, who decided. It has RLS on, no policies, no grants to the login role, and audit, stamp and no-delete triggers. It also adds `jobs.continues_job_id`, the follow-up job's link to the first visit, readable by the login role. Until it is applied, the "Back order - fit on a later visit" choice does not show, and Work complete still blocks as it does now. | 1 table + 1 column |

### SECOND and THIRD: invoice number at receiving, and check before you send (13 November 2026)

Backup taken first: `backups/2026-11-13T06-50-12` (129 tables, 281,784 rows).

| # | What | What it does on live | Size |
|---|---|---|---|
| 0b | `supabase/migrations/20261216100000_part_receipts.sql` | Adds two server-only tables (RLS on, no policies, no grants to the login role, audit/stamp/no-delete triggers): `part_receipts`, one row per delivery received (what, when, who, the supplier's invoice number or "INVOICE DUE BY", reminders, retake requests, number corrections), and `receipt_files` (delivery paper and invoice photos; a retake adds a file and marks the old one replaced, nothing deleted). It also adds `suppliers.invoice_later_allowed` and `invoice_later_days` (1 to 5). From the apply, every receipt needs the supplier's invoice number (or "Invoice comes later" for a marked supplier), and the old daily "invoice missing" reminder stops: older receipts are only listed. | 2 tables + 2 columns |
| 0c | `supabase/migrations/20261216110000_send_checks.sql` | Adds the server-only table `send_checks`: each "check before you send" confirmation (who, when, which lines were highlighted). The window itself works without it; the apply adds the log and the approver's "Checked before sending" box. | 1 table |

**From your phone:** turn auto mode off and reply **"apply"**. I run 0, 0b and 0c first (backup, run, record, live check), then the 8 below.

### Then the 8 from the overnight list

These come from the overnight list of 13 November 2026. A live backup was taken first: `backups/2026-11-12T21-37-52` (129 tables, 279,959 rows). Apply them in this order:

| # | What | What it does on live | Size |
|---|---|---|---|
| 1 | `supabase/migrations/20261215090000_stock_value_zoho.sql` (Section 2) | Lets a stock item used on a job post its value to Zoho. It adds the outbox kind `stockuse` and the column `stock_movements.zoho_journal_id`. Until it is applied, the stock count and bills work as now, and nothing is queued for stock used on a job. | 1 rule + 1 column |
| 2 | `supabase/data-fixes/2026-11-13-stock-value-mapping.sql` (Section 2, data fix) | Points "Stock value" on the Zoho mapping at "Parts stock (ERP count)" instead of Zoho's own "Inventory Asset". It also puts bill 9275779 (LPO-00070, MODEL AUTOMOTIVE PARTS EST) back in the queue. At the next **Sync to Zoho** the bill posts, and SPAY-00018 follows it. | 2 updates, nothing deleted |
| 3 | `supabase/migrations/20261215100000_part_changes.sql` (Section 3) | Adds the server-only table `part_changes` (RLS on, no policies, no grants to the login role, audit and no-delete triggers): every change of a part made in place (old → new, reason, who) and the changes waiting for the owner (cost up or another type). Until then "Change supplier / price…" and "This replaces…" do not show. | 1 table |
| 4 | `supabase/migrations/20261215110000_lpo_advance.sql` (Section 4) | Adds `supplier_payments.advance_for_po_id` (an advance paid for one LPO; a plain id, no new link between the two tables) and `purchase_orders.pay_first_at/by/note` ("Supplier needs payment first"). Until then "Pay in advance" and "Supplier needs payment first" do not show. | 4 columns + 1 index |
| 5 | `supabase/migrations/20261215120000_supplier_merge.sql` (Section 8) | Adds `suppliers.also_known_as` (earlier names, searchable) and `merged_into/merged_at/merged_by` (plain ids). Until then the rename fix and the TRN check work, but Merge suppliers and "also known as" do not show. | 4 columns |
| 6 | `supabase/data-fixes/2026-11-13-team-levels.sql` (Section 12, data only; backup `backups/2026-11-13T00-29-24`) | Moves 9 people so Department and Team agree with the new two-level form (list and labour-rate effect in `docs/team-levels-13-nov-note.md`). Each update is guarded by the person's old values. Until then the form and the tablets already read the two levels; only these 9 records keep their old filing. | 9 updates, nothing deleted |
| 7 | `supabase/migrations/20261215130000_hr_other_document.sql` (Section 13; backup `backups/2026-11-13T00-29-24`) | Lets HR keep an "Other document" with its own name (trade licence, medical certificate): the document kind `other` and the column `hr_documents.other_label`. The table stays server-only. Until then the person page shows the seven fixed documents only. | 1 rule + 1 column |
| 8 | `supabase/migrations/20261215140000_pcv_injectors.sql` (Section 14; backup `backups/2026-11-13T00-29-24`) | Allows the two new answer styles on inspection items and adds "PCV valve" and "Fuel injectors" to the stored checklist right after "Intake manifold" (once; reports already made keep theirs). Until then new inspections do not show the two items. | 1 rule + 2 checklist items |

## Applied on 12 November 2026, afternoon

The owner replied "apply". A fresh backup was taken first: `backups/2026-11-12T12-02-42` (128 tables, 279,114 rows). The file was run with `scripts/db-sql.mjs` without an error and recorded with `scripts/db-record-migration.mjs`. Checked on live: `upload_pending` exists with RLS on, no policies, and no read for anon or the login role. `npm run check:live`: 33 passed, 0 failed.

| # | What | What it does on live | Size |
|---|---|---|---|
| 1 | `supabase/migrations/20261214090000_upload_pending.sql` (12 Nov, inspection uploads fix) | Adds the server-only `upload_pending` table: one row per photo or video the moment it is saved on a tablet (the file's own id, car, inspection item, who took it, which tablet, size, sending state), marked arrived when the server records the file. RLS on, no policies, no grants to the login role. Until then the tablets keep every file and send it as now (saved on the tablet first, the camera inside the page, the idle lock waiting, three photos at a time, screen kept on), but the report cannot say "4 files still uploading from Mech 3", the customer's report is not held back for missing files and the advisor gets no 15-minute bell. | 1 table + 2 indexes |

## Applied on 11 November 2026, night

The owner replied "apply". A fresh backup was taken first: `backups/2026-11-11T19-35-14` (124 tables, 274,739 rows). The seven migrations were run with `scripts/db-sql.mjs` in order without an error and recorded with `scripts/db-record-migration.mjs`; the data fix marked 17 old password bells read. Checked on live: 0 unread old password bells, the HR tables and the hr-files bucket exist, 417 parts tagged to their quotation. `npm run check:live`: 33 passed, 0 failed.

| # | What | What it does on live | Size |
|---|---|---|---|
| 1 | `supabase/migrations/20261213090000_part_quote_link.sql` (11 Nov, Section 2) | Adds `for_quote` (the quotation number a request or part is for) to `part_requests` and `part_items`, a rule that fills it in when one is made (the quotation it was asked from, or the one being prepared; a part takes its request's), and fills it for existing parts from the quotation whose line carries them (nothing else guessed; Q-00078 itself is not touched). Until then the counter counts the whole job, as before, and there is no tag, move or Add here. | 2 columns + 1 rule |
| 2 | `supabase/migrations/20261213100000_receipt_void_request_cheque_total.sql` (11 Nov, Section 5) | Adds `payments.void_requested_at/by/void_request_reason` (accounts ask the owner to void a duplicate receipt; his Approvals decide) and `payments.cheque_total_aed` (a cheque's full amount, so receipts on one cheque never total more than it), with two indexes. Until then "Void – duplicate" answers that it switches on with the apply (the owner's own void and the cheque check without a stored total work already). | 4 columns + 2 indexes |
| 3 | `supabase/migrations/20261213110000_lathe_bills_v2.sql` (11 Nov, Section 6) | Adds to `lathe_bills` an edit history and the void request/void columns; lets a `supplier_payment_lines` row pay a lathe bill (`lathe_bill_id`, `po_id` may be empty, one of the two required); lets a supplier invoice with no car (a stock LPO, a lathe bill) be filed in `job_files` (`job_id` may be empty for kind supplier_invoice only). Until then the lathe page keeps its old paid form and no Correct / Void / Attach buttons, and a stock LPO's invoice takes no scan. | 7 + 1 columns, 2 rules, 1 index |
| 4 | `supabase/migrations/20261213120000_device_department.sql` (11 Nov, Section 8) | Adds `devices.department` (workshop / bodyshop / both; empty = not set). Until then a shared tablet shows everyone as before and Devices shows no department. | 1 column + 1 rule |
| 5 | `supabase/migrations/20261213130000_job_line_ticks.sql` (11 Nov, Section 9) | Adds the server-only `job_line_ticks` table (a job of the approved quotation ticked done by the technician, with who and when; audit, stamp and no-delete triggers). Until then JOBS TO DO shows without the tick boxes. | 1 table |
| 6 | `supabase/migrations/20261213140000_inspection_scope.sql` (11 Nov, Section 10) | Adds `jobs.inspection_scope` (full / complaints / pre_purchase; empty = "Type: not set") with who set it and a downgrade request waiting for the owner (granted column by column), `inspections.car_condition`, `inspection_items.not_checked_reason/auto/resolution/resolved_by/at`, and the setting `inspection_scope_rules` (fee and time per type, empty = today's rule). From the apply, an inspection cannot START until the advisor picks the type on the job card. | 9 + 1 + 5 columns, 1 settings row |
| 7 | `supabase/data-fixes/2026-11-11-password-alert-pile.sql` (11 Nov, Section 14, data only) | Marks read the 17 unread old "signed in with the password instead of a phone" bells (161 in all, read on live 11 Nov). From the deploy these sign-ins come as one evening summary; nothing is deleted. | 17 rows |
| 8 | `supabase/migrations/20261213150000_hr.sql` (11 Nov, Section 15) | Adds the three server-only HR tables `hr_people` (the person: passport name, role, department, joining date, phone, emergency contact, contract and probation end, Left with reason), `hr_documents` (photo, Emirates ID, passport, visa, labour card, health insurance, driving licence: number, expiry, file, the reminder stage; replaced and archived kept) and `hr_access_log` (every open, view, download, number shown, upload, edit, Left), with audit, stamp and no-delete triggers, and the private bucket `hr-files` (25 MB a file). No policies and no grants to the login role: only the server reads them. Until then the HR menu item says it switches on with the apply. | 3 tables + 1 bucket |


## Applied on 11 November 2026, morning

The owner replied "apply". A fresh backup was taken first: `backups/2026-11-11T06-28-27` (121 tables, 270,689 rows). The four migrations were run with `scripts/db-sql.mjs` in order without an error and recorded with `scripts/db-record-migration.mjs`. `npm run check:live`: 33 passed, 0 failed.

| # | What | What it does on live | Size |
|---|---|---|---|
| 1 | `supabase/migrations/20261212090000_lpo_invoices.sql` (10 Nov, Section 3) | Adds the server-only `lpo_invoices` table (further supplier invoices on one LPO: number, date, amounts and VAT as printed, which lines and how many, checked/paid/queried, its own Zoho bill), `purchase_orders.supplier_invoice_lines` (what the first invoice covers), `lpo_invoice_id` on supplier payment lines and invoice edits, and Zoho kind `lpoinvoice`. Until then the LPO page says several invoices per LPO switch on with the apply; one invoice per LPO works as before. | 1 table + 3 columns + 1 rule |
| 2 | `supabase/migrations/20261212100000_lpo_owner_review.sql` (10 Nov, Section 4) | Adds the server-only `lpo_owner_reviews` table (accounts send an LPO or one supplier block to the owner with a note; the owner's reply or decision; the reminder stamp) and the setting `lpo_accounts_limit_aed` (0 = off). Until then the LPO page shows Approve and Refuse only, as before. | 1 table + 1 settings row |
| 3 | `supabase/migrations/20261212110000_stock_reversals.sql` (10 Nov, Section 8) | Adds the server-only `stock_reversals` table (a request to reverse a stock entry or move it to a job, the owner's decision, the opposite movement) and `stock_items.archived_at/archived_by`. Until then the stock page shows no "Reverse this entry" (Archive already works for an empty item). | 1 table + 2 columns |
| 4 | `supabase/migrations/20261212120000_comeback_at_our_cost.sql` (10 Nov, Section 9) | Adds `jobs.comeback_reason`, `comeback_original_ref` (old invoice number when the original job is before the ERP), `comeback_deduct_original` (default on), `comeback_marked_by/at` (granted column by column), and the setting `comeback_vat_mode` = no_vat. Until then the job card has no "Comeback – at our cost" button; the existing comeback flow works as before. | 5 columns + 1 settings row |


## Applied on 9 November 2026, night

The owner replied "apply". A fresh backup was taken first: `backups/2026-11-09T19-20-13` (119 tables, 263,454 rows). The five migrations were run with `scripts/db-sql.mjs` in order without an error and recorded with `scripts/db-record-migration.mjs`. J-00974 was read on live first (no roll/batch entered yet, no bell sent yet), then the bells file ran: 2 bells. `npm run check:live`: 33 passed, 0 failed.

| # | What | What it does on live | Size |
|---|---|---|---|
| 1 | `supabase/migrations/20261211090000_accounts_posting.sql` (9 Nov, Section 2) | Adds `payments.cheque_deposited_at/_to/_by` and `bounce_charge_aed`, and lets a posting row (STL-) be a cheque or bank-transfer posting. Until then: cheques and transfers can already be marked cleared / confirmed / bounced (the payment counts, the tax invoice follows), but **Mark deposited** is hidden, and Zoho keeps the old way (a cheque posts to the bank on its clearing day instead of going through Undeposited Funds). | 4 columns + 1 rule |
| 2 | `supabase/migrations/20261211100000_payment_groups.sql` (9 Nov, Section 3) | Adds the server-only `payment_groups` table (one payment for several cars: CP- numbers, the full amount, cheque/transfer details, which receipts it replaced) and `payments.group_id`; lets Zoho post one customer payment per group (outbox kind `paygroup`); seeds the two new message templates (statement of account, one bill for several cars). Until then the Receive payment window says it switches on with the apply; the statement and the one-bill link already work. | 1 table + 1 column + 2 settings rows |
| 3 | `supabase/migrations/20261211110000_passkey_reset_code.sql` (9 Nov, Section 4) | Lets a passkey challenge be a `reset` (the owner's one-time sign-in code for a lost phone: 15 minutes, single use, kept as a hash). Until then the button answers that it switches on with the apply (meanwhile: Remove the lost phone, the person signs in with the password and sets up the new one). | 1 rule |
| 4 | `supabase/data-fixes/2026-11-09-batch-missing-bells.sql` (9 Nov, Section 6, bells only) | One bell each to the advisor in charge (Adarsh) and the bodyshop-side managers for **J-00974** (Land Rover Range Rover 2026, handover 9 Nov): its certificate has no PPF and no tint roll/batch. Nothing else changes; once the rolls are picked on the car's Warranty details, the certificate shows them with the same number W-00974 and the same dates. | 1 + n bells |
| 5 | `supabase/migrations/20261211120000_video_archive.sql` (9 Nov, Section 7) | Adds `archived_at`/`archive_key` to `gate_in_media` and `inspection_media`, the server-only `video_storage_summary()` for the Settings line, the `video_archive_months` setting (12) and the monthly archive job's row. Until then the monthly archive job waits quietly and the Settings line says it switches on with the apply; the 1080p recording, the 720p refusal and Download original already work. | 4 columns + 1 function + 2 rows |
| 6 | `supabase/migrations/20261211130000_lathe_work.sql` (9 Nov, Section 8) | Adds the lathe ticket columns to `part_items` (SUB- number, item, sent/back, who took it, which bill and its amount), the server-only `lathe_bills` table (one month-end bill: number, date, before VAT, VAT as printed, lines with no ticket, the one payment), the price list and the two limits (AED 200 no-LPO limit, 200% minimum markup = 3 × cost) and Zoho kind `lathebill`. Until then Parts management → Lathe and the car's "+ Outsourced – lathe" say they switch on with the apply. | 9 columns + 1 table + 3 settings rows |

## Applied on 9 November 2026, afternoon

The owner replied "apply". A fresh backup was taken first: `backups/2026-11-09T14-14-12` (119 tables, 263,256 rows). The two migrations were run with `scripts/db-sql.mjs` without an error and recorded with `scripts/db-record-migration.mjs`; the bells file was run after reading live again: the advisors had set most dates during the day, so only 2 bells went (Anas: J-00317; the owner: J-00991, no advisor). `npm run check:live`: 33 passed, 0 failed.

| # | What | What it does on live | Size |
|---|---|---|---|
| 1 | `supabase/migrations/20261210090000_promised_time.sql` (part 3) | Adds `jobs.promised_time` (the optional time next to the promised date). Until then the time box is hidden; the date works already. | 1 column |
| 2 | `supabase/migrations/20261210100000_bell_open_only.sql` (part 4) | Adds `notifications.cleared_at` and `archived_at`. Until then a done task already clears itself (marked read) and the badge already counts open actions only; with it the cleared stamp is kept and read notices leave the panel after 30 days. | 2 columns + 1 index |
| 3 | `supabase/data-fixes/2026-11-09-promised-date-bells.sql` (part 3, bells only) | One bell per advisor with the approved cars that have no promised date (read on live 9 Nov): Anas 5 (J-00317, J-00940, J-00977, J-00980, J-00990), Hamza 3 (J-00858, J-00860, J-00972), Adarsh 2 (J-00492, J-00986), the owner 1 (J-00991, no advisor). No date is set. | 4 bells |

## Applied on 9 November 2026, morning

The owner replied "apply" (07:09 Dubai). A fresh backup was taken first: `backups/2026-11-09T03-09-12` (118 tables, 259,952 rows). The live rows each file touches were read before and after; the files were run with `scripts/db-sql.mjs` in order without an error and the migration recorded with `scripts/db-record-migration.mjs`. `npm run check:live`: 33 passed, 0 failed.

| # | What | What it did on live |
|---|---|---|
| 1 | `2026-11-08-lpo-check-bells.sql` | 3 bells to the one active parts login (J-00990, J-00016, J-00343). |
| 2 | `2026-11-08-missing-advisors.sql` | J-00343, J-00470, J-00492, J-00974 → Adarsh; J-00992 → Anas (5 jobs, 5 history lines). |
| 3 | `2026-11-08-link-fee-worst-case.sql` | Payment-link fee setting 1.75% → 2.25%. |
| 4 | `20261209090000_purchase_returns.sql` | The `purchase_returns` table: RLS on, no policies, no access for anon or logged-in users. Purchase returns switched on by themselves. |
| 5 | `scripts/photo-sizes-backfill.mjs --apply` | Made the 400 px and 1600 px copies of all 1,330 existing photos (0.26 GB added), 0 failed, nothing changed or deleted. The count afterwards: 0 photos without sizes. |

## Applied on 8 November 2026, morning (passkeys)

The owner replied "go" and "apply". Pushed as 7fdac30 (live as dpl_2co4gWSHFc4Qeg52akMuSiLVtUik). A fresh backup was taken first: `backups/2026-11-08T05-47-43` (114 tables, 259,566 rows). `20261208090000_passkeys.sql` was run with `scripts/db-sql.mjs` and recorded with `scripts/db-record-migration.mjs` without an error. Read-only check after: the four tables exist with RLS on, no policies, and no select for anon or authenticated; `passkeys_rollout` = "owner". The live Supabase Auth settings were changed through the Management API: password_min_length 6 → 10, required characters none → small + capital + number, leaked-password protection off → on (Supabase's own `passkey_enabled` stays false). `npm run check:live`: 33 passed, 0 failed; the live sign-in page shows "Sign in with passkey".

| # | What | What it did on live |
|---|---|---|
| 1 | Code (7fdac30) | The passkey sign-in, My sign-in, the owner's Sign-ins page and the new password screens. |
| 2 | `20261208090000_passkeys.sql` | Passkeys ON FOR THE OWNER ONLY; every sign-in and change logged. |
| 3 | Supabase Auth settings | The 10-character rule and leaked-password protection. Existing passwords keep working. |
| 4 | Next, the owner | Tries his phone from an office PC, then Team › Sign-ins › "Everyone in the passkey roles" › Save. |

## Applied on 7 November 2026, morning

The owner replied "apply" (08:30 Dubai). A fresh backup was taken first: `backups/2026-11-07T04-32-38` (112 tables, 257,296 rows). The live state each file touches was read before and after. The five migrations were run with `scripts/db-sql.mjs` and recorded with `scripts/db-record-migration.mjs`, in order, without an error. `npm run check:live`: 33 passed, 0 failed; the security check's new gate-in probe passes on live.

| # | File | What it did on live |
|---|---|---|
| 1 | `supabase/data-fixes/2026-11-06-carry-over-bells.sql` (data only) | Only Adarsh's bell was sent (J-00978: Q-00050 left out 4 free lines of E-00059, for information). Anas's bell was NOT sent: Q-00061 already has the missing lines (added since yesterday), so it would have been stale. |
| 2 | `20261207110000_supplier_payments.sql` | The supplier payment tables, `purchase_orders.supplier_payment_id` and the Zoho kind. The new payment box (method, amount, several invoices, advance or fee, proof) is on for the owner and accounts. |
| 3 | `20261207120000_customer_address_as.sql` | `customers.address_as`. The "How to address in messages" box is on the customer form. |
| 4 | `20261207130000_gate_in_role_lockdown.sql` (SECURITY) | The four restrictive policies: a gate-in login's own database access now reads and writes no customer, contact or check-in link, and reads no money setting. |
| 5 | `20261207140000_quote_lines_fk.sql` | Removed the one orphaned quotation line (MAIN BATTERY AGM 95AH, AED 210): 1,499 lines → 1,498. |
| 6 | `20261207150000_function_search_path.sql` | 33 functions now have a fixed search path (0 left without). |

## Applied on 6 November 2026, evening

The owner replied "apply" (20:12 Dubai). A fresh backup was taken first: `backups/2026-11-06T16-12-34` (112 tables, 256,781 rows). Before: signed-in logins could run `clear_test_data()`. The file was run with `scripts/db-sql.mjs` and recorded with `scripts/db-record-migration.mjs`. After: signed-in false, anon false, the server's key true. `npm run check:live`: 33 passed, 0 failed (its C1 security check now passes on live).

| # | Migration | What it did on live |
|---|---|---|
| 1 | `20261207090000_clear_test_data_server_only.sql` (audit C1, CRITICAL) | Took "Clear test data" away from signed-in logins: only the server runs it. Your Settings button keeps working. |

## Applied on 6 November 2026, morning

The owner replied "apply" (08:25 Dubai). A fresh backup was taken first: `backups/2026-11-06T04-25-07` (111 tables, 253,750 rows). The rows each file touches were read before and after (none of the four was recorded yet; parts 774 and cars 65 before and after). The four files were run with `scripts/db-sql.mjs` and recorded with `scripts/db-record-migration.mjs`, in order, without an error. The plate file has no "reload schema" line, so that was sent on its own afterwards. `npm run check:live`: 33 passed, 0 failed.

| # | Migration | What it did on live |
|---|---|---|
| 1 | `20261205120000_offsite_backup_jobs.sql` (off-site backups) | Added the three watch rows: nightly backup, weekly storage copy, monthly restore test. Today's nightly run (05:43 Dubai) failed with "B2_KEY_ID is not set" because the Backblaze key is not saved yet. From the next run (tomorrow early morning) the watch sees it: the owner's bell rings "Off-site database backup FAILED" until the key is saved and a run succeeds. That is the watch working. |
| 2 | `20261205150000_supplier_invoice_edit.sql` (supplier invoice edit) | Added the invoice's own VAT column on LPOs (all empty, so VAT reads 5% as before) and the server-only edit history table (RLS on; only postgres and service_role hold rights). The "Edit invoice" button is now on for the owner and accounts, so Mathew can correct LPO-00037-2 (Gargash). |
| 3 | `20261205180000_advisor_price_parts.sql` (enter price myself on a job's part) | Added the three columns on parts (all 774 parts start as not priced by an advisor). "Enter price myself" on a job's part is now on. |
| 4 | `20261206090000_plate_history.sql` (plate can be added) | Added `old_plates` and `merged_into` on cars (65 cars, both empty). They come into use with the plate deploy: the old-plate search and the merge pointer. |

## Applied on 5 November 2026, morning

The owner replied "apply" (07:36 Dubai). A fresh backup was taken first: `backups/2026-11-05T03-35-40` (111 tables, 249,801 rows). The rows each file touches were read before and after, both files were run with `scripts/db-sql.mjs` and recorded with `scripts/db-record-migration.mjs` in order without an error, and `npm run check:live` ran (33 passed, 0 failed).

| # | Migration | What it did on live |
|---|---|---|
| 1 | `20261204150000_checkin_copy_template.sql` (resend check-in link) | Seeded the one settings row: the WhatsApp message for a check-in link resent AFTER approval (the read-only copy wording). The Settings box now keeps its edits. |
| 2 | `20261205090000_part_sticker_50x25.sql` (part stickers 50 × 25) | The stored part-sticker size was ALREADY 50 × 25 — the owner had typed it in Settings himself — so the file changed nothing in effect (it re-wrote the same two values) and was recorded so live and the test database stay in step. |

## Applied on 4 November 2026, night

The owner replied "apply" (23:25 Dubai). A fresh backup was taken first: `backups/2026-11-04T19-25-36` (111 tables, 249,626 rows). Then both files were run with `scripts/db-sql.mjs` and recorded with `scripts/db-record-migration.mjs`, in order, without an error, and `npm run check:live` ran (33 passed, 0 failed).

| # | Migration | What it did on live |
|---|---|---|
| 1 | `20261204090000_estimate_money.sql` (money from the estimate) | Invoices tied to an estimate (`invoices.estimate_id`), the bill-to block (`invoices.bill_to`, `quotations.bill_to`), `invoices.valid_until`, payment links and payment reports on an estimate (job now optional on both, with their place checks — every existing row has its job, so nothing changed), and the proforma WhatsApp template row (INSERT 1). The whole estimate-money feature switched itself on. |
| 2 | `20261204120000_estimate_money2.sql` (combined proformas) | `invoices.covers_estimate_ids uuid[]` + its index. Combined proformas switched on. |

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
