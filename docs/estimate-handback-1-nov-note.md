# Estimate back to the advisor (1 November 2026, E-00055)

## The cause (one line)

The Estimates list showed advisors only the estimates **they created** (`created_by = me`). When the owner revised E-00055, version 2 was created by the owner, so it left Anas's list. The "approved" notice also went to the version's creator (the owner himself), so Anas was never told.

## What changed

- **The advisor who STARTED an estimate stays in charge**, whoever edits, revises or approves it later. For a job's quotation, the car's advisor in charge stays in charge. One rule: `startersOf` / `quoteLeadIds` in `src/lib/quote-lead.ts`.
- **Every advisor sees every estimate.** Their own come first in each section, and the whole row opens it.
- **Sections** on Estimates, and on the new **Quotations** page (menu > Quotations):
  - Waiting for owner approval
  - Ready to send (approved or edited by the owner)
  - Sent
  - Opened by the customer
  - No reply: follow up
  - Being prepared
  - then Accepted, Carried over, Declined and Cancelled / expired.

  Each row says who it is waiting on and "started by <advisor>".
- **Versions** read "v2 · edited by Omar".
- **Back to the advisor.** The estimate or quotation goes back to the advisor in charge when the owner:
  - presses Approve on one waiting for him;
  - presses "Estimate complete" / "Quotation complete" on someone else's;
  - makes a change that ends the wait for his approval.

  It then reads "Approved by Omar – ready to send" or "Edited by Omar – check and send", with what changed, for example "Markup changed on 2 parts, total 966.00 → 987.00". The advisor gets:
  - a notification, which can't be switched off;
  - a Waiting on you line that opens it in one tap;
  - a banner at the top of the estimate.

  The line goes away once it is sent.
- How "what changed" is worked out:
  - a version the owner made himself is compared with the version before it;
  - for an in-place edit, the owner's first change stores how the estimate stood (`quotations.handback_baseline`), and that is compared.
- The other notices that went to "whoever made this version" now go to the advisor in charge:
  - expired;
  - no-reply follow-up;
  - the customer opened or answered;
  - sent by someone else;
  - Parts priced a part;
  - the revision decisions.

## The ones it happened to (live, checked 1 November 2026)

| Number | Version | Made by | Started by | Status | Effect |
|---|---|---|---|---|---|
| E-00055 | v2 | Omar | Anas | Being prepared | Hidden from Anas. Fixed by the migration: back to Anas, "Edited by Omar – check and send · Total 18,850.00 → 16,425.97", and Anas is told |
| Q-00027 | v3 | Omar | Adarsh (car's advisor Deepak) | Approved | Job quotations were never hidden (they show on the job card); no fix needed |
| Q-00021 | v2 | Peter (Parts revision) | Adarsh (car's advisor Deepak) | Being prepared | Job quotation, visible on the job card; no fix needed |

## Database

Migration `20261202100000_quote_handback.sql` adds five columns to `quotations` (`handback_baseline`, `handed_back_at`, `handed_back_by`, `handback_kind`, `handback_summary`) and fixes the stuck estimates.

Until it is applied:
- the code works without the hand-back;
- the list, the sections, "started by", the version labels and the notices to the advisor in charge already work.

## Proof

`npm run test:handback` (test database), with screenshots in `tests/browser/shots/handback/`.
