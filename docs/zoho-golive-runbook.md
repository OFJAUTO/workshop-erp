# Zoho Books go-live runbook — who does what, in order

For Omar (owner) and Mathew (accounts). Today every document posts to **OFJ TEST** (organization 944122733).
Go-live means new documents post to the **REAL** book (O F J AUTOMOTIVE WORKS LLC, organization 942979945)
instead. Nothing is re-typed: the ERP keeps doing the posting. This runbook is only about moving where it posts.

The one idea to keep in mind: **the start date is the line between the two books.** Everything dated before it
stays in OFJ TEST's history (and reaches the REAL book only as Mathew's opening balances). Everything dated on or
after it posts to the REAL book by itself.

---

## Step 1 — Mathew prepares the REAL book (in Zoho itself)

1. Sign in to Zoho Books and open the **real OFJ organization** (not OFJ TEST).
2. In the ERP open **Settings → Zoho Books → Account mapping**. Every name on that page must exist in the REAL
   chart of accounts **spelt the same** (Sales - Labour, Sales - Parts, the deposit-to accounts, Parts purchases,
   Courier, Commission, Recovery, the paid-from bank, the refund account, and so on). Create any that are missing in
   Zoho: Accountant → Chart of Accounts → New Account.
3. The **5% VAT tax** must exist in the REAL book (it does by default in a UAE organization).
4. In Zoho: Settings → Invoices → set **Zoho's own invoice prefix to something other than INV-** (for example
   **Z-**). The ERP posts its own INV- numbers; the go-live panel checks this live.
5. On the mapping page, the four **"Supplier payments by bank transfer / card / cash / cheque"** boxes say which
   account each supplier payment leaves from (an empty box uses the general "Paid from" account).
6. The two clearing accounts (**Card machine clearing**, **Payment link clearing**) must be created as **Bank**
   accounts in Zoho (Banking → Add Bank or Credit Card): card and link money lands there at its full amount, and each
   card settlement moves what arrived to the bank with a transfer (Zoho only transfers between bank-type accounts)
   and books the actual fee on **Bank Fees and Charges**.
7. Do **not** create customers, invoices or bills by hand for anything from the start date on — the ERP does that.

## Step 2 — Mathew checks the TEST books are clean (in the ERP)

1. Open **/zoho** (the Zoho Books sync page). The **Failed** filter must show **zero** rows. Each red row says in
   plain words what to fix (often a supplier's TRN on **Parts → Suppliers**, or the "VAT registered" tick for a
   supplier who charges no VAT) — fix it and press **Retry**. A row that was settled in Zoho by hand (a void, a
   correction) is closed with **"Done by hand in Zoho…"**: type what was done, press **Close the row**.
2. Open **/zoho/reconciliation**. Press **"Check every missing day"** until every day is covered (40 days per
   press). **The last seven calendar days must all be green.** A red day names the exact difference — usually a
   failed row on /zoho; fix it, then press **Re-check** on that day.
3. Open **/zoho/close** for the last full month. Every line should be green or understood (invoices genuinely still
   unpaid, for example). **Excel export** gives the accountant a copy.
4. When the TEST books match and he is satisfied, Mathew presses **"The review is done"** on /zoho — **from his own
   login** (the button only exists for accounts). *Mathew ticked this on 27 October 2026 at 09:16.*

## Step 3 — Omar chooses the start date (in the ERP)

1. Open **Settings → Zoho Books**, the **Go-live** panel.
2. Under **Go-live start date** pick the first day the REAL book owns — it must be the **1st of a month** (likely
   1 December) — and press **Save the date**. Agree it with Mathew: it is the date of his opening balances.
3. **No live Zoho tests in the 7 days before the flip:** their documents stay in OFJ TEST and keep those days red.
   If one ran, the panel shows a red warning with the first safe day.
4. The switch stays **locked until that day arrives** (a flip before it would leave the days in between in neither
   book). Flipping a few days *after* the start date is fine: the flip posts everything from the start date that was
   already made in the ERP into the REAL book.

## Step 4 — Omar flips the switch (on the start date, or after it)

1. On the same panel, seven lines must all be green:
   - Mathew's review tick;
   - the mapping is complete;
   - every mapped name exists in the REAL book (checked live when the panel opens);
   - Zoho's own invoice prefix is not INV- (checked live);
   - no failed syncs;
   - the last seven calendar days reconciled green;
   - the start date is chosen (the 1st of a month) and has arrived.
2. Type **REAL** in the confirm box and press **Go live on the REAL organization**. The server checks all six lines
   again at that moment, and refuses if the sync is posting a document right then ("try again in a minute").
