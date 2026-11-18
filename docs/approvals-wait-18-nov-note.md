# Approvals that wait too long (18 November 2026, Section 2)

Real case: the void of RCT-00062 (AED 2,236.50, a duplicate on cheque 019383) waited for the owner from 12 Nov.

## What changed
- **Approvals page:** shows "n waiting · the oldest has waited n days" at the top (red after a day). The group holding the oldest item comes first, oldest first inside each group. Every box shows "waiting n days" (red after 24 hours).
- **Duplicate evidence on the item:** a void request names the other receipts of the same cheque, e.g. "Cheque 019383 is already recorded: RCT-00057 AED 2,236.50 (J-00860, cleared). Is this a duplicate?", so it can be decided in one look.
- **The person who asked** (and accounts on money items) sees "Waiting for the owner – n days" with **Remind the owner**. It works once a day per item and sends the owner a bell and an email: "REMINDER from <name>: … – waiting n days". It is on the item's own page (job card, quotation, LPO) and on Accounts posting's cheque rows.
- **One daily reminder to the owner** from 9:00 Dubai when anything has waited more than 24 hours: "WAITING FOR YOUR APPROVAL: n items, oldest n days".
  - It goes as a bell and as an email with the list and a link to https://erp.ofjauto.com/approvals.
  - The email uses the ERP's existing Google Workspace sending (the one built for supplier LPO emails), from the supplier LPO address in Settings to the owner's sign-in email.
  - The last send and its result show on the Approvals page. The test server never sends the email.
- Step 36 of the hourly job sends it. The last reminder of each item and the last daily send are kept in settings (no new table, no database change).

## Email: will it reach you?
The sending code has existed since October, but no email has ever been sent from live (no LPO was ever emailed), so it is not known whether the Google Workspace key is in Vercel. The first daily reminder will show on the Approvals page either as "Email sent to the owner" or as the reason it could not send. If it cannot send:
1. **Google Workspace (built, free):** add the service-account key to Vercel (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY) with permission to send as the supplier LPO address. Cost: nothing extra.
2. **WhatsApp Business (Meta Cloud API, not built):** a utility message in the UAE costs roughly USD 0.02–0.05. One a day is at worst about USD 1.50 a month, plus the setup of a business number and an approved template.

## Live, read-only (18 Nov, 09:20 Dubai): 24 waiting for the owner
Oldest first:
- Revision Q-00027 v2 (17 days, ADARSH)
- Inspection fee J-00938 AED 0.00 (15 days, ANAS)
- Revisions: Q-00044 v2, Q-00023 v1, Q-00048 v1, Q-00050 v1, Q-00047 v1, Q-00052 v1, Q-00052 v2, Q-00049 v1, Q-00020 v1, Q-00062 v1 (11–14 days)
- Change to approved report J-00984 (10 days, Mert)
- Revision Q-00033 v3 (10 days)
- Revisions Q-00065 v2 (7 days), Q-00071 v2 (6 days)
- **Void RCT-00062 AED 2,236.50 (6 days, Mathew)**
- Revisions Q-00082 v3 (6 days), Q-00088 v1 (4 days), Q-00077 v1 (4 days)
- Stock reversal (4 days, PETER)
- Change to approved report J-01026 (16 h)
- LPO-00102 AED 2,148.12 and LPO-00103 AED 45.00 (new)

**RCT-00091 (AED 12,600.00) is not waiting.** Mathew voided it himself on 17 Nov at 15:00 when he replaced it with the one combined cheque payment (RCT-00096 + RCT-00097, cheque 018315). The advisor's payment report for J-00493 closed with RCT-00097.

Test: `npm run test:s18-2` (14 checks, owner and accounts, TEST). Proof: `docs/proof/2026-11-18-approvals-wait/`.
