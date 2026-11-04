# Document scan + supplier invoices by accounts only — 4 November 2026

What the owner asked for (queue of 4 November): a "Scan document" option next to every photo
upload that turns the camera into a document scanner (find the paper's edges by itself, let the
person drag the corners, straighten it, clean it for reading, several pages into ONE PDF), and the
supplier's invoice entered by ACCOUNTS only — Parts receive the parts and keep the paper at the
desk; accounts collect it, scan it and enter it, with a reader pre-filling the figures.

No database change: the WAITING FOR APPLY list is unchanged by this batch.

## 1. The document scanner

- `src/lib/doc-scan.ts` (pure, no dependencies): finds the paper on a photo (brightness threshold,
  largest bright area, its four corners), straightens it (projective warp), cleans it (Black &
  white by adaptive threshold / Greyscale by contrast stretch / Colour as taken) and writes the
  pages into ONE PDF. Unit test `tests/unit/doc-scan.test.mjs` proves the corners are found on a
  synthetic photo of an angled invoice WITH a keyboard beside it (the real GARGASH failure).
- `src/components/DocumentScanner.tsx` (client, loaded only when opened): the camera inside the
  page (the shared `CameraCapture`), "Paper found – drag a corner if the frame is off", four
  draggable corner handles, Black & white / Greyscale / Colour, "Use page" → "+ Add another page"
  → "Save PDF (n pages)". On a PC (no touch screen) it falls back to choosing a file; a chosen
  PDF passes through unchanged.
- The button sits in the ONE shared uploader: `JobFileUpload` (every job file place: supplier
  invoices, payment proofs, credit notes, bodyshop photos…) and `QueuedProofUpload` (supplier
  payment and commission proofs). "Photo" stays next to it. `scan={false}` turns it off per place.

## 2. Supplier invoices: accounts only

- The upload door refuses a `supplier_invoice` file from anyone but the owner and accounts
  (`src/lib/upload-targets/job-file.ts` — server-enforced, proven by the test posting to
  `/api/uploads/grant` with a parts login: 403).
- The LPO page's invoice form (`SupplierInvoiceForm`) and the files' X are for owner/accounts
  only; Parts see the amber "with accounts" line: "Invoice with accounts: they collect the
  supplier's paper from the desk and scan it. Keep it ready for them."
- `supplierInvoice` (the save) and `enterInvoiceFromList` are gated server-side the same way.
- An accounts query no longer tells Parts to "correct the invoice" (they cannot): it asks them to
  check the PAPER with the supplier and tell accounts, who correct the entry.

## 3. Receiving never asks for the invoice

- The receiving panel (`ReceivePanel`) has no invoice box: stickers, then "The supplier's invoice
  is NOT entered here: keep the paper at the desk – accounts collect and scan it."
- The save (`receiveTicked`, `receivePurchaseOrder`) marks the LPO "invoice to follow" by itself
  and tells accounts at once: "Parts received from GARGASH for J-00969 · DUBAI GG 13706 – collect
  the supplier's invoice from Parts and scan it", linking to the Supplier invoices page with that
  row open. The received line reads "Received · invoice with accounts" until accounts enter it.
- Accounts' WAITING ON YOU carries the same line with "Scan & enter"; the daily reminder (cron
  step 24) now goes to accounts, once a day, with the same words.

## 4. Accounts scan and enter, with the reader

- On the Supplier invoices page a waiting row opens "Scan & enter the invoice": the ONE supplier
  invoice box (number, date, amount, files with the new Scan document), "Read the scan", the
  per-line invoice prices, a remark box ("only when the paper differs from the LPO") and Save.
- "Read the scan" (`readInvoiceScanAction`) reads the newest scanned file: a text PDF through the
  pure reader `invoiceFacts` in `src/lib/price-import.ts` (invoice number, date, gross, discount,
  before VAT, VAT, net total; "adds up ✓" when before VAT + VAT = net); a camera scan or photo
  through the OCR reader `ocrInvoiceFacts` in `src/lib/import-ocr.ts` (needs `ANTHROPIC_API_KEY`;
  without the key the figures are typed by hand as before). The figures PRE-FILL the boxes —
  accounts check every one against the paper before saving.
- The remark is written on the LPO's notes and the job history. Mark checked then sends the bill
  to Zoho exactly as before.
- An invoice file Parts uploaded in the old days stays; when accounts add a scan next to it the
  job history logs "another invoice file added (replacing or alongside the earlier one)".

## Tests

- `tests/unit/doc-scan.test.mjs`, `tests/unit/invoice-facts.test.mjs` (in `npm run test:unit`).
- `npm run test:scaninvoice` = `tests/browser/test-scan-invoice.mjs` (18 checks): the fake tablet
  camera scans a two-page invoice into one straight, clean PDF (opened and counted with mupdf);
  parts receive with no invoice box; accounts' bell and Waiting line; Read the scan pre-fills
  2374 / 2026-10-28 / 1,040.00 with "adds up ✓"; the remark and Mark checked; the upload door's
  403 for parts.
- Reworked to the new flow: `tests/browser/sim-e2e.mjs` (a14/a14b), `test-p.mjs` (section 2),
  `test-price-changes.mjs` (A/B/C), `test-invoice2.mjs`, `test-supplierinvoice.mjs` (the ONE-box
  rules now proven on the accounts side).

## Assumptions (listed, not asked)

- The scan button's scope is the shared uploaders (`JobFileUpload`, `QueuedProofUpload`) — every
  supplier invoice, proof and job-file place. The inspection camera (`InspectionMedia`) keeps its
  own flow (photos of the car, not documents).
- The OCR reader runs only where `ANTHROPIC_API_KEY` is set (live has it; the test server proves
  the text-PDF path and the screens around it).
- Per-line invoice prices moved with the entry: they are typed by accounts on the entry panels
  (they were part of the invoice entry Parts used to do).
