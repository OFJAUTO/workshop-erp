# Zoho Books phase 3/4 — reconciliation, monthly close and the go-live flow (27 October 2026)

Everything still posts to **OFJ TEST** (944122733). The REAL organization stays read-only until the owner flips
the switch described below. Migration `20261123090000_zoho_phase34.sql` (database backed up first).

## 1. Suppliers who charge no VAT

- Parts → Suppliers: each supplier has a **“VAT registered”** tick (on by default). Unticked = no TRN needed;
  their bills and credits post flat (no VAT line, header `vat_not_registered`), and the Zoho vendor is updated to
  match on the fly. Ticked = the 15-digit TRN stays compulsory (plain-words FAILED otherwise).
- The four red bills from phase 2 (VEGA, Mezan Al Sham, Abu Dhabi Motors, DUBLIN) stay red on purpose: those
  suppliers ARE VAT registered — the fix is their TRNs, not the switch.

## 2. Supplier credits and customer refunds

- A part marked **Returned to supplier** (Parts desk or Returns and leftovers) now queues a **Zoho vendor
  credit**: the part at its cost, taxed or flat per the supplier’s switch, numbered and referenced `RET-…`
  (idempotent adopt), then **applied to the supplier’s bill** while it still owes anything — the result shows the
  bill’s balance after. Zoho vendor credits take no attachments, so the credit-note scan stays in the ERP.
- The invoice page of an issued **credit note** has a “Refund paid to the customer” card (accounts/owner):
  amount (≤ the CN), Cash or Bank transfer (transfer needs the reference), once only. Recording it queues a
  **Zoho credit-note refund** from the mapped “Advance refunds paid from” account; only the credit’s unapplied
  part can refund, reference `RF-<CN number>`, the refund id stored on the invoice row.

## 3. Daily reconciliation — `/zoho/reconciliation`

- The first sync run after Dubai midnight compares **yesterday** per the ERP with yesterday per Zoho: tax
  invoices (count + total), payments by method (deposits included, cheques by cleared date), credit notes,
  supplier bills (at `billErpFigures`, Our-stock excluded), supplier payments, expenses. Zoho’s side excludes
  void/draft and pages past 200 rows.
- One line per day: **Identical ✓** green, or **Differs** red with the exact difference per section and per
  payment method. A day turning red rings ONE bell to the owner and accounts. “Check every missing day”
  backfills (40 days per press); Re-check per day.
- Backfilled 23–27 October: 23 and 25 green; **24 red** (the TRN-waiting bill, AED 1,155 in the ERP vs 0 in
  Zoho — genuine); 26–27 red because the live test suites post documents into Zoho TEST and then clean their ERP
  rows away — those two days differ for real, and the red lines name exactly what the tests injected. On the
  REAL book after go-live this noise cannot happen.

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
5. **Reconciliation green for the last 7 days.**
6. **Start date chosen** — documents dated before it never post to the REAL book.

The flip: type **REAL**, press — the server re-checks all six at that moment, turns `zoho_live_enabled` on,
logs who/when/start-date (`zoho_golive_log` + audit log) and bells the owner and accounts. From then on the
write guard reverses: REAL writable, **OFJ TEST closed to writes**. “Back to OFJ TEST” needs a written reason
and is logged the same way. The runbook for Omar and Mathew: `docs/zoho-golive-runbook.md`.

## 6. Proof

- `npm run test:zoho3` — 22 local checks: write guard both ways, the pure date gate (5 cases), the checklist
  evaluating six gates and not all-green, the supplier VAT switch saving, the CN-refund card flow as accounts,
  the returned-part hook queueing a vendor credit, the go-live panel locked with the accounts-only tick, the
  reconciliation/close pages and the Excel export.
- `npm run test:zoho3live` — 15 live checks against OFJ TEST: a no-VAT bill (400 flat, no TRN asked), the vendor
  credit (150) posted and applied (bill due 400 → 250, id stored, never twice), the customer refund (invoice 630
  paid → CN 210 fully unapplied → refund 210, credit consumed to 0), and reconciliation catching a deliberately
  broken day (count-based: the ghost invoice moves the ERP one ahead, the row names the exact difference, the
  bell rings, posting the invoice returns the gap to baseline).
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
