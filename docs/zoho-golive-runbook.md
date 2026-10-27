# Zoho Books go-live runbook — who does what, in order

For Omar (owner) and Mathew (accounts). Today every document posts to **OFJ TEST** (organization 944122733).
Go-live means new documents start posting to the **REAL** book (organization 942979945) instead. Nothing is
re-typed: the ERP keeps doing the posting; this runbook is only about flipping where it posts.

---

## Step 1 — Mathew prepares the REAL book (in Zoho itself)

1. Sign in to Zoho Books and open the **real OFJ organization** (not OFJ TEST).
2. Open the ERP at **Settings → Zoho Books → Account mapping**. Every name shown on that page must exist in the
   REAL book's chart of accounts **with the same spelling** (Sales - Labour, Sales - Parts, the deposit accounts,
   Parts purchases, Courier, Commission, Recovery, the paid-from bank, and so on). Create any that are missing
   in Zoho: Accountant → Chart of Accounts → New Account.
3. Make sure the **5% VAT tax** exists in the REAL book (it does by default in a UAE organization).
4. Do **not** create customers, invoices or bills by hand — the ERP creates those itself after the flip.

## Step 2 — Mathew checks the TEST books are clean (in the ERP)

1. Open **/zoho** (the Zoho Books sync page). The red "Failed" filter must show **zero** rows. Every red row says
   in plain words what to fix (for example a supplier's missing TRN on Parts → Suppliers) — fix it, press **Retry**.
2. Open **Parts → Suppliers**: every supplier has their 15-digit TRN. A supplier who genuinely charges no VAT
   gets the **"VAT registered"** box unticked instead (then no TRN is needed).
3. Open **/zoho/reconciliation**. Press **"Check the missing days"** until the whole period is covered (it does up
   to 40 days per press). The last **seven days must all be green**. A red day shows the exact difference —
   usually a failed sync; fix it on /zoho, then press **Re-check** on that day.
4. Open **/zoho/close** for the last full month. Every line should be green, or understood (for example invoices
   that are genuinely still unpaid). The **Excel export** button gives the accountant a copy.
5. When the TEST books match and Mathew is satisfied, he presses **"I have reviewed the TEST books"** on the
   /zoho page — **from his own login**. (The button only appears for accounts; Omar cannot tick it for him.)

## Step 3 — Omar flips the switch (in the ERP)

1. Open **Settings → Zoho Books**, the **Go-live** panel. Six lines must all be green:
   - Mathew's review tick,
   - the mapping is complete,
   - every mapped name exists in the REAL book (checked live when the panel loads),
   - no failed syncs,
   - the last seven reconciliation days are green,
   - a start date is chosen.
2. Pick the **start date** — normally the 1st of the coming month. **Documents dated before the start date never
   post to the REAL book** (they stay in OFJ TEST, which keeps its history). So pick the date the real books
   should begin, agreed with Mathew.
3. Type **REAL** in the confirm box and press the button. It stays locked until every line above is green, and
   the server checks all six gates again at the moment of the press.
4. From that moment: new documents (dated on or after the start date) post to the REAL organization only, and
   **OFJ TEST is closed to writes**. The flip is logged with who and when, and accounts get a bell.

## Step 4 — the first days after the flip (Mathew)

- Watch **/zoho** daily. A red row says what to fix in plain words, then Retry.
- **/zoho/reconciliation** checks yesterday by itself every morning: red = the exact difference plus a bell to
  Omar and Mathew. It should be green every day.
- Before closing a month in Zoho, open **/zoho/close** for that month and clear every red line.

## If something goes wrong (Omar)

On the same Go-live panel there is **"Back to OFJ TEST"** — it needs a written reason and is logged. The sync
stops writing to the REAL book immediately; documents that already posted stay there (nothing is deleted).
Fix the problem, then flip forward again the same way (all six gates must be green again).

---

### What nobody needs to do

- No numbers are re-typed: the ERP's invoice, credit-note and receipt numbers are used as they are.
- Deposits stay unapplied in Zoho until their invoice exists, then the invoice takes them — automatic.
- Supplier bills carry the invoice's own figures, the courier as its own line, and the scan attached — automatic.
- The hourly sync runs by itself on the live server; **"Sync now"** on /zoho is only for impatience.
