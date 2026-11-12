# Speed check – 11 November 2026 (Section 16)

Measured, not bought. Nothing about a paid plan or the database location was changed.

## Where things run (names only)

- Server code: Vercel region **bom1 (Mumbai)**. Every live answer carries `X-Vercel-Id: bom1::bom1::…`.
- Database: Supabase region **ap-south-1 (Mumbai)**, Postgres 17, compute **Micro** (2 shared cores, 1 GB). Size 327 MB; 26 of 60 connections in use.
- So the server and the database already sit in the same city. Moving either would not help.

## Live, read-only (no sign-in, nothing created)

| What | Time from Dubai |
|---|---|
| A static file (`/version.json`) | 48 ms |
| Sign-in page (no database) | 105 ms |
| A page with one database read (`/s/<code>`) | 142 ms |

So one database round trip on live costs about **20–35 ms**. A page that makes its reads **one after another** pays that for every read in the chain.

## Signed-in pages, as a tablet loads them (800 × 1280, touch)

These were measured on the TEST server on this PC. Tests never sign in on live. This PC is **about 155 ms from the database for every call** (live and test alike). So the absolute numbers here are about 5 times what live shows. The **count of database waves** is the true measure.

BEFORE the fixes (median of 3 loads):

| Page | Ready | Database calls | Waves in a row |
|---|---|---|---|
| Accounts dashboard | 11.5 s | 127 | 66 |
| Owner dashboard | 10.6 s | 185 | 38 |
| Job card | 10.2 s | 181 | 52 |
| Advisor dashboard | 9.7 s | | |
| Parts desk list (`/parts`) | 7.9 s | | |
| Gate-in dashboard | 7.6 s | | |
| Parts dashboard | 6.8 s | | |
| Quotation page | 6.6 s | | |
| Workshop manager dashboard | 6.0 s | | |
| Invoices and payments | 5.3 s | | |

On live, the same waves at 20–35 ms each give roughly: the accounts dashboard 1.3–2.3 s, the owner dashboard 0.8–1.3 s, and the job card 1.0–1.8 s.

AFTER: see below.

## What was fixed (free)

The cause was never the plan or the region: pages made their database reads **one after another** when most did not need each other. Now they start together:

- The accounts "Waiting on you" sections (17 reads) and the LPO approval lines.
- The Waiting on you panel on every dashboard (5 reads).
- The owner's dashboard: 14 reads that need only the list of cars; the package costing of every quotation in the profit box (was one quotation after another, 3 reads each).
- The job card: 11 reads that need only the job start at once.
- The Parts desk list: the estimates, the counts and the prices to fix start with the page; the LPO card reads together; the advisor and technician tags together.
- The gate-in board: every ready car's balance at once, the customers' credit terms in one read (was 2 reads per car).

AFTER (same test server, same cars):

| Page | Before | After | Waves before → after |
|---|---|---|---|
| Accounts dashboard | 11.5 s | 7.5 s (−35%) | 66 → 33 |
| Owner dashboard | 10.6 s | 6.8 s (−36%) | 38 → 20 |
| Job card | 10.2 s | 8.5 s (−16%) | 52 → 43 |
| Advisor dashboard | 9.7 s | 6.1 s (−37%) | → 24 |
| Parts desk list | 7.9 s | 5.1 s (−35%) | → 19 |
| Gate-in dashboard | 7.6 s | 3.8 s (−50%) | → 15 |
| Workshop manager dashboard | 6.0 s | 3.6 s (−40%) | |
| Technician's jobs | 4.2 s | 3.2 s (−24%) | |

All 32 measured pages and taps: 150.3 s → 118.7 s in total. The raw figures are in `docs/proof/2026-11-11-speed/speed-before.json` and `speed-after.json`.

**What that means on live.** Waves × 20–35 ms, plus about 60 ms to draw the page:

| Page | Live, about |
|---|---|
| Owner dashboard | 0.5–0.8 s |
| Gate-in, Parts desk | 0.4–0.7 s |
| Advisor dashboard | 0.5–0.9 s |
| Accounts dashboard | 0.7–1.2 s |
| Job card | 0.9–1.5 s |

So the job card and, on a busy day, the accounts dashboard can still pass 1 second. What is left on the job card is about 38 small reads spread over some 30 separate helpers (charges, deposit, warranty, teams, mileage, history…). Joining those is the next step, and it is free.

## Would a bigger plan help? No (with numbers)

- The database itself answers fast. Over the last 5 weeks the busiest app reads average 2–16 ms each (settings 2.3 ms, job history 15.6 ms). The 57 ms reads are the largest job lists. CPU and memory are not the limit: 327 MB of data fits in memory.
- The time goes on round trips. Each one is about 20–35 ms on live, and **network and handshake time does not shrink with a bigger computer**.
- Supabase compute: Micro today, about USD 10 a month. Small is about USD 15 (+5), Medium about USD 60 (+50), Large about USD 111 (+101). None of them shortens a round trip, so **not recommended**.
- Vercel Pro is about USD 20 per member a month. It runs the same Mumbai region, so no gain for speed. **Not recommended.**
- The heaviest database load is Supabase's own live-update feed. It has read changes 3.17 million times since 6 October (11 ms each), from the 31 tables in the feed. It is free, but every table added to it costs load. Keep the feed to the tables screens really listen to.

## Tools

- `npm run test:speed` (`tests/browser/speed-check.mjs`): the tablet timing against the test server. It writes JSON to `docs/proof/2026-11-11-speed/`.
- `tests/browser/speed-trace.mjs` with a test server started with `SPEED_TRACE=<file>` (`src/instrumentation.ts`, off everywhere else): one page's database calls and waves, in order.

## MEASURED ON LIVE (12 November 2026 morning, Vercel Observability, production, last 12 hours)

Read from Vercel in the owner's own Chrome (read-only). Screenshots: `docs/proof/2026-11-11-speed/live-vercel-functions-p75-12h.jpg` and `live-vercel-dashboard-12h.jpg`.

| Page | P75 duration on live | Calls |
|---|---|---|
| Job card `/jobs/[id]` | **111 ms** | 137 |
| Home `/home` | **90 ms** | 59 |
| Notifications `/api/notifications` | 362 ms | 69 |
| LPO page `/parts/orders/[id]` | 635 ms | 13 |
| Parts desk `/parts` | 761 ms | 22 |
| Sign-in `/login` | 1.05 s | 45 |
| Dashboards `/dashboard` (all roles) | **1.85 s** (route detail: average 0.997 s, P75 1.39 s) | 46 |

So the job card, home, the Parts desk and the LPO page are under 1 second on live. The dashboards are not yet: on average 1.0 s.

The real cost of one database call from the live server is **97 ms** on average (Vercel's External APIs for `/dashboard`: 2.8K calls to Supabase from 46 page views, about 60 calls each). That is higher than my estimate of 20–35 ms, which came from the sign-in page and a public page. This is why the dashboards stay near 1 s even after their waves were halved.

The next free step for the dashboards: fewer calls per view (about 60 now). One read for the jobs-to-do and planning facts of all cars instead of one per helper, and the Waiting on you items from the same job list the dashboard already holds.

A bigger Supabase plan still would not help: the 97 ms is the trip and the query handling per call, not the database's CPU (CPU throttle P75 21%, memory 303 MB of 2 GB).
