# Zoho Books phase 3/4 — reconciliation, monthly close and the go-live flow (27 October 2026)

Everything still posts to **OFJ TEST** (944122733). The REAL organization stays read-only until the owner flips
the switch described below. Migrations `20261123090000_zoho_phase34.sql` and, after the adversarial review,
`20261123120000_zoho_org_switch.sql` (database backed up before each: `backups/2026-10-27T03-55-55`,
`backups/2026-10-27T06-13-40`).

## 1. Suppliers who charge no VAT

- Parts → Suppliers: each supplier has a **“VAT registered”** tick (on by default). Unticked = no TRN needed;
  their bills and credits post flat (no VAT line, header `vat_not_registered`), and the Zoho vendor is updated to
  match on the fly. Ticked = the 15-digit TRN stays compulsory (plain-words FAILED otherwise).
- The four red bills from phase 2 (VEGA, Mezan Al Sham, Abu Dhabi Motors, DUBLIN) stay red on purpose: those
  suppliers ARE VAT registered — the fix is their TRNs, not the switch.

## 2. Supplier credits and customer refunds

- A part marked **Returned to supplier** (Parts desk or Returns and leftovers — both now set
  `disposition = 'returned'`) queues a **Zoho vendor credit**: the part at its cost, taxed or flat per the
  supplier’s switch, numbered and referenced `RET-…` (idempotent adopt), then **applied to the supplier’s bill**.
  When the supplier’s invoice is not in Zoho yet the credit **waits for the bill** and applies the moment it posts,
  so the same facts post the same money whichever was typed first. A part merely “back with Parts” (kept in stock,
  scrapped, fitted as goodwill) is never a credit. Zoho vendor credits take no attachments, so the credit-note scan
  stays in the ERP.
- The invoice page of an issued **credit note** has a “Refund paid to the customer” card (accounts/owner):
  amount (≤ the CN), Cash or Bank transfer (transfer needs the reference), once only. Recording it queues a
  **Zoho credit-note refund** from the mapped “Advance refunds paid from” account; only the credit’s unapplied
  part can refund, reference `RF-<CN number>`, the refund id stored on the invoice row.

## 3. Daily reconciliation — `/zoho/reconciliation`

- Each morning the five-minute sync compares **yesterday** per the ERP with yesterday per Zoho — from 00:30, and
  only once the queue has caught up (a run that drained a full batch leaves it for the next run): tax invoices
  (count + total), payments by method (deposits included, cheques by cleared date), credit notes, supplier bills
  (at `billErpFigures`, Our-stock excluded; a fils per bill line allowed, since Zoho works VAT out line by line),
  supplier payments (the amount the sync recorded posting), expenses. Zoho’s side excludes void/draft and pages past
  200 rows. A row written before its day ended is checked again, and a red yesterday is re-checked every hour.
- Every day is compared with **the book that owns it**: OFJ TEST before go-live; after it, OFJ TEST for days
  before the start date and the REAL book from it. The row says which (“against OFJ TEST”).
- One line per day: **Identical ✓** green, or **Differs** red with the exact difference per section and per
  payment method. A day turning red rings ONE bell to the owner and accounts (red → red rings nothing new).
  “Check every missing day” backfills from the first day of the month of the first document (40 days per press);
  Re-check per day.
- Backfilled for the whole OFJ TEST period (1–26 October) — see the review-round section for the results.

## 4. Monthly close — `/zoho/close`

Month picker (six back); lines: every day reconciled green, totals per method vs Zoho, unpaid tax invoices,
deposits held on open jobs (informational), supplier bills unpaid (named, with amounts), commissions unpaid,
recovery months settled, “invoice to follow” open, failed syncs = 0. Green OK ✓ / red Open with the exact list.
**Excel export** (`/api/export/zoho-close?month=`): Checklist, Totals per method, Unpaid invoices, Unpaid bills.
No new Zoho calls — the close sums the stored reconciliation rows.

## 5. Go-live flow — Settings → Zoho Books (owner only)

Six gates, all must be green before the switch unlocks:
1. **Accountant reviewed OFJ TEST** — Mathew ticks it on `/zoho` from his own accounts login (the owner cannot).
2. **Mapping complete** — every box on the mapping page picked.
3. **The mapped names exist in the REAL organization** — read live from the REAL chart (plus the 5% tax).
4. **No failed syncs.**
5. **Reconciliation green for the last 7 calendar days** — each of the seven days before today has a row, written
   after that day ended, and green (seven old green rows are not enough).
6. **Start date chosen, and arrived** — documents dated before it never post to the REAL book; the switch stays
   locked until the day itself (a flip before it would leave the days in between in neither book).

The flip: type **REAL**, press — the server re-checks all six at that moment, then ONE database transaction
(`zoho_switch_org`) refuses if a document is being posted, archives OFJ TEST’s queue in `zoho_outbox_archive`,
clears every Zoho reference the ERP holds (all of them OFJ TEST’s), restores the target book’s own references and
turns `zoho_live_enabled` on. Then every document dated from the start date is queued for the REAL book (the
replay; contacts and vendors are found or made as each document needs them). Logged (`zoho_golive_log` + audit
log) with the counts; owner and accounts get a bell. The write guard reads the switch fresh on every write: REAL
writable, **OFJ TEST closed for good**; a sync run that started before the flip stops at its next row. The start
date is fixed for good. (Second review round: the switch runs ONCE; “Stop” only pauses posting to REAL and “Resume”
restarts it — see below.)
The runbook for Omar and Mathew: `docs/zoho-golive-runbook.md`.

