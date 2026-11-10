# Autel post-scan – 10 November 2026 (Section 2)

## Read-only check (live, 10 Nov 19:20 Dubai)

- **Mailbox import:** runs every five minutes. Last run 10 Nov 19:20, OK ("0 new · 0 reports filed"). No access error: the Google connection has no `last_error`.
- **The last 10 emails** in the scans mailbox, all with the PDF attached and a VIN read:

| Arrived | VIN | What happened |
|---|---|---|
| 10 Nov 17:10 | WDD5J4GB3LN020838 | J-01005, pre-scan |
| 10 Nov 16:45 | WP0CA2A87NS205465 | J-01000, pre-scan |
| 10 Nov 16:20 | SAL1A2B40PA110573 | **unmatched** (no open job with that VIN): on Scan reports for someone to pick the car |
| 10 Nov 13:55 | SALCA2BG8HH675844 | J-00940, **post-scan** |
| 10 Nov 13:40 | ZAMRP56F5H1213913 | J-00492, **post-scan** |
| 10 Nov 11:00 | 1GYS98R98SR151272 | J-00996, pre-scan |
| 10 Nov 10:15 | SCA689X05KU109876 | J-00995, pre-scan |
| 9 Nov 16:35 | W1N4632761X443783 | J-00994, pre-scan |
| 9 Nov 16:00 | W1N4632761X366489 | J-00979, **post-scan** |
| 9 Nov 15:50 | ZAMRP56F5H1213913 | J-00492, **post-scan** |

No duplicates and no errors. Every report has its own Report ID.

**Cause in one line:** the mailbox filed the post-scans correctly, but QC's "Post-scan from the Autel (PDF)" box only read a file attached by hand there and never looked at the emailed reports.

## Fix

- THE pre/post rule (`scanKindFor(status, hasPre)`): the first report for a job is the pre-scan. A report that arrives once the work has started, or once a pre-scan exists, is the post-scan.
- `attachPostscanToQc` copies the newest emailed post-scan into the job's files (kind `qc_postscan`) and makes it the open QC round's post-scan. It runs when the email is filed, when a QC round opens (for a scan that came during the work) and when the QC page opens (it heals rounds opened before this change). It never replaces a post-scan QC already has.
- While nothing is in, QC's box says "Waiting for the Autel report… last checked n min ago".
- Unmatched reports stay on Scan reports, where someone picks the car (built earlier). The same Report ID is never filed twice.
- Standing rule: tests never read the real scans mailbox; they go through the TEST route `/api/e2e/mailbox`.

Proof: test:sim path d2 (9 checks); screenshot `docs/proof/2026-11-10-autel-postscan/d2-qc-postscan-landed-1440.png`.
