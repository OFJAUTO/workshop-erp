# Customer details on cars – 29 October 2026 (batch 2, section 1)

## Why a technician's name showed where the customer should be

The car card printed `customer ?? technician`. For a login that may not see customers (workshop managers, Parts,
QC, technicians) the customer was blank, so the assigned technician's name filled the customer spot with no label.
The owner's and advisors' cards always showed the customer. Now the customer spot shows ONLY the job's customer
(the one on the gate-in who approves the job card) and only to the owner, advisors and accounts; the people on the
car get their own tag ("Tech · Moayad", "Tech · Moayad +1").

Open cars that showed a technician in the customer spot on workshop logins on 29 October (customer names are not
kept in the repository; they were listed in the batch report): J-00016 (Keno), J-00017 (Fahim), J-00317 (Keno),
J-00343 (hazem), J-00460 (Michael), J-00470 (Fahim), J-00491 (Sabir), J-00492 (Moayad), J-00493 (AHMAD), J-00556
(Michael), J-00609 (Keno), J-00655 Dubai EE 72836 (Moayad), J-00860 (Michael). Now: the owner, advisors and accounts
see the customer plus "Tech · <name>"; workshop roles see "Tech · <name>" and no customer. Cars with nobody assigned
showed "Not assigned" in the same spot; that is gone too.

## What each role sees

- Owner, advisors, accounts: the customer on every car card (a company with "contact: <name>"; "Dropped off by the
  customer's driver" / "Brought in by our recovery" / "… an outside recovery" on its own line - the gate-in records how
  the car arrived, not a name), the tappable name opening the owner details panel, and everything else as before.
- Gate-in staff: the customer only on the gate-in form (search, create, edit). Nowhere else (they only have /gate-in).
- Everyone else (workshop managers, technicians, team leaders, Parts, QC): the car photo, plate, VIN, make/model and
  job number. No customer name, phone, approver, driver, address or customer link, anywhere.

## The owner details panel

ONE component, `src/components/CustomerPanel.tsx` (`CustomerName` button + `CustomerPanelHost`, mounted in the app
layout for the owner, advisors and accounts only; a pop-up on a computer, a sheet sliding up below 1,100 px; ✕,
Escape, a tap outside or the back button close it). Data from `GET /api/customer-panel?job=|customer=` (403 for every
other role): name, customer number, person or company (+ contact person), phone(s) with Call and WhatsApp, email,
contacts, how the car arrived and who approved the job card (when not the customer), previous jobs (count + the last 3
with date, job number, car and invoiced total), spent this year, open balance, other cars, declined work from
earlier visits, and the buttons Open customer page / Gate-in details. Opens from the car cards (dashboard, Jobs, To
assign), the job card header, the gate-in form and the top search ("Customer" next to a result).
Not shown: the registered owner from the registration card and its expiry - the gate-in does not record them yet.

## Enforced on the server (pages and reports changed)

- `src/lib/customer-data.ts`: `seesCustomers(role)` (the ONE rule), `jobCustomersFor` (the ONE source of a job's
  customer, empty for other roles), `jobPeopleFor` (the people on each car).
- `src/lib/job-data.ts` `loadJobCard`: for a workshop login no customer, customer name, VIP note, approver/recipient
  names, pickup address or loose-item names, and every history note has the customer's words and any phone number
  replaced ("the customer", "(phone)") - this covers the job card, gate-in details, gate-in edit, gate-out, the
  inspection page, the work order, QC, road tests, the media page, the technician's job screen and the gate-in PDF.
  Customer pages (approval, report, report PDF) pass `customerPage` and always get their own details.
- Job card: the approval and report boxes show a plain status to workshop roles (no approval link, no report link -
  both open customer pages); loose-item collector names hidden; the customer's name in the header (panel) for the
  customer roles.
- Gate-in details: the Customer row and "View as customer" for the customer roles only.
- Inspection page: the customer's report link and PDF only for the customer roles (both show name and phone).
- To assign: no customer name for workshop managers.
- Bodyshop car page: no customer name, phone, WhatsApp, update links or handover page for managers and team leaders.
- Calendar (day, week, month, booking page, booking edit): customer names and the collection address only for the
  customer roles; others see the car.
- Cars list and car page: no owner name for workshop managers or Parts.
- Parts desk and LPO list: no customer name; Parts cannot search by customer.
- Top search: workshop roles search by plate, VIN and job number only (the box says so).
- Loose-item tags: the customer's name is printed only when the owner, an advisor or accounts prints them.
- Invoice, quotation and receipt PDFs by id: no longer open for workshop managers (LPOs still do).
- Notifications: managers and Parts read "The customer approved …" (no name); car notices without an advisor go to
  the advisors (never to a gate-in person); the approval-link reminder goes to the sender only.
- Database (`supabase/migrations/20261129090000_customer_privacy.sql`, applied after the code was live): approval
  requests readable by the owner, advisors, accounts and gate-in only; the login role cannot read the pickup address
  (gate_ins.location_*), who brought loose items and the stored owner report (jobs), the gate-out collector
  (gate_outs.collector_*, delivered_to, delivery_address), loose-item collectors (job_items.collector_name) or a
  booking's collection address (appointments.collect_address) - the server reads them for the customer roles. The
  customers and customer_contacts tables were already closed to workshop logins.

## Tests

- `npm run test:customers1` (31 checks): the owner's and an advisor's cards (J-00655 with its customer and
  "Tech · Moayad"), the panel at 1440×900 and 800×1280, and for the workshop manager, the technician on the car, Parts,
  QC and a team leader: 5–15 pages each, their search and the panel route never carry the customer, approver, driver
  or phone; a technician's search for the customer's name finds nothing. Screenshots in `tests/browser/shots/customers1/`
  (kept out of git).
- `npm run test:security` probes a real workshop manager, technician, Parts, QC and team leader login: no customers,
  contacts, approval requests or personal columns.
