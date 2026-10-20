# The workflow map

**What this is.** One table of every hand-off in the system: what just happened, who did it, what they see the moment they do it, whose move it is next, what that person sees on their screen, who gets a bell, what changes on the boards, and which clock starts ticking. The code follows this map; when the two disagree, one of them is wrong and gets fixed (the end-to-end simulation `tests/browser/` checks the main paths against it).

Written 21 October 2026, after the overnight batch. Columns:

- **Event** – the thing that happened (usually one button).
- **Who** – the person who presses it.
- **They see** – the confirmation under their finger (rule R1: always at the thing they pressed, never silence).
- **Next** – whose move it is now.
- **Their task** – the exact line and button the next person finds on their Waiting list / desk (rule R2: the task goes TO them, they never have to go looking).
- **Bell** – the notification, if any (rule R3: a bell for a hand-off to a different person, never for your own action).
- **Boards** – what changes on the step bar, dashboards and desks (rule R4: live state everywhere, one source).
- **Clock** – the timer that starts, and what happens when it runs out.

## The nine rules (R1–R9)

1. **R1 – Confirm.** Every button answers at the button: a green line, the new state, or the error in red. Nothing just "goes quiet".
2. **R2 – Hand over the task.** When A finishes, B's screen gets the task with a button, worded as work to do ("ORDER NOW", "Record the deposit"), not as information.
3. **R3 – Notify.** B also gets a bell with the car and the one line. No bells to the person who pressed the button.
4. **R4 – Live state.** Boards and lists read the live rows (`partsLiveOf`, `moneyState`, `nextStepOf`, `stageStates`), never a stored label that can go stale.
5. **R5 – No dead ends.** Every state has a way forward on screen: a refusal says what to fix, a wait says who is awaited, a declined job still gates out.
6. **R6 – No duplicates.** A second tap, a retry or two people on the same row never make a second record (`client_key`, `FormGuard`, locks).
7. **R7 – Plain words.** Buttons and tasks say the thing itself ("Invoice to follow", not "defer invoice capture").
8. **R8 – Expanded by default.** The Waiting list and urgent sections arrive open; a person never unfolds to find out they are needed.
9. **R9 – Hide empty.** A section with nothing in it does not render. No "Nothing to order" filler.

## A. Gate-in

| Event | Who | They see | Next | Their task | Bell | Boards | Clock |
|---|---|---|---|---|---|---|---|
| Car gated in (form saved) | Gate-in | "Saved" + the media checklist opens | Gate-in (same person) | "Finish the gate-in photos and videos" → **Add video and photos** | – | Job appears on the dashboard as *Gate-in incomplete* | Stage clock starts (`stage_entered_at`) |
| Media checklist complete | Gate-in | Every item turns green; the finish button goes | Advisor | "Create and send the approval link to the customer" → **Create the approval link** | `gate_in_complete` to the advisor and the manager | Status *Pending approval*; step bar step 1 done | Doc reminder: approval link not sent → red "Not sent" chip + `doc_not_sent` (settings `doc_reminder_limits`) |
| Approval link sent (WhatsApp) | Advisor | The send window confirms "Sent"; the link line shows the time | Customer | (customer page `/a/…` – Approve with name) | – | *Waiting on the customer to approve the job card* | Same doc clock stops |
| Customer approves the job card | Customer | "Thank you, approved" on the page | Workshop manager | "{Manager} assigns a technician" → **Assign** (`/assign`) | `customer_approved` to the advisor and managers | Status *Pending inspection*; floor board shows the car | Assignment overdue reminder → the department's manager too |

## B. Inspection

