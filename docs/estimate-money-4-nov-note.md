# Money from the estimate, Part 1 — 4 November 2026

The owner's urgent task (case E-00061, LARS, a company, AED 2,420.00: they want to pay by bank
transfer BEFORE the car arrives). Part 1 delivers the money core: the PROFORMA INVOICE from an
estimate, payments against it, and the TAX INVOICE issued by itself the moment it is paid.

**Database change:** `20261204090000_estimate_money.sql` is on the WAITING FOR APPLY list (backup
`backups/2026-11-04T11-08-18`, 111 tables, 249,077 rows, taken first). Until the owner applies it,
live shows no proforma card on estimates and nothing half-works (`estimateMoneyReady`). It was
applied to the TEST database and every proof below ran there.

## What staff see

1. **On an accepted estimate** (and, for a deposit, on one not accepted yet): the "Proforma &
   payment · car not here yet" card.
   - **COMPLETE** – the whole bill: the proforma carries the estimate's own lines, discount and
     rounded total through THE one draft rule (`draftFrom`), so the figures are exactly what the
     customer accepted.
   - **PARTIAL** – a deposit: % or AED. One line, "ADVANCE PAYMENT AGAINST ESTIMATE E-xxxxx",
     VAT inside the amount (1,050.00 = 1,000.00 + 50.00 exactly).
   - **Bill to** (can differ from the car's owner): company name, attention person, address,
     TRN (15 digits when VAT-registered — checked), and the customer's PO/reference number.
     Typed once, kept on the estimate, printed on the proforma and every tax invoice
     (web page and PDF; the PDF's "Billed to" box carries it all).
   - "Valid until" on the proforma (the estimate's validity by default).
   - Send through the one send window (WhatsApp message from the new Settings template
     `whatsapp_estimate_proforma_template`, short link, PDF attached); the send is stamped and
     logged. The customer page and PDF read "PROFORMA INVOICE – not a tax invoice" and name the
     estimate as the Reference.
2. **Record payment** (owner + accounts): the Record payment window offers the estimate's
   proforma by itself ("Estimate E-00061 · car not here yet"). Accounts can now open an estimate
   (read-only; managing it stays with the advisor who started it and the owner).
3. **Paid → the tax invoice issues itself:**
   - COMPLETE proforma paid → the tax invoice for the WHOLE bill (same lines, same bill-to),
     queued for Zoho like any tax invoice (manual sync sends it).
   - PARTIAL proforma paid → the ADVANCE tax invoice ("Advance payment against E-xxxxx", VAT
     inside), marked as a deposit document — so Zoho carries the money as an advance (never a
     second invoice), and the job's final invoice folds it in like every deposit invoice. Nothing
     is ever counted twice.
   - A cheque converts the moment it CLEARS (the cheque-clear action re-checks job-less
     proformas — pending charges included, which closed a latent gap).
4. **Void** (owner + accounts): an UNPAID estimate proforma can be voided with a reason (logged
   on the estimate's history). Money on it blocks the void.
5. **Badges and filters:** the estimate page and the Estimates list show "Paid AED X of Y" and
   the badge (Prepaid / Part paid / Proforma sent – unpaid); three new filter chips on /estimates.
6. **Money pages:** Invoices and payments shows "Car not here yet · E-00061" rows (today's money
   and tax invoices counted like every row); the customer panel lists "E-00061 · paid AED X of Y ·
   car not here yet".
7. **The job-less receipt is fixed:** a receipt on an invoice with no job (estimate proformas,
   pending charges) now sums ITS OWN payments (it used to show the full total as still due) and
   names the car from the invoice; `recordPaymentCore` also stamps the car on invoice payments.

## For Mathew (the owner's point 8)

Job deposits (car already in the workshop) are UNCHANGED: a deposit recorded on a job still
follows the existing rule — a deposit tax invoice only when Settings say so, otherwise the
advance waits for the proforma. The owner asks you to confirm: **should job deposits follow the
same "tax invoice the moment it is paid" rule as estimate advances now do?** If yes, we will turn
`createDepositInvoice` on for every job advance the same way (it is one switch; the Zoho
treatment is already the advance rule and would not change).

## Zoho

- Complete pre-payment: contact → payment (unapplied) → the full tax invoice → the payment
  applied at invoice sync. The job's final invoice (Part 2) never re-invoices what this covered.
- Partial: the payment is the advance in Zoho (existing deposit rules); the advance TAX invoice
  is never posted (deposit document), exactly like today's job deposit invoices.
- Everything goes through the outbox under manual sync as always; proven on the TEST database
  (outbox rows asserted; no live Zoho calls).

## Tests

- `tests/unit/estimate-money.test.mjs` (21 checks, in `npm run test:unit`).
- `npm run test:estmoney1` (31 checks through the screens): the full E-00061 story — complete
  proforma with company bill-to + TRN + PO → bank transfer → full tax invoice by itself →
  Prepaid; partial 50% → void with a reason → re-issue → paid → advance tax invoice (VAT exact,
  deposit-marked, NOT in the Zoho outbox as an invoice) → Part paid; list badges and the three
  filters; the money list rows; the fixed job-less receipt ("Paid in full" + the car).
- Screenshots in `tests/browser/shots/estmoney/`.

## Part 1b — the advisor's payment link and payment report on estimates (same day)

- **Send payment link** (advisors, accounts, the owner) on an estimate with an OPEN proforma:
  complete or partial amount, an optional pasted gateway link, OUR /p/ payment page naming the
  estimate (its people read from the estimate — there is no job), the WhatsApp message from the
  payment-request template, logged on the estimate, accounts told. A partial link counts itself
  paid once that much has come in on the proforma (or the tax invoice it became) since the send.
- **"Payment received – send to accounts"** works on estimates: the same dialog, the slip stored
  under the estimate's own place (`estimate-reports/…`, the new `estimate_report` upload target —
  no job file exists yet), the report on the estimate's history, accounts' bell and WAITING ON YOU
  line open the estimate with the Record payment window pre-filled: the one target is the
  estimate's proforma, the advisor's slip stands as the proof, the receipt's key is the report's
  id (one report, one receipt), and the advisor hears "Recorded ✓" with the E-number.
- Fixed on the way: the Record payment window's job-less form demanded a SECOND proof file even
  when the advisor's slip was attached — the slip now stands as the proof there too.

## Part 2 — THE CAR ARRIVES: the money follows it (same day)

- **At gate-in**, every proforma, payment and tax invoice of the carried estimates moves onto the
  job in one step (`moveEstimateMoneyToJob`, idempotent). The job's history says exactly what
  came: "Estimate money carried over: INV-00022 (tax invoice, AED 2,100.00), INV-00023 (advance
  tax invoice, AED 1,050.00), PRO-00043 (proforma, AED 800.00) · AED 3,650.00 already paid."
- **"Paid so far" stands on the job card from the first minute**; the "Car not here yet" rows
  leave Invoices and payments (the job's own rows carry the money now); the estimate page points
  at the job.
- **Nothing is ever counted twice:**
  - A COMPLETE pre-paid tax invoice IS the job's tax invoice (the proforma step never rebuilds
    the bill on top of it).
  - An ADVANCE tax invoice is a deposit document: at Ready the job's final proforma folds it in
    exactly like today's job deposit invoices — its payments move across, the final invoice
    prints "Deposit invoiced (INV-xxxxx)", and in Zoho the moved payments (now on the job) are
    applied to the final invoice as the job's advances.
  - A PARTIAL proforma is a deposit document from birth, so it folds the same way; a COMPLETE
    proforma still open at arrival simply becomes the job's proforma.
- **The calendar shows the money**: a booking for a car with prepaid estimate money reads
  "Prepaid AED X" on the grid, and the booking page says "AED 3,650.00 on E-00087, E-00088 – the
  money follows the car onto the job at gate-in."

## Part 3 — changes, cancellations and refunds (same day)

**A second database change joins the WAITING FOR APPLY list:** `20261204120000_estimate_money2.sql`
(the combined proforma's covers column). Both files apply together when the owner says so.

- **Revised UP after a payment**: the money card measures against the newest accepted version by
  itself — "Part paid · AED X of new total" — and the advisor issues a top-up proforma (partial
  or complete for the rest) exactly like the first one. Nothing new to learn.
- **Revised DOWN below what was paid**: the card shows the over-payment in amber ("Paid AED
  2,100.00 against a bill of AED 1,575.00 — AED 525.00 over"). The OWNER settles it with a reason:
  **Keep as customer credit** or **Refund it** — either way a CREDIT NOTE is issued (the VAT
  paper) against the right invoice: the full tax invoice when one is posted (the credit note goes
  to Zoho and applies there), or the advance invoice (never in Zoho — the row is flagged "by
  hand" from birth, with the exact words of what to do there). A refund is recorded on the credit
  note's page (method + reference, logged, once only).
- **Additional estimates**: each issues its own proforma as before, **or ONE COMBINED proforma**
  — on the base estimate's card the advisor ticks the accepted additional estimates of the same
  car and the single proforma carries every line and the one total; the additional estimate's
  page says "Billed on PRO-xxxxx together with E-xxxxx", and the money is never counted twice.
- **Cancel with money held** (owner only, from the money card): reason + an optional
  **cancellation fee** that stays invoiced; the open proforma is voided (logged); what stands
  invoiced beyond the fee becomes a credit note — refunded on its page or kept as the customer's
  credit; the estimate is then cancelled with the reason. A cheque still clearing blocks it, and
  the plain Cancel menu refuses with directions while money is on the estimate. Tax invoices are
  NEVER deleted — only corrected by credit notes.
- **Past its date with money held**: the hourly clean-up NEVER expires it. The advisor and the
  owner are told once ("AED 500.00 is paid on it, so it was NOT expired. Re-send, revise, or
  cancel it"), the hold is on the estimate's history, and a second run never repeats it.

## Part 4 — ORDER PARTS NOW, before the car arrives (same day; THE TASK IS COMPLETE)

- On an **accepted estimate with priced parts**, advisors and the owner see **"Order parts now
  (N priced)"** next to Book / Gate in. One tap:
  1. a **HELD job** opens once (status booked, not on any list — exactly like the bodyshop
     bookings; its history says "opened as a HELD job for E-xxxxx");
  2. the estimate's priced part lines become part requests and priced parts through THE one
     converter (idempotent — Start quotation later never doubles them), made orderable because
     the customer's acceptance of the estimate IS the approval;
  3. the **main LPO goes for the normal one-tap approval**. With NOTHING paid the owner's bell
     says **"LPO to approve, NO ADVANCE"**, the LPO page warns "NO ADVANCE received on E-xxxxx
     (AED 0.00 of … paid) – the car is not here yet", and approving anyway needs the owner's
     reason (logged as "No advance received: …") — the same override rails as a missing deposit.
- Parts that arrive are received on the held job as usual (the desk's search finds it; labels,
  stickers, receiving all normal) — **held for E-xxxxx** until the car comes.
- **At gate-in the held job IS the job**: the estimate stays ticked to carry, the same J-number
  opens (one job, now open), the parts and LPOs are already on it, the money follows (Part 2),
  and nothing is doubled.

## Tests (whole task)

`npm run test:estmoney1` — **89 checks** through the real screens: proformas (complete, partial,
combined), bill-to, payments, links, reports, automatic tax invoices, gate-in carry, over-payment
settlement, cancel with fee + refund, expiry hold, and Order parts now with the no-advance
approval and the held-job gate-in. Plus unit `estimate-money` (21) and the reworked regressions.

## Assumptions (listed, not asked)

- A COMPLETE proforma needs the customer's acceptance; before acceptance only a PARTIAL (deposit)
  proforma can go out.
- One OPEN proforma per estimate at a time (void it to issue a different one); top-ups and
  combined proformas for additional estimates come with Parts 3.
- The advisor's payment LINK and "Payment received – send to accounts" on estimates ship in the
  next push of this task (the migration already carries their columns).
- Accounts gained `viewEstimates` (read-only page) so "Record payment works on estimates, same as
  on jobs" is real; they cannot edit or send the estimate itself.
