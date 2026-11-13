# Section 4 – Every warning comes with its fix (13 November 2026, evening list)

## The real case: the gate-out of J-00991

"Warranty card incomplete … Fill it on the bodyshop page" had no way to enter it there. Now:
- **"Enter details"** sits beside the warning. It opens the same fields as the bodyshop page: PPF roll and areas, tint roll, ceramic products.
- **Save** keeps you on the gate-out page, and the warning clears.
- **Someone who may not write warranty details** (an advisor, gate-in) gets **"Remind the bodyshop manager"** instead: one bell to the bodyshop manager, logged in the job's history.

## THE shared piece

`FixIt` (`src/components/FixIt.tsx`) shows the warning, and beside it one of:
- the button that opens a small panel with exactly the needed fields;
- a link to the place on the page or screen where it is fixed;
- for someone not allowed to fix it, **"Remind <name>"**. It sends one bell, and the button turns into "Reminded ✓".

**Where each warning now has its fix:**

| Warning | The fix beside it |
|---|---|
| Warranty card incomplete (gate-out) | "Enter details" panel, or "Remind the bodyshop manager" |
| Balance due / no invoice (gate-out, cars and loose items) | "Record payment" (owner and accounts), or "Remind accounts". Owner and accounts also keep "Release with a reason" as before |
| Bodyshop sign-off missing (gate-out) | You: "Release as owner" (already there). Others: "Remind the bodyshop manager" |
| Parts not handed over (Work complete) | "Back order – fit on a later visit" (built earlier today) |
| Advisor in charge not set (job card) | Advisors and you: "set advisor" (already there). Others: "Remind the advisors" |
| Assign blocked: gate-in photos not complete | "Finish the gate-in photos" |
| Assign blocked: check-in not approved | You: "Send the check-in link". The manager: "Remind the advisor" |
| Quotation waiting for the owner | The advisor: "Remind the owner". You: your approval box, already on the page |
| Final km missing (gate-out) | The km box is required: pressing gate-out puts the cursor straight on it (unchanged) |

## The list of every warning

- `docs/warnings-list-13-nov.md` was made by `scripts/warning-inventory.mjs`, which reads the screens' code: **11 blocking warnings, 9 with their fix beside them.**
- **The 2 "words only" lines are not blockers:**
  - your own "Supplier invoices not received: n" count (count only, as you asked today);
  - the wash page's "no cars waiting" line.
- **The script finds** warnings shown as red or amber boxes, or red/amber bold words. A warning written in plain grey text is not counted; I found none that blocks.

## Proof (TEST only)

- `npm run test:s4-fixes`: **9 of 9**, signed in as the owner, an advisor and accounts. It covers:
  - "Enter details" fills the warranty card on the gate-out page, and the warning clears;
  - the advisor's "Remind the bodyshop manager" rings once;
  - "Remind accounts" for the advisor, "Record payment" for accounts;
  - the advisor's "Remind the owner" on a quotation waiting for you;
  - the list.
- Layout checks clean for the owner, the advisor and accounts at 800 × 1280 and 1440 × 900.
- Screenshots: `docs/proof/2026-11-13-warning-fixes/`.

## Assumptions

- **"Sign"** for a missing sign-off stays on the bodyshop page, where the team leaders sign with their PIN. On the gate-out you get "Release as owner", the others "Remind".
- **A reminder** goes to the advisors in charge of the car, accounts, you, or the bodyshop managers. It never goes to the person pressing it.
- No database change.
