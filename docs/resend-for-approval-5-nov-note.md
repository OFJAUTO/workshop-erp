# Parts changed after approval: reopen the flow and resend for approval — 5 November 2026

The real case: **J-00985 (Audi A8, no plate yet)**. After the customer approved Q-00052 v2, Peter cancelled the six
approved brake parts and added eight new AL NABOODA ones (e.g. FRONT BRAKE PAD, 674.80). The parts bar stayed all
green, "Pricing" said "No parts on this car", and there was no way to send the new parts for approval or onto an LPO.

## The cause (one line)

The one shared step rule counted only parts the customer had approved, so parts added after approval — waiting
for an approval that never came — counted nowhere: every step green and "No parts on this car".

## What was built

- **The flow reopens.** A part added after approval (on no approved quotation, not yet approved) holds the bar
  open from the first step it affects — "Pricing" while it has no price, then "Request approval" ("1 new part
  needs approval – Resend for approval"). The bar is **never all green** while any live line isn't yet approved,
  ordered, received and handed over. The same rule draws the Parts page, the job card's dots and Parts tile, the
  parts desk list and the parts dashboard.
- **"Changes since approval"** — one card on the Parts page (and a line on the job card):
  "Changes since approval: 8 added, 6 removed, cost + AED 31.58", each new line (needs approval / approved),
  each changed line (old → new) and each removed line (struck through, with its reason).
- **Each line shows its own status**: New – needs approval / Approved – to order / On LPO-… (waiting for approval)
  / On LPO-… · ordered / Partly received / Received / Handed over / removed.
- **"Resend for approval"** (parts desk, advisor, owner) sends only the changes to the owner or the head
  accountant, on an LPO whose page shows **old vs new** (what the customer approved against what we buy now).
  Their notice says "Parts changed after approval · LPO-… to approve" with the change line. The answer shows
  inside the card, next to the button. A part with no price, or a stand-in supplier, is refused in words.
- **Once approved, the new LPO continues the car's family**: LPO-00107-1 was the first, the new one is
  LPO-00107-2 (the next number), never a second family. Cancelled lines stay marked cancelled on their own LPO,
  and the supplier copy of the new LPO also lists "Cancelled on LPO-…" for that supplier's lines, so the supplier
  hears the new order and the cancellation together.
- **The advisor is told** with the difference; the customer's approved quotation is **not** changed. The notice
  opens the quotation with "Ask to revise" already open and prefilled ("Parts changed after approval: …"):
  revising stays the advisor's choice.
- **Cost and profit**: removed lines never count. Profit on approved work now subtracts the removed parts and
  adds the new ones (once per job), and an invoiced job counts the real cost of approved parts that no invoice
  line carries (before this, J-00985's eight new parts — AED 5,678.24 — would have been missing from its profit).
- **Clear buttons**: "Edit" is now **"Change prices (reopens pricing)"**, and "Back to the parts desk" is
  **"← All cars on the parts desk"**.

## J-00985's figures (checked)

- **"8 of 8 priced" is right** — the 6 removed parts never count.
- **"Our cost AED 5,678.24 + VAT 283.91 = 5,962.15" is right**: 674.80 + 143.50 + 2 × 1,311.37 + 506.10 + 80.50
  + 4 × 4.90 + 2 × 143.50 + 2 × 672.00 = 5,678.24; VAT 5% = 283.91.
- The six removed parts were AED 5,646.66 on the approved quotation, so the change is **+ AED 31.58**.
- Two lines are worth a look when Peter resends: "FIT SWREW" (as typed) and REAR BRAKE PAD SENSOR × 2 against the
  front one × 1.

## Live jobs in the same situation (nothing changed; the parts desk and each advisor notified)

| Job | Advisor | Parts | AED before VAT |
|---|---|---|---|
| J-00492 | Deepak | AC filter (John Auto) | 100.00 |
| J-00940 | Anas | Convertor seal, rear main seal (Al Tayer), radiator (Setac) | 1,157.00 |
| J-00975 | Anas | Water pump, gasket, turbo coolant hose, rear link rod (Emirates American) | 1,717.48 |
| J-00977 | Anas | Front wiper blade set (Abu Dhabi Motors) | 774.24 |
| J-00985 | Anas | The eight AL NABOODA brake parts | 5,678.24 |

## Assumptions

- "After approval" = on no part line of the job's approved quotations; lines left off and unchosen options were
  seen by the customer, so they are never "new". A replacement part (another supplier, an exchange) stands in for
  the line it replaces and shows as "changed", never "added + removed".
- Removals alone need no approval (they cost nothing; the endings already mark the LPO line cancelled); the
  Resend button appears when there are new parts to approve.
- Approving the resend LPO is the approval of those parts; refusing it puts them back under "To order", like any
  refused LPO. Planning reopens on resend (the car is no longer "every part here").

## Proof

`test:sim` path **j** (17 checks): approve → LPO-X-1 → cancel the part with the supplier → add a new one → the bar
opens again with "Changes since approval: 1 added, 1 removed, cost + AED 474.80" → Resend (answer in the card) →
the approvers and the advisor told → the approval screen shows old vs new → approve → **LPO-X-2** → ordered →
received → handed over, the bar checked at every step and **green only after the hand-over**. Unit test
`parts-changes` with J-00985's real figures. Screenshots `tests/browser/shots/sim/j*.png`.
