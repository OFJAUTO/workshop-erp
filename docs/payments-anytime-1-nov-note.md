# Record a payment – always possible, for any car, at any time

1 November 2026 (batch "payments anytime + LPO approvals + intake manifold", section 1)

## Why J-00969 could not take a payment

Before the proforma exists (it is made when the car is Ready), the only way to record money was a closed grey fold at
the very bottom of the money page, "Record an advance payment". At the same time, "What to do now" said "Nothing to do
yet", and the job card's PROFORMA box had only the "Payments and invoice" link. Nobody found it.

## What staff see now

**Record payment** (owner and accounts) opens one window. It works from:

- the job card's money box (PROFORMA / TAX INVOICE), at every stage, before or after the check-in approval, and after
  the car has left;
- the money page ("What to do now" says "No proforma yet … recorded as an advance"; after gate-out: "The car has left
  with AED X still due");
- every car page and every customer page, including a car or a customer with no job at all;
- the Invoices and payments page (it starts with a search: name, mobile, plate, VIN or job number);
- the search results at the top ("Pay" next to each car);
- the customer details panel.

The window first asks **where the money goes**:

- the job ("Allocate to J-00969 … balance AED X"): before the proforma it is an advance (no VAT), with its own RCT
  receipt, and it comes off the proforma and the tax invoice by itself;
- the job's proforma or tax invoice, once there is one;
- jobs that left with money still owed;
- **the customer's account (not allocated)**, with a required note of what it is for and, optionally, the car.

Then the method:

- card and payment link need the auth code; card needs the slip;
- cash;
- cheque (number, bank, date);
- bank transfer (reference and proof).

**More than the total:** a warning, "More than … by AED X", and a required note (a refund to make or credit to keep).
It is logged on the job and the owner is told. It no longer waits for the owner.

The answer stays in the window: "✓ RCT-00041 recorded", where it went, Receipt (PDF), **Send the receipt** (WhatsApp
or copy, with the receipt link the customer can open), Record another.

**Paid so far · Balance** shows on the job card ("Total AED 945.00 · Paid so far AED 600.00 · Balance AED 345.00"), on
the proforma (each receipt and the BALANCE DUE) and on the customer page.

**Unallocated payments:**

- they are listed on Invoices and payments with their age ("unallocated 3 days", red from 7 days);
- on the customer and car pages;
- one line each in accounts' Waiting on you;
- in the customer panel as "Credit AED X (not allocated)".

**Allocate** moves one in a single step to a job, its proforma or its tax invoice. When the customer has credit, the job
card and the money page offer "Customer credit, not allocated – Allocate to this job".

**Advisors** still never record money. They now have **Send payment link** on the job card: the full balance or a
custom amount, deposit asked or not. The message (Settings > WhatsApp: payment link) carries our /p/ payment page; the
bank's own pay-by-link can be pasted to open from it. Accounts are told and record the money when it arrives.

**Zoho:** an advance posts as a customer advance (unapplied) as before. Once allocated and the invoice is in Zoho, it
is applied there.

## Assumptions

- A payment for a customer with no job, or one whose job is not known, is an unallocated advance on the customer's
  account. It is never guessed onto a job.
- Allocation is only to the same customer's jobs and invoices.
- A job already paid in full is not offered as a place for new money, unless it is the job the window was opened on
  (then more than the total needs the note).
- The proof photo of a payment with no job goes through the server (photos are shrunk on the phone first). Payments on
  a job keep the send queue.
- The "pending charges" place is added by that task (it is queued); the window will list pending charges then.

## Proof

`npm run test:payanytime` (test database): 27 checks plus the stage round of 42 (7 stages × owner and accounts ×
3 checks). Pictures are in `tests/browser/shots/payanytime/`.