**The cutover rules** (documents meeting the start date): a pre-start document already posted to OFJ TEST simply
stays there; one that never reached it (typed after the flip with an old date) turns RED with by-hand words; a
credit note, refund or supplier payment whose parent predates go-live turns red the same way (the REAL book has no
parent to hang it on); a customer payment received after go-live on a pre-start invoice still posts (real money),
unapplied, with the words saying the accountant applies it to the opening balance. **“Done by hand in Zoho…”** on
any red row closes it as posted with who, when, what was done and the reason it was red.

## 6. Proof

- `npm run test:zoho3` — 39 local checks: write guard both ways; the pure rules (start-date gate, gate 5 on
  calendar days, gate 6 refusing a future start date, the book that owns a day, when yesterday’s check is due,
  real months); the supplier VAT switch saving AND flagging a bill already in Zoho; the CN-refund card (one history
  line); the returned-part hook; the go-live panel locked, Mathew’s real tick shown and left untouched; the
  reconciliation/close pages, the Excel export and an impossible month answered without a crash; **Done by hand**
  through the screen; and **the switch itself, simulated inside a database transaction that is rolled back**
  (OFJ TEST → a made-up organization → OFJ TEST: refused while a row is in flight; 38 queue rows archived and 35
  stored references cleared; everything back; nothing kept; never REAL, never live).
- `npm run test:zoho3live` — 24 live checks against OFJ TEST: a no-VAT bill (400 flat); the vendor credit (150)
  applied (bill due 250); a part kept in stock posts nothing; a credit typed before the supplier’s invoice waits,
  then applies the moment the bill posts (300 → 200 due); the supplier payment settles 250 and, after a simulated
  crash, the retry ADOPTS it and records 250 (never the bill’s 400); the customer refund (210, credit consumed to 0);
  reconciliation catching a broken day (the ERP one invoice ahead, the exact difference named, compared against
  OFJ TEST, ONE bell on turning red and none on a red re-check, the gap back to baseline once fixed).
- Screenshots in `tests/browser/shots/`: `zoho34-reconciliation.png`, `zoho34-close-october.png`,
  `zoho34-golive-panel.png`, `zoho34-sync-page.png`, `zoho3-golive-locked.png`, `zoho3-close.png`.

## Found while testing

- The vendor-credit handler read `part_items.name` — the column is `description`, so every credit would have
  failed as “the part no longer exists”. Caught by the new local test on first run.
- OFJ TEST has no auto-numbering for vendor credits (“Please enter the vendor credit number”) — the create now
  names the number (`RET-…`, same as the reference) with `ignore_auto_number_generation`.
- A test day’s reconciliation baseline is red by itself (Zoho TEST keeps documents whose ERP rows the cleanups
  removed), so the live proof is count-based, and the suite’s cleanup re-checks the day instead of deleting the
  row — the next morning’s automatic check then rings no new bell.

## Review round (27 October 2026, same day)

An adversarial review (five lenses, three skeptics per finding) confirmed 19 findings — 14 distinct problems —
all fixed in commit e8b47e7 (+ the test fixes after it). The ones that mattered most:

- **The flip would have broken every existing customer and supplier.** The ERP stores Zoho ids without saying
  which organization they belong to; after the flip every stored OFJ TEST id would have been sent to the REAL book
  and refused, forever (Retry reuses the same id). Fixed by the one-transaction switch above (archive, clear,
  restore per organization).
- **A future start date would have lost money.** With the runbook’s “1st of the coming month”, every document
  made between the flip and that date was skipped from REAL while OFJ TEST was already closed — marked green,
  in neither book. Now the switch only unlocks on the start date itself, the flip replays everything from the start
  date that was made earlier, and a pre-start document that never reached OFJ TEST turns red instead of green.
- **The backfill would have invented supplier credits.** `return_status = 'returned'` only means “back with
  Parts”; a part kept in stock, scrapped or fitted as goodwill carries it too. Only `disposition = 'returned'`
  is a supplier credit now (the desk’s Returned-to-supplier sets it).
- Also: a credit before its bill now waits and applies; a refund/credit note/supplier payment on a pre-start
  parent fails in plain words instead of waiting forever; reconciliation per book, re-check rules and the
  first-document backfill start; gate 5 on calendar days; the start date fixed once live and only the owner sets
  it; an adopted supplier payment records its own amount; a VAT-switch change flags the supplier’s posted bills
  (and a Retry can no longer turn such a bill green); the close reads every row past 1,000 and refuses impossible
  months; a lost refund race is told so; the write guard and the drain read the switch fresh.
- A permanent security check: the switch function runs for the server only (`npm run test:security`).

