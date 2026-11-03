# Section 4 (2 November 2026, evening; built 3 November): Invoices and payments shows every job with money

For: the owner, Mathew and Aleemath (accounts).

## What was wrong

On 2 November two part payments were recorded: AED 30,000 on J-00969 and AED 8,000. The top of Invoices and payments read "Collected today AED 38,000", but the list under it said "Part paid · 0" and "Awaiting payment AED 0 · 0 cars".

**The cause, in one line:** the list was built from invoices only. An advance has no invoice (it waits for the proforma), and the only cars without an invoice that made it onto the list were cars already at Ready. On top of that, the tiles were counted by separate queries, not from the list they open, so they could never agree.

What that meant on the screen:

- J-00969 is approved and in the workshop, with AED 30,000 paid in advance. It was on **no** list at all: not in Awaiting payment, not in Part paid.
- "Awaiting payment" counted only cars whose proforma or tax invoice had been **sent**. Approved work with nothing paid, proformas still to send, customers on credit terms and cars that had already left owing were all left out.
- "Collected today" was the only figure that saw the advances. Its link opened "Paid" (cars paid in full, any day), so no list ever added up to it.
- A cheque cleared today but received yesterday was counted on yesterday's date. The Zoho daily check counts it on the day it cleared.
- The list stopped after the newest 600 invoices. Once there are more, older open jobs would quietly drop out.

## What changed

1. **Every job with money paid or owed is a row:**
   - an open car with any payment, an approved quotation, or a proforma or tax invoice;
   - a car at Ready, waiting for payment or out for delivery;
   - a car with an advance that has no invoice yet;
   - a car that **left still owing** (credit terms, late payment);
   - a car that **left paid in full in the last 30 days** (so Paid, Tax invoices and Released still show the recent ones; it counts in no tile, because nothing is owed);
   - any car with money in today or a tax invoice issued today.

   Two more kinds of row:
   - **Customer credit**: money on a customer's account that is not on a job yet. One row per customer, with its age. Tap it to go to the customer's Money box, where Allocate is.
   - **Pending charge**: a charge with its own proforma (recovery, fuel and the like with no visit). Tap it to go to Pending charges.
2. **Each job row shows "Paid so far AED a · Balance AED b"** (or "Paid in full" / "No approved total yet"), a cheque still clearing, and **"Today AED d"** in green when money came in today. Before the proforma, the balance is the approved total less every advance. That is the same figure as the job card, the customer page and the Record payment window, because all of them now use one rule.
3. **An advance has its own chip:** "Advance AED 30,000 · AED 7,930 to pay" (amber). It shows on the list, the job card and the money page. A car that left with money still owed now reads "Left owing · AED 2,150 due" (amber), not a green "Released".
4. **The chips** are All, Awaiting payment, Customer says paid / reported, Part paid, **Advance, no proforma yet**, **Collected today**, **Tax invoices today**, **Customer credit**, Paid, Proformas, Tax invoices and Released. Each count is the number of rows behind it, except Tax invoices today, which counts the invoices (like its tile).
   - **Part paid** = some money in and some still due. Advances count.
   - **Awaiting payment** = every balance due on approved work, whatever the step: in work, proforma to prepare or send, sent, part paid, tax invoice unpaid, credit terms, left owing, pending charge.
5. **The tiles come from the same list they open:**
   - **Awaiting payment** → the Awaiting list. It reads "N cars · AED X due now · AED Y work in progress" (and "+ n pending charges" when there are any). "Due now" means a proforma or invoice was sent, the car has left, or it is a pending charge.
   - **Collected today** → the new Collected today list. It reads "N payments · this month AED Z".
   - **Tax invoices today** → the new list of today's tax invoices. Deposit tax invoices are not counted. The tile, its chip and the list's heading all count **invoices**: if one car got two tax invoices today, they say 2 ("2 tax invoices on 1 car") and the row shows both numbers.

   The heading of each list repeats its total ("4 · AED 47,600.00 in 5 payments"), so you can check it against the tile.
6. **The collected rule:** money counts on the day it was received. **A cheque counts on the day it clears**, the same as the Zoho daily check. A cheque still clearing is shown on its row but not counted.
7. **The accounts dashboard** uses the same list and tiles. Its Awaiting payment is in four groups:
   - Due now: proforma or invoice sent
   - Proforma to send or prepare
   - In work, advance received (with a link to every advance)
   - In work, nothing paid

   The old "Deposits received, not yet on an invoice" box is replaced by the advance group and the Advance chip.

   **Pending charges are not rows on the dashboard** (your rule of 31 October: cars not in the workshop stay off it). The Awaiting payment tile counts them, so one plain line under Awaiting payment says "Plus 1 pending charge (cars not in the workshop) · AED 630" with a link to Pending charges; no customer or car is named there. Cars that left paid in full are not on the dashboard either; the other section is called "Other money: paid, today, customer credit".
8. **The money page** (Payments and invoice) now shows "Paid so far" and "Balance due" by the same rule before the proforma. Before, it counted a cheque that had not cleared and left out money paid on a deposit invoice.
9. **Dates and search.**
   - With no dates entered, the page shows what is paid or owed now, and the cars that left paid in full in the last 30 days. A line under the chips says so.
   - Enter dates to see history: every job with a document issued between them (credit notes too), with no 600 limit. Today's money does not creep into an older date range.
   - The search box also finds older cars by plate (written as people say it), VIN, job number, customer name, the customer's **mobile**, or any document number (a credit note or an old proforma too). Everything it finds is shown.
