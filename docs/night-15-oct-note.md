# Night of 15 to 16 October 2026: payment flow, accounts screens, WhatsApp PDFs, parts, LPOs, stock, new estimate, car photo, clean-ups

Migrations `20261101090000_payment_flow_and_stock.sql` and `20261101093000_stock_order_lines.sql` (backups
`backups/2026-10-15T17-43-21` and `backups/2026-10-15T20-01-27` first). Proof tests: `npm run test:m` (payment flow, 51
checks), `test:n` (new estimate chooser and car photo, 20), `test:o` (Share PDF, the PDF viewer, supplier LPO email, 19),
`test:p` (labels prompt, LPO list, returns, totals, supplier invoice checks, price memory, real stock, 25). Every test
removes its rows. Deployed commit by commit through the night.

## PART A: payment flow

**A1 Sending the proforma.** Done. "Send the proforma" first asks how the customer will pay (Cash, Card, Payment link,
Cheque, Bank transfer; compulsory, the bank charge per method shown under each), offers the Pay now switch (when the
Network International keys are in place) and always a box to paste a payment link, then shows the WhatsApp message.
Accounts get "Proforma PRO-00001 sent: Nikolai, AED 3,530, expected Bank transfer, Dubai A 114" and the car sits in
their Awaiting payment list. "Add Pay now and resend" appears on the invoice page once the proforma went out without it.

**A2 Recording payments.** Done. Accounts record transfer, cheque and payment link; advisors cash and card at the
counter (marked "Recorded by advisor, to confirm" and listed under "Confirm today's counter payments" on the accounts
dashboard and the invoices page with one Confirmed button); the owner records anything. The method expected is
pre-selected, the full amount pre-filled, Part payment one tap. "Customer says paid" (advisor) puts "Customer says paid,
checking" on the proforma, the job card and the lists and asks accounts to look at the bank; gate-out stays locked.
A part payment shows PART PAID with the balance due.

**A3 Final confirmation.** Done. "Record full payment" opens: "Confirm full payment: AED 3,530.00 received by Bank
transfer (ref 12345). This completes the payment and creates tax invoice INV-00001. A tax invoice can't be cancelled or
deleted. Corrections are only possible by credit note, approved by the owner." with "Yes, record and create tax invoice"
and "Go back". Yes records the receipt, creates the tax invoice and tells the advisor "Paid: Dubai A 114, AED 3,530.00".
There is no Issue button in the normal flow; the owner's early tax invoice is a small link with a reason.

**A4 Invoice page.** Done. Four numbered steps: 1 PROFORMA SENT, 2 PAYMENT (Total, Paid, Balance in large print),
3 TAX INVOICE, 4 READY FOR GATE-OUT. Only the current step has the black button; done steps are pale green with a
tick, later steps grey. Paid: the payment form, the link box and Pay now disappear. Already done from earlier work:
the customer page "Paid, thank you", the "INV-00001 · Tax invoice" title, the Documents list, View as read-only.

**A5 Job card.** Done. The money tile shows the status chip, the totals and one big button for the current step (Send
the proforma, Record payment, Send the tax invoice, Gate out); the next-step panel says the same. Gate-out stays blocked
until the balance is zero unless the customer has credit terms (already done). A proforma unpaid past the limit (24 h,
Settings) turns the tile red with "Waiting 26 h", the rows red on the accounts screens, and the owner is told once by
the hourly job.

**A6 Accounts screens.** Done. The accounts dashboard is money only: tiles (Awaiting payment, Collected today and this
month, Tax invoices today, LPOs waiting approval, Supplier invoices to check), the counter payments to confirm, then
every open car from Ready onwards as a row with the car photo, plate, car, job number, customer and the step line
JOB DONE → PROFORMA SENT → PAYMENT → TAX INVOICE → RELEASED. "Invoices and payments" is the same rows with filter chips
and counts (All, Awaiting payment, Customer says paid, Part paid, Paid, Proformas, Tax invoices, Released), a date range
and a search by plate, job number, customer or invoice number. The accounts menu is Dashboard, Invoices and payments,
LPOs, Suppliers, Customers, Profit, Attendance. The daily profit target is the owner's only. The J-00111 bug ("Ready,
advisor has not marked it yet" with the proforma already sent) had a deeper cause: since the evening's declined-charge
column gave jobs a second link to invoices, every query that embedded the job from an invoice had failed silently (the
invoices list, the profit figures). Fixed by naming the foreign key; the dashboard's "Proformas to send" and "On the
clock" (which read "NaN:NaN") were also victims of a swapped query order, now fixed.

**A7 Tests.** Done: `tests/browser/test-m.mjs`, 51 checks covering every scenario above plus Pay now.

