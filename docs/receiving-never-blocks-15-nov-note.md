# Section 1 (URGENT, 15 November 2026): receiving parts never blocks the mechanic

## Step 0: what existed

- **Receipts and "Invoice later allowed"** (13 November):
  - every delivery was a receipt with a compulsory invoice number;
  - only suppliers marked "Invoice later allowed" could skip the number, with up to 5 days to send it.
- **The block:** a normal supplier such as AL GHANDI AUTO blocked the delivery without the number, so the part could not be handed over.
- **"Issue the parts" never looked at the invoice.** The block was only at receiving.

## What changed

- **"Arrived - paperwork pending" for EVERY supplier.**
  - The parts desk records what physically arrived (quantity and condition as before) with the delivery paper's photo, or the "No paper came" tick.
  - The parts can be handed to the technician at once.
  - The reference is due:
    - for a normal supplier, by the end of the same day;
    - for an "Invoice later allowed" supplier, within its own days (at most 5), as before.
- **One reference is enough to record the delivery.** The parts desk taps the type of reference (one tap) and types its number:
  - Invoice number;
  - Pre-payment parts invoice number;
  - WIP number;
  - any type the owner or accounts add.
- **Settings > Supplier references** (owner and accounts; also linked from Supplier invoices):
  - every type has "Counts as the supplier's invoice";
  - the defaults: Invoice yes, Pre-payment yes, WIP no;
  - a type that does not count records the delivery, but the real invoice stays due and stays on "Invoices not received".
- **Reminders:**
  - the parts desk and accounts get a red reminder every morning (from 07:00 Dubai) while the paperwork is overdue;
  - you get one evening count: "n deliveries with supplier paperwork overdue".
- **An LPO cannot be checked ("closed") and its supplier cannot be paid** while a delivery on it is "Arrived - paperwork pending" with no reference. This covers "Mark checked", "Paid to supplier" and the Supplier payments box. The refusal names the LPO and says what to do.
- **Accounts change the type or the number later:**
  - "Change …" on the receipt;
  - logged old type and number → new, who, when.
  - The parts desk only adds a missing reference.
  - "Retake photo", "Scan again" and "Ask Parts to retake" are unchanged.
  - The check-before-save window names the reference type ("WIP number: W-77", or "ARRIVED - PAPERWORK PENDING").
- **Supplier invoices:**
  - "PRE-PAYMENT PARTS INVOICE NO." and "WIP NO." on the cards, beside the invoice number;
  - searchable;
  - two new columns in "Export to Excel", also on the Parts accounts list and its export.
- **Zoho:** the bill carries the other references in its notes (Zoho bills have only one reference field, which stays the LPO number).

## Read-only check on live (receipts since 13 November)

- There are 8 receipts with a number.
- One looks like a pre-payment number: **LPO-00079-1, AL GHANDI AUTO L.L.C, "PP26POR24179"**. Once the database change is applied, accounts can change its type to "Pre-payment parts invoice number" with "Change …" on the receipt.
- The other seven are normal invoice numbers.

## Proof (TEST only)

- **`npm run test:receipts2`: 25 of 25.** Signed in as the parts desk and accounts (and the owner for the count). It covers:
  - the type choice;
  - 5 of 6 with the invoice number;
  - the brake pad recorded "Arrived - paperwork pending", due today;
  - the brake pad marked ready for the technician;
  - "Mark checked" refused;
  - the morning reminder (not before 07:00, once a day) to the parts desk and accounts;
  - the owner's evening count;
  - a WIP number typed later, after which the LPO can be checked;
  - accounts changing WIP → pre-payment (logged);
  - WIP and pre-payment receipts recorded straight away;
  - search, the columns and the Excel export;
  - Settings (accounts in, the parts desk refused).
- `npm run test:receipts`: 28 of 28, brought up to the new rules.
- Unit test `receipt-refs`: all pass.
- Layout (Supplier invoices, Settings > Supplier references, Parts accounts) at 1440 and 800: clean.
- Security: all pass.
- Screenshots: `docs/proof/2026-11-15-receiving/`.

## Database change (WAITING FOR APPLY)

`20261217090000_receipt_refs.sql`:
- adds two columns on `part_receipts`;
- adds one settings row.

"Arrived - paperwork pending" already works on live without it. The apply switches on:
- the type choice;
- the new columns;
- the close and pay block.

## Assumptions

- **"Closed" = accounts' "Mark checked".** The ERP has no other close step for an LPO.
- **Entering an invoice on the LPO never clears a pending delivery by itself.** A late part often comes on its own paper, so the reference must be typed on that receipt.
- **The "same working day" is the Dubai calendar day the part arrived.**
- **The owner's "daily summary"** is one evening bell at 21:00, sent only when something is overdue.
- **Zoho:** the other references go into the bill's notes, because Zoho bills have one reference field and it stays the LPO number (it is how the ERP finds the bill again).

## NEEDS OMAR

- Mathew confirms which reference types count as the supplier's invoice (now: Invoice yes, Pre-payment yes, WIP no). He can change it himself at Settings > Supplier references.
