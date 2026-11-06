# Gate-in role check – 6 November 2026 (Section 9)

**Result: the screens were OK; the database was NOT. Fixed (one part live, one part WAITING FOR APPLY).**

What I checked, signed in as a real gate-in person (Deepak) on the TEST database:
- **Screens:** every page but the gate-in ones (jobs, job card, money page, customers, invoices, estimates, quotations, parts, dashboard, supplier invoices, Zoho, settings, calendar) sends the gate-in login away. Customer panel, money PDFs and exports are refused. The car's gate-in record shows no money. OK.
- **The top search** answered a gate-in login (cars only, no customers). Fixed: the search box is gone for gate-in and the search refuses it (they search on the gate-in page).
- **The database itself** (what a gate-in login could get by calling the database directly with its own login): it could read **every customer's name, phone, email and address (35)**, the **check-in links (21)** and the **money settings (62)**, and it could **change another customer's phone**. Money rows (payments, invoices, quotations, part costs, LPOs) and writes to money, settings and staff were already refused.

The fix:
1. **Live now:** the gate-in screens read and write customer and check-in rows through the server (after their own permission check), so they no longer need the gate-in login's own access. Nothing on screen changes.
2. **WAITING FOR APPLY** `20261207130000_gate_in_role_lockdown.sql`: the database then refuses a gate-in login customers, contacts, check-in links and money settings. Proven on TEST with the rule on: the gate-in role check (6 checks), gate-in (18), resend check-in (19), plate (36) and roles (151) – all green.

Car photos: the gate-in screens show the car picture as before (unchanged).

`npm run test:security` now also probes the gate-in login (it says "waiting for apply" until the rule is on). New test: `npm run test:gateinrole`.
