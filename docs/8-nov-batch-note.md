# Batch of 8 November 2026 (evening) – the items marked NEVER RECEIVED or PARTLY

## Section 1 – Off-site backups: key saved (LIVE)

- **Database backup, run now in GitHub's cloud: OK.** `db/daily/ofj-db-2026-11-08T17-13-04.tar.gz.enc`, 26.1 MB
  encrypted (118 tables, 259,764 rows), also kept as the November monthly copy.
- **Restore proven (TEST database only, its scratch schema):** the copy was downloaded from Backblaze, decrypted and
  restored – 118 tables, 259,764 rows, every count matches the dump. Against live now (read-only counts):
  jobs 52 / 52, invoices 24 / 24, payments 21 / 21.
- **Storage copy, run now: OK.** 1,995 files (photos, videos, PDFs), 2,152.5 MB, each encrypted, in Backblaze under
  `storage/`. All three watch rows (nightly, weekly, monthly) are green.
- **The encryption key's other copy:** there was one in an old Claude scratch folder (temporary, gets cleaned). It is
  now on your Desktop as **OFJ-BACKUP-KEY.txt** (the key is never printed in chat, git or logs). The restore test in
  GitHub printed the key's fingerprint `ecfbe604` (the first 8 characters of its SHA-256, not the key), and the
  Desktop copy has the same fingerprint, so it is the same key GitHub uses. Move it to your password manager, print
  it for the safe, then delete the file.
- **Failure notices:** the backup and restore watch rows are green and their "late" flag is cleared, so no new
  failure bells. The three old "FAILED: B2_KEY_ID is not set" bells (6–8 Nov) stay in your bell until you read them.
  GitHub stops the failure emails once the runs succeed.
- **Not done – the move of the PC's `backups/` folder (125 folders, 20 GB):** it runs on the PC and needs the
  Backblaze key on the PC too; the key lives only in GitHub's secret store, which cannot be read back. On NEEDS OMAR.
- `scripts/offsite/restore-test.mjs` now reports the jobs/invoices/payments counts against live and the key fingerprint.

## Section 2 – Pre-made photo sizes (LIVE, push f3c07b2)

- **Cause:** every small picture was a Supabase image transformation – ONE helper, `thumbsFor` in
  `src/lib/media-urls.ts` (`createSignedUrl(…, { transform })`), used by: the check-in link's photos, the
  inspection report (link and staff preview), damage photos, payment-report slips, warranty and after-care photos,
  mileage photos, the bodyshop progress/handover pages, and the Record payment window's car pictures. No other place
  (no `/render/image/` address, no Next image loader). The test project counts too: Supabase bills transformations per
  organisation, and the test suites opened those pages.
- **Now:** every photo gets a 400 px thumbnail and a 1600 px medium copy ONCE, when it arrives, drawn with sharp on
  the server (`src/lib/photo-sizes.ts`), stored next to the original in the same bucket under `_sizes/` with a
  one-year Cache-Control. Lists and dashboards (car pictures on the dashboard, Jobs, My jobs, To assign, the parts
  inspection list) use the thumbnail; the viewer shows the medium copy with an **Original** button (the untouched
  original, for download). Originals are never changed or deleted. A photo with no sizes yet shows its original –
  never a transformation. Upload points hooked: THE upload door (every queued photo and video poster), the car
  picture copy, the car form, gate-in loose items, payment proofs, recovery driver photos, the bodyshop tablet,
  film-roll photos.
- **Check:** `tests/browser/check-no-render.mjs`: zero `/render/image/` requests on the dashboard, Jobs, two job
  pages, their gate-in pages, Gate-in and Cars; test-viewer7 15/15 (the page uses the 400 px copy, the viewer the
  1600 px copy). The transformation count 24 hours later is on NEEDS OMAR (Supabase dashboard → Usage).
- **Backfill:** WAITING FOR APPLY #1 (1,330 photos, about 0.21 GB extra).

## Section 3 – Send LPO for selected parts (LIVE, push 3b8a704)

See `docs/lpo-selected-8-nov-note.md`.

## Section 4 – Approve each supplier separately (LIVE)

- Under each supplier's block of a waiting LPO request: **Approve <supplier> (AED x incl. VAT)** and **Refuse
  <supplier>** (reason compulsory). Approve makes that supplier's own LPO at once (LPO-00059-1, ready to send); the
  others stay "Waiting for approval" on the same request. **Approve all** and **Refuse this line** stay.
- A refused supplier's parts go back to the parts desk with the reason; the desk taps Replace, prices it and ticks it,
  and the replacement **joins the same request** while it waits.
- The header says "2 of 3 suppliers approved · 1 waiting"; the LPO list shows each supplier's state
  (`Sparein ✓ · Al Ghandi ✓ · Mezan waiting`); after a partial approval the approvers' bell lists what still waits.
- A repeated part number or a line with no real price keeps Approve off for that supplier only.
- The request becomes "approved" once no supplier waits and no refused line waits for its replacement.
- **Advisor not set:** a job with no advisor now takes the service advisor who made its quotation (else its estimate)
  when a quotation is started or the car arrives with an estimate (`fillMissingAdvisor` in `src/lib/job-advisor.ts`).
  Live list (read-only) – WAITING FOR APPLY #3 sets: J-00343, J-00470, J-00492, J-00974 → Adarsh; J-00992 → Anas.
  Left as they are (quotation made by you, or no quotation/estimate yet): J-00469, J-00490, J-00491, J-00493,
  J-00494, J-00560, J-00861, J-00862, J-00935, J-00938, J-00939, J-00973, J-00979, J-00981, J-00982, J-00987, J-00991.
  J-00989 is not an open job (closed, its BMS MODULE line removed).
