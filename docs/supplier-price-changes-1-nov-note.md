# Supplier invoice price different from the approved LPO (1 November 2026, LPO-00035-2)

## Where the 260 was saved

Nowhere. LPO-00035-2 kept only the supplier's invoice number (2374) and its photo:

- the invoice price on its lines was empty;
- the invoice amount was empty;
- the parts' cost on the job stayed 250.

The receiving panel Peter used had no box for the price on the invoice, so the job's cost and profit never saw the +AED 40 (four links at +10 each).

## What changed

- **The supplier's invoice is the real cost.** The receiving panel now has "On the invoice, each" beside every part, filled in with the approved price; Peter types the invoice's price over it. The LPO page's invoice form already had per-line prices. The invoiced price becomes the part's cost on the job, in the profit and in the bill to accounts and Zoho. The LPO keeps the approved price as the record.
- **Both prices show** on the LPO, the Supplier invoices tab and the report: "Approved 250.00 · invoiced 260.00 (+10.00 each, +20.00 total)". The job card shows "Supplier price change: −AED 40.00".
- **Price up after approval:**
  - Up to the limit (the higher of 5% of the LPO or AED 100 per LPO; settings `supplier_price_auto_percent` and `supplier_price_auto_aed`) it is accepted at once, and the owner is told with the invoice one tap away.
  - Above the limit it waits for the owner's **OK** or **Query with supplier** on the LPO. Only the owner decides, and accounts cannot mark the invoice checked (so no bill goes to Zoho) before then.
- **Price down:** accepted at once.
- **Quantity different** (one delivered instead of two): shown as "Quantity different" in the Supplier invoices tab; the missing one stays to receive.
- **Customer price:** when the customer already approved the quotation, their price never changes, and the job's profit carries the difference. A quotation not yet sent is rarely the case here (parts are ordered after approval) and is not recalculated by this change.
- **Owner report:** Reports > Supplier price changes, per month and per supplier (how often, how much up, how much down), with every change listed.

## LPO-00035-2 (in the migration)

- Its four wishbone links get the invoice price AED 260.00 (accepted: +40 on a 1,000 LPO is within the limit).
- The job's cost follows it, and the invoice amount is set to 1,040.
- The customer's price stays as approved. The change is written on the job's history.

## Not finished

The limits are not on the Settings screen yet: the defaults (5% / AED 100) apply, and the migration adds their rows so they can be added to the screen.

## Database (WAITING FOR APPLY)

Migration `20261202160000_supplier_price_changes.sql` (the two setting rows and the LPO-00035-2 fix). Everything else is live without it.

## Proof

- `npm run test:pricechanges` (test database, 15 checks), screenshots in `tests/browser/shots/price-changes/`.
- `npm run test:p` (24 checks), updated to the new rule.
