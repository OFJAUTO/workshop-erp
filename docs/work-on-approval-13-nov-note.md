# Section 1 – Work starts as soon as the customer approves (13 November 2026, evening list)

## J-01002 (read on live, nothing changed)

- **12 Nov:** the customer declined everything. Then you moved the car back to Pending quote with the reason "MISTAKE".
- **13 Nov:** Q-00088 was sent and approved **in full**: 30 of 30 lines, AED 10,150.00.
- LPO-00086 was approved and split into four supplier LPOs.
- The workshop manager released the car to work at 14:29 with the available parts.
- **The headline was wrong because** the old "declined" stamp of 12 Nov was never cleared. The new rule ignores a decline the customer reversed by approving later. No data change was needed.

## What changed

- **Parts and work run side by side.** "Release to workshop" (and bodyshop) shows as soon as the customer approves, without waiting for the Parts step. The release form says "Work starts now; the parts follow" and lists the parts still coming.
  - "Waiting on" now asks the manager first; Parts work alongside.
- **Each job line on the technician's "Jobs to do"** shows one of:
  - **READY TO START**: no parts needed, or every part is here;
  - **WAITING FOR PART: <part>, <expected day>**, or "not ordered yet", with "(+n more)";
  - **START ANYWAY (dismantle and prepare)**: the workshop or bodyshop manager allowed it.
  - The same list, with the **"Start anyway"** button, is on the manager's work order. "Start anyway" is kept in the job's history; no new table.
- **The steps tag on the job card:** "Work active · Parts: 2 of 5 here" while parts are still coming.
- **Work complete** still needs every part handed over, or put on back order (unchanged).
- **LPO nudge:** an LPO waiting for approval sends accounts a bell after 30 minutes, then every 30 minutes. You get no bell; the count is on your dashboard as before.
- **The headline rule:**
  - a decline only shows while it still stands;
  - when some items are approved it reads **"APPROVED IN PART: n OF m ITEMS"**;
  - when everything is declined, **no LPO can be raised** (refused on the server).
- **"Inspection type: not set"** on a finished inspection:
  - filled from the customer's request when it is clear ("FULL INSPECTION" → Full inspection, "pre-purchase" → Pre-purchase);
  - otherwise the box is hidden.

## Proof (TEST only)

- `npm run test:s1-work`: **17 of 17**, signed in as the workshop manager, the technician, the advisor and the parts desk.
- Unit `work-on-approval`: 12 of 12.
- Layout checks clean for the workshop manager, the technician and the advisor at 800 × 1280 and 1440 × 900.
- Security check passed.
- Screenshots: `docs/proof/2026-11-13-work-on-approval/`:
  - the release at approval;
  - the technician WAITING (800);
  - Start anyway;
  - READY (800);
  - APPROVED IN PART (1440 and 800).

## Assumptions

- A job line's parts are the ones the "Jobs to do" list already ties to it (the part's own line, else the best match by name, as since 11 Nov). A part matched to no line shows under "Other parts".
- "Start anyway" changes the tag only. The technician can always clock on to the car; the tag tells them what they may do.
- No database change.
