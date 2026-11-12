# Zoho Books tab – 13 November 2026 (Section 9)

**Built (no database change):**
- **One search box above the documents.** It finds a document by its number, the customer or supplier name, the plate, the job number or the amount. It works with the Type filter (tax invoice, payment, supplier bill…), the From and To dates, and the status chips (All, Waiting, Failed, Posted).
  - A search looks through the newest 3,000 documents of the chosen status, not only the newest 400.
  - Tapping a status chip keeps the search.
- **Each result shows its Zoho status** (Posted ✓, Posted · differs, Failed, Waiting) and when it was queued and posted.
- **Failed documents sit at the top** in their own red box, "Failed – needs you". Each shows its reason in plain words, Try again (and "Done by hand in Zoho…"). A failed row is never shown twice.
- **"Last syncs" is folded into one line** ("Last syncs · 5 · latest 13 Nov 02:10 · 3 posted…") that opens on tap.

**Proof (TEST):**
- `npm run test:s13-9` passes 8 of 8.
- The page's own test, `test-s11-zoho-manual`, passes 69 of 69. Its "payments group" count now includes combined payments, which joined that group on 9 November.
- Screenshots: `docs/proof/2026-11-13-zoho-tab/`.
