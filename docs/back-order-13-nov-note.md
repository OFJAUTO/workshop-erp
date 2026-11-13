# Back order - fit on a later visit (13 November 2026, URGENT, J-00317)

## Step 0: what blocks J-00317 (read on live, nothing changed)

J-00317 (RAM LARAMIE, Dubai W 64762) is **already at Pending QC**: Omar moved it at 08:37 with the reason "SYSTEM", just after Mert sent it back ("Transmission mount not replaced"). The two parts that blocked "Work complete":

1. **TRANSMISSION MOUNT**
   - Ordered from TRADING ENTERPRISES on **LPO-00058-2**, expected **08 Jan 2027**: the 60-day special order.
   - Not handed over because it has not arrived.
   - The line the customer pays for is on **Q-00020**: "TRANSMISSION MOUNT", AED 1,549.60. That line points at an older Al Tayer price that was never ordered.
   - The part that was really ordered sits on Q-00078 as a line left off.
   - The back order handles this. It moves the Q-00020 line, because that is the line that charges the part, and it carries the part that was really ordered.
2. **FRONT BRAKE PAD**
   - The customer approved it on Q-00078 (AED 866.25 with VAT) at 08:30 today.
   - Not handed over because it is not ordered yet: it sits on **LPO-00083**, waiting for your approval.

**Was anything like this built before?** No. There was no back order and no "fit later". The new feature reuses existing pieces:
- the held job a gate-in opens: the "booked" job that "Order parts now" already uses;
- the ONE approval box, with auto-approve;
- the deposit proforma, for the customer's advance;
- the invoice draft rule;
- the calendar.

## What was built

- **The Work complete box** (work order) lists each part not handed over, with two choices. The same box is on the **job card** while the car is in Work, QC, wash, Ready or waiting for payment.
  - "Still coming for this visit": the part keeps blocking, as before.
  - "Back order - fit on a later visit": a reason is required.
- **Who decides:**
  - The owner, a workshop manager or the bodyshop manager: it applies at once.
  - An advisor: it goes to your Approvals (Approve the back order / Keep it on this visit).
  - The auto-approve list has a new type, "Back order – fit a part on a later visit (customer pays for it now)". It is not ticked by default.
  - "Pays when fitted" always needs you.
- **The follow-up job**, e.g. "J-01600 continues J-00317". Its status reads "Waiting for part - car not here". It carries:
  - the part, with its LPO;
  - the hours moved for fitting;
  - an approved copy of those lines with the customer's approval on it, so the customer approves nothing again.
- **Shared labour line:** the box offers the line that names the part, e.g. "ENGINE MOUNT AND TRANSMISSION MOUNT … 4.0 h". You type the hours for later, and the box shows "Done now: 2.5 h stays on this job · later: 1.5 h".
- **Totals:**
  - This visit's invoice covers only the work done. The quotation's total drops by exactly what the follow-up job charges.
  - Both jobs together = the customer's approval, to the fils.
  - The time budget counts only the hours that stay.
- **Customer documents for this visit** (proforma and tax invoice, page and PDF) carry one line, for example:
  "TRANSMISSION MOUNT ON ORDER - TO BE FITTED ON ARRIVAL (EXPECTED 08 JAN 2027)".
  It has no part number, cost or supplier.
- **Money:**
  - "Customer pays for the part now" is the default. It makes an advance proforma on the follow-up job for the moved amount.
  - "Pays when fitted" needs you.
  - The box shows whether we already paid the supplier, or marked the LPO "pay first".
- **When Parts receive the part:**
  - The parts desk can receive it on the follow-up job's Parts page, although the car is not here.
  - The advisor gets "Back-order part arrived - book the customer".
  - The follow-up job card shows the customer's message, with WhatsApp and Copy buttons.
  - The follow-up is in the calendar on the expected day, as a car drop.
- **At gate-in**, the car's follow-up job opens instead of a new job:
  - There is no inspection fee.
  - Once the customer approves the check-in, the job goes straight to planning, then the fitting.
- **"Back orders (n)"** shows on your dashboard, the advisors' dashboard and the parts desk. It lists the car, part, expected date, days overdue, and "Paid by customer" yes or no.
- **Warranty:** the part lives on the follow-up job. Our 6-month warranty runs from the day it is fitted, which is that job's gate-out.

## Proof (TEST only)

- `npm run test:backorder`: **34 of 34 passed**. It covers:
  - mark the back order and split 4.0 h into 2.5 h now and 1.5 h later;
  - confirm the work, pass QC, the wash, the proforma (AED 787.50), payment, the tax invoice (AED 787.50), gate-out;
  - the follow-up job at AED 787.50, so 787.50 + 787.50 = **1,575.00 = the approved total**;
  - the ON ORDER line on the page and in the PDF;
  - the Back orders list for the owner, the advisor and Parts;
  - receive the part, the advisor's bell and the draft message;
  - the gate-in opens the follow-up job (no new job, no fee).
- Screenshots: `docs/proof/2026-11-13-back-order/`.

## Assumptions

- When a part's own line was left off, the line that charges it is the approved part line with the same name. That is J-00317's case.
- The follow-up job keeps the first job's advisor, side (mechanical or bodyshop) and car.
- The car-drop booking sits on the expected day at 10:00. The advisor moves it when they book the customer.
- A back order is refused once a tax invoice is out for the visit, because that would need a credit note.
- In the owner's target box, between the back order and this visit's invoice, the moved lines count on both jobs. The invoice ends this, which on J-00317 is today.
- On the follow-up visit, the gate-in person picks the usual fields. If an advisor does the gate-in, they still see the fee choice, but the system records "no fee" for the follow-up job.
