# Section 7: Zoho supplier bills, one line per part (13 November 2026, evening list)

## What changed

**A supplier bill now posts to Zoho with one line per delivered part.** Each part line has:
- the name, quantity and unit cost before VAT, and 5% VAT;
- the part number, the LPO, the job number and the plate in the line's description;
- its own account: parts purchases, or stock value for stock orders.

**Other lines and figures:**
- Courier and freight each have their own line, on the courier account.
- A discount or round-off on the supplier's total is its own line. Nothing hides inside a price.
- The order number (reference) is the LPO.
- The VAT fils between Zoho's 5% per line and the paper's VAT go in the adjustment, so the total is the paper's to the fils.
- **Supplier bills only.** Invoices, payments and expenses are unchanged.

**THE rule:** `billLines` in `src/lib/zoho-bill-lines.ts`. The sync uses it, and so does the side-by-side script `scripts/zoho-bill-preview.mjs` (read-only).

**Bills already posted with the old single summary line:**
- On the Zoho sync page each one now has **"Re-post with one line per part"**. It changes only that bill, in place.
- The total must stay the same. A payment already applied stays applied. If Zoho shows less paid afterwards, the row turns red with the reason.

## Bill 1260925425 (PREMIER AUTO PARTS, LPO-00076-2, AED 921.90)

- **Its lines:** three delivered lines: 8 × 67.00, 1 × 110.00, 4 × 58.00 = 878.00, plus VAT 43.90 = **921.90**. Unchanged.
- **The three parts not delivered** (received 0) are not billed, as before.
- **Your books are not live yet,** so it sits in OFJ TEST. It is paid there; the payment stays attached.
- **The re-post itself needs a press on the live site** (tests never sign in on live). This is on NEEDS OMAR: Zoho sync page → the LPO-00076-2 bill → "Re-post with one line per part".

## For Mathew

`docs/zoho-bill-lines-for-mathew.md`: three real bills, before and after, each keeping its total:
- LPO-00076-2: 921.90;
- LPO-00044-1 (Gargash): 1,833.84;
- LPO-00086-2: 440.00.

## Proof

- **Unit test** `tests/unit/zoho-bill-lines.test.mjs`. It covers:
  - LPO-00076-2 to 921.90;
  - the courier line;
  - an invoice discount line;
  - a supplier with no VAT;
  - per-line VAT rounding landing on the paper's VAT;
  - spotting an old one-line bill.
- **No Zoho call was made** from this machine. The TEST server has no Zoho connection, and live cron calls are not allowed for tests.
- No database change.

## Assumptions

- **"List price less n%"** is printed under a part only when the invoiced price really is the list price less that discount. Otherwise it would mislead.
- **A further invoice on the same LPO, and lathe bills,** keep their current lines. Only the LPO's main bill changed.
- **The per-part supplier discount stays inside the unit cost**, as the supplier invoices it. Only a discount on the invoice total becomes its own line.
