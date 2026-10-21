# 21 October 2026 batch — delivery note

Twelve sections, each pushed live on its own (`LIVE: …` messages through the day). Sections 1–7 went out
earlier today; this note covers the whole batch for the record. Everything below ran against the live
database with its own browser test; every test removes its rows.

## 1. Complimentary and Included lines — LIVE
A price of 0 is a real choice now. Typing 0 asks "Complimentary, Included in package, or charge normally?";
the ⋯ menu carries the same three. The customer sees the green word (COMPLIMENTARY / INCLUDED) instead of
0.00 on every document; our cost still counts against profit. A free pick-up & drop-off reads
"Complimentary pick-up & drop-off". Proof: `npm run test:comp` (12 checks), E-00009 send-ready with the PDF.

## 2. The discount on every customer document — LIVE
One template serves the estimate, quotation, proforma, tax invoice and receipt (`src/lib/pdf/template.tsx`).
A line's discount prints bold green under it ("Discount 22%: −AED 4,840.00"); the totals read Labour &
services (before discount) → green Discount → green Round-off → Subtotal → VAT → Grand total. Names lose
trailing dashes (`cleanDocTitle`). Proof: `npm run test:docdiscount` (12 checks).

## 3. Supabase security — verified again
The full lockdown from the overnight security turn re-checked green: `npm run test:security` passes, the
advisor re-run shows 0 critical. Notes live in `docs/security-21-oct-note.md` and
`docs/security-table-after.md`.

## 4. Bodyshop costing — LIVE
Our own services never say "Outside work" (only a service marked outside work does). Installer hours come
per service (PPF exterior 96, interior 8, dismantle & refit 16, detailing prep 12, tint strip & refit 4,
windshield 2, panoramic 2, ceramic on PPF 4, ceramic on leather 4; default 8) and cost the bodyshop rate
(`settings.bodyshop_cost_rate_aed`, AED 50) in the internal box and in profit — real clockings replace the
estimate (`profit.ts`). A model-history hint shows last time's hours.

## 5. Packages — LIVE
"+ Add a package" on every estimate and quotation; OFJ Platinum seeded (10 items, only-if panoramic roof,
complimentary pick-up & drop-off, the 10-day check).

## 6. To assign, rebuilt — LIVE
`staff.team` (Mechanical: Technicians / Electricians / Helpers · Body: Dismantle & refit / PPF / Painting /
Detailing & cleaning) set on the Team page. Cars left, ONE team-grouped panel right; the server enforces
sides (a manager assigns his side, the owner everything). Bodyshop cars skip the road test and mechanical
inspection and land in `bodyshop_assignments`. Proof: `npm run test:assign` (16 checks).

## 7. Pick-ups run the delivery procedure — LIVE
One `TripActions` component serves the recovery rows and the gate-out panel: Send to driver / Copy message /
Copy link (short `/d/…`) / Tell the customer. The driver's page is two steps (Car loaded photo → Delivered
photo and price). Advisors see actions, never prices. Proof: `npm run test:trips` (14 checks).

## 8. Inspection fee per car — LIVE
At gate-in: chips 750 / 1,000 / 1,500 / 2,000 + Other, default 750. Settings carries "Premium brands"
(Lamborghini, Ferrari, Rolls-Royce, McLaren, Bentley, Bugatti, Aston Martin → AED 1,500 default, prefilled
from the make). Anyone can raise; below 750 or waiving needs the owner: the figure becomes a request he
answers on the job card (Approve / Keep), enforced server-side. The customer's approval page shows the
chosen amount in English and Arabic (snapshotted on the link); the fee locks at approval — a stale edit
form is refused in words. The job card badge shows the fee (· locked). The declined-work invoice uses the
job's own fee. Migration `20261112210000_inspection_fee_per_car.sql`. Proof: `npm run test:fee` (18 checks).

## 9. One gate-in details page — LIVE
"Gate-in details" sits in the ✓ Job card approval box at every stage (header button on loose jobs) and
opens `/jobs/<id>/gate-in`: the approval name and time, the inspection fee, vehicle and customer, every
gate-in answer, the requests, gate-out details with the old-parts photos, and all photos and videos.
"View as customer" opens the exact approval link with `?preview=1` (never marks it opened, rings nobody);
"Download PDF" is the internal record (`/api/pdf/gate-in/<id>`, photos embedded, INTERNAL footer). The
three fold-outs at the bottom of the job card are gone (History stays). Proof: `npm run test:gatein` (18).

## 10. Scan reports appear by themselves — LIVE
`inbound_scans` joined the live publication (migration `20261112230000`); the technician's Step 1 card, the
manager's inspection page, the job card and `/scans` listen live with a quiet 20-second net. The report
appeared in 2.6 s in the proof, with "Scan report received 09:24 ✓", the soft flash, and the read button
lighting up — no reload, no scroll jump, nothing typed lost. The step card now follows the server's file
list (an emailed report used to stay invisible until a reload). Proof: `npm run test:scanlive` (10 checks).

## 11. Quotation lines reorder — LIVE
Every job line has the ⋮⋮ drag handle, ↑ ↓ buttons and Move up / Move down / Move to top in its ⋯ menu.
The numbering renumbers itself and the PDF, link and invoice print the same order (everything loads by
`position`; the save route's `reorder` now also reopens a completed quotation). An approved quotation
refuses a reorder in words (423 + the lines lock trigger). Spell check confirmed on the typed name boxes
and the customer-note box (English). Proof: `npm run test:reorder` (14 checks).

## 12. Payments name only the actual method — LIVE
The money page's deposit rows join the people lookup, so a cash deposit reads "Cash · deposit · by Omar" —
the old fallback that printed a provider's name is gone; a row with no recorder says "paid online (Pay
now)". Online payments store "Paid online · card ****1234" as their reference (the gateway reference stays
in `client_key`). The receipt PDF names the method only. The charge audit across every payment found ZERO
rows disagreeing with their actual method — RCT-00091 is cash with charge 0.00, and the live rates are
card 2.26, link 1.75, cash/cheque/transfer 0. The advance fold says in plain words what it does. Proof:
`npm run test:method` (10 checks).

## Tests
`npm run test:fee | test:gatein | test:scanlive | test:reorder | test:method` (new), plus the batch's
earlier `test:comp | test:docdiscount | test:assign | test:trips`. `npm run test:layout` and
`npm run test:security` ran at the end of the batch.

## No new environment variables.
