# Vercel clean-up, 28 October 2026 (A5)

Cycle figures given by the owner (20 days): observability events 5.46M ($5.67), build CPU 21 h ($4.51), fast origin
transfer 8 GB ($2.01), function invocations 1.42M (≈ 71,000 a day).

The Vercel command-line tool is not signed in on the office PC, so per-route counts could not be read from Vercel.
The figures below are estimates from the code (45 staff, 10-hour days), checked against the measured 71,000 a day.
Compare them with Vercel → Usage → Functions after one working day.

## What changed (only changes that also make the system better)

| Change | Why it is better as well as cheaper |
| --- | --- |
| Live screens and the bell wait for Realtime; the timed check runs only while the live connection is down, every 2 minutes, never while the tab is hidden (27 Oct + today's 2-minute clamp) | Changes show within about a second instead of up to 30 s |
| A live screen refreshes at most once per 10 s (first change at once, a burst folded into one) | No flicker during Parts pricing or a technician's measurements |
| Quote editor: lock heartbeat only while the tab is in front (45 s), no database write when the lock is fresh; page refresh after saves at most every 10 s | No `quotations` writes every 30 s from forgotten tabs (each one re-rendered every open estimates list) |
| Autosave retries back off (4 s → 2 min) and pause while hidden | A tablet with a stuck save no longer hammers the server all day |
| Phone upload page: checks every 15 s only while the checklist is incomplete and the screen is on (was every 6 s, forever) | |
| Customer "Video getting ready": 8 s → 15 → 30 → 60 s, none while hidden, a "tap to check again" button after 20 min (was every 8 s for 2 hours) | Kinder to the customer's phone battery |
| Bodyshop section tablets: every 2 minutes while the screen is on | |
| Payment proof photos go straight to storage (the deposit panel already did) | **Fixes a real fault**: the form's 1 MB limit would have refused a normal 2–5 MB phone photo of a card slip |
| Other forms that send a photo (supplier "mark paid", film rolls, sticker settings): limit raised from 1 MB to 4 MB | Same fault, smaller forms |
| Car picture copied inside storage instead of downloaded and re-uploaded through the server | Faster gate-in |
| Short links (WhatsApp previews and taps) cached for a day by Vercel's network | Instant preview and open |
| The login check (proxy) no longer runs for short links, fonts and the scheduled jobs | They check themselves |
| Builds are skipped when a push only touches docs, tests, scripts, migrations or notes (`vercel.json` ignoreCommand) | |

Not changed, on purpose: PDFs are still drawn fresh on every view (caching them risks a customer seeing an old version
of a quotation or invoice); the three error logs stay (there was no routine logging to remove); the five-minute crons
stay round the clock; the type-check stays in the build (safety net).

## Top 10 sources of function calls, per working day (estimates)

| # | Route / source | Before 27 Oct | After 28 Oct |
| --- | --- | ---: | ---: |
| 1 | Proxy (login check on every request) | ≈ 110,000 | ≈ 22,000 |
| 2 | `GET /api/notifications` (the bell) | ≈ 54,000 | ≈ 1,500 |
| 3 | `/my-jobs/[id]` (technician screen) | ≈ 16,000 | ≈ 1,500 |
| 4 | `/dashboard` (incl. accounts and parts dashboards) | ≈ 7,700 | ≈ 2,000 |
| 5 | Other live lists (my jobs, workshop, assign, QC, wash, bodyshop, invoices, estimates, LPOs, calendar) | ≈ 7,200 | ≈ 3,000 |
| 6 | `/api/quote/save` + quote page refreshes | ≈ 5,500 | ≈ 2,500 |
| 7 | Navigations and form saves (unchanged) | ≈ 5,400 | ≈ 5,400 |
| 8 | `/jobs/[id]` (job card) | ≈ 3,600 | ≈ 600 |
| 9 | `/tablet/bodyshop` (section tablets) | ≈ 3,600 | ≈ 900 |
| 10 | `/u/[token]` + `/api/customer/media` (phone upload, customer videos) | ≈ 3,000–8,000 | ≈ 400 |

Total function calls: from ≈ 71,000 a day (measured) to roughly 20,000–25,000 a day.

## Expected monthly Vercel cost (30 days, usage items only; the plan fee is unchanged)

| Item | Before (this cycle's rate) | After (estimate) |
| --- | ---: | ---: |
| Observability events | 8.2M ≈ $8.50 | ≈ 2.5–3M ≈ $3 |
| Build CPU | 31 h ≈ $6.80 | ≈ 26 h ≈ $5.60 (docs-only pushes skipped; one push per section stays, as asked) |
| Fast origin transfer | 12 GB ≈ $3.00 | ≈ 4–5 GB ≈ $1.10 |
| Function invocations | 2.1M | ≈ 0.7M (inside the plan's included amount) |
| **Total usage** | **≈ $18** | **≈ $10** |

The biggest remaining lever is the number of builds: pushing once per approved batch instead of once per section would
cut build CPU by most of the remaining $5–6.

Observability: nothing in the code adds observability (no instrumentation, no analytics, no Sentry). The 5.46M events
are Vercel's own per-request records. Whether an add-on such as Observability Plus is switched on can only be seen in
Vercel → Settings → Observability; it was not turned off.
