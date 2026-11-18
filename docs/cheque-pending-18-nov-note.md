# Cheque pending: clear wording and the tax invoice (18 November 2026, Section 1)

Real case: J-00493 (Dubai GG 10280, MERCEDES-BENZ GLE 450), PRO-00009 AED 12,600.00, cheque 018315 (RCT-00097, part of one cheque of AED 25,725.00 with RCT-00096 for J-00974). The page said "BALANCE DUE AED 12,600.00" in red, and there was no tax invoice.

## What changed
- **One balance rule** (`balanceWordsOf` in `src/lib/still-due.ts`) and **one display** (`src/components/BalanceHeadline.tsx`):
  - money nobody has paid in any form → red **BALANCE DUE AED x**;
  - a cheque (or unconfirmed transfer) covering it → amber **COVERED BY CHEQUE – WAITING TO CLEAR** with "Balance once cleared: AED 0.00";
  - a cheque covering part → "Cheque pending AED x" and "Balance due AED y".
- The same words appear on the money page, the invoice page, the job card (paid-so-far line), the gate-out page and its block message, and "Out with balance due" (a covered car reads "cheque pending" and is not in the red total). The dashboards' money chips already said "Cheque pending – waiting to clear".
- **Issue tax invoice now** (accounts and the owner) on the money page and the invoice page:
  - paid in full → issued at once (it was missed);
  - covered by a cheque still clearing → goes to the owner on Approvals ("Tax invoice before the cheque clears"). The auto-approve switch applies when the owner ticks that type; the owner himself issues it at once.
  - The tax invoice is made from the job's own proforma, carries the reason, and is never changed afterwards.
- **Deadline:** 14 days from completion (the earliest of Ready to invoice, a Ready / payment / delivery stage, or the proforma).
  - From day 10, the page shows "TAX INVOICE DUE BY <date>" with the button beside it.
  - The hourly job tells accounts and the owner once per job.
  - The accounts dashboard has a "Tax invoices due" list.
- **Setting** (Accounts posting → Cheque tab; owner and accounts only): "For cheque payments, issue the tax invoice: when the cheque clears (as now) / when the cheque is received / when the job is completed". The default is as now.
- **A cheque that bounces after its tax invoice:** the tax invoice stays. The balance is due again. Accounts and the owner are told in those words. A credit note is used only if the job itself is cancelled.
- **Shared cheque:** "Mark cleared" says "This also clears RCT-00096 (AED 13,125.00)." before the press.
- **Fault found by the live check and fixed:** money that cleared after the car had left never turned the paid proforma into the tax invoice. This happened on J-00981 (PRO-00007, AED 2,325.75) and J-00860 (PRO-00015, AED 2,236.50), both paid in full. From now on it does. Those two are listed with "paid in full – issue now".

## Live list (read-only, 18 Nov): completed jobs with no tax invoice
J-00460 PRO-00002 8,700.00 completed 31 Oct (17 days, unpaid) · J-00493 PRO-00009 12,600.00 6 Nov (11 days, cheque pending 12,600.00) · J-00974 PRO-00008 13,125.00 6 Nov (11 days, cheque pending 13,125.00) · J-00981 PRO-00007 2,325.75 6 Nov (11 days, PAID) · J-00860 PRO-00015 2,236.50 9 Nov (8 days, PAID; the duplicate RCT-00062 waits for its void) · J-01004 PRO-00031 3,150.00 12 Nov (5) · J-00994 PRO-00041 2,000.00 14 Nov (3) · J-00859 PRO-00045 5,400.00 16 Nov (1) · J-01014 PRO-00046 2,142.00 16 Nov (1) · J-01016 PRO-00050 14,000.00 17 Nov (0).

Tests: `npm run test:s18-1` (22 checks, accounts and owner, TEST) and the unit test `tax-invoice-due`. Proof: `docs/proof/2026-11-18-cheque-pending/`.
