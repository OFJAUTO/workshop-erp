# 20 October 2026, part 2 — delivery note

Eight sections, each pushed live on its own (`LIVE:` messages through the day). Two migrations, both
applied after a fresh database backup (`backups/2026-10-20T09-47-07` and `...T10-02-16`).

## 1. Accounts' WAITING ON YOU shows everything
`src/lib/accounts-waiting.ts` (`accountsWaitingExtra`) feeds the accounts dashboard's Waiting on you
box with every money action: cash taken (deposits included) still to confirm and bank — each with its
own **Confirm & bank** button, deposits requested and not received, LPOs waiting for the one-tap
approval, supplier invoices to follow or with a price to check, recovery trips claimed by the drivers
and months ready to pay. `WaitingPanel` rows carry `always: true` so money items never dedupe away.
The money page's deposit rows gained the amber "To confirm & bank" badge and the **Confirmed &
banked** button (cash on invoices too). Every dashboard tile was checked against live data; none
shows 0 while something is pending. Proof: `npm run test:waiting` (7 checks).

## 2. Supplier invoice rules
Migration `20261110190000_supplier_invoice_date_paid.sql`. The supplier invoice now needs the
**number AND the date printed on it** (`purchase_orders.supplier_invoice_date`); "Invoice to follow"
is the one exception and shows the amber **Invoice missing** badge on the LPO and the list, sits on
the accounts Waiting list, and reminds Parts once a day (cron step 24, `invoice_reminder_at`,
notification `supplier_invoice_missing`). A supplier LPO is **marked paid** (owner or accounts, with
an optional reference) only when the number, the date and at least one scan are on file
(`markSupplierPaid`, `supplier_paid_at/by/reference`, the gate spelled out on the page). The invoice
takes **several files** with thumbnails and an **×** to remove (`job_files.removed_at/by`, route
`/api/files/remove`, `JobFileUpload removable`, `InvoiceFiles` on the LPO page); the scan is optional
at receiving but required before paying. Proof: `npm run test:invoice2` (16 checks).

## 3. The advance payment is a real step
Migration `20261110210000_advance_payment_step.sql` (`jobs.deposit_requested_at/by`). A quotation
that asks a deposit puts **ADVANCE PAYMENT** on the job-card step bar between Approval and Parts
(same stage-box colours; `StageTrack` gained `extra`), with its own stage card: the amount asked and
received, **Send deposit request** (the written WhatsApp message with the amount from
`whatsapp_deposit_request_template`, a Pay now link pasted underneath if wanted), and the stamp once
sent. The next step reads "Send the customer the deposit request" for the advisor, then "Record the
deposit" for accounts (`next-step.ts` + `waiting.ts`); only accounts or the owner record the money
(unchanged rule). The Parts job page says **Waiting for the deposit** (the owner's LPO override
stands). Before sending a quotation: a big parts order (over `deposit_threshold_aed`, 5,000) with no
deposit asks "Ask for a deposit?", and a customer note mentioning an advance or deposit with none set
asks "Did you mean to ask for a deposit?". Proof: `npm run test:advance` (15 checks).

## 4. Commission counts at once, instantly on screen
A commission counts as a cost **the moment it is set**, labelled "pending owner approval"; only the
owner's decline removes it (`quoteTotals` in `quotes.ts`, and `jobProfits` in `profit.ts` — so the
owner's profit, the daily team target and the 12,000 advisor bonus all see the same figure; the
monthly "Mark paid" list still pays only approved ones). The Commission line reads and writes the
editor's own header state (`onLocal` on `CommissionLine`), so the whole internal box — profit,
margin, total cost — moves the instant a commission is added, changed, approved or declined, with no
refresh, and reverts if the save fails. This fixes the Q-00043 kind of case (45.1% shown, 38.0%
real). Proof: `npm run test:commission` (9 checks).

## 5. The advisor discount limit, as a share of labour
`discount_limit_percent` now defaults to **10** (the stored 25 was moved to 10) and is measured
against the labour the discount applies to; **the round-off at sending counts toward it**
(`ownerApprovalReasons` rebuilt on the real discount columns). Within the limit the advisor sends
himself; above it the quotation waits as `pending_owner` — the owner's bell rings, the page reads
"Waiting for the owner: discount 18% of labour (limit 10%)", and nothing can go to the customer until
he approves from the box on the quote page. Parts stay undiscountable by advisors; the owner is never
limited. Proof: `npm run test:discount` (10 checks).

## 6. A new line appears the instant it is tapped
`addLine` draws the row at once with the cursor in it: the editor makes the line's id, the save
carries it (`addLine.id` accepted by the save route), so the server's row — service price and hours
filled in — slides underneath on the next refresh and a duplicate is impossible. Measured: the line
is on screen in about **50 ms** with the save held up 3 seconds on purpose. Typing is never lost (the
queue already kept everything in localStorage); a refused save now stays on the line as **"Not saved
– <reason>"** with a **Retry** that resubmits the same op (`useQuoteAutosave.failed`, the chip on
every row kind, the parts table included). Removing a line was already instant. Proof:
`npm run test:instant` (9 checks); `test:commission` re-run green after the editor changes.

## 7. Fixed-price lines, switchable per line
Every labour or service line's three-dot menu now has **Make it Fixed price (qty × price)** /
**Make it Labour (hours × rate)** — on filled lines too, the customer's figure carried across (and
never below the standard rate on the way back). A fixed line shows no hours boxes, counts nothing in
labour hours or labour cost, and the customer's PDF shows it with no hours text (checked by reading
the PDF). The root of the "R1234 – YF refrigerant recovery at 1 h × 1500 AED/h" complaint: a service
set as **fixed price in Settings** (price typed each time, `services.line_kind`) was landing as a
labour line — the save route and the editor now respect `line_kind`. Proof: `npm run test:fixed`
(11 checks).

## 8. A photo of the old parts at gate-out
Ticking **Old parts handed over** opens Photo and Gallery buttons (optional). Each photo uploads at
once to `job_files` (`kind gate_out_photo`, caption "Old parts handed over") with the time and who
took it — `JobFileUpload` gained a `caption` prop and the × works here too. The job card's Gate-in
details fold shows "Old parts: Handed over · n photos below" on the gate-out record and the photos
underneath with the time and the name. Proof: `npm run test:oldparts` (9 checks).

## Lessons of the day
- The approved-quotation lock trigger silently refuses `deposit_mode/value` updates through the e2e
  sql route; `deposit_aed` alone passes — test seeds must set only that.
- A quotation's stored totals must stay consistent with a discount set by SQL, or `roundQuotation`
  refuses ("too far from the quotation total") and the send silently stops.
- `SendLinkDialog`'s `children` REPLACES the message body; extra controls above the message go in the
  new `above` prop.
- `Collapsible` mounts its children only when open (it is a button, not a `<details>`), so a test
  must click the fold's button before counting what is inside.
- The e2e "quote" stage seed carries a pre-made token, so "a link exists" proves nothing about
  sending — assert `valid_until` or the `quote_link_created` event.
- `payments.customer_id` is NOT NULL with no default: a test inserting a payment must select it from
  the job.
