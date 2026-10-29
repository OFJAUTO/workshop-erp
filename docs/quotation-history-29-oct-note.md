# Quotation history: every quotation and version stays visible (29 October 2026, batch section 1)

## 1.0 Data check: nothing was lost

Checked against the change log (every quotation ever created) and the "Clear test data" backups on 29 October 2026.

- **No quotation or version made since the last "Clear test data" (22 October, 10:53 Dubai) is missing.** That is 13 quotations and 7 estimates, all with their lines.
- **No line of an approved or replaced quotation changed after the customer answered.**
- **No quotation was ever deleted.** The change log has no deletes on quotations or their lines.
- **What is missing from the numbering was removed on purpose:**
  - Early quotations from the testing weeks (9–22 October) went when the owner pressed Clear test data on 10, 13 and 22 October. Each press made a backup first, in the private `backups` bucket.
  - The automatic tests' own quotations were removed by their clean-up.
- **Nothing was restored**, because nothing was lost.

| Job | Quotations kept |
|---|---|
| J-00017 (Dubai E 55138) | Q-00002 v1 approved AED 21,000.00 by MASHKOOR (19 lines) · Q-00033 v1 AED 13,050.00, opened by the customer (16 lines) |
| J-00609 (16054) | Q-00030 v1 approved AED 8,430.00 by ZIGA OMERSEL (13 lines) |
| J-00470 | Q-00021 v1 replaced (AED 16,820.00) · v2 being prepared |
| J-00655 | Q-00032 v1 replaced (AED 15,210.00) · v2 being prepared |

Note: the message described Q-00030 as J-00017's quotation. Q-00030 belongs to J-00609. J-00017's original is Q-00002.

**Why staff thought Q-00030 was erased:** the job card showed only the newest quotation, so an earlier one could only be reached by its number.

**Why the numbers have gaps** (Q-00003 to Q-00018 and others): the quotation numbers come from one counter. Every quotation the automatic tests made used up a number, and the test was then deleted. The new test puts the counter back at the end, so it leaves no gap.

## What changed

- **Job card, "Quotations" section.** One row per quotation, oldest first:
  - number · ORIGINAL or ADDITIONAL · amount · status (for example "Approved 24 Oct by MASHKOOR");
  - a versions dropdown ("v1 (old, read-only)" / "v2 (current)");
  - Open · PDF · Revise (Revise only on a quotation out with the customer).
  - Under the list: "Approved so far AED X · Waiting for approval AED Y · Declined AED Z", then New quotation.
  - The section takes two columns when a job has more than one quotation.
- **Rules.**
  - New quotation on a job that has one is an additional quotation. It never touches the earlier ones.
  - Revise makes a new version of the same number; the old version stays, read-only.
  - One quotation is prepared at a time ("Finish Q-… first").
  - The Approval step stays done while an additional quotation waits.
- **Old versions.** An old version opens read-only with a grey banner, "OLD VERSION – replaced by v2 on 29 Oct by Omar". An approved version whose revision is still being prepared says "This approved version stands until v2 is approved".
- **The customer's old link.** It shows "This quotation has been updated" and a button, "View the latest version". The old version can never be approved.
- **Additional quotation, customer's copy.** The link and the PDF are titled "ADDITIONAL QUOTATION" with the line "In addition to quotation Q-00002 (approved 24 Oct)". No staff names, part numbers, costs or internal notes.
- **Car cards and lists.**
  - Dashboard cards show a "2 quotations ▾" picker (owner and advisors) and the chip "Additional quotation not approved · X h" (everyone).
  - The car page lists each visit's quotations.
  - The estimates list and the estimate page carry the versions dropdown.
- **Search.** "Q-00030", "q30" or "E-12" opens that quotation's newest version (owner and advisors).
- **Money.**
  - Already counting every approved quotation: the invoice, deposits, the work order and the daily target.
  - Fixed: the package cost history at gate-out and the 10-day after-care check now read every approved quotation, not only the newest.
  - Fixed: a supplier's courier or freight charge counts once per car, on its first quotation. It was being subtracted again for every approved quotation, in the daily target's "coming from cars in the workshop", in the advisors' approved profit, in the editor's internal profit box and in the low-profit check.
  - J-00017's invoice preview (money page) is a copy of Q-00002. Q-00033 joins as soon as the customer approves it.

## Proof

- `npm run test:quotehist1`: 22 checks.
- Pictures in `tests/browser/shots/quotehist1/`.
- test-k and test-l were brought up to the new old-link rule. test-k's other two stale checks (the low-profit question first; a finished parts step stays done) were updated.
- test-k B13 (the markup reminder scenario of 15 October) still stops before the question. It is unrelated to this change and is listed for later.
