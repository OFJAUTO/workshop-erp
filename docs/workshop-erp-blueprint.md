# Workshop ERP Blueprint

As of 6 October 2026. Luxury car workshop in Dubai (Porsche, Bentley and similar; mechanical, bodyshop, paint, PPF, tinting). Roughly 45 users.

## What we are building

One system that runs the whole workshop, from booking to gate-out, that a new employee can use on day one without training. It replaces the current software (Gateway ERP) and builds on the intake, work-logging and QC app already made.

Every screen follows these rules:

- **One home screen per role.** A technician sees his jobs, a parts man sees his orders. Nobody sees menus they cannot use.
- **Three taps for anything common.** Gate-in a car, clock on to a job, request a part.
- **Colour shows status.** Green is on time, amber is due today, red is overdue or blocked.
- **Scan and photograph instead of typing.** Plate, VIN, damage photos, part labels.
- **Shared tablets on the floor, PCs in the office.** Same system, laid out for each.
- **Plain words, no codes.** If a button needs explaining, it gets redesigned.

## The journey of a car

Every car follows the same twelve stages, the standard dealer-workshop sequence, and the system always shows which stage it is in and who holds it.

1. **Booking.** Appointment on the calendar with customer, car and reason for visit. Walk-ins skip this.
2. **Gate-in.** Plate or VIN scan, walk-around photos, mileage, fuel, and the customer's requests and complaints in their own words. A job card opens.
3. **First approval: job card and terms.** The customer approves the job card and the terms and conditions by WhatsApp link or on the tablet. This authorises inspection only.
4. **Assignment.** The workshop manager assigns the car to a technician or team.
5. **Inspection and diagnosis.** The technician answers each complaint and does a full health check with photos, then lists the labour and parts needed.
6. **Parts pricing.** Parts check stock and get price and delivery time from suppliers. Nothing is ordered yet.
7. **Quotation.** The advisor builds the quote: labour, parts, VAT and expected completion date.
8. **Second approval: the quote.** The customer approves by WhatsApp link. Declined work is recorded against the car.
9. **Parts ordering and issue.** Parts raise a purchase order for approved work, the owner or head accountant approves it, goods are received and issued to the job. The car shows as waiting for parts until then.
10. **Work.** Technicians clock on and off the job. Anything extra found goes back to step 6 as an additional quote; no extra work without approval.
11. **QC.** Independent checklist and road test. A fail sends the car back to work.
12. **Invoice and gate-out.** The advisor marks the job ready, accounts issue the invoice and take payment, handover photos are taken and the car is released. A follow-up message goes out a few days later.

On the dashboard this is shown as a nine-step track per car: Gate-in, Inspection, Quote, Approval, Parts, Work, QC, Wash, Ready. Car wash is its own step between QC and Ready.

## Main screens

**Manager dashboard.** One page that answers "how is my workshop right now":

- Cars in the workshop, due today, overdue, ready to collect
- A Pending row counting cars waiting on inspection, quote, customer approval, parts, QC, car wash and payment. Tapping one filters the list.
- Every car as a row with plate, model, technician or advisor, promised date, its nine-step track, and its status in plain words (for example "Waiting for parts, expected Wed 7 Oct")
- Most urgent cars first; High priority and VIP badges
- Who is clocked in and what each technician is working on; idle technicians flagged
- Money summary for the owner: today's revenue, month to date, unpaid invoices
- See the HTML design file in this folder for the exact look

**Advisor dashboard.** The same board without cost or profit figures: cars waiting for inspection, waiting for customer approval, approved, waiting for parts, in work, in QC and ready.

**Calendar.** Appointments and promised delivery dates in day, week and month views. It shows how full each day is, so advisors stop overbooking.

**Gate-in.** A guided flow on a tablet, one step per page:

1. Scan plate or VIN. A returning customer's details fill in automatically.
2. Walk-around photos, with existing damage marked on a car outline.
3. Mileage, fuel level, valuables, warning lights.
4. Customer's requests and complaints in their own words.
5. Priority, promised date and customer signature.

**Technician screen (shared tablet).** The simplest screen in the system: my jobs, a clock button, the inspection form, parts request. Big buttons, short words, icons.

## Modules

All modules read from one shared record of customers, cars and jobs.

| Module | What it does |
| --- | --- |
| Appointments | Bookings, calendar, daily capacity, reminders to customers |
| Gate-in and gate-out | Intake flow, photos, signatures, handover record, release control |
| Job cards | Complaint, findings, job lines, labour, parts, status, full history per car |
| Estimates and approvals | Estimate, customer approval by link, terms and conditions, revisions logged |
| Parts and purchasing | Genuine part numbers, parts ordered per job, purchase orders, goods received, issue to job |
| Materials stock | Consumables, PPF and tint film, paint: bought on purchase orders, held as stock, usage booked to jobs |
| Time clock | Shift clock in and out, plus clock on and off each job; attendance and clocked versus billed hours |
| QC | Checklists per job type, independent sign-off, fail and rework loop, photos |
| Bodyshop, paint, PPF, tint | Sub-steps inside the Work stage per job type; fixed-price packages |
| Invoicing | Estimate, proforma invoice, tax invoice, receipt; deposits and partial payments; 5% UAE VAT |
| Users and settings | Users, roles, PINs, discount limits, labour rates, checklists, terms text, shift times |

