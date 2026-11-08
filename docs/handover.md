# Handover – 8 November 2026
**Status:** the 9-section batch, the A/B status check and the rest of the audit are done and live; only the items below wait for you.
**Live (6–7 Nov):** estimate carry-over · resend quote · parts desk edits after sending · supplier payments (on with apply #2) · Zoho to the fils · jobs sorting · small preview + greeting · part labels 50 × 25 · gate-in check · audit H3 code, M1, M3, M6–M8, M13–M15, L2, L3, L6, sim rule. A/B were already live (603ef5d, 0972039). Notes: `docs/*-6-nov-note.md`, `docs/audit-rest-6-nov-note.md`.
**WAITING FOR APPLY:** the passkeys (login security upgrade): built and tested on TEST, NOT pushed (the owner sees it first). Push → `20261208090000_passkeys.sql` → Supabase password settings → owner tries his phone → rollout "Everyone". See `docs/waiting-for-apply.md`, `docs/passkeys-7-nov-note.md`, staff guide `docs/passkey-staff-guide.md`.
**NEEDS OMAR:**
1. Backblaze key → **"key saved"** (backups part 2).
2. Mathew: set **both Zoho orgs' time zone to Asia/Dubai** (H3's other half).
3. Zoho Books → Posted → red **LPO-00045-1** row → **Check again in Zoho** (re-posts 1,011.00 in OFJ TEST).
4. Now that supplier payments are on: one real supplier payment through **Sync to Zoho**, checked once in OFJ TEST.
5. Leaked-password protection: part of the passkey apply (step 3).
6. Network International: why STL-00012's link payment cost **2.25%** (or change the link rate on Card settlements → Bank fees).
7. Peter: print the **Test label**, follow `docs/part-labels-guide-for-peter.md`.
**Assumption:** no title typed → greeted by first name ("Dear Dhia,"); a "How to address" changes it.
**Left (tests only, product fine):** test-t rewrite; stale old sections in test-c (4), test-g C (bulk delete now asks the ending), test-f C@1920 (1); test-s3-payreport E1/H2/H3 timing on this PC.
