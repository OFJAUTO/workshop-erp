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

## Still to come (the task's remaining parts)

- Part 2: gate-in carries every proforma, payment and tax invoice onto the job ("Paid so far",
  "Already invoiced", calendar "Prepaid AED X"); the final invoice deducts everything already
  invoiced.
- Part 3: revisions (top-up / credit / refund with credit notes), additional estimates' proformas,
  cancel with refund-or-credit and the expiry holds.
- Part 4: "Order parts now" on an approved estimate with the no-advance owner warning.

## Assumptions (listed, not asked)

- A COMPLETE proforma needs the customer's acceptance; before acceptance only a PARTIAL (deposit)
  proforma can go out.
- One OPEN proforma per estimate at a time (void it to issue a different one); top-ups and
  combined proformas for additional estimates come with Parts 3.
- The advisor's payment LINK and "Payment received – send to accounts" on estimates ship in the
  next push of this task (the migration already carries their columns).
- Accounts gained `viewEstimates` (read-only page) so "Record payment works on estimates, same as
  on jobs" is real; they cannot edit or send the estimate itself.
