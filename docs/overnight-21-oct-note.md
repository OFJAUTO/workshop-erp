# Overnight batch, 20 to 21 October — delivery note

Everything from your two lists (PART 1 evening fixes, PART 2 "make the system make sense") is built, tested and live. Each section went live on its own push; this note is the summary in one place.

## PART 1 — the evening fixes

1. **1.1 Waiting-list buttons act in place.** Every "Waiting on you" line now carries its real button. The big one: **Record deposit** opens a panel right there on the dashboard — amount pre-filled, the five payment methods, card/transfer ask for the proof photo, over-payment is kept as an advance with a plain note, the receipt and **Send receipt** appear in the same spot. No page changes. (Buttons on the list now: Record deposit, Confirm bank, Record payment, Assign, Review the report, Price the parts, Order now, Open the LPO, Send the proforma, Approve, plus Open on every other line.)
2. **1.2 Urgency on the list.** Red / amber / grey bars and chips with plain words, no duplicate lines for one car, the age on every line ("waiting 2 h"), the list arrives open, "· N urgent" in the heading, and a red line older than 30 working minutes rings its person once (cron).
3. **1.3 The job money page rebuilt.** Step bar (Job done → Proforma → Payment → Tax invoice → Released), a money summary with **BALANCE DUE** large, "WHAT TO DO NOW" as one black button per role, payments with proof thumbnails, documents underneath. Only accounts and the owner record money.
4. **1.4 Our payment page.** Every pay message carries OUR short link only (no gateway address in the text). The link opens `/p/…`: the amount large, **Pay now** (the pasted gateway link), **Bank transfer** with copy buttons, **Pay at the workshop** with the address and hours. A pasted link is checked against the allowed pay-page addresses; replacing it keeps the same short link; once paid the page says Paid ✓ with the receipt.
5. **1.5 Part names.** The importer never glues the part number into the name again (a cleanup script fixed the two live rows and four LPO lines). Every part can carry two names: the supplier's and the customer's (pencil in the quotation editor; locked once approved).
6. **1.6 The discount says where it stands.** The banner bug is fixed and a live status line sits under the discount: green while inside your limit, amber with the owner wording when above it.
7. **1.7 The Commissions page.** Accounts and the owner only. Pending → Approved to pay → Paid. You approve, reject or edit; accounts can pay ONLY when you approved AND the tax invoice is settled, and must pick the method with a note; a payable commission sits amber on accounts' Waiting list; monthly Excel; a credit note flags you.
8. **1.8 Profit per invoice.** The owner-only page to the agreed design: period pills, four boxes, the where-the-money-went bar, the table with provisional dots, margin pills, sorting, filters, a per-row breakdown and the total row, Excel export.

## PART 2 — the system makes sense

- **2.1 + 2.2 The nine hand-off rules and the map.** `docs/workflow-map.md` holds R1–R9 (confirm · hand over the task · notify · live state · no dead ends · no duplicates · plain words · expanded · hide empty) and one table of EVERY hand-over: who presses it, what they see, who is next, the exact task and button that person finds, the bell, the board changes and the clock. The code was made to match.
- **2.3 The LPO flow (the reference).** The stale "PO waiting for approval" is gone — the desk reads the live LPO status. Approval is an amber task for you; your Approve answers in full ("LPO-00063 approved ✓ — Parts have been asked to order from …"); Peter gets a RED **ORDER NOW** task; Ordered moves the car to Deliveries expected and writes "Parts ordered from X – arriving {date}" on the job card; a refusal carries your reason back.
- **2.4 The Parts desk rebuilt.** ORDER NOW cards on top with their own clock (amber 30 working minutes, red 60, red rings you once), the sections in work order with empty ones hidden, deliveries grouped per supplier with overdue red, tooltips instead of grey paragraphs, All cars folded at the bottom, timestamps per step, and your **Parts speed** report (`/reports/parts-speed`).
- **2.5 ONE supplier-invoice box.** The receiving panel, the LPO's delivery form and the LPO's own invoice card all use the same box and the same rulebook: number + date compulsory unless **Invoice to follow**; "wdwdwdw" is refused as it is typed and again by the server; a future date is refused; an amount more than 5% off the LPO total (your AED 500,000 on a 14,782 order) stops and asks for one tick; photos/PDFs upload with an X and follow the LPO; "to follow" = amber *Invoice missing*, accounts' list, one Parts reminder a day.
- **2.6 The end-to-end simulation.** `npm run test:sim` walks EIGHT real paths through the screens as every role (technicians at 800 px), checking R1–R9 at every step, with a screenshot of the actor's confirmation and of the next person's screen at each hand-over (`tests/browser/shots/sim/`):
  - a) mechanical + supplier parts + deposit + pay-link — the full 22-step reference walk
  - b) stock parts + cash (incl. the double-tap test: one payment)
  - c) declined → diagnosis fee → gate-out
  - d) revision after approval (lock → ask owner → allow → v2 → v1 superseded)
  - e) bodyshop PPF (sign-off locks the gate, handover page, warranty PDF, final-check visit)
  - f) mixed quotation (mechanical + PPF lines on one work order)
  - g) recovery delivery (driver's one-button page closes the job)
  - h) commission set → owner approves → payable only when settled → paid with method
- **2.7 What the simulation caught and fixed.**
  - **The manager's "confirm the work" task never reached his Waiting list** (a finished job still read "In work, waiting on the technician" on the dashboard): the dashboard and Waiting-list loaders never read `work_done_at` / `wash_sent_at`. Both now pass them — before → the bell was the only signal; after → the task line "Job finished, waiting on {manager} to confirm" with the button.
  - The completion dialogs, declined flow, revision flow, driver page and gate-out delivery all proved out through the walk; the editor-side quirks the walk hit were test-side and the real screens behaved (each step's screenshot is in the folder).

## For the record

- New tests: `test:supinv` (23 checks), `test:sim` (the eight paths). All previous suites re-run where touched: `test:invoice2`, `test:p`, `test:partsdesk`, `test-z` S3.
- No new environment variables.
- No migrations in part 2 sections 2.2–2.6 (2.5 works on existing columns).
