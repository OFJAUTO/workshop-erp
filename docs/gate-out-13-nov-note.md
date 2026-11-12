# Gate-out: owner release and smarter sign-offs – 13 November 2026 (Section 5)

**The case:** J-00991 (GMC AT4, Dubai G 52235). The owner could not gate out: the detailing and paint leaders had not signed, although the job is PPF. Balance due AED 21,000.00, paid 0.00.

**Built (no database change):**
- **"Release as owner"** on the gate-out page, under the sign-off message:
  - one tick and a short reason;
  - the missing sign-offs are written in the job's history as "SKIPPED BY OWNER, not signed", with the reason; nothing is written as signed;
  - the team leaders and bodyshop managers get a bell.
- **Sign-offs only from teams that actually worked on the car** (a stage started or done). Detailing is no longer asked always, and a stage that was only planned is never asked.
- **The bodyshop manager can sign for an absent leader** (his own PIN, logged "on behalf").
- **Payment is its own lock, owner only.** Releasing a car with money owing needs the owner and a separate tick, "Releasing with AED 21,000.00 unpaid". Accounts and others see "blocked until it is paid, or the owner releases it" and "Ask the owner to approve the release".
- **"Out with balance due"** on the owner's dashboard and the accounts dashboard: every car that left owing money, with the amount, until it is paid. It reads THE money of the job, so a payment takes it off by itself.
- **The warranty card warning:** the gate-out page warns when the warranty card is incomplete (for example "PPF film roll or batch number missing"). It never blocks.
- **The sign-off message shows once** (Section 1).

**Live, read-only check – J-00991's "instrument cluster" thumbnail:**
- The file stored as "Dashboard at gate-out" (job-files, 12 Nov) is a 25 KB picture of the OFJ logo itself. It was added from Omar's own login on 12 November at about 15:32 Dubai, probably picked from the device instead of taking a photo.
- The gate-in dashboard photo (6 Nov) is a real 795 KB photo and is fine.
- **No real photo was lost:** the system kept exactly what was chosen. Take a new dashboard photo at the gate-out.

**Proof (TEST):**
- `npm run test:s13-5` passes 10 of 10:
  - detailing not asked when its stages never started;
  - the manager signs for the PPF leader "on behalf";
  - accounts are blocked;
  - the sign-off message shows once;
  - Release as owner with a reason, plus the unpaid confirmation, and the car leaves;
  - SKIPPED BY OWNER in the history, nothing signed;
  - the car is on "Out with balance due".
- Screenshots: `docs/proof/2026-11-13-gate-out/`.