| Event | Who | They see | Next | Their task | Bell | Boards | Clock |
|---|---|---|---|---|---|---|---|
| Technicians assigned (+ road test choice) | Manager | The assign row collapses to "Assigned to …" | Technician (or QC first) | "Start the inspection on the tablet" → **Open on the tablet**; road test needed → QC's task "Road test" | `job_assigned` to each technician (and QC when a road test is set) | Status *Pending road test* or *Pending inspection*; the Inspection step shows its two halves | Stage clock resets |
| Road test saved | QC inspector | The eight items save with the chips; "Saved" | Technician | "Finish the inspection report" → **Open the report** | `road_test_done` to the technician and manager | Inspection opens | – |
| Inspection submitted | Technician | "Submitting…" then the server's answer in the bar (A5) | Manager | "The workshop manager reviews and approves the report" → **Review the report** | `inspection_submitted` to the manager | *Report submitted, waiting on {manager}* | – |
| Report sent back | Manager | The decision bar confirms; reason saved | Technician | "Report sent back for changes" → **Open the report** | `inspection_returned` to the technician | Back to *In inspection* | – |
| Report approved (parts list ticked, hours agreed) | Manager | The ReviewBar confirms "Approved" | Advisor + Parts | Advisor: "Start the quotation and send the report" → **Start the quotation**. Parts: the car appears on the Parts desk with its requests | `inspection_approved` to the advisor; `parts_requested` to Parts | Status *Pending quote*; Parts desk gains the car (Pricing step current) | Parts pricing clock (shown per step on the desk; owner's Parts speed report) |

## C. Quotation and the customer

| Event | Who | They see | Next | Their task | Bell | Boards | Clock |
|---|---|---|---|---|---|---|---|
| Parts pricing done | Parts | **Pricing done** turns the bar green; open rows would turn red with "Go to next" | Advisor | "Finish the quotation and press Quotation complete" → **Finish the quotation** | `parts_priced` ("Prices ready on {car}") to the advisor | Desk: *Priced* chip; quote editor's blockers clear | – |
| Prices changed after sending | Parts | "Send updated prices" confirms | Advisor | The quotation flags "Parts prices changed" | `parts_price_changed` | `quotations.parts_price_changed_at` badge | – |
| Quotation complete | Advisor | The completion asks its questions once (low profit? markup? parts missing? deposit?) then "Completed" | Advisor (send) | "Send the quotation to the customer" → **Send the quotation** | Owner gets `low_profit` only if sent under the margin | *Quotation ready to send* | Doc reminder: quotation not sent |
| Quotation sent | Advisor | The send window: short link + message, "Sent" | Customer | (customer page `/q/…` – Approve, or ask urgent-only) | – | *Waiting on the customer*; `viewed_full_at` when opened | Quote expiry (`quote_valid_days`); `payment_waiting_long` later |
| Customer approves | Customer | "Thank you, approved ✓" with the deposit line when one is set | Deposit short → advisor; else Parts / manager | See D and E | `quote_approved` to the advisor, manager, Parts | Status *Approved* → planning; the approved amount locks (quote lock) | Planning clocks start |
| Customer asks urgent-only | Customer | "We'll send the urgent-only version" | Advisor | "Create the urgent-only version" → **Open the quotation** | `urgent_requested` | *Urgent work only requested* | – |
| Advisor marks Declined | Advisor | The Declined card opens with what happens next | Advisor | **Decline to gate-out** (fee invoice optional) | `job_declined_out` to the managers | Status straight to gate-out path (R5: no dead end) | – |

## D. Advance payment (deposit)

| Event | Who | They see | Next | Their task | Bell | Boards | Clock |
|---|---|---|---|---|---|---|---|
| Approval lands with a deposit set | – (automatic) | – | Advisor | "Send the customer the deposit request (AED X)" → **Send deposit request** | `deposit_to_collect` to the advisor and accounts | Waiting list: *Advance payment* (amber) | – |
| Deposit request sent | Advisor | The send window confirms; the pay link is validated against the allowed gateway domains | Accounts | "Deposit of AED X to receive" → **Record the deposit** (panel opens in place) | – | *Waiting for the deposit* | `deposit_overdue` (cron 19); accounts red after `settings` hours; red >30 min rings once (cron 25) |
| Deposit recorded | Accounts | The RECORD DEPOSIT panel confirms in place; over-payment kept as advance; **Send receipt** right there | Parts / owner | LPO unblocked: Parts' normal flow | `deposit_received` to Parts and the owner ("LPO can be approved") | LPO gate opens; money page step done | – |

## E. Parts and LPOs (the reference hand-off, 2.3)

| Event | Who | They see | Next | Their task | Bell | Boards | Clock |
|---|---|---|---|---|---|---|---|
| Send LPO for approval | Parts | "Sent for approval" at the button | Owner / head accountant | Amber task "LPO waiting for approval · {number}" → **Open the LPO** (Approve / Refuse with reason) | `po_approval` to the approvers | Desk + job card: *LPO waiting for approval*; deposit short shows the override box | Waiting-list amber; >24 h escalates red |
| LPO approved | Owner/accounts | "{number} approved ✓ — Parts have been asked to order from {suppliers} (N parts, AED total)" | Parts | **RED task: ORDER NOW** – big card per supplier LPO on top of the desk with Copy / PDF / Email / **Ordered** | `po_approved` ("ORDER NOW…") to Parts | Desk: ORDER NOW section first; job card line updates; `partsLiveOf.orderNow` everywhere | Amber at 30 working min, red at 60 (`order_now_*_minutes`); red rings the owner once (cron 26, `task_overdue`) |
| LPO refused | Owner/accounts | "Refused" with the reason logged | Parts | The LPO shows *Refused* with the reason; fix and re-send | `po_refused` with the reason to Parts | Desk clears the pending badge | – |
| Supplier LPO marked Ordered (dates per line) | Parts | The card turns light green "Ordered ✓" | Supplier (outside) | *Deliveries expected* group per supplier with the dates | `parts_arrived`-family "Parts ordered · {job}, expected by {date}" to the advisor | Job card: "Parts ordered from {supplier} – arriving {date}"; *Waiting for parts* | Overdue date turns the delivery group red; arrivals week view; `parts_delay` date moves need a reason |
| Parts received (panel or LPO page) | Parts | The receiving panel confirms; stickers print; **the ONE supplier-invoice box** (number+date, or Invoice to follow; amount >5% off needs the tick; files with X) refuses bad entries in place | Technician | "Parts ready for you" → tick + PIN on his tablet (`PartsForCar`) | `parts_arrived` to the advisor and manager; `parts_ready` to the technician | Step *Received* done; labels prompt; `ReceivePanel` rows collapse green | 2-hour reminder if not taken (cron 21) |
| Invoice to follow | Parts | The box says exactly what happens next | Parts (later) + accounts | LPO: amber **Invoice missing**; accounts tile "Supplier invoices to check" | Daily `supplier_invoice_missing` to Parts (cron 24, once a day) | Orders list badge "Invoice missing · N days" | Daily until number+date entered |
| Supplier invoice price ≠ LPO (> AED 1) | Parts | "Saved. N prices differ – accept or dispute below" | Accounts / owner | **Accept new price / Dispute** on the flagged line | `supplier_invoice_mismatch` | Job cost follows the invoice price meanwhile | – |
| Supplier paid | Accounts | "Paid to supplier" with the reference | – | – | – | Supplier totals; profit final | Pay gate: needs the invoice scan on job LPOs |

## F. Work

| Event | Who | They see | Next | Their task | Bell | Boards | Clock |
|---|---|---|---|---|---|---|---|
| Manager releases the work (start day, technicians) | Manager | The planning card collapses to the plan | Advisor | "{advisor} confirms the finish date and tells the customer" → **Confirm the date** | `work_released` to the technicians and advisor | Status *In work*; floor board moves | Time budget (`budget_*`) |
| Technician presses Working / Pause / Job finished | Technician | `WorkClock` turns green/amber with the time; "Job finished" asks once | Manager (on finish) | "Job finished, {manager} confirms" → **Confirm the work** | `work_finished` to the manager | Work order shows the sessions live | Overnight open sessions auto-close (cron 10b); breaks auto-pause |
| Manager confirms the work | Manager | The confirm bar answers | QC | "The QC inspector checks the car" → **Start QC** | `qc_ready` to QC | Status *Pending QC*; QC round opens itself | – |

## G. QC and wash

| Event | Who | They see | Next | Their task | Bell | Boards | Clock |
|---|---|---|---|---|---|---|---|
| QC fails items | QC | The round saves with the failed list | Technician + manager | The failed items in a red box on the tablet and the work order | `qc_failed` | Status back to *In work*, round n+1 | – |
| QC passes | QC | "Passed" + sticker prompts (oil service / battery) | Advisor | "{advisor} sends the car to the wash" → **Send to wash** (asks "Is the car wash free?") | `qc_passed` to the advisor | *Ready for wash*; job summary written to the scoreboard | – |
| Sent to wash / Wash done | Advisor / washer | The wash card flips state | Advisor | "Wash done; the car is Ready" | `wash_done` | Status *Ready*; proforma prepares itself (`ensureProforma`) | – |

## H. Money and gate-out

| Event | Who | They see | Next | Their task | Bell | Boards | Clock |
|---|---|---|---|---|---|---|---|
| Proforma ready | – (automatic at Ready) | – | Advisor | "Send the proforma… bank details and Pay now are on the page" → **Send the proforma** (asks the expected payment method) | `proforma_ready` | Money page step 1 done; accounts dashboard row | Doc reminder: proforma not sent (cron 15) |
| Proforma sent | Advisor | The send window confirms; `/p/` page carries Pay now / bank transfer / pay at workshop | Accounts | "Awaiting payment of AED X" → **Record a payment** (only accounts and the owner can) | `proforma_sent` to accounts | *Awaiting payment*; money row on the accounts dashboard | `payment_waiting_long` (cron 17); accounts red; red >30 min rings once (cron 25) |
| Customer pays by link | Customer | The gateway's own page, then "Paid ✓" with the receipt | – (automatic) | – | `invoice_paid` "Paid: {plate}, AED x" to the advisor | Tax invoice generated at zero balance (`convertProformaIfPaid`); receipt on the same link | – |
| Payment recorded at the counter | Accounts/owner | The form confirms in place; card/transfer need the proof photo; over-balance waits for the owner | Advisor | "Tax invoice ready to send" → **Send the tax invoice** | `invoice_paid` to the advisor | Money steps 2–3 done; profit panels update | – |
| Gate-out (collect) | Advisor | The gate-out form: keys tick, collector, "Released" | – | – | `gated_out` to the managers | Job closed; owner report written | Comeback window tracked |
| Gate-out (delivery) | Advisor | DeliveryPanel: **Send to driver** → **Car loaded** → **Mark delivered** | Driver | Driver's one-button page `/drive/…` | `on the way` WhatsApp to the customer | Status *In delivery* | 3-hour "still on the way" reminder (cron 20) |

## I. After the car left

| Event | Who | They see | Next | Their task | Bell | Boards | Clock |
|---|---|---|---|---|---|---|---|
| Comeback opened | Advisor | The comeback form confirms; free jobs need approval on sending | Manager/owner | The comeback job runs the normal path marked *Comeback* | `comeback_*` | `/comebacks`; warranty credit lands on the invoice | – |
| Revision of an approved quotation | Advisor asks | "Ask owner to revise" with the reason | Owner | **Allow / Decline** the revision | `revision_requested` | Quote lock holds until allowed; proforma replaced after approval | – |
| Commission set on a quotation | Advisor/owner | The commission box saves | Owner | **Approve / Reject / Edit** on `/commissions` | `commission_set` to the owner | Pending → Approved to pay → Paid columns | Payable turns amber on accounts' Waiting when the invoice is settled |
| Commission paid | Accounts | "Paid" with method + note (only when approved AND settled) | – | – | – | Monthly export; credit note flags the owner | – |

## J. Bodyshop (differences only)

| Event | Who | They see | Next | Their task | Bell | Boards | Clock |
|---|---|---|---|---|---|---|---|
| Bodyshop quotation approved before arrival | Customer | The booked line on the quote page | Advisor | **Book the arrival** (writes the car-drop appointment) | `bodyshop_booked` | Job stays *booked* until the car arrives | – |
| Car arrives, checklist complete | Gate-in | The normal gate-in flow | Sections | Stages built from the approved lines, due dates spread to the promised day | Section leaders' heads-up | `/bodyshop` board; TV board | Late stage shifts the rest + tells the leaders (cron 16) |
| Stage done / handover sign-off / PPF handover | Leader / manager | One-tap stage buttons; sign-off locks gate-out | Next section | The next section's stage turns current | `bodyshop_*` | Progress page `/progress/…` for the customer | Aftercare check booked; day-8 reminder (cron 23) |

## K. Side flows

| Event | Who | They see | Next | Their task | Bell | Boards | Clock |
|---|---|---|---|---|---|---|---|
| Scan report lands in the mailbox | – (cron, 5 min) | – | Advisor/manager | The scan on `/scans`, matched by VIN to the open job | `scan_received` / `scan_unmatched` | Pre/post scan slots on the job | Mailbox problems tell the owner once |
| Stock below minimum | – (cron 18) | – | Parts | Reorder prefilled on `/parts/stock` | `stock_low` once per dip | Stock page figures | Monthly count ask on the 1st |
| Part with no home (returned/leftover) | Parts | The Returns and leftovers card | Owner | Decide: return / stock / scrap / fit | `no_home` after 3 working days | `/parts/no-home` | 3 working days |
| Upload fails on any screen | Anyone | The capture keeps the preview with **Retry** | Owner | `/settings/uploads` failure list | – | – | 90 s stall detector |

## Where the texts live

- Task lines and buttons: `src/lib/next-step.ts` (`nextStepOf`) — the one source every Waiting list reads.
- Urgency and escalation: `src/lib/waiting.ts` (`urgencyOf`), amber >24 h → red; reds ring once through cron 25/26.
- Money steps: `src/lib/money-steps.ts` (`moneyState`); parts steps: `src/lib/parts-steps.ts` + live `src/lib/parts-data.ts`.
- Stage colours: `src/lib/stage-style.ts` (`stageStates`) — done green, current amber, later grey, everywhere.
- Notifications: `src/lib/notifications.ts` (`NOTIFICATION_TYPES`); WhatsApp texts: Settings → Messages (`src/lib/messages.ts`).
- Supplier invoice rules: `src/lib/supplier-invoice.ts` — the one rulebook for every screen that takes an invoice.
