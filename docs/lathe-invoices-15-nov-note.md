# Section 4 (15 November 2026): lathe invoices go through Supplier invoices first

## Before

- A lathe bill was entered on Parts > Lathe and went straight to Supplier payments.
- It was not on Supplier invoices, so it had no check and no query.

## Now (one list, the same parts reused)

- **Every lathe bill is a row on Supplier invoices,** tagged **LATHE**, with:
  - its tickets;
  - its scan ("Scan / attach the lathe bill");
  - the same search, filters and "Export to Excel" (LPO column "LATHE", cars column "Lathe bill · n tickets").
- **Accounts open it and press "Mark checked",** or "Query with Parts", which sends it back to Parts with the comment.
- **Only a checked lathe bill can be paid.** Supplier payments offers it only after the check ("Pay on Supplier payments" appears on the opened bill).
- **Its Zoho bill is queued at the check,** like every supplier bill (OFJ TEST until go-live).
- **Supplier totals do not count it twice.** Supplier payments keeps its lathe dues from the checked bills, and Parts accounts counts each lathe bill once.

## Database change (WAITING FOR APPLY)

`20261217100000_lathe_bill_check.sql`:
- adds the check and query columns on `lathe_bills`;
- marks the lathe bills already paid or in Zoho as checked.

Until it is applied:
- lathe bills already show on Supplier invoices (tagged LATHE);
- they still pay directly, as before.

## Proof (TEST only)

- **`node --env-file=.env.test.local tests/browser/test-lathe-invoices.mjs`: 9 of 9,** as accounts. It covers:
  - LATHE on the list, New;
  - not offered on Supplier payments;
  - opened with its ticket, then Mark checked;
  - offered on Supplier payments after the check;
  - Query sends it back unchecked;
  - the Excel export.
- Screenshots: `docs/proof/2026-11-15-lathe-invoices/`.

## Assumptions

- **Lathe bills entered before today that are already paid or in Zoho count as checked** (nothing settled goes back to accounts). Unpaid ones wait for accounts' check.
- **A lathe bill has no LPO,** so the LPO-based checks (price against the LPO, received quantities) do not apply. Its tickets are shown instead.