## Logins and access rights

Every person has their own login, and their role decides what they see and what they can change.

Roughly 45 people log in: 4 to 5 service advisors, about 30 technicians across mechanical and bodyshop, 1 QC, 1 to 2 workshop managers, 3 parts, 2 to 3 accounts, and the owner on the master account.

Office staff log in on their PCs. Technicians use the shared workshop tablets (6 to 7 in the workshop, the same in the bodyshop): tap your name, enter a 4-digit PIN, and the tablet locks again when idle. No personal phones.

| Role | Home screen | Can change | Cannot |
| --- | --- | --- | --- |
| Owner (master account) | Manager dashboard | Everything, including prices, users, roles, discount limits and purchase order approval | Nothing blocked |
| Workshop manager | Floor board | Gate-in, assign cars and technicians, move cars between stages, set priority, see all jobs and hours | Change prices, approve purchase orders, see accounts |
| Service advisor | Advisor dashboard and calendar | Bookings, gate-in, quotations, job status, priority, mark ready to invoice, discounts up to the set limit | Change labour rates, delete jobs, approve purchase orders, see cost or profit |
| Technician | My jobs | Clock in and out, inspection reports with photos, parts requests | Gate-in, see prices, margins or other technicians' hours |
| Parts | Parts requests and orders | Price parts, raise purchase orders, receive goods against an approved order, issue to jobs | Approve purchase orders, edit job lines or invoices |
| QC inspector | Cars waiting for QC | Pass or fail checklists, send back to work | Gate-in, sign off his own work |
| Accounts | Invoices and payments | Issue invoices, payments, credit notes, supplier bills; the head accountant also approves purchase orders | Edit job cards or stock counts |

Rules that apply to everyone:

- **Every change is logged** with who, what and when. Nothing is silently overwritten.
- **Sensitive actions need approval.** Discounts above the limit, purchase orders, releasing an unpaid car, and deleting anything.
- **Closed means closed.** Once a job is invoiced, only the owner can reopen it.
- **Accounts are closed off.** Payments, supplier bills, cost prices and profit are visible only to accounts and the owner.
- **Access is enforced at the database level**, not just by hiding buttons.

## Zoho Books integration

The ERP runs the workshop and Zoho Books keeps the accounts, with data flowing one way so nothing is typed twice. Workshop staff never open Zoho. The accounts team works mainly in Zoho. The accounts move from the accounting built into Gateway ERP to Zoho Books, ideally at a month end.

| Event in the ERP | What appears in Zoho Books |
| --- | --- |
| New customer at gate-in | Customer contact |
| New supplier | Vendor contact |
| Deposit received | Advance payment from the customer |
| Job invoiced | Sales invoice with labour and parts lines and VAT |
| Payment recorded | Payment against that invoice |
| Purchase order approved | Purchase order |
| Goods received with supplier invoice | Bill against the vendor |
| Credit note or refund | Credit note |

- **Invoice numbers come from one side only**, so the two systems never disagree. Recommended: the ERP issues them at handover.
- **Failed syncs are visible.** A sync page lists anything that did not go through, with a retry button.
- **VAT returns and the ledger stay in Zoho.** The ERP does not do accounting or payroll.
- This design is from general knowledge of Zoho's API. Check it against the current Zoho Books API documentation and the plan's limits as the first task of the integration phase. Confirm how VAT on deposits should be recorded with the accountants.

## Technical foundation and hosting

A web app in the cloud, opened in any browser on tablet or computer, with nothing to install.

- **Database:** a hosted Postgres database such as Supabase. It handles logins and enforces each role's access at the data level.
- **Photos and documents:** cloud file storage linked to each job, with gate-in photos kept as evidence.
- **Hosting:** a managed web host in a region close to Dubai for speed. No servers to look after.
- **Backups:** automatic daily database backups, plus a monthly test that a backup actually restores.
- **Test copy:** a separate copy of the system where changes are tried before staff see them.
- **Code:** kept in a repository the owner owns.
- **Setup:** the owner deploys it to the cloud himself, guided step by step. He is not a developer. A backup person for emergencies is still to be named.

## Build order

Six phases, each one usable on the floor before the next starts. The old software keeps running until phase 4 is proven.

