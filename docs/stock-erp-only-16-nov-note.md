# Section 1 (16 November 2026): stock stays in the ERP only

## Step 0: what existed

- **On 13 November (option B), every stock item used on a job queued a "Stock used on a job" journal for Zoho.** The journal moved the item's cost from the stock value account to a cost account.
- **Live, read-only, 16 Nov:**
  - 5 such entries were waiting on the Zoho Books tab (you saw 2; 3 more came since);
  - none had ever reached Zoho, OFJ TEST included;
  - so there was nothing to reverse.
- **Stock-purchase bills already used the account chosen in Account mapping.**

## What changed

- **"Post stock usage to Zoho"** is a switch on Settings > Zoho Books > Account mapping, in a "Stock and Zoho" box.
  - It is **OFF** by default (no setting saved = off).
  - Only the owner and accounts can change it; the change is logged (who, when, old, new).
- **While it is OFF:**
  - no "Stock used on a job" entry is made any more;
  - every entry already waiting is closed as **"NOT SENT - STOCK USAGE IS NOT SYNCED"**. It stays on the Zoho Books tab and in the history, and never goes with "Sync to Zoho".
  - The closing happens before every Sync to Zoho, in the five-minute and hourly jobs, and when the switch is turned off. The 5 live entries close by themselves within minutes of this deploy.
- **If it was ever turned on and journals reached Zoho, turning it off again takes those journals back out of Zoho** at the next Sync to Zoho (OFJ TEST until go-live).
- **Supplier bills for stock purchases post as before, one line per part.**
  - They go to the account chosen in Account mapping, under the box now called "Stock purchase bills (the ERP keeps the count and value)".
  - It may be an asset or an expense account, never Zoho's own inventory account.
- **Inside the ERP nothing changed:** the stock count and average cost stay as they are, and a job's profit still includes the cost of stock used on it.
- **The Stock report** (Parts management > Stock report, and a button on the Stock page and the mapping page; owner and accounts only):
  - **stock as of any day:** per item quantity, cost each and value, plus the total value, rebuilt from the movements, so any past day is correct;
  - **the movements of any period:** in from LPOs, out to jobs (with the job number), counts, adjustments and returns, with their values;
  - **month-end snapshots:** saved by the hourly job on the 1st for the last day of the month before, never twice;
  - **Excel:** the stock and the movements, or one snapshot.
- The parts desk cannot open the report or its export.

## Proof (TEST only)

- **`node --env-file=.env.test.local tests/browser/test-stock-erp.mjs`: 14 of 14,** as accounts (the parts desk for the refusal). It covers:
  - the switch, OFF by default;
  - two waiting entries closed as NOT SENT and shown on the Zoho Books tab;
  - ON and OFF through the screen;
  - 31 Oct stock (10 l at 20.00 = AED 200.00) and October's movements;
  - today's stock at the weighted average;
  - the Excel export;
  - the 31 Oct snapshot saved once and listed;
  - the parts desk refused.
- Unit `stock-report`: all pass.
- Layout (Stock report, Stock) at 1440 and 800 for owner and accounts: clean.
- Security: all pass (the new table is server-only).
- Screenshots: `docs/proof/2026-11-16-stock-erp/`.

## Database change (WAITING FOR APPLY)

`20261218090000_stock_snapshots.sql` adds one server-only table for the month-end snapshots. Everything else is live without it; only the saved snapshots wait for the apply.

## Assumptions

- **A job's profit already counts the stock cost from the ERP** (the part's cost at the stock average), so turning the Zoho journals off changes nothing in the ERP.
- **The as-of value uses the weighted average cost as it stood on that day,** replayed from the movements.
- **An item made with a quantity and no movement counts from the day it was made.**
- **The month-end snapshot is taken on the 1st** for the last day of the month before. It is the same figure as "Stock as of" for that day, kept for good.

## NEEDS OMAR

- Mathew chooses the Zoho account for stock purchase bills in Account mapping (box "Stock purchase bills").
- Mathew decides whether to post one closing stock figure to Zoho each month from the month-end report (Stock report → the month-end snapshot → Excel).
