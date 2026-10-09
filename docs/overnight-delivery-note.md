# Overnight delivery note (9 to 10 October 2026)

Everything from "Overnight build: fixes and redesigns from tonight's test" (A to K) and the later "L. Comeback jobs" is built, except the items under "Not done". The database was backed up before each of the two migrations (`backups/2026-10-09T19-14-45` and `backups/2026-10-09T20-29-09`). Migrations `20261017090000_overnight_round3.sql` and `20261017120000_overnight_round3b.sql` are applied. The whole path was run by a script against the local server (a test car from approval to gate-out, then a free comeback): 50 checks, 50 passed; the test rows were removed afterwards.

## What the round before (A to H of the daytime list) still needed

Checked each item. Two were not actually finished and are now: the QC save that "never went through" (the round was never opened after a hand move; see A1 below), and the work order's "every part confirmed" gate, which now reads the handover instead of the retired confirm step. The rest worked.

## A. Fixed

- **A1 Owner moves open the step properly.** Moving to QC opens the QC round; moving to Work builds the work order; "Start QC" always works, and a car in Pending QC with no round shows an "Open the QC round" button. The QC save opens the round itself if it is missing.
- **A2 No dead ends.** The work order in planning says what to do and links to the Planning card; the QC page with nothing to check links to the work order or the job card.
- **A3 Plain wording.** "Moved to Pending QC by Omar, 22:48. Reason: …". The owner's move now asks for a reason. Gate-out before its time is written the same way.
- **A4 Payment recorded twice.** RCT-00003 was voided as a duplicate (kept, struck through). One tap now makes one receipt (see K).
- **A5 Money boxes take numbers only.** Letters disappear as you type in any numeric or decimal box.
- **A6 Invoice options change the invoice at once.** A tap on Labour itemised, One Labour charges line or Add Consumables rebuilds the lines; the agreed total and discount boxes apply when you leave them.
- **A7, A8, A9, A10, A11** are covered by G, F, C and E below.

## B. Notification sound

Four soft tones (soft marimba, low two-note bell, gentle pop, short warm chord) in Settings with a Play button each; one for ordinary notifications, one for the owner's approvals and a technician's "additional work found". Plays once, then a gentle single note every two minutes (the minutes are a setting) while something is unread. Each person can pick their own tone from the bell.

## C. Quotation screen

Three blocks (Labour and services, Parts, Other charges) and one summary. Labour grouped by inspection finding, descriptions start empty, thin rows, finished rows collapse, findings not quoted block sending unless "Not quoting this" with a reason, hours estimate against the quoted hours. Parts link to a labour line ("For: …", amber when not linked), removing a job removes its parts. "Recommended" is gone; parts carry no urgency; labour has an Urgent switch; dangerous lines warn and only the owner switches them off. Ready-made jobs list by category (two letters find them), editable in Settings; a job built twice is offered under "Used before" and joins the list when the owner ticks it. Markup: floor 5, no upper limit, amber from 50, spelled-out confirmation from 100 ("Markup 5255%. This part will sell for AED 267,750. Correct?"), both figures owner-only settings; "Set markup for all parts" at the top; "Ask Parts for a part" one tap. Other charges: one thin recovery row (trip type, trips, cost and price per trip, provider Our/External/Customer arranged, Show/Hide), bank charge greyed "Internal, not shown to customer", inspection fee when it applies, free Other lines. Rounding on Send (nearest 10 down by default, or up; whole dirhams; the pre-VAT amount adjusts; the invoice inherits). The quotation date is "Estimated: about N working days after approval"; the firm date is set in planning.

## D. Customer links

Every customer page (job card approval, inspection report, quotation and estimate, invoice) is the same document as the PDF: header with the logo, legal name and TRN, title and number, customer and car boxes, sections, totals, Download PDF. The quotation has a sticky bottom bar with Approved and Declined only; approve asks once with the total then thanks; decline asks once with an optional "Tell us why", the advisor is told, the fee reminder shows, nothing moves. After a decline the advisor makes a revised quotation (v2, "Keep urgent lines only" shortcut, the customer sees "Revised quotation", v1 stays Declined, a real discount shows in bold). The invoice page shows Pay now when a payment link is pasted on the invoice, "Paid, thank you" once settled, the receipts and the bank details.

## E. Part type

Shows on the Parts pricing row, the quotation, the customer page, the invoice, the purchase order page and PDF, and the labels.

## F. Planning inside the Parts step

A Planning card on the job card with three circles and faces: 1 Parts, 2 Workshop, 3 Advisor (grey not their turn, amber with the waiting time, green done). Parts: In stock or To order with the days per part on the Parts job page, "All in stock", then "Parts planned" ("All parts here by <date>"). A job with no parts skips the Parts circle. The manager sees the parts date and the hours estimate, picks the start day, ticks the technicians and presses "Release to workshop" (or "Start with available parts" after a warning). The advisor gets a suggested finish date from the start day and the hours (8 to 17, Sundays off), confirms it, tells the customer on WhatsApp; that is the promised date, and it never holds the work. Notifications at each hand-over, a Remind button, the owner can fill any circle, a daily reminder when a circle waits more than a day. A part arriving later than planned turns the Parts circle amber and tells the manager and the advisor.

## G. Work on the technician's tablet

