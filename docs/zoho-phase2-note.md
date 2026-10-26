# Zoho Books — Phase 2 delivered (27 October 2026)

**What this adds:** credit notes, suppliers, supplier bills, supplier payments and expenses now post to
**OFJ TEST only**, through the same queue with the same rules as Phase 1 (one-way, never twice, totals checked
against Zoho's own answer, FAILED in plain words, the real book untouched until go-live).

## What posts, and when

1. **Credit notes** — the moment you issue one, it posts with the SAME CN number, the credited line, VAT 5%,
   and is applied against the original invoice (Zoho's UAE edition requires the association and the matching
   Dubai place of supply — both handled). The Phase 1 red "enter it in Zoho by hand" rows are gone, and the
   invoice's own figure check now counts applied credits. Refunds: the ERP records no refunds yet, so none
   post (the agreed paid-from account is on the mapping screen for the day it does).
2. **Suppliers → Vendors** — matched by stored id then exact name among vendors; TRN carried as the VAT
   registration; a name clash with a customer gets "· Supplier". One vendor per supplier, never a duplicate.
3. **Supplier invoices → Bills** — when Peter saves the invoice (never while "Invoice to follow"): bill number
   = the supplier's invoice number, date = the invoice date, the parts as ONE line at the invoice's NET
   figures ("Parts per LPO-00063 – 11 items"), each courier/freight charge its own line, VAT 5% on top, the
   price-differs-from-LPO flags in the bill's notes, and the scan attached. When the before-VAT amount Peter
   typed differs from the lines, the TYPED figure wins (named in the notes) so the bill equals the invoice.
   **A supplier without a TRN fails in plain words** — "enter the 15-digit TRN from their invoice on
   Parts > Suppliers, then press Retry" — because a VAT bill needs the supplier's VAT registration; once the
   TRN is entered, Retry updates the Zoho vendor and posts. An "Our stock" LPO is internal and never bills.
4. **Supplier payments** — Mark paid creates one Zoho vendor payment settling that bill in full from the
   mapped paid-from account, with the LPO number as the reference; the bill must show 0 due afterwards or the
   row fails with both figures.
5. **Expenses** — a paid commission voucher (CPV-xxxxx) posts as one expense with the signed voucher/slip
   attached (a proof uploaded later attaches by itself on the next run); a recovery month marked paid posts
   as ONE expense per driver/company with the month's trip list attached as Excel. Courier on a supplier's
   invoice stays on that supplier's bill — never doubled as an expense.
6. **Mapping** — Settings → Zoho Books → Account mapping gained "Purchases and expenses": Parts purchases,
   Courier & freight, Sales commissions, Recovery & transport, and the Paid-from account; plus the
   reference-only "Advance refunds paid from". Pre-filled; Mathew reviews and saves.
7. **Sync page / Waiting on you** — the new kinds (Supplier, Supplier bill, Supplier payment, Credit note,
   Commission, Recovery month) show with the same statuses, figures, Open-in-Zoho links and Retry; failures
   sit amber on Mathew's Waiting on you.

## Backfill (ran 27 October 2026)

14 suppliers → vendors, 1 paid commission → expense, all posted. The five supplier invoices already in the
ERP: one was an "Our stock" LPO (internal — correctly skipped); the other FOUR failed with the actionable
reason — **VEGA AUTO SPARE PARTS, Mezan Al Sham, Abu Dhabi Motors and DUBLIN AUTO SPARE PARTS have no TRN in
the ERP**. Peter enters each TRN from the supplier's invoice header on Parts > Suppliers, then presses Retry
on the sync page; they post by themselves.

## Proof

- `npm run test:zoho2` — 19 local checks: every hook through the real screens (issuing a credit note, entering
  a supplier invoice, Mark paid, paying a commission voucher, marking a recovery month paid), the mapping
  additions, the sync page and Waiting wording, and the REAL-org write guard.
- `npm run test:zoho2live` — 24 checks against OFJ TEST, all green: (a) a bill at 1,700.00 + VAT 85.00 =
  1,785.00 with the courier line, a price flag in the notes and the scan attached; (b) "Invoice to follow"
  held back in plain words, posting the moment the invoice is entered; (c) two vendor payments settling both
  bills to 0 due; (d) a credit note (210.00) posted under its own CN number and applied — invoice balance
  630 → 420, and the invoice's re-check stays green counting the credit; (e) a commission expense (350.00)
  with the voucher attached; (f) one recovery-month expense (250.00) with the trip-list Excel attached;
  (g) a forced "Mapping missing" failure, Retry posting exactly once, and the adopt pass returning the SAME
  bill id with the stored id wiped; (h) a write at the REAL book refused by the guard.
- Screenshots in `tests/browser/shots/`: `zoho2-sync-posted.png` (all kinds green with figures, the four TRN
  failures with Retry), `zoho2-erp-lpo.png` (the LPO next to its bill figures), `zoho2-erp-creditnote.png`,
  `zoho2-mapping.png`.

## The adversarial review round (same night)

A four-way review (money, never-twice, security, regressions) attacked the build and confirmed 22 weaknesses;
all were fixed and the full live test ran again, 24/24. The ones worth knowing in plain words:

- **One supplier invoice belongs to one supplier.** Ticking parts from two different suppliers and typing one
  invoice would have put the whole amount on BOTH suppliers' bills — now the receive panel refuses in plain
  words ("receive one supplier's delivery at a time"). Same-supplier multi-LPO receives still work.
- **A bill counts what was delivered.** A short-shipped LPO bills the received quantities, and an undelivered
  line on a part delivery bills nothing — no more paying for units that never arrived.
- **Typing the WITH-VAT total into the before-VAT box** (the single most likely slip — it lands at exactly +5%
  and used to pass silently) now gets its own pointed question before it saves.
- **A credit note can never over-credit an invoice**, even against credits the accountant entered in Zoho by
  hand before the sync existed — Zoho's own applied list is counted first.
- **A recovery month paid twice** (late trips) now sums the payout and turns the expense row red with both
  figures, instead of the second batch silently never reaching the books.
- **An invoice changed after its bill posted** turns red ("fix the bill in Zoho by hand") rather than
  silently never re-posting; a scan uploaded after the bill posted attaches by itself on the next run.
- **The Zoho reference ids on ERP records are now server-only** (a database trigger): no login can point a
  document at a different Zoho record by hand.
- A missing bills/expenses mapping fails only the rows that need it — never the Phase 1 money.

## What I need from you / Mathew / Peter

1. **Peter**: enter the TRN for the four suppliers above (Parts > Suppliers), then press Retry on the four
   red rows on the Zoho Books page.
2. **Mathew**: review the new "Purchases and expenses" boxes on the mapping screen (my suggested names are
   pre-filled) and Save; before go-live, create the same names in the REAL organization.
3. A supplier who is genuinely NOT VAT-registered (no TRN exists) cannot bill with VAT — today such a bill
   stays red; say the word if you want a "no VAT" switch per supplier and Phase 3 adds it.

## Still ahead (Phase 3/4)

- The accountant's side-by-side review of OFJ TEST, then **go-live**: the owner turns the switch on, writes
  re-point at the REAL book and replay from the agreed start date.
- The daily reconciliation report (yesterday per the ERP vs per Zoho, one line per day, a bell on any
  difference) and the monthly close checklist.
- Credit-note refunds and supplier credit notes (returns) once the ERP records them.
