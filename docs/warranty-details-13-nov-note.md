# Warranty card details – who enters them and where (13 November 2026, Section 11)

**Who and where (one entry, used everywhere):**
- The team leader enters the details at the end of their own stage on the bodyshop car page (`/bodyshop/<job>#stages`); the bodyshop manager (or the owner) can fill them for the leader. Already built on 21 October and 9 November; kept as it is:
  - PPF: the roll or batch number (one tap on an open roll, or typed) and the areas covered (pre-ticked from the package).
  - Tint: the roll or batch number.
  - Ceramic: the product (one-tap chips of products used before). No batch (since 9 November).
  - The stage cannot be signed off while a detail is missing, and QC ticks "Warranty details complete" before Ready.

**New:**
- **Metres of film used** (optional) on the PPF entry: saved on the first roll picked, so the film cost of the job's REAL PROFIT follows without a second screen.
- **The job card names what is missing and who enters it:** one line per product, e.g. "PPF details missing – waiting on the PPF and tint leader", with **Enter now** (owner, manager, team leader) to the stage. The line goes once the details are in.
- **Entered once:** the BATCH boxes on Labels › Warranty labels fill themselves from the warranty entry (PPF film and window tint labels).
- **Advisor in charge must be set:** a car whose advisor in charge is "not set" (no advisor chosen, and gated in by someone who is not an advisor, e.g. the gate-in role) cannot be assigned. The words: "Advisor in charge is not set: set it at the top of the job card first". The job card shows it in red at the top.

**Live check, J-00991 (read-only):** its PPF, tint and ceramic details are missing; the job card now names them and who enters them.

**Proof (TEST):**
- `npm run test:s13-11` passes 10 of 10 (the missing lines and Enter now, the one-tap roll, metres on the roll, the Labels batch box filled, the line gone, the red "not set", assign refused in plain words, assign as before with an advisor).
- `npm run test:warranty12` passes 31 of 31 again (its ceramic-batch checks were stale since 9 November).
- Layout check (job card, Labels, Bodyshop) at 800 × 1280 and 1440 × 900: clean.
- Screenshots: `docs/proof/2026-11-13-warranty-details/`.

**Assumptions:**
- "Past approval" = assigning the inspection or the work (the next step after the customer's approval). Bodyshop cars that start by themselves at gate-in are not held.
- The owner is held by the same rule (setting the advisor takes one tap).
