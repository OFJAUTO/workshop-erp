# 30 October 2026 – delivery note

Five requests from the owner on 30 October, built and tested against the shared database:

1. Additional estimates
2. Estimate parts
3. PPF recheck
4. Recovery upload
5. Inspection fee choice

Migrations, in order (all applied and recorded on 30 October after a backup, `backups/2026-10-30T10-28-53`):

- `20261130090000_additional_estimates.sql`: `quotations.additional_to_id`, `quotations.carried_job_id`.
- `20261130100000_estimate_parts.sql`: the price columns on `quotation_lines`, and the lock trigger now allows the parts desk's "checked" stamp.
- `20261130110000_ppf_recheck.sql`: `jobs.job_kind 'recheck'`, `jobs.recheck_of`, `aftercare_checks.recheck_job_id` and `aftercare_checks.redo`, and the day-8 message.
- `20261130120000_trip_contact.sql`: `recovery_trips.contact_name` and `recovery_trips.contact_phone`.
- `20261130130000_inspection_fee_choice.sql`:
  - `jobs.inspection_fee_choice`, `no_fee_reason`, `no_fee_note`, `inspection_type`, `fee_set_by` and `fee_set_at`;
  - `approval_requests.no_fee`;
  - the settings `inspection_fee_min_aed` / `inspection_fee_max_aed`;
  - the wording with VAT, in English and Arabic.

## 1. Additional estimates (part 1 live in the morning, part 2 now)

**The cause.** "Create a new one anyway" did nothing when the advisor had picked the customer and the car by hand. React 19 resets a form after the server answers, so the car drop-down went back to "Choose the car…" behind the question window. The second tap was then refused. The 29 October quotation-history work did not cause it.

**What changed.**
- The question is asked only for THE chosen car, and only when that car has an estimate still waiting for it.
- "Waiting for its car" means accepted, being prepared, or with the customer, and not carried to a job. `OPEN_ESTIMATE_STATUSES` in `src/lib/quote-history.ts` is the ONE list, used by the question and by the gate-in carry-over. An estimate the customer already approved, like E-00035, counts too.
- The question reads: "This car already has an open estimate: E-00035 · AED X · approved/sent <date>". It has two buttons: Open E-00035, and Make an additional estimate. The second one always creates the estimate.
- The additional estimate's customer link and PDF are titled ADDITIONAL ESTIMATE, "In addition to estimate E-…".
- The car page and the customer page list every estimate with its versions, using the same `QuotationList` as a job's quotations (`kind="estimate"`).
- At gate-in, every open estimate of the car is listed and ticked. The original is the first one that is not itself additional, and goes into `jobs.estimate_id`. The others get `carried_job_id`.
- "Start quotation" makes one quotation per estimate, in the order they were made, each with its own lines. The money line counts every approved one, and the invoice draft takes every approved one.

**Other "already has one" windows, all now with a way forward:**
- the gate-in's "This car is already in the workshop on job J-…" opens that job card in one tap;
- the "car already on record" warning gates that car in with one tap.

## 2. Estimate parts

**The ONE "+ Add a part".** An estimate uses the same "+ Add a part" as a job quotation; the old "+ Part (estimate)" is gone. An estimate's part LINE carries its own price, because there is no job yet. The rules are in `src/lib/estimate-parts.ts`, which is pure:
- states: draft / with_desk / priced / advisor / checked;
- `unpricedEstimateParts`, `waitingWords`.

**The advisor:**
- names the part and sets the quantity and a note for the parts desk;
- sends it with "Send to parts desk to price", per line or "Send all to the parts desk (n)";
- or uses "I have a price" (cost and supplier). The line is then marked "Priced by advisor" (internal only), and the parts desk gets a "check this price" task.

**The parts desk.** `/parts` lists "ESTIMATE E-… – car not here yet" first, with make, model, year and VIN (`loadEstimatesToPrice` in `src/lib/estimate-parts-data.ts`). The parts desk prices on `/parts/estimate/[id]`, filling:
- cost, supplier, part number, type and availability;
- or "Price is right ✓" for an advisor's price.

