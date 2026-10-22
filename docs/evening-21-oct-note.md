# 21 October 2026, evening batch — delivery note

Fourteen sections, each pushed live on its own with a `LIVE: …` message and screenshots. Every test ran against
the live database through the local server and removed its own rows (plus any uploaded test photos).
Database changes were applied only after a fresh backup.

## 1. Commission duplicates — LIVE
One commission per job. A new quotation version carries the commission over and leaves a tombstone on the old
version (AED 0, status "superseded"), so it never lists twice. Cleaned on the live data: J-00859 (Shukri,
AED 1,500) showed four times (Q-00043 v1–v4); now one commission, the paid one; the three duplicates are
tombstoned. Migration `20261113090000_one_commission_per_job.sql`. Proof `npm run test:commission1`.

## 2. Commission payments need proof — LIVE
Paying commissions makes a voucher (`CPV-00001`…): cash with the signed voucher photo, or a transfer with its
reference and slip. A payment without its proof stays amber on the Commissions page and in accounts'
"Waiting on you". The one payment made before vouchers existed became CPV-00001 with its proof still to
upload. Table `commission_payments` (RLS, owner + accounts). Proof `npm run test:commission2`.

## 3. The owner's full control — LIVE
The owner edits inspection reports directly (no change request), fills the technician's form, approves his
own discounts, supplier discounts and revisions directly. No screen asks the owner to approve himself (the
list is in the END report). Proof `npm run test:owner3`.

## 4. The advisor in charge — LIVE
`jobs.advisor_id`: the advisor in charge shows on the job card and the dashboard and can be changed there;
every notification about a car goes to the advisor in charge (and anyone following it), not to whoever gated
it in. The owner's bell stays quiet for routine advisor notices. All seven open jobs were filled in.
Migration `20261113130000_advisor_in_charge.sql`. Proof `npm run test:advisor4`.

## 5. Capitals are never changed — LIVE
What people type keeps its capitals (no automatic Title Case or capitals any more), in the boxes and in the
database. Migration `20261113150000_keep_typed_capitals.sql`. Proof `npm run test:capitals`.

## 6. One way to quote, and the bodyshop board — LIVE
"New bodyshop quotation" starts an estimate with the package picker open; the old address redirects. The
bodyshop board shows every real car (bodyshop and mixed jobs, cars not started yet) with the planned sections.
Proof `npm run test:bodyshop6`.

## 7. Packages cost themselves — LIVE
A package line fills its own internal estimate from Settings: film rolls (matte or gloss, big cars 1.5),
tint and ceramic per car, the month's consumables share, installer hours × the bodyshop rate, recovery — one
line with the estimated profit. HOTFIX the same evening: the first version read the package snapshot wrongly
and the three estimates holding a real package (E-00009, E-00010, E-00011) failed to open for about an hour;
fixed and covered by the test. Migration `20261113170000_package_cost_estimate.sql`. Proof `npm run test:pkgcost`.

## 8. The packages page and wording — LIVE
Tidy rows (name, warranty, "Only if" with its condition, ×), "Estimated completion" everywhere, unticked
only-if items never reach a customer, "Package discount (10%)" in bold green. Proof `npm run test:packages8`.

## 9. The package on every customer document — LIVE
One model (`packageDocOf`) behind the PDF section and the link card: PROTECTION PACKAGE with the name, finish
and car, the package price, what's included with ticks and warranties, complimentary badges, estimated
completion, subtotal — on the estimate, quotation, proforma and tax invoice. Proof `npm run test:pkgdisplay9`.

## 10. The PPF cutting method — LIVE
Chips on every PPF line: Hand-cut (recommended), Pre-cut, Mixed with a note; approved with the quotation and
locked after; printed under the film with a one-sentence explanation; a big HAND-CUT / PRE-CUT / MIXED badge on
the job card, the bodyshop page and the PPF tablet; the monthly report splits PPF hours and film by method;
optional hand-cut surcharge in Settings (0). Migration `20261113210000_ppf_cut_method.sql`. Proof `npm run test:ppfcut10`.

