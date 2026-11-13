# Section 6: the Estimates and Quotations lists (13 November 2026, evening list)

One shared list, `QuoteListSections`, serves both pages: `/estimates` and `/quotes`.

## What changed

**Tabs, each with its count:**
- **PREPARING**: drafts, and anything waiting for you.
- **SENT**: sent, opened, or "urgent only" asked.
- **APPROVED**.
- **Closed (n) →** is a link on the right. It holds carried over to a job, not going ahead, cancelled and expired.

**Search** by number, plate (with or without spaces), VIN, customer, make and model.

**Mine / All:**
- Advisors open on **Mine**.
- You, accounts and the others open on **All**.
- The choice stays in the address, so a link keeps it.

**Oldest waiting first.** Each row has an age tag ("today", "1 day", "5 days"):
- It **turns red** after 2 days in Preparing or Sent, or 7 days in Approved.
- The row's border turns red too.
- The age counts from:
  - the start (Preparing), or your hand-back (approved or edited by you);
  - the send (Sent);
  - the customer's answer (Approved).

**Tags on each row:**
- **Ready to send**: a draft with a total above AED 0 and nothing waiting on the parts desk.
- **With parts desk (n)**.
- **Waiting for owner**.
- **Opened by customer**.
- The existing money badge covers **Deposit paid** (Prepaid / Part paid AED x of y) and **Proforma unpaid**.

**"Approved or edited by the owner, not sent for more than 2 days"**: a read-only box above Preparing.
- **E-00055** (edited by you on 31 Oct) shows now.
- **E-00039 and E-00078** were approved on 12 Nov at 16:22 Dubai time (the auto-approve while you were away). They join the box on 14 Nov at 16:22, when they pass 2 days.

**"Not going ahead"** always needs a reason (one-tap reasons, or type one):
- **Estimates:** the "…" menu, also for a draft. It is kept, never deleted, and moves to Closed.
- **Quotations:** the "…" menu on the list opens the quotation's "Not going ahead (customer declined)".
- Delete is still offered for a draft that was never sent.

**The 2-day reminder:**
- An estimate or quotation that is ready to send and untouched for 2 days reminds its advisor in charge with one bell. It repeats at most every 2 days.
- At 9 pm you get one count: "3 estimates and 1 quotation ready to send for 2+ days", with their numbers.

## Proof (TEST only)

- **`npm run test:s6-lists`: 13 of 13.** It signs in as an advisor and covers:
  - opening on Mine;
  - All;
  - the tags and the red age;
  - search by plate;
  - the owner-approved box;
  - Not going ahead with a reason, then under Closed;
  - the reminder and your evening count, without a double reminder;
  - the Quotations page.
- Unit: `tests/unit/quote-list.test.mjs`.
- Screenshots at desktop and tablet size: `docs/proof/2026-11-13-estimate-lists/`.
- Older suites brought to the new list:
  - test-estimates4 18/18;
  - test-handback 28/28;
  - test-l: the "Not going ahead" checks pass. Its 2 failures are the old ones on the list.
  - the sim's decline step.
- No database change.

## Assumptions

- **Preparing counts a quotation waiting for you.** It is still being prepared from the customer's point of view.
- **"Ready to send" needs a total above AED 0.** A draft at zero has no price yet.
- **"Not going ahead" on a job quotation** is the existing "customer declined", now with a reason it cannot be sent without.
- **"Owner-approved, not sent"** counts your approval, or your hand-back after editing it, once more than 2 days old.