1. **Foundation.** Database, logins, roles, PINs, customers and cars. Done when every staff member can log in and sees only their own screen.
2. **Gate-in, job cards and floor board.** Done when every car in the workshop is on the board.
3. **Calendar, QC and manager dashboard.** Done when the owner can run the morning meeting from the dashboard alone.
4. **Quotations, approvals, invoices, payments and Zoho Books sync.** Done when a full week of invoices matches Zoho to the dirham.
5. **Parts, purchase orders and materials stock.** Done when every part on a job traces back to an approved purchase order.
6. **Time clock, bodyshop and PPF sub-steps, customer messages.** Done when clocked versus billed hours shows per technician.

Reports on margin per job, technician efficiency and parts ageing come last, because they need a few months of clean data to mean anything.

## Decisions

Agreed with the owner on 6 October 2026.

- **Look:** light theme in white, black and grey, with colour used only for timing. Clean and simple. Company logo top left. Technician photos on their profiles.
- **Language:** English only.
- **Old data:** start fresh, nothing imported. Gateway stays switched on as a read-only archive. Cars on site are gated in by hand on switch-over day.
- **Who can gate in a car:** service advisors, the workshop manager and the owner. Technicians and QC cannot.
- **Users:** the owner adds, removes and disables users and resets PINs from the master account. A removed user's history stays on record.
- **Who does what on billing:** the advisor builds the quotation, runs the job and marks it ready to invoice. Accounts only issue the invoice and take payment.
- **Customer approval:** the advisor sends a link by WhatsApp. The customer sees the job card and price, ticks the terms and conditions, and approves. The system stores who approved, when, and the exact terms shown. Work cannot start without it. Approval is for the whole job to begin with; line-by-line can be switched on later.
- **WhatsApp:** simple version only. The advisor copies or taps to send the link from the workshop number. No WhatsApp API.
- **Parts are ordered per job:** almost no stock is held. Every part is ordered from the main dealers against a specific job and tracked as priced, ordered, expected date, received, issued.
- **Parts discipline:** no part is issued to a job unless it came in on an approved purchase order. Every part request, order and receipt carries a name and a time.
- **Purchase orders:** approved only by the owner or the head accountant. No goods received and no supplier bill without an approved order behind it.
- **Deposits:** parts above a value set by the owner need a customer deposit before the purchase order can be raised.
- **Partial payments:** an invoice can take several payments. Deposits come off the final invoice, and the balance due always shows.
- **Documents:** estimate, proforma invoice, tax invoice and payment receipt, each made from the one before in one tap.
- **VAT:** 5% UAE VAT on every invoice, tax invoices with TRN, VAT returns filed from Zoho Books.
- **Release control:** a car with a balance due cannot be gated out unless the owner or accounts approve. Every such release is logged.
- **Discounts:** the advisor limit is a setting on the master account, starting at 25%. Anything above goes to the owner, and every discount is logged.
- **Profit per job:** selling price minus parts cost, technician time at cost, paint and film materials and sublet work. Shown to the owner and accounts only.
- **Attendance:** shift clock in and out with an on-time and late report per employee.
- **Photos:** a profile photo on every employee, and unlimited photos on every car and job.
- **Inspection reports:** a fixed checklist per job type with photos and a green, amber or red mark per item, sent to the customer as a branded report.
- **One sequence for every job type:** mechanical, body and paint, PPF and tinting all follow the same steps. Only the Work step differs: each job type has its own sub-steps, set by the owner (for example body and paint: strip, repair, prep, paint, polish, refit; PPF: wash, paint correction, install, cure, final check). A car with several job types shows each department's progress and moves to QC when all are done.
- **Fixed-price packages:** PPF and tint jobs can be quoted from a price list at gate-in.
- **Priority:** every car carries High, Normal or Low priority, set at gate-in by the advisor or at any time by the owner or workshop manager. High-priority cars sort to the top of every screen. Each change is logged.
- **VIP:** a VIP mark is set on the customer and shows as a badge on every car of theirs, on every screen. It carries a handling note that staff see when they open the car.
- **Outside work:** jobs sent to outside suppliers get their own purchase order and tracking, and the cost lands on the job.
- **No insurance jobs:** all work is customer-paid. No insurer, claim or excess fields are built.
- **Payroll is not included.** The system records attendance and hours only.
- **Changeable by the owner without a rebuild:** terms and conditions text, checklists, Work sub-steps, discount limits, deposit threshold, labour rates, shift times, users.
- **Proposed additions:** comeback tracking, warranty on parts and labour, service reminders, and a daily summary sent to the owner.

Still open:

- [ ] Exact number of advisors, workshop managers and accounts users
- [ ] One discount limit, or separate limits for labour and parts?
- [ ] VIP privacy: should technicians see the VIP badge and handling note but not the customer's name or phone number?
- [ ] Who is the backup person if something breaks while the owner is away?
- [ ] Does the Zoho Books plan include API access, and who is the admin on that account?
- [ ] Pick-up and delivery: does a driver need to do gate-in photos at the customer's door?