The actions are in `src/app/(app)/parts/estimate-actions.ts`. The notification types are `estimate_parts_to_price`, `estimate_price_check` and `estimate_parts_priced`.

**Markup, completing and gate-in:**
- Markup has a 5% minimum, as on a job.
- "Estimate complete" is blocked while a part has no price ("1 part still waiting for the parts desk", or "not sent yet"), through `sendBlockers`.
- At gate-in, `estimateLineRows` turns each priced line into a real part request and a priced part item on the job, keeping the cost, supplier, part number and markup. Nothing is re-priced. An unpriced line becomes an open request for Parts.

**Found by the test and fixed.** The quotation screen kept its own copy of an estimate part's price over the server's. So a price from the parts desk, or the advisor's own saved price, could stay hidden on an open screen until the page was reloaded. The price fields of an estimate part now always come from the server (`estPriceOf` in `QuoteEditor.tsx`), except while the advisor's own change is still being saved.

**Also found.** "Start quotation" never checked whether the estimate's lines were copied. It now writes the reason in the quotation's history and in the server log.

## 3. PPF recheck

**The PPF CUT choice** is offered only on a real PPF install: a PPF service from the list, or a package with PPF film in it (`ppfInstallLine`, `NOT_AN_INSTALL` in `src/lib/ppf-cut.ts`). A typed "PPF RECHECK" line is not an install. Tint and ceramic follow the same rule.

**"PPF RECHECK (FREE)" is its own visit type:**
- at gate-in ("Normal visit / PPF RECHECK (FREE)");
- from the car page;
- as a hint on New estimate.

It is linked to the original job (`jobs.recheck_of`, `linkRecheck` in `src/lib/recheck.ts`). It has no inspection fee, no approval, no quotation and no invoice. It goes to the PPF team as ONE stage, the final check.

**The tablet checklist** (`RecheckChecklist`, points in `src/lib/recheck-points.ts`) has eight points: Edges and lifting, Bubbles, Dust or contamination, Alignment and gaps, Panels and badges refitted, Interior screen film, Tint, Ceramic. Each point is answered OK / Needs fixing (note, photos, Fixed), or "Not on this car" for the last three.
- The hand-over signs off the original job's final check.
- The visit goes to Ready with nothing to invoice.
- If anything was redone, the visit also counts as a comeback.

**Cost.** It counts on the ORIGINAL job: "Recheck: X h · AED Y", using clocked time and film (`recheckCostsFor`, `profit.ts` `recheckCost`, `TimeSpentPanel`).

**Warranty wording:**
- the customer sees "Final check done on <date> ✓", and nothing when it is not done;
- staff see "Final check not done".

**Reminders:**
- The first reminder comes two days before the final-check day set in Settings ("Final check: days after handover", default 10, so day 8). It used to be fixed at day 8.
- Its WhatsApp message now reads "Your OFJ BESPOKE final check is due…".
- From the final-check day, the car shows in the advisor's Waiting on you as "Book the PPF final check". It stays there until the car comes in for its recheck visit, the check is done, or the owner activates the warranty.
- Assumption: "booked" means the car came in for its PPF RECHECK visit. The calendar slot made automatically at gate-out is not a confirmed booking.

**The recheck visit's bodyshop page** shows no Release sign-off card and no customer-update card (found in the proof screenshots and fixed): only the checklist is handed back.

**Typed "PPF RECHECK" lines.** Only J-00862 (Dubai EE 57530, G63) has one. No earlier job of that car is in the ERP to link it to.

## 4. Recovery driver photo (live in the morning; the pick-up contact now)

**The cause.** The driver page sent the full phone photo, usually 4 to 12 MB, through a server function. Vercel refuses anything above 4.5 MB ("413 FUNCTION_PAYLOAD_TOO_LARGE") before our code runs.

**The fix:**
- the photo is shrunk on the phone (long side 2,000 px, JPEG);
- it goes straight to storage with a signed link;
- an offline queue on the phone (IndexedDB) shows the amber "Saved – will send when the signal is back (1 waiting)" and keeps the photo through closing the page;
- every failure is logged in `upload_failures`;
- the office has a backup that marks the step with the photo.

**What the driver sees.** For his own open trip only: the customer with Call and WhatsApp, the address, the map and the car.

