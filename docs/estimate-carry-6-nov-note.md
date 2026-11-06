# Estimate → job: an exact copy – 6 November 2026 (Section 1)

**Cause, in one line:**
- What happened: since the 3 November units change, the copied lines went into the database in ONE batch where part lines carried a "unit" and labour/service lines did not. The database library then filled the missing unit with "empty".
- What failed: the database refuses an empty unit, so the whole batch failed.
- Why parts still arrived: parts come back by their own road, so only labour and services vanished.
- Logged on live for Q-00050, Q-00052, Q-00053 and Q-00061.

**Fix (the ONE shared carry-over, `src/app/(app)/quotes/actions.ts`):**
- **Insert:** missing fields take the column's default (`insertCarriedLines`).
- **Lines** now also carry:
  - the complimentary flag;
  - the installer hours;
  - the line's department;
  - an estimate part's own fields (supplier, part number, availability, priced by).
- **Header** carries every choice: discount (kind, value, scope, who set it), round-off, note to the customer, expected payment method, materials, bill-to, the complimentary reason, tint and commission.
- **Check:**
  - After the carry-over, the job's quotation is compared with the estimate line by line, with VAT and total (`src/lib/carry-check.ts`).
  - Not exact: a red warning on the quotation ("Not an exact copy of E-…: 1 line missing (…)") and a bell to the advisor and the owner.
  - Exact, with the estimate approved by the customer: the quotation is "Approved (from E-…)" with the customer's name and date. No new approval needed.
- **Red warning buttons:** "Add the missing lines from the estimate" and "Leave them as they are".
- **Payments and proformas** of the estimate already move with the car at gate-in (4 November).

**Existing jobs (live, read-only list):**

| Job | Quotation | Estimate | State | Missing | What happens |
|---|---|---|---|---|---|
| J-00988 (Anas) | Q-00061 v1 | E-00062 | being prepared | 2 lines: RIGHT SIDE SKIRT REPLACE AND PAINT, REAR BOTTOM COVER REPLACE AND PAINT (AED 2,800.00) | The red warning shows on Q-00061; one tap adds them back. Bell on the waiting list. |
| J-00978 (Adarsh) | Q-00050 v1 | E-00059 | approved, invoiced INV-00005 | 4 lines at AED 0.00 (computer diagnosis, fluids top-up, TPMS reset, basic car wash) | Not changed. Bell on the waiting list. |

Q-00052 and Q-00053 had the same failure but their lines were re-added by hand since.

**Test:** `test:sim` path o, 10 checks:
- An approved estimate with labour, a fixed service, a complimentary line, a priced part, a recovery, a PPF package with one item off, a discount and a note is carried to the job. Every line, VAT and the total are equal, and it is approved from the estimate.
- A line removed shows red, and "Add the missing lines" restores the exact total.

**Proof:** `docs/proof/2026-11-06-estimate-carry/` (o1-quote-from-estimate-1440.png, o2-red-warning-800.png).
