# Loose-items jobs (no car) and the JOB CARD button (20 November 2026, Section 2)

**The case:** J-01034, BMW X6 2012, no plate. It came from the approved parts-only estimate E-00102, held as a "booked" job because "Order parts now" was used.
- **Cause:** the job card sent every booked job to the bodyshop booking page. That page showed the PPF pre-work panel and "Quotation not started" (it looked only for a quotation, not an approved estimate). There was no button to open the job.

## Now
- **START THE JOB – LOOSE ITEMS** on the approved estimate, on the booked job card, and on the gate-in page "Loose items, no car" (the gate role sees no amounts).
  - It opens the job card at once, with no gate-in.
  - The held job keeps its J-number, parts, LPOs and money.
  - The estimate is carried, so nothing is typed twice, and the quotation starts from it as at a gate-in.
  - The department comes from the lines: J-01034 is mechanical.
- **The short flow on the job card:** ITEMS RECEIVED (a photo of the items, or "Nothing to receive") > PARTS AND WORK > INVOICE AND PAYMENT > HANDED OVER.
  - There is no km, fuel, car photos, panel check, wash or road test.
  - Handing over uses the existing "who collected" step on Gate out.
  - A parts-only sale works the same way.
- **Tag "LOOSE ITEMS – NO CAR"** on the job card, the dashboard, the Jobs list and the calendar.
- **The JOB CARD opens for every booked car** (the bodyshop booking page stays one tap away). Before arrival it shows:
  - the jobs, the parts and their status, the booked arrival and the promised handover;
  - red **ARRIVAL WAS DUE <when>** once the time has passed (the advisor gets one reminder from the hourly job, step 37);
  - an amber warning when a part is expected after the promised handover;
  - "Gate in the car" or "START THE JOB – LOOSE ITEMS".
- **JOB CARD button** in the header of the car page and the bodyshop page (the other job pages already had it).
- **On the bodyshop page:**
  - the PPF pre-work panel shows only for a job with PPF or paint work;
  - an approved estimate or ordered parts read as done, never "Quotation not started".

## Assumptions
- A loose-items job from an estimate keeps the estimate's car record (for the parts' fit).
- The tag, not the car, tells everyone that no car is here.

Test: `npm run test:s20-2` (14 checks: advisor + gate role, TEST). Proof: `docs/proof/2026-11-20-loose-jobs/`.

**NEEDS OMAR – the advisor's clicks for J-01034:** open J-01034 (search "J-01034") → the job card now shows "Before the car arrives" → tap **START THE JOB – LOOSE ITEMS** → the quotation from E-00102 opens → on the job card tap **Nothing to receive** (or add a photo of the items) → continue with the parts, then the invoice and payment, then Gate out (who collected).
