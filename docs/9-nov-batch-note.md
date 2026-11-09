# Batch of 9 November 2026 – the owner's list of 8 November (four parts)

All four parts are live (push e064dd8). Two database changes and one set of bells wait for "apply" (see the end).

## 1. Softer whites, logo, small print (LIVE)

- ONE theme file: `src/app/theme.css`. Staff screens only (the app shell carries `data-erp-staff`):
  - cards #F6F5F1, page #E6E5E1;
  - card borders #D6D5D0, input and dropdown borders #C9C8C3;
  - search field and light grey panels #DCDBD6, unfinished stage bars #D6D5D0;
  - sidebar text #ECEBE7, active menu pill #F1F0EC, text on black buttons #F3F2EE.
- Pop-ups, menus, tables, forms, toasts and the bell panel use the card colour (they read the same variables).
- Customer pages, printed pages and PDFs stay white. Printing from a staff screen is white too.
- Black, red, green, the gold bar, fonts and layout are unchanged.
- **Logo:** left-aligned with the menu text, 130 px wide, 28 px above the first menu item.
- **Small print:** no text under 13 px on staff screens, and 14 px on tablets and phones. 296 places that used 9–12 px now use the one small size.
- On a phone, the stage labels sit on two staggered lines so "Quote" and "Appr." never touch.
- **Contrast 4.5:1, by darkening text only** (checked by `tests/unit/theme-contrast.test.mjs`):
  - grey text #6b6f76 → #55595f;
  - green words #0f7b4f → #0c6b44 and amber words #8a5a00 → #7a4f00, words only (the green buttons and the gold bar keep their colour);
  - white on the red badge stays pure white.
- **Proof** (`docs/proof/2026-11-09-s1/`): `dashboard-1440x900.png`, `dashboard-800x1280.png`, `job-1440x900.png`, `job-800x1280.png`.

## 2. "Urgent" must mean urgent (LIVE)

**Today's rule (until now):** red was:
- every accounts task;
- every ORDER NOW;
- a deposit to record;
- every car at Ready, pending payment or out for delivery;
- AND any other item once it had waited 24 hours.

**New rule** (`src/lib/urgent-rule.ts`). Red only for one of three reasons, shown on the line in red words:
1. **Money at risk:**
   - cash taken and not banked;
   - a payment the customer made, reported and still not recorded after the reminder time;
   - a car Ready or out for delivery with money still owed;
   - a supplier invoice that may be a duplicate.
2. **Promised date passed**, or **at risk**: due within 4 working hours while the car is not yet at QC, wash or Ready. A promised date counts until closing time that day.
3. **A customer waiting on us more than 4 working hours.** This covers the gate-in counter, the inspection and the price, and the hand-back. You change the 4 hours in Settings › Money ("Urgent when a customer waits more than …").

Everything else is "Today" or "When you can". Nothing turns red just by getting old.

The box reads **"41 waiting · 6 urgent"**, red only when something is urgent, urgent items first.

**Counts today** (a fresh copy of live, 9 Nov, on the test server):

| Who | Waiting | Old rule urgent | New rule urgent |
|---|---|---|---|
| Owner (everything) | 39 | 39 | 16 |
| Accounts | 36 | 33 | 3 |
| Workshop manager | 6 | 6 | 1 |
| Parts | 3 | 1 | 0 |
| Service advisor | 9 | 9 | 9 |

All 9 of the advisor's items are customers waiting for a price or a hand-back for more than 4 working hours, or promised dates already passed.

## 3. Promised date on every approved job (LIVE, the time waits for apply #1)

- **The release window** (workshop and bodyshop) asks for the promised date. It is required, with the time optional.
  - An amber warning shows when the parts are expected later than the date.
  - The date may not be before the start day.
- **The job card:**
  - shows "No promised date yet: set it now" on an approved car without one;
  - the same box changes an existing date, and a change needs a reason.
- Every set and change is logged in the history ("Promised date 2026-11-14 → 2026-11-16: Parts arrive later (Omar, job card)").
- The advisor's confirmation uses the same box.
- **Due today** and **Overdue** on the dashboard count from promised dates only (`promiseState` in `src/lib/promise-dates.ts`), never from the stage targets. A car that is Ready is never overdue.
- **Open approved jobs with no date today (live, read-only):**
  - Anas: J-00317, J-00940, J-00977, J-00980, J-00990;
  - Hamza: J-00858, J-00860, J-00972;
  - Adarsh: J-00492, J-00986;
  - no advisor: J-00991 (to you).
- The bells wait for apply #3. No date was set by me.

## 4. The bell only counts what is still open (LIVE, the archive waits for apply #2)

- **Actions vs information** (`src/lib/bell-rules.ts`): every notice type is either an ACTION (with what makes its task done) or INFORMATION.
  - The badge counts unread actions only.
  - Information is marked read once the bell panel has shown it.
- **A done task clears itself for everyone who got it.** Examples:
  - an LPO approved;
  - a car assigned;
  - a reported payment recorded;
  - the proforma sent;
  - the wash done;
  - any car task once the car has left.
- The clean-up (`src/lib/bell-clear.ts`) runs from the bell at most once a minute, and in the hourly clean-up (step 31).
- After apply #2, read and cleared notices are archived after 30 days (they leave the panel; nothing is deleted).
- **Bell per role, live (read-only), now → with the new rule:**

| Role | Now | New rule |
|---|---|---|
| Advisors | 1,503 | 267 |
| Workshop manager | 851 | 237 |
| Gate-in | 389 | 9 |
| Owner | 155 | 48 |
| Technicians | 93 | 16 |
| Parts | 33 | 7 |
| Accounts | 23 | 13 |
| Team leaders | 18 | 0 |
| QC | 3 | 0 |

943 done tasks clear by themselves within a minute of the first bell check after this deploy.

## Tests

- `test-nov9` 15/15 (parts 2–4 through the screens).
- Unit tests `urgent-rule`, `bell-promise`, `theme-contrast` (all in `npm run test:unit`).
- Layout re-check of the pages that failed at first: clean.
- `test-deposit-panel` and `test-lpoflow` follow the new urgent rule.
- Report script `tests/browser/report-nov9.mjs` (test copy only).
