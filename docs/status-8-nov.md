# Status – 8 November 2026

From git log, `docs/handover.md`, `docs/waiting-for-apply.md` and the queue notes. Nothing was built, tested or changed for this answer.

1. **LIVE** – ff1a7c8, 6 Nov (Section 1). The carry-over bell data fix was applied on 7 Nov (0716a52).
2. **NEVER RECEIVED** – nothing in git or the notes for "send LPO for selected parts" or "repeated part numbers like 1234AA". Related, already live: a cost under AED 5 asks "Real price?" and blocks the LPO (2 Nov); Send LPO names unfinished lines (1 Nov).
3. **NEVER RECEIVED** – an LPO is still approved whole and split by supplier afterwards; only refusing one line exists (1 Nov). Nothing gives a job with no advisor the quotation's advisor (the parts pages show "quotation by X", dca0ed5).
4. **LIVE** – bb27363, 6 Nov (Section 2).
5. **NEVER RECEIVED** – nothing for removing a wrong scan report or an Autel check when attaching. Related, live: Fix 1 (603ef5d, 4 Nov), Autel reports reach the technician's Step 1 with no duplicates.
6. **LIVE** – c188ff3, 6 Nov (Section 4); migration applied 7 Nov (0716a52). Covers the payment link method, amount, payment date, advance/fee and one payment across several invoices.
7. **NEVER RECEIVED** (this change) – the settlement date box exists since 27 Oct (c65b7ff) but still starts at today's date.
8. **LIVE** – 42d7864, 6 Nov (Section 3).
9. **PARTLY** – to the fils and the true read-back check are live (6e097ee, 6 Nov). LPO-00045-1 waits for your "Check again in Zoho" press. STL-00012: the bank took 2.25%, not the set link rate; that needs Network International's answer or a rate change from you.
10. **PARTLY** – QR, no left cut (one label per PDF page, zero margins), Test label and printing tips are live (7409e5e, 6 Nov; first half 3655d16, 5 Nov). No separate self-check feature was found, only the automated test. Peter's test print is still to do.
11. **LIVE** – 505f2ea, 6 Nov (Section 6).
12. **NEVER RECEIVED** – the advisor's name is on the parts pages (dca0ed5, 6 Nov), not the technician's. The only parts bell to the technician is the 2-hour "not received" reminder (since 18 Oct).
13. **NEVER RECEIVED** – returns, "credit note awaited" and the Zoho vendor credit are live since 3 Nov, but there are no PR- documents.
14. **LIVE** – 89b2ad3, 6 Nov (Section 7); the How-to-address migration was applied 7 Nov.
15. **LIVE** – 16bf17a, 6 Nov (Section 9); the lockdown migration was applied 7 Nov.
16. **LIVE** – 603ef5d (Autel reports to the technician's Step 1; the mailbox is read with nobody signed in) and 0972039 (Print internal), both 4 Nov.
17. **NEVER RECEIVED** – thumbnails still use Supabase image transformations (`src/lib/media-urls.ts`).
18. **PARTLY** – the code items are live (14f6e33 and 9bad65d, 6 Nov; M15 ea90e8c, 7 Nov). L1 and L4 were applied 7 Nov; leaked-password protection went on 8 Nov with the passkeys. Left for people: H3's other half (Zoho time zone, Mathew), M9 (terminal IDs empty), M10 (one clearing account for card and link), M11 (LPO-00035-2 dated 2016), M12 (STL-00005 method/fee mismatch).
19. **IN QUEUE** – part 1 is live (e854e09, 5 Nov). Part 2 waits for your Backblaze key ("key saved"). Nothing was run.

**A. In the queue, not on your list:** only test fixes; the product is unaffected (test-t rewrite; stale old sections in test-c, test-g C and test-f C@1920; test-s3-payreport timing on this PC).
Done and live, not on your list:
- Login security upgrade (passkeys): 7fdac30, 8 Nov, on for you only.
- Plate can be added: 3329ef2, 6 Nov.
- Advisor on parts pages: dca0ed5, 6 Nov.
- 5 Nov: supplier invoice edit (f59f4b9), enter price myself (f5cb259), resend for approval (bb44576), revise at the top (36db402), supplier amounts with VAT (255655a).

**B. Built but not asked for / rolled back:** nothing rolled back. Nothing unasked beyond small supporting fixes found by tests (for example 47de76d). The notes commit c3101ec is not pushed yet, on purpose: Vercel's one-click rollback only reaches the previous version, which must stay the one from before the passkeys.

**C. WAITING FOR APPLY:** nothing.

**D. NEEDS OMAR:**
1. Backblaze key, then reply "key saved".
2. Mathew: set both Zoho organisations' time zone to Asia/Dubai.
3. Zoho Books → Posted → the red LPO-00045-1 row → "Check again in Zoho".
4. One real supplier payment through "Sync to Zoho", checked once in OFJ TEST.
5. Passkeys: try your phone at an office PC, then Sign-ins → "Everyone in the passkey roles" → Save, and give staff the guide.
6. Network International: why STL-00012's link payment cost 2.25%.
7. Peter: print the Test label.
8. Audit items for people: M9 to M12 (item 18).

**E. This minute:** nothing is running. This status answer is the only work. Nothing more is queued until you send "key saved", switch passkeys on for everyone, or send a new task.