- Proof: `tests/browser/shots/sim/x5-two-of-three-approved.png`, `x9-child-lpo-one-supplier.png`; sim path x.

## Section 6 – Settlement date with no default (LIVE)

- The date moved into the record row next to **Record the settlement**, labelled "In bank on (money in the bank)".
  It starts EMPTY every time, cannot be in the future, and cannot be earlier than the newest ticked payment (red words
  under the box; Record stays off). The server already refused both. Nothing is pre-ticked until the date is picked.
- ONE shared component `src/components/MoneyDate.tsx`, also used by the supplier payment's "Paid on" and the bank
  report's date (which now starts from the report's own date, never today).
- Recorded settlements read "In bank 5 Nov · recorded 7 Nov by Mathew".
- test:settle 31/31 (new check: the date starts empty and Record is off); test-fees4 and test-version pick the date.

## Section 7 – Technician on parts pages (LIVE)

- "Technician: Keno" (or "Mechanical: Keno · Bodyshop: Sabir") next to the advisor on the parts page, every parts
  desk row (with a **Technician** filter), Parts arrivals, Hand over and the LPO page (`JobTechnicianTag`,
  `src/lib/job-technician.ts`). Never on a supplier copy or a customer page.
- Hand over: "Ready – waiting for Keno · 26 h".
- Bells: a part marked ready tells the technicians on the car (as before); the workshop manager now hears it at once
  only when no technician is on the car, and otherwise after **4 working hours** not collected (housekeeping step
  21b, once per car). The 2-hour reminder stays.

## Section 8 – Purchase returns (WAITING FOR APPLY #2, then live by itself)

What already existed (3 Nov) and stays: Return to supplier on the Parts table, "credit note awaited", the credit
note record, the Zoho vendor credit. Added in the same flow:
- **PR-00001…** opened by itself when a part is given "Return to supplier" (`src/lib/purchase-returns.ts`), linked
  to its LPO and the supplier's invoice number; **Return note (PDF)** for the supplier: part, part number, quantity,
  their invoice, the reason, two signature lines, no customer details, no prices (`/api/pdf/return-note/[id]`).
  Fewer pieces can go back than arrived.
- **Statuses:** Return requested → **Sent back** (date, who took it or who collected it, photo of the signed slip) →
  **Credit received** (number, date, before VAT and VAT as printed, scan; runs the 3 Nov credit-note path, so the Zoho
  vendor credit is queued) / **Refund received** (method, date, amount; Zoho by hand) / **Replaced** / **Refused by
  the supplier** (back to our stock at cost, or written off with the owner's approval). A **restocking fee** field
  (an expense, to the job or overhead).
- **Money, worst case:** the supplier balance moves only when accounts record the credit or refund. Until then the
  Suppliers list shows **"Credit expected from <supplier> AED X · not in the balance yet"**. A credit on an invoice
  already paid shows as "Credit to use" (money the supplier owes us). The LPO page warns while an invoice may still
  charge a returned part.
- **Job cost:** a refused part written off to the job, or a restocking fee to the job, counts on the job's cost
  (`returnCostsForJobs` in profit). The advisor is told when a return is refused. Customer documents are never changed.
- **Parts management → Purchase returns** (`/parts/returns`): Waiting to go back / Waiting for credit (days counting) /
  Done / Refused. Accounts get a bell when a part goes back, and a reminder after 7 days without a credit (step 21c).
- Sim path y: 7 checks. Proof: `y1-return-note.pdf`, `y6-purchase-returns-list.png`, `y5-supplier-credit-expected.png`.

Assumptions: the job's cost of a returned part still comes off when the return is decided (the 3 Nov rule); a refused
return or a fee puts the cost back (job or overhead). A credit to use is shown, not yet offered inside the pay box
(take it off the payment by hand). A refund and a restocking fee are entered in Zoho Books by hand.

## Section 9 – Payment link fee at the worst case (WAITING FOR APPLY #4)

- The built-in rate is now 2.25% + AED 1 + VAT; the stored setting moves from 1.75 to 2.25 with the apply
  (`supabase/data-fixes/2026-11-08-link-fee-worst-case.sql`). You can change it on Card settlements → Bank fees.
  Recorded settlements and payments are not changed; the real fee from a settlement still replaces the estimate.
- Open jobs whose profit estimate goes DOWN (0.5% of the total; no open job has an unsettled link payment):
  J-00017 54.50 · J-00317 72.90 · J-00460 43.50 · J-00491 99.75 · J-00492 50.00 · J-00609 42.15 · J-00940 100.00 ·
  J-00975 71.50 · J-00977 27.50 · J-00980 37.50 · J-00990 33.08 · J-00991 105.00 – AED 737.38 in all.

## End of batch

- `npm run test:layout` (every page, every size, pop-ups, 130% text, the document check): clean; 50 document checks.
- `npm run test:security`: all passed (`purchase_returns` is in the server-only list).
- `npm run test:sim`: 341 checks, 0 failed (25 paths; the run's own time cap was raised from 55 to 150 minutes).
- `npm run check:live` (read-only): 33 of 33.
- Queued test fixes, done:
  - test-t brought to today's rules: 56 of 57, and the last check's wording was fixed against the real text. The two checks about the owner's own services list now run only with CHECK_SERVICE_DATA.
  - test-c 67 of 67 (waits for slow saves; today's VAT and heading words).
  - test-g 44 of 44 (an ordered part with nothing arrived is now cancelled in the sweep, so the kept part is a received one).
  - test-f 92 of 92. It found a real fault: a 22-character part number was cut at 1920 px, so the wide-screen part number column is now 19 rem (the name column 10.5 to 14.5 rem).
  - test-s3-payreport 76 of 76 (its waits are three times longer on this PC).
  - The other suites that pressed the old "Send LPO" button now use the new `sendLpo` helper.