One big countdown ("Time left 31 h 20 min of 40 h", green, amber under a fifth left, red once over; several technicians share it and it shows who is working), Working and Pause (Stop is gone), the road test remarks, the customer's requests, the read-only job list with the parts (✓ handed over, "Coming Monday"), "Additional work found", "Job finished". The inspection checklist, work photos and per-line clocks are gone; the inspection is one line. Pause reasons one tap (Waiting for parts, Waiting for the manager, Another job, Break, Tools or lift busy), logged; waiting for parts tells Parts, waiting for the manager tells the manager; the clock pauses itself at the end of the shift and at clock-out. The manager has the pause log per car on the work order and per technician per day on the Pause log page, with totals and "Not accepted". "Leave this job" with a reason. "Job finished" asks "All work on this car is done?"; the clock stops and locks; with several technicians each presses "My part is done"; the manager presses "Confirmed, send to QC" or "Not done, send back" with a note the technician sees on top; the job card says "Job finished, waiting on <manager> to confirm" with a Remind button; send-backs are counted per technician, manager and QC apart.

## H. Parts handover

"Hand over" per car: every part that is here is ticked, untick what stays, "I confirm I received these 9 parts for Dubai E 20260" above one PIN box; later arrivals are another handover; returns go the other way with the Parts person's PIN; a manager or the owner can sign for a technician (logged). Consumables below the threshold in Settings need no PIN. The technician's job list shows the ticks and "coming <day>". PINs are personal: a temporary PIN from the owner must be changed on first use (typed twice on the tablet); nobody can read a PIN. "Parts trail" per job lists every handover and return. The old "Issue parts" screen redirects to the handover.

## I. Job summary and scoreboard

At QC pass the owner and the manager get a Job summary card (verdict Good, Acceptable or Needs a talk; hours charged, used, the difference, per technician; on time; QC rounds and send-backs; pauses; parts; profit against the quotation for the owner only; a one-line manager comment). It stays on the job card. The Scoreboard page shows each technician per month: cars, hours charged against used, QC and manager send-backs, pauses, workmanship comebacks and verdicts.

## J. Wash

QC pass tells the advisor; the car waits as "Ready for wash" until the advisor presses "Send to wash" (job card or Car wash page); "Wash done" by the advisor or the owner makes it Ready. No photo. A display-only Wash board at `/board/wash` (tiles with the car picture, plate, make and colour; refreshes itself; "No cars waiting for wash") on a device the owner registered. Settings keep "show the needed-by date" and "Done button" switches.

## K. Invoice and payment

Three taps: the method; "Full amount · AED X" or Partial; Record. A cheque asks for its number and date; the bank charge note shows for card and link only. The invoice page says "Invoice AED X · Paid AED Y · Balance AED Z"; "Paid in full" replaces the box. One tap, one receipt: the button locks and the same tap twice makes one receipt; an identical payment within a minute is refused. More than the balance waits for the owner ("Request owner approval"); the owner approves or refuses. Receipts are never deleted: the owner or the head accountant voids with a reason, struck through, the owner is told. The advisor is told when the invoice is issued and the next step reads "Send the tax invoice to the customer"; the dashboard has "Invoices to send" and "Awaiting payment" for advisors. Advisors can record payments; accounts tick them as verified; unverified ones older than three days show in red on the Invoices page. Paid in full releases the car.

## L. Comebacks

At gate-in a car back within the window (90 days, a setting) asks "Is this a comeback for a previous job?" with the recent jobs; the job gets a Comeback badge, high priority, and is linked both ways. After the inspection the manager picks the cause (Our workmanship, Faulty part, New unrelated problem, Caused by the customer or another workshop); only the owner confirms and makes it free. A free job needs no customer approval: the quotation is approved on sending; the invoice shows the work and parts at their value then "Warranty repair, no charge" to zero. The loss is on the comeback job, the original shows "Profit after comeback", the daily panel has a red "Comebacks" line. A faulty part gets a "Claim from supplier" flag (supplier, purchase order, amount, paid), which reduces the loss. Unrelated or customer-caused is a normal paid job with a "Return visit" badge. Workmanship comebacks count against the original job's technicians on the scoreboard. The Comebacks page lists them by month with cause, cost and claim.

## Improved on my own

- The owner's move asks for a reason (so A3 always has one).
- A job with no parts skips the Parts circle of planning.
- The technicians' database rules now follow "on the car" (the manager can put several technicians on one car and each sees it on the tablet).
- A technician's "additional work found" plays the louder tone for the manager.
- The customer's invoice page links each receipt.
- A daily reminder when planning waits on one person for more than a working day.
- An end-to-end test route (`/api/e2e/run`, local only, refused in production) that runs a car through the whole path; the clean-up SQL sits beside it in the scratchpad.

## Assumptions

- The file `docs/ofj-invoice-design.html` named in the list does not exist in the project; the customer pages use the PDF document look already in use (`src/lib/pdf/template.tsx`).
- The wash board accepts any device the owner registered at `/tablet/register`; a separate "board" kind exists in the database but the registration form offers Shared or Personal.
- Returns to Parts need the Parts person's PIN only when they have one (office staff with a password login record the return from their login).
- "Hours charged" on the scoreboard is shared between the technicians on a car by their clocked time.
- The verdict rule: Good when the time used is within 10% of the hours charged, QC passed first time, on time and no send-backs; Needs a talk when the time is 30% over, QC failed twice, two manager send-backs, more than a day late, or a pause was not accepted; Acceptable otherwise.
- The comeback "cost" is the loss on its invoice (real parts and clocked labour, nothing charged), reduced by a paid supplier claim.

## Not done

- The Wash board "Done" button (the switch is in Settings; the advisor marks the wash done for now).
- Notifications are not played through a phone app; the bell and the tab count are the alert.
- The bodyshop path and Zoho Books, as before.

## Waiting for you

- Nothing is blocked. The push to `main` deploys on its own; check the live site in the morning.
- Open Settings once and press Save, so the new sounds and figures are confirmed (they already have sensible defaults).
- For the wash board: on the wash-bay screen, sign in, open `/tablet/register`, register it, then open `/board/wash` and leave it.
- Give each technician a temporary PIN from the Team page; they choose their own on first use.