**Note:** Mathew ticked “The review is done” on 27 October 2026 at 09:16 from his own login. The tests now leave a
real tick exactly as it is.

## Second review round (27 October 2026, afternoon)

A second adversarial check of the fixes (three lenses, two skeptics each) confirmed 14 more findings, all about the
go-live cutover. The answer was one design decision plus the gaps it left:

- **The switch runs once in the life of the books** (migration `20261123150000_zoho_golive_once.sql`). “Back to OFJ
  TEST” is gone: it would have handed REAL-era documents and ids back to the test book (restoring only posted rows,
  missing changes made in between, and mislabelling the archive on a double press). After go-live the owner can only
  **Stop** posting to the REAL book (nothing is written anywhere; documents wait) and **Resume** it. The switch checks
  under its own lock that it never ran before (`zoho_went_live_at`) and that the books are not already live.
- **Nothing falls between the two books silently.** At the flip, every ready document dated before the start date
  that OFJ TEST never posted (it was still waiting there, e.g. a supplier credit waiting for a bill) turns red in the
  REAL queue. An invoice after go-live whose deposit was taken before it, a payment on a pre-go-live invoice, and a
  supplier credit on a pre-go-live bill all POST and then show red with the by-hand step (a new “attention” outcome:
  the Zoho id and figures are kept, the row is red until “Done by hand”). Voids, bounced cheques and corrected
  supplier invoices on documents in the opening balances turn red instead of being ignored or posted twice.
- **The day comparisons follow the book.** The flip clears the reconciliation rows from the start date (they were
  made against OFJ TEST) so they are checked again against REAL; the monthly close only counts a day compared with the
  book that owns it.
- **“Done by hand” ripples.** A credit note, refund, supplier payment or supplier credit whose parent was settled by
  hand turns red instead of waiting forever; a payment on such an invoice posts unapplied and shows red; a file added
  later to a hand-closed row turns it red instead of re-posting it.
- **A bill keeps the VAT it was posted with** (`purchase_orders.zoho_bill_taxed`): a later change of the supplier’s
  switch never re-figures history; only bills posted under the other standing are flagged, in neutral words.
- **Waiting rows can no longer starve the queue:** the worker takes the rows looked at longest ago first, and a batch
  of nothing but waits does not count as “busy” for the morning check.
- If the queuing after the flip ever fails, a red line and **“Finish the go-live queue”** appear on the panel and the
  sync page (`zoho_golive_followup`).

Proof: `npm run test:zoho3` 42 local checks (adds: the switch refuses once the books went live, inside the rolled-back
simulation; a hand-closed row turns red on a late addition; a bill posted without VAT stays green when the switch
moves to “not registered”). `npm run test:zoho3live` against OFJ TEST adds: a credit note on a hand-closed invoice turns
red without waiting, and a payment on it posts unapplied and shows red. The paths that only exist after a real flip
(the replay, the orphan rows, the opening-balance hooks) are covered by the rolled-back simulation, the pure rules
and the code review — the REAL book is never touched by a test.

## Third review check (27 October 2026, evening)

A third adversarial pass over the second round confirmed 3 findings; 4 more that its verifiers could not finish (the
review agents ran out of allowance) were traced by hand and also hold. All fixed (commit 36f5da9, migration
`20261123170000_zoho_switch_bill_taxed.sql`):

- “In the opening balances” now means dated **before** the start date and posted to OFJ TEST (a Zoho id there). A
  document from the start date whose REAL replay has not posted yet is simply re-queued — never sent to the opening
  balances with the wrong instructions.
- Red rows about opening-balance documents are **by hand only**: Retry refuses them, and re-queues or late additions
  leave them red (a re-run could have posted a re-dated bill a second time, or erased the instruction).
- “Done by hand” on an invoice that never reached Zoho turns every payment of it already posted there (unapplied)
  red, to be applied by hand.
- The switch clears the VAT snapshot of bills dated from the start date (they post again in REAL as new bills, with
  the supplier’s standing as it is then); older bills keep theirs.
- A document reopened at the flip (a late scan) still counts as having reached OFJ TEST: only its change is the
  by-hand item. The test organization is fixed once the books went live.
- Proof: `npm run test:zoho3` 47 local checks (adds Retry refused on a by-hand-only row, Done by hand on an invoice
  turning its posted payment red, and the VAT-snapshot clearing inside the rolled-back switch simulation).

**Zoho’s daily allowance.** The last live run stopped half-way with “The API call for this organization has exceeded
the maximum call rate limit of 1,000”: OFJ TEST allows **1,000 calls a day**, and today’s live test runs plus the
27-day reconciliation backfill used them up. The sync behaved exactly as designed (every row waited with the reason;
nothing failed, nothing posted twice) and resumes by itself when Zoho’s day turns. Two consequences:
- The resolved chart of accounts is now kept for 30 minutes (per organization and mapping; dropped on any account
  error): a waiting row no longer costs two calls every five minutes (up to ~600 a day).
- `npm run test:zoho3live` must be re-run once the allowance is back (the second-round run passed 26/26 before it ran
  out). The REAL organization’s plan allowance should be checked before go-live (see questions).