3. What the button does — **once in the life of the books**, in one step that cannot half-happen:
   - OFJ TEST's queue is put away (archived — nothing is lost), and every Zoho reference the ERP held (all of them
     OFJ TEST's) is cleared, so nothing from the trial book can leak into the real one;
   - the day-by-day comparisons from the start date are cleared (they were made against OFJ TEST; those days now
     belong to the REAL book and are checked again);
   - the switch turns on: from now on only the REAL book is written, and **OFJ TEST is closed for good**;
   - every document dated from the start date is queued for the REAL book (the message says how many), and the
     five-minute sync posts them — customers and suppliers are created (or found) in the REAL book as each document
     needs them;
   - every document dated **before** the start date that never reached OFJ TEST (it was still waiting there, for
     example a supplier credit waiting for a bill) is shown **red** on /zoho, to be entered by hand.
4. The flip is logged with who and when, and Omar and Mathew get a bell. If the queuing part ever fails, the panel
   and the sync page show a red line and a button **"Finish the go-live queue"** — press it (nothing is ever queued
   twice).
5. When the sync page shows nothing waiting (usually within the hour), Mathew opens **/zoho/reconciliation** and
   presses **"Check every missing day"**: the days from the start date are compared with the REAL book.

## Step 5 — Mathew, on the start date and the days after

1. **Opening balances.** Documents dated before the start date never post automatically. Open **/zoho/close** for
   the month before the start date: its **unpaid tax invoices**, **deposits held on open jobs** and **supplier bills
   unpaid** are exactly the opening balances to enter by hand in the REAL book.
2. **Red rows on /zoho are the by-hand list.** Each says what to do in Zoho; once done, press **"Done by hand in
   Zoho…"**, type what was done, **Close the row**. The cases:
   - a payment received after go-live on an invoice from before it — it DID post (unapplied): apply it to the
     opening-balance invoice in Zoho;
   - an invoice from after go-live whose deposit was taken before it — the invoice DID post: apply the opening
     advance to it in Zoho (otherwise the REAL book shows that money as still owed);
   - a supplier credit on a bill from before go-live — it DID post (unapplied): apply it to the opening bill;
   - a credit note, refund or supplier payment against a document from before go-live, a supplier invoice typed late
     with an old date, or anything dated before the start that never reached OFJ TEST — nothing posted: enter it by
     hand;
   - a void, a bounced cheque or a corrected supplier invoice on a document from before go-live — it sits in the
     opening balances: correct it there by hand (these rows refuse Retry on purpose: re-running could post the
     document a second time);
   - closing an invoice with "Done by hand" also turns red every payment of it that had already posted (unapplied):
     apply each to the invoice in Zoho by hand.
3. Watch **/zoho** daily. **/zoho/reconciliation** checks yesterday by itself every morning (from 00:30, once the
   queue has caught up), re-checks a red day every hour, and compares each day with the book that owns it — OFJ TEST
   before the start date, REAL from it. A day that turns red rings one bell.
4. Before closing a month in Zoho, open **/zoho/close** for it and clear every red line.

## If something goes wrong (Omar)

On the same panel, **"Stop posting to the REAL book"** needs a written reason and is logged; accounts get a bell.
It is a pause: nothing is written to any Zoho book (OFJ TEST stays closed — the go-live switch runs only once), and
every new document waits in the queue. **Nothing already posted is removed.** When the problem is fixed, type
**REAL** and press **"Resume posting to the REAL book"**: the waiting documents post in order.

---

### What nobody needs to do

- No numbers are re-typed: the ERP's invoice, credit-note and receipt numbers are used as they are.
- Deposits stay unapplied in Zoho until their invoice exists; then the invoice takes them.
- Supplier bills carry the supplier's own figures, the courier as its own line and the scan attached; a supplier
  credit (a part returned to the supplier) waits for its bill and is applied to it.
- The sync runs by itself every five minutes on the live server; **Sync now** on /zoho is only for impatience.

### Paying a supplier (accounts)

On the LPO page, **Paid to supplier** asks how it was paid — **Bank transfer** (the default), **Card**, **Cash** or
**Cheque** — an optional reference, and the **proof** (bank slip, card slip, signed receipt or cheque copy). The
line under the method buttons shows which account each method pays from. No proof at hand? Mark it paid anyway: the
LPO then shows **Proof missing** with an **Upload the proof** button. In Zoho the supplier payment carries that
method, comes out of that account, and the proof is attached.