**A8 Network International.** Built and tested against a pretend gateway; the live connection needs the keys. The
customer's Pay now opens the N-Genius hosted card page; on return (and on the webhook) the system asks the gateway for
the order's state and only then records the payment as "Payment link" at 1.75%, which completes the step and creates
the tax invoice by itself. A part payment remakes the order for the balance; a pasted link replaces it; nothing is ever
recorded twice (the order reference is the receipt's key). Until the keys are in, the switch is not offered and the
paste box is used.

Vercel environment variables to add (Settings > Environment Variables, then redeploy):

| Variable | Value |
|---|---|
| `NGENIUS_API_KEY` | the API key of the N-Genius service account (the long Basic-auth string from the portal) |
| `NGENIUS_OUTLET_REF` | the outlet reference (UUID) of the AED outlet |
| `NGENIUS_ENV` | `sandbox` first, `live` when the sandbox run is clean |
| `NGENIUS_WEBHOOK_SECRET` | a word of your choosing, for example a long random string |

Give Network International the webhook address `https://erp.ofjauto.com/api/pay/ngenius/webhook?key=<the same word>` and ask
them to enable: N-Genius Online (hosted payment page) on the AED outlet, the "SALE" action (authorise and capture in one),
webhook notifications for the order events (CAPTURED, FAILED), sandbox credentials first and the live ones after.

## PART B: WhatsApp PDFs and supplier email

**B1 Share PDF.** Done. Under Open WhatsApp in every send window (quotation, estimate, inspection report, proforma, tax
invoice, supplier LPO): on a phone the share sheet with the file named "OFJ Quotation Q-00005.pdf" and so on; on a PC
the file downloads with the hint to attach it in WhatsApp Web; every share is written on the job.

**B2 PDF inside the link.** Done. The customer's View button shows the PDF inside the page, page by page (the pages
come as pictures from `/api/pdf-pages`), pinch zoom and Zoom buttons, Back, Download PDF at the bottom. Nothing opens
in a new tab. On the quotation, the inspection report, the proforma and the tax invoice.

**B3 Supplier LPO by email.** Built; the live sending needs the Google keys. The supplier LPO card has Share PDF and
"Email to supplier": the supplier copy (VIN, part numbers, our buying prices, never the customer or selling prices) goes
from the mailbox in Settings > Parts ("Send supplier LPOs from", default peter@ofjauto.com) to the supplier's email on
file, and the LPO shows "Sent to supplier by email". Until connected the card says "Email not set up yet"; without an
email on the supplier it says what to add.

Google steps (one time, by the owner, about fifteen minutes):
1. Open https://console.cloud.google.com, create a project called "OFJ ERP" (or use an existing one).
2. In "APIs and services", enable the **Gmail API**.
3. In "IAM and admin" > "Service accounts", create a service account called "ofj-erp-mail". Open it, go to "Keys",
   "Add key", "Create new key", JSON: a file downloads. Keep it private.
4. On the service account's details, note the "Unique ID" (a long number) and the email (…@….iam.gserviceaccount.com).
5. Open https://admin.google.com (the Workspace admin) > Security > Access and data control > API controls >
   "Manage domain-wide delegation" > "Add new": client ID = the Unique ID, scope `https://www.googleapis.com/auth/gmail.send`.
6. In Vercel add two variables and redeploy:

| Variable | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | the service account's email from step 4 |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | the `private_key` value from the JSON file (the whole `-----BEGIN PRIVATE KEY-----…-----END PRIVATE KEY-----` text; line breaks may stay as `\n`) |

7. In Settings > Parts check "Send supplier LPOs from" (peter@ofjauto.com) and the email text. Then "Email to supplier"
   on any approved supplier LPO sends the PDF.

**B4 Tests.** Done: `tests/browser/test-o.mjs`, 19 checks.

## PART C: parts, LPOs, stock

**C1 Sticker prompts.** Done. A delivery puts "n parts are here: print the labels" with the button at the top of the
car's parts page; QC's pass tells the advisor "Print the service sticker" when the job has an oil change and Parts
"Print the battery warranty sticker" when a battery was fitted; the handover page already offered the stickers.

**C2 LPOs page.** Done. Tabs with counts (All, Waiting for approval, Approved to send, Ordered, Received, Supplier
invoices, Stock orders, Cancelled), a search by plate, VIN, job number, part or LPO number (the cars found get their own
"LPOs for this car" sections), a supplier filter, quick dates ("ordered 2 days ago, expected 18 Oct"), late orders and
invoices to check in red (the late-part reminder to Parts already ran daily), stock orders marked, supplier LPOs showing
their main LPO, cancelled ones kept.

