# Supplier invoice number at receiving (13 November 2026, URGENT 2)

## Step 0: how it worked before (nothing was built twice)

- **Receiving already worked part by part**, through two doors:
  - the LPO page: "Received now" per line, partial deliveries, "partly received";
  - the car's Parts page: tick the parts that arrived.
- **No receipt record:** only the received quantity and date on each LPO line.
- **No invoice number at receiving:** since 4 November accounts collect the paper and enter the invoice.
  - An LPO goes to "Invoice with accounts" (`to_follow`).
  - Accounts get "Collect the supplier's invoice" at once.
  - Then a daily reminder to accounts (housekeeping step 24).
- **Kept and reused:**
  - the Supplier invoices card, where accounts scan, read and enter the invoice;
  - several invoices per LPO (`lpo_invoices`);
  - accounts' "Query back to Parts";
  - the 5% check;
  - the rule that a supplier is paid only against an entered invoice.

## What is new

- **Every receipt is recorded** (`part_receipts`): what arrived, the date, time and who.
  - The LPO shows "2 of 5 received".
- **The supplier's invoice number is compulsory** on every receipt, at both doors. Stock LPOs included.
  - The parts desk types only the NUMBER.
  - Accounts still scan the invoice and check the figures on Supplier invoices. The typed number pre-fills that card.
- **"Invoice comes later"**: the button shows only for a supplier marked "Invoice later allowed".
  - Only the owner and accounts can mark a supplier: Parts > Suppliers > open the supplier > "Invoice later allowed" + days.
  - At most 5 days; the box refuses more.
  - The parts desk must add a photo of the delivery paper, or tick "No paper came" (logged).
  - The receipt is tagged "INVOICE DUE BY <date>": amber, red once overdue.
- **Reminders** go to the parts desk and accounts: day 3, day 5, then every day while overdue.
  - Both dashboards show "Invoices not received (n)", oldest first, overdue in red.
  - You see only the count on your dashboard, with no bell.
  - Typing the number later (parts desk or accounts) stops the reminders.
- **Same number twice:** a number already used for that supplier asks "Same invoice as LPO-…?" (tick) instead of refusing.
  - One invoice may cover several receipts or LPOs; one LPO may have several invoices.
- **Older receipts** (received before this goes live, with no invoice yet) are listed apart:
  - "Older receipts without an invoice (n)";
  - never reminded. The old daily reminder stops once the change is applied.
- **Accounts fix what the parts desk captured.** On every receipt (LPO page) and on its Supplier invoices card:
  - "Retake photo" and "Scan again" for the delivery paper and the invoice, any time. The old file is never deleted: the History shows who replaced it and when.
  - "Correct the invoice number": logged old → new, who, when.
  - "Photo unclear - ask Parts to retake": it shows on the parts desk's dashboard ("Photos to retake") until they retake it.
  - The parts desk can retake its own photo until accounts have checked the invoice. After that, only accounts and the owner can.
- **Payment:** the supplier still cannot be paid without the entered invoice (unchanged).

## Proof (TEST only)

- `npm run test:receipts`: **28 of 28**. It covers:
  - 2 of 5 received with one number, the other 3 the next day with another;
  - a normal supplier without a number: refused;
  - "Same invoice as LPO-E2E-R1?";
  - accounts mark a supplier (9 days refused, 5 saved), then the exception with the paper photo and the INVOICE DUE BY tag;
  - reminders on day 3, day 5 and overdue every day, to the parts desk and accounts, none to you;
  - both lists, overdue in red, your count only;
  - the number typed later stops the reminders;
  - "ask Parts to retake", the parts desk retakes, accounts scan again and replace the photo (old files kept), accounts correct the number (logged);
  - the parts desk is locked out after the accounts check;
  - the Supplier invoices card pre-filled.
- Unit `receipt-rules`: 15 of 15.
- Screenshots: `docs/proof/2026-11-13-receipts/`.

## Assumptions

- "Retake photo" opens the camera; "Scan again" picks a photo or a PDF. Both keep the old file.
- One receipt is saved per LPO in one delivery. The Parts page refuses ticked parts from two suppliers at once ("one supplier at a time").
- "Day 3" counts from the day received (Dubai). With a shorter limit (e.g. 2 days), the day-3 bell is already an overdue one.
- Your "daily summary" is the count on your dashboard; there is no separate evening message.