**New now: the pick-up contact.** The Recovery page's form takes "Person the driver calls" and "Their mobile". When this is someone other than the customer, the driver page shows a second "Pick-up contact: <name>" with its own Call and WhatsApp. Everything is hidden once the trip is done.

## 5. Inspection fee: optional, the advisor sets the amount

This replaces the single fixed fee, and the 21 October chips (750 / 1,000 / 1,500 / 2,000).

**ONE choice.** `InspectionFeeChoice` (rules in `src/lib/inspection-fee.ts`, server side in `inspection-fee-server.ts` `saveFeeChoice`) is required:
- on the approval-link window;
- at gate-in when an advisor or the owner does it. The gate-in person leaves it for the advisor.

**The two options:**

| Option | What it asks for |
|---|---|
| Inspection fee | An amount between the Settings lowest and highest (500 and 2,500, owner only). Quick buttons 500 · 1,000 · 2,500. The suggested amount (premium brands have their own) is pre-filled. |
| No inspection fee | A reason from the list. Then full inspection ("Free full inspection") or quick job. A quick job skips the Inspection stage and goes straight to the quotation. |

**What the customer sees:** "AED 1,050.00 including VAT (AED 1,000 + VAT)", in English and Arabic. With no fee, the customer page says nothing about a fee.

**Not chosen yet.** A car whose fee is not chosen yet reads "Inspection fee: not chosen yet" (amber) on the job card, never the old fixed AED 750 (found in the proof screenshots and fixed).

**Locked at the customer's approval.** After that only the owner changes it, on the job card ("Change the inspection fee (owner)"), with a reason that is logged.

**Declined all work.** "Customer declined all work" charges this job's fee plus VAT.

**The owner's report.** Reports > Inspection fees, per advisor and month: cars with a fee and the amounts, without a fee and why, fees charged on declined cars, time spent on free full inspections.

**Older jobs.** Jobs approved before this change keep their fee (badge "Inspection fee: AED X · locked"). One old "fee below 750" request is still waiting for the owner, so its card stays until it is decided.

**Retired.** The 21 October test `test-fee.mjs` and its `npm run test:fee` script are retired; `test:feechoice` covers the fee now.

## Tests

| Test | Checks |
|---|---|
| `npm run test:addest` (sections A–E, C with `REAL_ESTIMATE=E-00035` on the real car; the extra estimate it makes there is removed and the numbering put back) | 40 |
| `npm run test:estparts` | 24 |
| `npm run test:recheck` | 13 |
| `npm run test:feechoice` | 18 |
| `npm run test:driveupload` (now with the pick-up contact) | 12 |

Screenshots are in `tests/browser/shots/addest|estparts|recheck|feechoice|driveupload`.

**Older tests re-run, all green:**

| Test | Result |
|---|---|
| `test:declined2` | 16/16 (wording now "AED 750 + VAT (AED 787.50) the customer agreed to") |
| `test:gatein1` | 18/18 |
| `test:estimates4` | 18/18 |
| `test:quotehist1` | 22/22 |
| `test:ppfcut10` | 15/15 |
| `test:tint11` | 31/31 |
| `test:warranty12` | 31/31 |

`test:warranty12` now expects the new customer wording: Active ✓ from the handover, "Final check done on <date> ✓", never a check not done. The staff see "Final check not done".

The shared test helper `chooseInspectionFee(page, amount)` in `tests/browser/pw-lib.mjs` makes the fee choice for any test that does a gate-in as an advisor or the owner.

## Lessons

- `Badge` swallowed `data-*` test hooks. It passes them through now, like `Card`.
- An estimate seeded as approved cannot take lines: the approved-quotation lock refuses them silently through the e2e sql route. Add the lines first, then mark it approved.
- The stage seed has fixed ids: a test that needs a "fresh" car twice must clean up in between.
- Tests on the shared database burn real numbers while staff work: E-00040 to E-00049 were test estimates (removed). Anas's E-00050 was made in the middle of the run.
- Turbopack kept serving an old `quote-history-data.ts` after new exports were added; deleting `.next` and restarting fixed it (the known lesson).
