# Supplier invoice: edit amounts with a remark — 5 November 2026

The real case: **LPO-00037-2 (Gargash, J-00969)** was approved at **12,228.30 before VAT**, and the
supplier's actual invoice came to **11,684.82 + VAT 584.24 = 12,269.06** — and nobody could change the
entered figure, because the invoice box only showed while no invoice was entered yet.

## What was built

**One shared "Edit invoice" button** (owner and accounts only; everyone else never sees it and the
server refuses them too), in two places:

1. **The LPO page → the RECORD box** (right under the record lines).
2. **Parts management → Supplier invoices → open the invoice** (the same button at the bottom; on an
   invoice split over several LPOs, one button per LPO).

The form edits the **invoice number, the date, each line's cost before VAT, the before-VAT total and
the VAT** (empty VAT = 5% as before). While typing it shows, live:

- **"Approved 12,228.30 → Invoiced 11,684.82 (−543.48)"** — the same line then stays on the LPO's
  Record box and on the invoice row whenever the figures differ;
- the **total with VAT**;
- an **amber warning when the VAT is not 5%** of the amount (suppliers round per line) — it warns
  but **never blocks**;
- the same "check the figure" tick as entry when the amount is more than 5% off the LPO.

**The remark is compulsory.** Every edit is recorded — who, when and **old → new for each field** —
and shown under the invoice on the LPO page and on the Supplier invoices row ("Invoice edits").
Nothing is ever overwritten silently.

## Where it flows (the one shared calculation)

- **Part costs** → the job's profit and the advisor bonus (each line's invoice price becomes the
  part's real cost, exactly like entering the invoice — the Gargash case puts **543.48** back on the
  job's profit).
- **The row's totals, the supplier's balance and "Owed to suppliers"** all read the typed VAT
  (before VAT + the invoice's own VAT = total; a split invoice's paid/unpaid shares each carry their
  own VAT).
- **"Paid to supplier"** confirms the invoice's own total ("AED 12,269.06 (11,684.82 + VAT 584.24)").
- **Zoho Books**: the edit sends the invoice **back to UNCHECKED**, so accounts look again — their
  fresh "Mark checked" queues the bill with the corrected figures. A bill **already posted** to Zoho
  turns red for the accountant ("fix the bill in Zoho by hand"), exactly like a changed invoice
  always did; a bill still waiting in the outbox simply posts the fresh figures. The ERP's own bill
  figure (reconciliation, monthly close, sync previews) now uses the typed VAT; Zoho itself still
  computes 5% on the bill, so a VAT more than a few fils off 5% shows as a **named** reconciliation
  difference — never a silent one.
- **The customer's price never changes** from here.

## Already paid?

The recorded payment is **never touched**. The edit stores and shows the difference:
"Paid before the edit: the supplier owes us AED X" (or "is owed AED X more"), in the answer, in the
history and on the screen. Increases work the same way as decreases (250 → 260 is fine).

## The database change (WAITING FOR APPLY)

`20261205150000_supplier_invoice_edit.sql` — the invoice's own VAT column and the server-only edit
history table. Backup taken first: `backups/2026-11-05T06-25-24`. **Until it is applied, the Edit
button stays hidden and VAT reads as 5%** — nothing live changes. It is applied to the TEST database
and fully tested there.

## The real Gargash invoice

Not touched by me, as asked. Once the migration is applied, **Mathew** opens
**LPO-00037-2 → Record box → Edit invoice**, types the line costs from the paper, amount
**11,684.82**, VAT **584.24**, a remark, and saves — everything above follows by itself.

## Proof

`npm run test:supinvedit` (23 checks through the real screens on the TEST database): the exact
Gargash figures edited with a remark; the live "Approved → Invoiced (−543.48)" words; back to
UNCHECKED; the history row with old → new; the part costs down 543.48 (the job's profit up the
same); the row totals, supplier balance and Paid-to-supplier at 12,269.06; the VAT warning that
never blocks; the paid-then-edit difference (+15.94 owed to the supplier) with the payment
untouched; the posted-Zoho-bill red flag; the button hidden from the parts desk **and** the server
refusing them (and refusing a too-short remark). Unit tests: the typed-VAT row maths and the
Approved→Invoiced words (`tests/unit/supplier-invoice-rows.test.mjs`).