10. **Credit notes lower the balance.** A credit note on a tax invoice takes its amount off what is still owed (less any part of it refunded to the customer in money). So a car that left with a tax invoice of AED 10,500, a credit note of AED 1,050 and AED 9,450 paid reads "Paid in full" with "credit note AED 1,050.00 off". It is never stuck in Awaiting payment or Part paid. The same figure is on the list, the job card, the customer page, the money page, the invoice page and the Record payment window, and paying the rest moves the car to Ready as it should.

## The lists asked for

I did not read the live data: production reads are not allowed from the test machine. The proof ran on the TEST database, on a copy of the J-00969 situation made through the screens as accounts:

| Row | Paid so far | Balance | Today | In the lists |
|---|---|---|---|---|
| Copy of J-00969, approved and in work, AED 30,000 recorded in the Record payment window | AED 30,000.00 | AED 8,115.00 | AED 30,000.00 | All, Awaiting, Part paid, Advance, Collected today |
| Second customer, AED 8,000 on the account (not allocated) | AED 8,000.00 | none | AED 8,000.00 | All, Customer credit, Collected today |
| Second customer, AED 8,000 advance on another car in work | AED 8,000.00 | AED 4,600.00 | AED 8,000.00 | All, Awaiting, Part paid, Advance, Collected today |
| Car at Ready, proforma sent: AED 1,000 cash today, a cheque of AED 600 received yesterday and cleared today, a cheque of AED 500 still clearing | AED 1,600.00 | AED 1,550.00 | AED 1,600.00 (2 payments) | All, Awaiting (due now), Part paid, Collected today |
| Tax invoice issued today, unpaid | AED 0.00 | AED 2,205.00 | none | All, Awaiting (due now), Tax invoices today |
| Car that left owing | AED 1,000.00 | AED 2,150.00 | none | All, Awaiting (due now), Part paid, Released |
| Car that left, paid in full yesterday | AED 1,575.00 | Paid in full | none | All, Paid, Tax invoices, Released (no tile) |
| Car that left: tax invoice AED 3,150, credit note AED 1,050, AED 2,100 paid | AED 2,100.00 | Paid in full ("credit note AED 1,050.00 off") | none | All, Paid, Tax invoices, Released (no tile) |
| Car in inspection with nothing paid | not on the list | | | |

The tiles on that test:
- Collected today = AED 47,600.00 in 5 payments. That equals the database sum of today's payments by the collected rule, and the sum of the Collected today list.
- Awaiting payment = the sum of the balances on its list.
- Tax invoices today = 1, the same as the database.

**Before**, the same data would have shown none of these rows:
- the J-00969 copy;
- the second customer's credit and advance;
- the car that left owing.

Part paid would have listed only the car at Ready, and Awaiting payment only the car at Ready and the unpaid tax invoice.

**J-00969 on live, from the rule:** after this change it shows as "Paid so far AED 30,000.00 · Balance AED (approved total − 30,000)" under Awaiting payment, Part paid and Collected today (on the day the money came in). The AED 8,000 shows on a job row or as a Customer credit row, depending on where it was recorded.

## What staff need to do

Nothing changes in how money is recorded.

- **Accounts:** open Invoices and payments.
  - **Awaiting payment** is now everything still owed.
  - **Collected today** is today's money, line by line, with the same total as the tile.
  - **Customer credit** rows are money to allocate: tap the row, then Allocate on the customer's page.
- **To find an old paid invoice:** cars paid in full in the last 30 days are on the list (Paid, Released). For older ones type the plate, VIN, job number, mobile or invoice number in Search, or enter dates.

No database change is needed: nothing waits for "apply".

## Tests

- `npm run test:s4-moneylist`: the browser proof above, on the TEST database. Screenshots are in `tests/browser/shots/s4-moneylist/`. Since the review of 3 November it also proves the credit note, two tax invoices on one car, the dates list keeping to its dates, the search by mobile and by VIN, and the dashboard without pending-charge rows.
- `tests/unit/money-list.test.mjs`: the rules (`npm run test:unit`).
- The draft totals are now read for many jobs at once. On 3 November they were checked against the old one-job-at-a-time reading over every job on the TEST database: 40 jobs, 0 differences. The jobs included two approved versions of one quotation, a rounded total, returned and replaced parts, hidden and left-off lines, an agreed charge, an inspection fee and a free comeback.

## Review of 3 November (independent check)

An independent review of this change found eight points; all are fixed:

1. The list without dates had dropped every car that left paid in full, so Paid, Tax invoices and Released went almost empty. Now cars paid in full in the last 30 days stay (no tile changes), and a line under the chips says where older ones are.
2. A credit note did not lower the balance, so a car that left after a credit note would have sat in Awaiting payment and Part paid for ever. Fixed everywhere the balance is shown (point 10 above). There are no credit notes on live yet.
3. Pending charges had become rows on the accounts dashboard, against your rule of 31 October. They are off it again; one line says how much of Awaiting payment they are, with a link to Pending charges.
4. A date range also showed jobs that only had money today. It now keeps to its dates.
5 and 7. The search found cars by mobile, VIN, a company's contact name or a credit-note number, and then hid them. Everything it finds is now shown.
6. "Tax invoices today": the tile counted invoices, the list counted cars. Both count invoices now.
8. The page re-loaded itself about every minute while anyone was editing a quotation. It no longer listens to quotations (an approval always changes the job too, so nothing is missed).

Not changed (customer documents): the customer's own tax invoice page and PDF, and a Pay-now link on a tax invoice, still show the invoice's balance without the credit note; the credit note is its own document for the customer.
