# Night of 30 to 31 October 2026 – delivery note

The owner was asleep and the Supabase token for the test database had not been added, so no browser test could run
(tests never write to the live database any more). Each section was checked with:

- the type-check;
- lint;
- a full production build;
- the new unit tests (`npm run test:unit`: our TypeScript run directly by Next's compiler, no database);
- read-only checks of the live data.

The browser proofs run tomorrow on the test database.

Applying database changes was refused overnight by Claude Code's safety check ("Production Deploy"), so they wait for
the owner's "apply". Features that need a new column are built to stay dormant until it exists
(`src/lib/schema-ready.ts`), so the pushed code never breaks the live site.

## 1. Tests never touch the live database (prepared; finished tomorrow with the token)

- **The guards and the setup scripts are live** (commit 86ec8e7, see CLAUDE.md speed rule 7).
- **Tomorrow:** add `SUPABASE_ACCESS_TOKEN` to `.env.local`, then run `npm run test:db:create`, `npm run test:db:migrate` and
  `npm run test:db:copy`.
- **Cost:** a second project in the Pro organisation, Micro size, USD 0.01344 per hour = about USD 10 (AED 37) a month.
- **Live numbering check (read-only):**
  - no duplicate job, customer, estimate, quotation, invoice or receipt numbers;
  - tax invoices INV-00001 and INV-00002 have no gap;
  - receipts start at RCT-00036 (1 to 35 were used by tests before 26 October);
  - job, customer and estimate numbers have gaps from test runs.

## 2. Calendar booking (ALREADY LIVE + checked)

**The cause:** `dbb5e85b-…` is Anas's own "we collect" booking. Since 14 October, `jobs.final_check_appointment_id` is a
second link between bookings and jobs. The booking page's read of "its job" was therefore ambiguous: the database
refused the whole read (PGRST201), and every booking page said "Not here" for every role. It was fixed earlier
(b617005). `npm run test:embeds` now checks every such read: 158 checked, 0 refused.

New in this batch:
- **The "Not here" page with the real reason**, and every refusal logged at Settings > Refusals. Logging starts once
  migration `20261201110000` is applied.
- **The gate-in person** opening a car already in the workshop goes to its photos page.
- **The every-role page test** (`npm run test:roles`) runs tomorrow on the test database.

## 3. One profit calculation

**ONE calculation:** `quoteTotals` costs every package line with the shared figures (`packageLineCost`,
`PackageCosting`, `packageCostingOf` / `packageCostingForQuote`):
- film: rolls × the finish's roll price;
- tint: only the windows included;
- ceramic: exterior 75 / interior 55, only what is included;
- consumables;
- installer hours × the bodyshop rate.

Commission, recovery and the bank fee were already counted.

**THE list (`profitLines`)** is used by the quotation and estimate panel and the locked quotation:
- Price before VAT
- − Parts at cost
- − Labour at cost (e.g. 80 h × AED 50)
- − Materials (PPF film, tint, ceramic, consumables, our services' cost, typed materials)
- − Outside work
- − Recovery
- − Commission
- − Bank fee (excl. VAT)
- − Other internal costs
- = Total cost → PROFIT

The separate "Estimated cost …" sentence is gone, and packages say "Package margin".

**Every other place uses the same figures:**
- the daily target and approved-not-invoiced profit;
- the advisors' figures;
- the quotation completion's low-profit check;
- the profit page and owner reports (`jobProfits`). These count the real film, tint and ceramic once recorded on the
  job, and the package estimate until then. A package car with no installer clock-ins counts the package's hours,
  marked provisional.

**The advisor bonus** adds these bodyshop costs back: bodyshop work stays outside the bonus.

**The test** (`tests/unit/profit.test.mjs`) uses the owner's exact example. AED 20,000 − (1,429 + 120 + 130 + 125 +
4,000 + 500 + 5,000 + 368.50) = AED 8,327.50 (41.6%). The lines add up to the total cost. A tint item ("ceramic heat
rejection film") is tint, not ceramic coating. A switched-off item costs nothing.

**3.3 Film rolls:** the default is the most used on the same model before, else 1.5 for a big car, else 1. The
quotation shows "Film rolls (usual X: why)". Anyone may raise it. Lowering it needs a note: the server refuses
without one and logs it as `film_rolls_lowered`.

**3.4 Before → after** (`scripts/profit-recalc-report.mjs`, read-only), quotations with a package, open or approved in
the last 35 days:

| Quotation | Before | After |
|---|---|---|
| Q-00039 v1 · J-00969 (draft, the owner's example) | AED 14,131.50 | AED 8,327.95 (41.6%) |
| E-00033 v1 (draft) | AED 19,632.50 | AED 13,828.95 (69.1%) |
| Q-00024 v1 · J-00493 (approved) | AED 11,400.00 | AED 5,516.05 (46.0%) |
| Q-00034 v1 · J-00491 (approved) | AED 14,349.87 | AED 8,626.72 (45.4%) |

There were no invoiced package jobs in the last 35 days. No job crossed the AED 12,000 bonus line, because bodyshop
work is outside the bonus.

**3.5 Recovery company:** THE picker (`RecoveryProviderPicker`) on the quotation's recovery line offers the saved list
plus "+ Add new" (name and phone). There is no free typing any more. The owner's card on the Recovery page flags
names that look like typing mistakes (`looksLikeJunk`: "YGHUHGHU", "SH"), with Remove.

## Section 4 – Damage already on the car (LIVE; parts wait for migration 20261201120000)

**4.1 The outline.** It is now car-shaped, with FRONT / REAR / LEFT / RIGHT printed around it. Every panel is named
"Part – position", for example "Headlight – front right". `tests/unit/panels.test.mjs` checks each name against where the
panel is drawn. None of the old names were wrong.

**4.2 The section.** ONE model (`src/lib/damage.ts`, `src/lib/damage-data.ts`) and ONE section (`DamageSection`).
"Damage already on the car" appears in English and Arabic on the customer's job card link. It shows the outline, the
list, and each panel's own photos (caption `panel:<key>`). With no damage it says "No damage noted at check-in". The
same block (`DamagePdf`) is on the customer's job card PDF (`/api/pdf/jobcard/[token]`, the View button) and on the
internal gate-in PDF.

**4.3 The check-in details.** "Damage noted: N panels (see above)" replaces "Major damage noted".

**4.4 The panel marker.** The note box reads "Note (shown to the customer)" and each panel takes photos. The bodyshop
pre-work check keeps a plain "Note".

**4.5 Approval.** The checkbox adds the confirmation line in both languages. `approval_requests.damage_snapshot`
keeps what was confirmed (dormant until the migration is applied).

**4.6 Found after check-in.** Anyone on the car records it, from the job card or the technician screen. The advisor in
charge is told (`damage_found_after`). The customer roles send the WhatsApp message (template in Settings). This needs
`gate_ins.damage_after` (dormant until the migration is applied).

**4.7 One diagram everywhere.** The same diagram is on the gate-out and the technician screen.

**PDF note:** the PDF fonts have no Arabic, so the PDFs are in English. The link carries the Arabic.

## Section 5 – Complimentary jobs (LIVE; dormant until migration 20261201130000)

**The rules.** `src/lib/complimentary.ts` sets them. A line counts as free when it is:

- marked Complimentary,
- discounted 100%,
- a free recovery (pre-approved only with a PPF package), or
- on a quotation that totals nothing.

Free lines need a reason:

- our mistake, with the original job;
- goodwill, with a note;
- warranty, with the original job.

**Approval.** The owner approves through the existing owner approval (pending_owner). His notification shows the
normal price and the cost to us. The owner's own sending approves it by itself (logged).

**Cost to us.** It comes from THE profit calculation. PPF work that is not a package now carries its share of a car's
film, everywhere, so it is never 0.

**Customer words.** Goodwill shows "COMPLIMENTARY (value AED X)". Our mistake and warranty show "NO CHARGE".

**Where it shows.**

- Rework appears on the original job card and on Comebacks.
- Goodwill this year appears on the customer's record.
- Wholly free jobs with no invoice count as a cost in the daily figure.
- The monthly Complimentary report is at Reports > Complimentary.

**Invoice.** A wholly free job gets no tax invoice by default. A Settings switch changes this, and
`docs/complimentary-vat-note.md` asks Mathew to confirm.

**Simplification.** The cost moves to the original job on screen only. The daily profit counts it on the free job
itself, so the bonus is never touched.

## Section 6 – Quotation PDF (LIVE)

**6.1 Text drawn on top.** The overlap came from a Text with `flex: 1` inside a column. The package rows now align at
the top, and each tick sits on the first line of its item. "COMPLIMENTARY (value …)" puts the value on its own line.

**6.2 PDF check.** `npm run test:pdf` runs `tests/unit/pdf-check-lib.mjs` and `pdf-layout.test.mjs`. It is also part
of `test:unit`. It fails on:

- text drawn on top of other text,
- text running off the page,
- an amount split across two lines,
- a tick not level with its line.

**6.3 Free pick-up shown once.** It shows only as the package badge, and an empty Other charges section is hidden.

**6.4 Tint.** Tint items name the windows chosen and their darkness. Each window's choice reads "Not needed" when off.

**6.5 Package items.** Any package item can be marked "Not needed", including the pick-up and after-care badges.

**6.6 AED 0 package.** A package at AED 0.00 cannot be sent: "set the package price first".

## Section 7 – "+ Add a part" (LIVE; the owner's list is filled by migration 20261201140000)

**The parts.** Body (with the lights), Glass and Interior come from `src/lib/body-parts.ts` until the migration copies
them into the owner's list.

**Sides.** A part that comes in sides becomes one line per side: "Headlight – front right".

**Search.** It forgives spelling ("grill", "head light", "bumpr", "fender", "windshield").

**From the damage list.** This first tab on quotations and estimates lists the parts from the damaged panels.

**Most used.** It counts the parts actually asked for.

## Section 10 – Uploads (PARTLY; the rest waits for the test database)

**Done tonight.** `ImageShrinker` sits in the root layout. A full-size phone photo is redrawn in the browser to at most
2,560 px and about 2.5 MB before any form sends it through the server. That covers the 14 server-upload places at
once. It was checked in the browser: a 41 MB picture became 2.1 MB, and a form sent while it was still being redrawn
waited, then sent the small file.

**Waiting for the test database:**

- resumable videos (TUS, built, switched off by `NEXT_PUBLIC_RESUMABLE_UPLOADS`),
- the offline queue on every staff upload screen (today only the driver page uses `src/lib/upload-queue.ts`),
- the 200 MB slow-network test.
