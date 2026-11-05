# Declined-work invoice fix — 5 November 2026 (J-00970, INV-00007)

Two faults on a "customer declined all work" invoice:

1. **The PDF**: the declined list (75 note lines on INV-00007) was written INTO the invoice's note,
   and the note draws inside the block that never splits across pages — so it printed on top of the
   totals, the amount in words and the footer. It also listed work that is not a recommendation
   (labour lines, consumables, bare "Other", service packages), with repeats.
2. **The staff money page's Lines box** showed the approved QUOTATION's lines — a declined car has
   none, so it read "Services None · Spare parts None · Total AED 0.00" while the tax invoice said
   AED 1,500.00.

## What changed

- **The Lines box = the document's own lines.** Once an invoice or proforma is ISSUED, the money
  page's Lines box shows THAT document's lines and ITS stored totals (INSPECTION CHARGES · 1,428.57
  · VAT 71.43 · 1,500.00 on INV-00007), labelled "INV-x's own lines". Before any document it keeps
  showing the approved draft as before. `/invoices/[id]` was already right (it always read the
  invoice's lines); estimate proformas and pending-charge invoices live there and are covered.
- **The declined list is its own section**, built from the saved declined-work records by ONE pure
  rule (`src/lib/declined-doc.ts`): grouped **Replace now → Replace → Advisory**, repeats removed
  (the worst grade wins), and labour lines, consumables, bare "Other" lines and service packages
  never on it. Page 1 of the PDF stays clean with one line — "38 recommended items declined by the
  customer – listed on page 2" — and the grouped two-column list starts on page 2 under its own
  heading, flowing onto page 3 when long. **It can never overlap anything again.**
- **The same section** on the customer's invoice page (with "listed below") and on the job card.
- **Old invoices** (the list still inside their note): the block is read OUT of the note and shown
  as the same section — the raw forty lines are never printed anywhere any more.
- New invoices write NO list into the note at all (both paths: declined-all and declined-to-gate-out).

## The proof the check now gives

`npm run test:declinedfix` (17 checks): a real declined-all invoice with **47 declined items**
through the real screens — the Lines box showing the invoice's own figures, the grouped
de-duplicated section on the customer page and the job card, the PDF's clean page 1 + page-2
section, and **the standard PDF check passing with zero overlaps** (the same check that fails the
old layout). The old-note fallback is proven too. `test-declined2` follows the new behaviour.

## The live invoices this heals on deploy (PDFs render fresh when opened)

| Invoice | Job | Total | List lines in the note | Sent to the customer? |
|---|---|---|---|---|
| INV-00001 | J-00655 | 787.50 | 24 | no |
| INV-00004 | J-00976 | 997.50 | 19 | **yes – worth resending** |
| INV-00007 | J-00970 | 1,500.00 | 75 | **yes – worth resending** |

Numbers and amounts are untouched — only the layout. The advisor resends from the job's money page
(Send again) whenever convenient.