**C3 Returns and leftovers.** Done. The parts desk button says "Returns and leftovers (n)"; each part shows the LPO it
came on and goes back to the supplier against it (credit note), onto the shelf as real stock (quantity and cost land on
the matching stock item, or a new one), to scrap with a reason, or on the car with the owner's approval.

**C4 Supplier purchase totals.** Done: Suppliers > Purchase totals (LPOs, this month, three months, all time, last
order, invoices to follow, prices to check per supplier, each name opening the LPO list filtered to it).

**C5 Supplier invoice at receipt.** Done. The delivery form asks "Supplier invoice: came with the delivery / to follow /
enter it later". A price more than AED 1 off the LPO is flagged; accounts, the owner or Parts press Accept new price
(the job's cost follows the invoice) or Dispute (the owner and Parts are told; the LPO price stands). Accounts count
them in "Supplier invoices to check" and see them under the LPO list's Supplier invoices tab.

**C6 Price memory.** Done. On the Parts table, leaving the part number box with the price boxes empty shows "Last: AED
90.00 net · Al Futtaim · J-00112 · Use" (list, discount, net, supplier, type and brand); one tap fills them in.
Spaces and dashes in part numbers are ignored.

**C7 Real stock.** Done. Items carry a part number, minimum, reorder quantity, supplier and an average cost; every
change is a movement (in, issued, count, adjustment, back) with the quantity after it, listed on the stock page. A
stock order is an LPO with no job: one supplier, the items and quantities (Reorder prefills a low item), approved by
the owner or the head accountant like any LPO, Ordered, then the delivery lands on the shelf with the cost averaged in
and the supplier invoice asked for. An item below its minimum turns red and tells Parts once per dip (hourly job); on
the 1st the job asks for the monthly count, whose figures replace the stock figures with the difference written down.

**C8 Stage boxes.** Already done: the job card's step tiles were pale green with a tick when done, white with a black
outline when current and grey when not reached.

**C9 Clocking.** Done. "NaN:NaN" came from the dashboard reading its invoice and clock queries in the wrong order
(fixed); a clock with no readable start prints 0:00; before QC the manager sees "No time has been clocked on this car
(0 h 00 min)" and the button reads "Send to QC anyway (0 min clocked)". J-00111 really had no clocked time: nobody
pressed Start work.

## PART D

**D1 New estimate and quotation.** Done. One page with three big choices (existing customer and car; existing customer,
new car; new customer and car), the customer found by name, company or phone, the car's few details (make, model, year,
colour, plate, VIN if known). A phone already on file is pointed out at once with "Use this customer" or "Create a second
customer anyway"; a VIN or plate already on record is pointed out with "Use this car" and is never doubled. The same
chooser starts the bodyshop quotation. Already done: bookings had Existing or New customer with a free-text car, and
gate-in's New car page creates the customer and the car together.

**D2 TV board.** Done: the display boards and their buttons are gone; the wash list stays a normal page.

**D3 Car photo.** Done: the car's picture as a rounded thumbnail (about 120 px) in the header of every car page (job
card, quotation, work order, inspection, QC, parts, gate-out, invoice, bodyshop, the car's own page), small on the parts
desk rows and the accounts rows, a grey outline when there is no picture.

**D4 Today vs target.** Done: "AED 0 of AED 20,000 (0%)", never negative; the month so far underneath; owner only.

## Not done, with the reason

- A8 live and B3 live: both wait for the keys in Vercel (listed above); the code paths run against a pretend gateway
  and the "not set up yet" path. The N-Genius webhook signature is not checked because the system never trusts the
  webhook body: it asks the gateway for the order's state every time.
- C1 "at handover": the handover page already offered the sticker print; no extra prompt was added there.

## Assumptions

- Accounts record bank transfers, cheques and payment links; advisors cash and card; the owner anything. A role
  trying another method is refused with a plain message.
- The counter payment's "Confirmed" is the existing verification tick; a counter payment needs no PIN.
- The waiting limit for a sent proforma is 24 hours (Settings > QC, car ready and follow-up).
- The N-Genius order uses the "SALE" action (authorise and capture at once); CAPTURED or PURCHASED counts as paid.
- A supplier invoice price counts as a mismatch above AED 1 per unit; smaller differences are stored and correct the
  job's cost without a decision.
- A stock order needs no invoice scan; a job's LPO still does.
- Real stock average cost: weighted by what is on the shelf and what came in; a count never changes the cost.
- "Keep in stock" on a leftover part joins a stock item with the same part number, else the same name, else starts one.
- Share PDF uses the phone's share sheet on Android, iPhone and iPad; Windows and Mac download the file.
- The PDF viewer relies on the browser's own pinch zoom (the page allows it) plus Zoom buttons.
