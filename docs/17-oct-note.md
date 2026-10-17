# 17 October 2026: quote lock check, commission, delivery and recovery, gate-out, target and labour rate, parts role

Delivery note for the owner. Migrations `20261104090000` to `20261104120000`; proof test `npm run test:y` (71 checks, run section by section with `ONLY=B|C|D|E|F|G|Z`).

## A. What was interrupted: both finished and live

**A1. Approved-quote lock.** It was committed and pushed before the usage limit (commits 09a0c69 and 8f6b0de), the database triggers are live, and the 27-check proof passes. An advisor cannot delete or change anything on a customer-approved quote from any screen or request; the server and the database both refuse and write the attempt in the quote's history. The list of approved quotes checked for changes after approval is in `docs/approved-quote-lock-note.md`: none was ever changed after approval; the one thing to decide is the Q-00012 version 2 draft (started 39 seconds after the approval, two lines removed on it) — say "cancel Q-00012 v2" or "keep it".

**A2. Scan mailbox one-time sign-in.** Done and live (commit 56ed442): the mailbox is read through a one-time Google sign-in as scans@ofjauto.com with gmail.readonly only, so the stored token can only ever read that one mailbox; the domain-wide delegation path for reading is gone (the service account remains only for sending the supplier LPO email, which uses gmail.send). The Scan reports page shows "Mailbox not connected yet" / "Mailbox problem: … Connect the mailbox again" and the owner is notified once if it ever stops. You press **Connect scans@ofjauto.com** on erp.ofjauto.com/scans; the exact Google Cloud and Vercel clicks (OAuth consent screen Internal, the OAuth client, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `SCANS_MAILBOX`) are in `docs/16-oct-note.md`, section I.

## B. Small fixes

**B1. Break times per weekday (migration 20261104090000).** Settings > "Breaks (per day, per department)": a grid of seven days by two sides, written as 12:30-13:30, empty = no break that day. Saturday to Thursday: mechanical 12:30-13:30, bodyshop 13:30-14:30; Friday: both 12:30-14:00 (already filled in). Every clock pauses in the right break for its day, and labour cost, the times on screen, planning and due dates all use the same per-day hours. A box missing from a save keeps its stored value, so the grid can never be wiped by accident. Fixed on the way: the main Settings form could not be saved at all since 14 October (the bodyshop final-check message has no customer link and the save insisted on one).

**B2. Layout at any zoom.** The quotation, parts, job card and gate-in pages were checked at 80, 90, 110 and 125 per cent browser zoom at PC and tablet widths: nothing overlaps, is cut off or pushes the page sideways (wide tables scroll inside their own box, which is the design). The check now lives in the test suite so it runs on every change.

**B3. No staff names on customer pages.** The customer's invoice page shows only the invoice details, "Paid, thank you", the amount, View tax invoice (PDF) and the receipts — no Call button, no WhatsApp. Every other customer link (quotation, proforma, inspection report, handover, receipts) keeps at most one contact: **Call OFJ · +971 4 330 3113** (the company phone from Settings). No staff name appears anywhere a customer looks; the one allowed exception is the driver's name and mobile inside the "on its way" message (D3), which you asked for.

## C. Commission (migration 20261104093000)

One Commission line in the grey internal box, directly under Recovery cost, with **+ Add** opening the fields right there: who (one tap from the list or typed) and AED or % of the total before VAT. Once added it reads "Commission · Ahmed (5%): AED 2,833" with Edit and Remove; the old separate section at the bottom of the box is gone. A commission added or changed by anyone but you shows amber **"Waiting for owner approval"** and counts for nothing while it waits; you are told "Commission for Ahmed, AED 2,833 on [car] ([job])" and answer on the quotation with **Approve**, **Decline** (removed, with your note; the asker is told) or **Change amount**. Your own commissions are approved at once; an edit after approval waits again. It never holds up the customer flow; profit reads "(commission pending)" until decided; approved commissions count in cost, profit and the monthly commissions list; nothing of it is ever shown to a customer. A commission can be added even on a sent or customer-approved quotation, since it never touches the customer's figures. Commissions set before this rule stand as approved.

## D. Delivery by recovery (migration 20261104110000)