## 11. Tint specification per window — LIVE
One box on the quotation and the estimate: Windshield (None / Clear heat-rejection / Top strip / Full), front
side windows, rear side windows, rear window, sunroof / panoramic roof (only if the car has one). Each row:
darkness chips Clear · 5 · 10 · 15 · 20 · 30 · 35 · 40 · 50 · 60 · 70 and "Extra dark – double layer".
One scale only: "50% darkness". Presets ("Standard"; the owner saves his own with "Save as a preset") and
"Same as last time" for a returning car or customer. The shade is added by itself to the tint items on the
quotation, proforma and tax invoice (PDF and link): "OFJ ceramic heat-rejection tint – side & rear windows ·
front sides 50% darkness · rear sides & rear window 70% darkness". Darker than the legal limit (Settings >
Packages > Window tint, owner; 50 to start) reads "above the legal limit – customer's request" and the customer
ticks it when approving (who and when kept; the server refuses without it). After approval the advisor can still
change it until the tint stage starts (the owner can always correct it); every change is written down old → new
and the "updated tint choice" WhatsApp is prepared. The job card, the bodyshop page and the PPF tablet show the
choice; the installer takes the photo after fitting on the tablet with his PIN. Double layer = double film in
the package cost plus the hours in Settings. Migration `20261113230000_tint_specification.sql`. Proof `npm run test:tint11` (31 checks).

## 12. The invoice is the warranty card — LIVE
- Team leaders write the details at the end of their stage: PPF roll/batch number and the areas covered
  (pre-ticked from the package), the tint roll number (with the PPF stage when the tint is merged into it), the
  ceramic product and batch (final detail). Done is refused until they are written. QC ticks "Warranty details
  complete" before the car can be Ready (a later change needs QC again). A "Warranty details" card on the
  bodyshop page corrects them any time.
- The tax invoice carries a WARRANTY table (product · coverage · roll/batch · cutting method · darkness ·
  warranty · valid until, from the handover day, with VIN and plate) and the framed "YOUR OFJ WARRANTY" panel
  with a large QR. The customer's tax invoice page shows the same panel.
- The QR opens the public warranty page (no prices, no customer name): car, VIN, products, coverage,
  roll/batch, dates, short terms with "Full terms", and the STATUS: "Pending activation – complete your 10-day
  check" with "Book your check" (WhatsApp to OFJ); "Active ✓" with the check date and the team leader's
  photos once the check is signed off; after 30 days without it "Not activated – 10-day after-care check not
  completed" with the reminder dates. The owner can activate by hand with a note (job card).
- Reminders on day 8 (the booking message ready for the advisor), day 12 and day 20 after the handover,
  each once, each date written down.
- After gate-out the job card has the short "Your OFJ warranty card" WhatsApp with its short link.
- Settings > Warranty terms (owner): period, a 2–3 line short version and the full text per product (PPF,
  tint, ceramic, mechanical workmanship), starting with neutral standard wording.
- Every mechanical tax invoice: "Workmanship warranty: 6 months, valid until <date>".
- Warranties (owner and advisors): search by VIN, plate or customer — what is covered, rolls used, status,
  10-day check done or not.
- Also fixed: a "Ceramic coating for PPF" line no longer takes the PPF cutting words (no live invoice had them).
Migration `20261114090000_warranty_card.sql` (table `warranty_entries`: RLS on, staff read policy, server-only
writes). Proof `npm run test:warranty12` (30 checks).

## 13. Document clean-up — LIVE
- Every totals row lets a long label wrap; the amount keeps its own space ("Labour and services discount
  (10%)" no longer runs over it). Discounts in bold green. Checked on the quotation PDF by the text positions;
  the same rows serve the estimate, proforma, tax invoice, credit note and receipt.
- A line named just "PART" (or blank) is flagged in Before sending; completion refuses it.
- "Internal cost only – hide from customer" on any line (the line's ⋯ menu, the part rows, "+ Internal cost"
  under Other charges): the cost counts in the profit, the line never reaches a customer document.
Proof `npm run test:doc13` (10 checks).

## 14. Layout and security checks
`npm run test:layout` and `npm run test:security` at the end of the batch (results in the END report).

## Tests added this evening
`test:commission1 | test:commission2 | test:owner3 | test:advisor4 | test:capitals | test:bodyshop6 |
test:pkgcost | test:packages8 | test:pkgdisplay9 | test:ppfcut10 | test:tint11 | test:warranty12 | test:doc13`.
`test-i` (bodyshop) now writes the warranty numbers at the PPF stage; its old TV-board check reads the in-app board.

## No new environment variables.
