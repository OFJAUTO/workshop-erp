# LPO "Send for owner approval" (10 November 2026, Section 4)

- On "Approve this LPO" (and under each supplier of a request with several suppliers), accounts have a third choice next to Approve and Refuse: **Send for owner approval**, with the compulsory note "What are you unsure about?".
- The LPO then shows **Waiting for owner** on the LPO list, in the owner's bell and in his Waiting on you (red after the reminder). Accounts cannot approve or refuse it while it waits.
- The owner sees the accounts note at the top of the LPO page and can **Approve** (optional answer), **Refuse** (reason required) or **Reply to accounts** (the LPO goes back to accounts with his answer). Accounts get a bell with the decision or the answer.
- Log on the LPO and the job: "Sent for owner approval by <name>, <time>: <note>", "Reply to accounts by …", "Approved by Omar, <time>: <answer>".
- Reminder: one bell to the owner after 4 working hours (hourly job, step 32).
- Accounts approval limit: Settings > Money, "Accounts approve LPOs up to AED … incl. VAT". 0 = off (the default). Above it, an LPO goes to the owner by itself, noted "Above accounts limit".

Switches on once `20261212100000_lpo_owner_review.sql` is applied. Test: `test:sim` path d4 (17 checks). Proof: `docs/proof/2026-11-10-owner-review/`.