**D1. The set-up at gate-out.** For "Our truck" the regular driver is prefilled with his mobile and truck plate; the other saved drivers are one tap; for a company, its drivers. Drivers live in Settings > "Recovery drivers" (name, mobile, truck plate, company, "Regular" tick), and a driver typed at gate-out joins the list by himself. The advisor pastes the pin the customer sent (checked to be a real map link, with "Open map" and a red "Not a map link" otherwise), adds a short "Location details" line, and for a returning customer the last pin and details fill in by themselves. Day: Today · Tomorrow · Day after · Pick date. Time: Morning · Afternoon · Evening, or an exact time. The Fee box is gone: the driver enters his own price when he delivers.

**D2. The driver's message and his one-button page.** "Send to driver" opens WhatsApp to the driver with the plain message (plate · car · day and time, the customer's name and mobile, the pin forwarded exactly as it is, the location details) ending in "When delivered, press here: [link]". His page needs no login and shows nothing about prices or invoices: one big **DELIVERED: TAKE PHOTO** button, the camera, one **PRICE (AED)** box, **SEND** — and the link is dead after it is used. The same kind of link serves pick-ups (photo on loading), started from the Recovery page. The car still cannot be released for delivery until the balance is zero (or your or accounts' logged reason, or credit terms).

**D3. "Car loaded: send 'on its way'".** One button on the delivery panel: it opens WhatsApp to the customer with your template filled in — editable for that one customer before sending — and marks the car "On the way" with the time. The template lives in Settings ("WhatsApp: car on its way") with the blanks [name], [car], [truck plate], [driver name], [driver mobile]; the default is exactly your wording with +971 4 330 3113. No time estimate; the driver's name and mobile are allowed in this message only.

**D4. Out for delivery closes itself.** The panel shows status only: "On the way: left 21:44 · Driver: [name] · Truck [plate]". When the driver presses Delivered, takes the photo and enters his price, the job closes by itself ("Delivered hh:mm"), his photo is kept on the job's files and his price lands on the Recovery page and in the job's recovery cost. "Received by", the advisor's photo buttons and "Handover confirmed with the customer" are gone. If the car is still "On the way" after 3 hours the advisor is reminded once and can press **"Mark delivered"** (logged as marked by the advisor); accounts add the price later on the Recovery page.

**D5. The Recovery page** (owner, advisors, accounts): one row per trip — date, plate and car, job, pick-up or delivery, driver or company, "Open the pin", the photo, the price claimed and the status. **Claimed → Approved / Queried → Paid**, one tap each (Queried carries a note). The rough straight-line distance from the workshop shows with the price per km once you paste the workshop's own pin in Settings ("Workshop location pin"), so unusual prices stand out; "Usual for this distance: AED X–Y" appears once at least three similar trips are on record. A monthly view totals trips and averages per driver or company, with "Export for accounts (CSV)". This page replaces the WhatsApp group.

## E. Gate-out mirrors gate-in

Keys are one tick: "1 key handed back ✓" with the gate-in's own count; the keychain tick shows only when the gate-in recorded one; the dash cam tick only when one was recorded. A small "Different number of keys?" link opens the choice with a one-tap reason, which is written on the job and **told to you at once**. Photos at loading stay (optional); the notes box is gone.

## F. Target box and labour cost rate (migration 20261104120000)

**F1.** Your dashboard panel now leads with **"Month to date: AED X of AED Y target (Z%)"** — the target is AED 20,000 (Settings) × working days passed, Sunday never counted; green on pace, amber behind. Under it: **"Break-even so far: AED X"** from Settings > "Monthly fixed costs" (AED 380,000 placeholder — change it; the note reminds you not to put technicians' pay there if it's already charged as labour cost on jobs) with the month's profit above or below it in green or red; **"In progress (approved, not invoiced): AED X profit"** from approved quotes on open jobs; **"At this pace: AED X by month end"**; and a smaller line with today's invoiced profit and collections. Profit per job = the invoice before VAT (after discounts and round-off) minus parts cost (with supplier invoice corrections), labour (clocked hours — bodyshop tablets included — × the department's cost rate), outside work, the real recovery cost (the driver's price once there is one), approved commissions, the actual bank charge, and materials and consumables used. VAT is never profit; the figure updates as late costs arrive and reads "(includes N provisional)" meanwhile.

**F2.** Separate hourly cost rates per department already live in Settings (the per-department boxes under the cost rate; AED 90 until you set them). New: **Labour rate check** (/reports/labour-rate; accounts see it in their menu, you reach it from Reports). Per side it shows the hours actually clocked on cars that month, the box where accounts type the technicians' all-in cost (salaries, allowances, accommodation, transport, visas and insurance, leave and tickets, gratuity — nothing else), the real rate (cost ÷ hours) next to the rate in Settings, and your one-tap **"Use this rate"**, after which every job profit and the target box recalculate.

## G. Parts role

**G1. Parts arrivals** replaces Calendar in the Parts menu (you keep both): a week view with, per day, the parts expected — supplier, car (plate and job number), LPO number. Overdue parts sit on top in red with **"Chase supplier"**, which opens WhatsApp to the supplier with the order, part and expected date already written (it asks you to add the supplier's phone under Suppliers when there is none). Special orders (15 days' lead or more) are marked, and "Special orders only" lists them whenever they land, past the week. Tap a part → new date + a one-tap reason: "All parts here by" follows, the car's promised date moves later when the part lands after it, and the advisor is told. Workshop stock orders show too, marked Stock. Filters: supplier, special only, this week / next week.

**G2. Parts-only dashboard.** The Parts role's dashboard drops every workshop chip for seven parts tiles with counts — To price · LPOs waiting for approval · To order (send to supplier) · Arriving today · Overdue deliveries · Received, not handed over · Supplier invoices missing — each one a link. Below, only the cars with parts activity, each with the five parts-step dots and one button for that car's current step. "Waiting on you" stays at the top.

## Section by section

| Section | State |
|---|---|
| A1 quote lock | Already done before this batch (committed, pushed, live); confirmed, list in the lock note. |
| A2 mailbox sign-in | Already done before this batch (committed, pushed, live); confirmed; "Mailbox problem: connect again" plus the one-time owner notice were already in. |
| B1 breaks per weekday | Done (migration 20261104090000, test-y B). |
| B2 zoom | Done (the checker is in test-y Z, 4 pages × 8 widths, all clean). |
| B3 customer pages | Done (test-y B). |
| C1 commission | Done (migration 20261104093000, test-y C, 13 checks). |
| D1–D5 delivery and recovery | Done (migration 20261104110000, test-y D, 24 checks). |
| E1 gate-out mirrors gate-in | Done (test-y E; the 16 October gate-out suite reworked, 46 checks). |
| F1 target box | Done (migration 20261104120000, test-y F). |
| F2 labour rate | Done (test-y F; the per-department rates already existed in Settings, the check report and "Use this rate" are new). |
| G1 parts arrivals | Done (test-y G). |
| G2 parts dashboard | Done (test-y G). |

## Assumptions

- A1: the approved version itself never changes, you included; your way to change it is Revise (a new version to the customer). Q-00012 v2 awaits your word.
- B1: "Saturday to Thursday" includes Sunday in the grid defaults; Sunday still never counts for targets. A person's own break from Team still beats the department's, on every day.
- B3: the driver's name and mobile in the "on its way" message is the one allowed exception to "no staff names", as D3 asks.
- C1: a removed approved commission tells you; declined means removed with your note; "Change amount" is Edit-then-approve in one step; a commission on a superseded version counts for nothing (only approved-status quotations count).
- D1: the pin must be a Google (or Apple) Maps / WhatsApp location link; short links (maps.app.goo.gl) are accepted but carry no coordinates, so those trips show no distance. The delivery address column stores the details line.
- D2: pick-up links are started from the Recovery page ("New pick-up"); the driver's page closes the job only for deliveries.
- D4: the 3-hour reminder runs in the hourly housekeeping, so it can arrive up to an hour late.
- D5: distance is straight-line (no paid map service), so real drives are longer; "Usual for this distance" needs 3 similar trips (±25% of the distance) and uses the middle half of their prices.
- F1: "on pace" is green at 100% of the target so far, amber below; break-even is the fixed costs spread over the month's working days; "In progress" is the quote-side expected profit of approved, open, not-yet-invoiced jobs.
- F2: "Use this rate" writes the side's rate to its departments (mechanical; bodyshop, paint, PPF and tint, detailing). Hours = work-session minutes plus bodyshop tablet clockings in the month.
- G1: "special order" = 15 days or more between pricing and the expected date; "Chase supplier" opens WhatsApp (nothing is logged for it); stock-order dates are moved on the LPO page as before.
- Live data was left untouched: the test figures (labour cost actuals, drivers, trips) were put back or removed after each run.
