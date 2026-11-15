# Section 3 (15 November 2026): the "Proof missing" tag is one rule

## The cause (SPAY-00031)

- **The invoice:** DUBLIN AUTO SPARE PARTS LLC BR invoice 262817342 covers two LPOs:
  - the first invoice of LPO-00076-1;
  - a FURTHER invoice on LPO-00076-4.
- **The payment:** SPAY-00031 (card, AED 1,396.50) paid both, with its card slip attached.
- **The fault:** the list read the proof only from the LPO's own "Paid to supplier" field. A further invoice on an LPO never carries one, so it said "Proof missing – upload" and counted it under "Paid without proof".

## What changed

- **ONE source:** `proofsByInvoiceKey` (src/lib/supplier-payments.ts). A proof attached to a recorded payment covers every invoice and LPO that payment paid; an LPO's own proof covers that LPO. It is read by:
  - the list tag;
  - the "Paid without proof" filter and its count;
  - the opened invoice (paid line and proof under each LPO);
  - Parts accounts;
  - the LPO page's "Proof of payment".
- **The opened invoice** no longer shows the payment slip among the invoice scans.
- **The invoice file buttons are named:** "Open the invoice (PDF) · file 2 of 3 · uploaded 14 Nov 2026, 10:22".

## Read-only check on live

Exactly one invoice was tagged "Proof missing" while its payment had a proof: **DUBLIN AUTO SPARE PARTS LLC BR, invoice 262817342, LPO-00076-4, paid by SPAY-00031**. It shows correctly on this deploy, and nothing on live needed changing.

## Proof (TEST only)

- **`node --env-file=.env.test.local tests/browser/test-proof-tag.mjs`: 5 of 5,** as accounts. It covers:
  - the list tag;
  - the "Paid without proof" filter, which still lists an invoice paid with no proof;
  - the proof shown under both LPOs;
  - the named PDF buttons;
  - Parts accounts.
- Screenshots: `docs/proof/2026-11-15-proof-tag/`.
- No database change.
