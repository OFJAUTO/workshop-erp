# Auto-approve while the owner is away – 12 November 2026

**No database change.** The switch is one settings row (`auto_approve`) that the page writes itself. Nothing waits for "apply".

## Where

- **Settings > Approvals while I'm away** (`/settings/approvals`, owner only; the server refuses anyone else, View as and Act as).
- **The switch:** one ON / OFF master switch with an optional end date. After that date it switches off by itself (in the hourly job).
- **The types:** one tick and an optional "Up to AED" cost limit per type. Blank means no limit; above the limit the request comes to the owner as normal.
- **The dashboard:** an amber line "AUTO-APPROVE IS ON until … · n types: …" with "Auto-approved today: n items, total cost AED x". A tap opens the switches. The Approvals page shows the same line at the top.
- **The Approvals page:** gets an "Auto-approved" list, newest first, each with its job, time, the log line and the cost.
- **One evening summary:** from 20:00 Dubai, once a day and only when something was auto-approved: "Auto-approved today: 3 items, total cost AED 900.00".

## Types that can be auto-approved

| Type | Pre-ticked | Limit compared with |
|---|---|---|
| Complimentary – goodwill gesture | yes | cost to us |
| Complimentary – our mistake / rework | yes | cost to us |
| Complimentary – warranty claim | yes | cost to us |
| Complimentary recovery, pick-up and drop-off (quotation) | yes | cost to us |
| Free recovery, pick-up or drop-off (job-card charge) | yes | cost to us |
| Free fuel or other charge (job-card charge) | no | cost to us |
| Quotation discount above the advisor's limit | no | the discount |
| Quotation round-off down above the limit | no | the round-off |
| Quotation total above the approval amount | no | the total |

Each is approved where it is asked:
- **Sending a quotation or estimate (`sendQuotation`):** if EVERY reason it waits for is a ticked type within its limit, it is approved under the owner's name and the send goes on. One reason not ticked means it waits as before; nothing is half-approved.
- **Adding a free charge on a job (`addCharges`).**
- **Turning the switch ON** approves the ticked types already waiting the same way. The advisor gets "AUTO-APPROVED (OWNER AWAY): Q-… – send it".

Each one is logged in the quotation's or job's history:
"AUTO-APPROVED (OWNER AWAY): Q-00012 v1 – complimentary (Goodwill gesture…) · asked by Peter · cost to us AED 150.00".
No bell goes to the owner.

## Always comes to the owner (no switch)

These kinds decide through their own owner-only step: revision of an approved quotation, commission, LPO, supplier discount, inspection fee below the minimum, supplier price up, change to an approved report, stock reversal, comeback at our cost, payment above the balance, receipt void, lathe-bill void and inspection type made smaller. For LPOs, accounts can already approve up to a limit (Settings > Money).

## Proof (TEST)

`npm run test:autoapprove`. Unit: `tests/unit/auto-approve.test.mjs`. Screenshots: `docs/proof/2026-11-12-auto-approve/`.
