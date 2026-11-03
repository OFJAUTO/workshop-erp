# Section 11 – Zoho Books: a manual button instead of sending by itself

Built 3 November 2026 (the 2 November evening list, section 11). Database change: `supabase/migrations/20261203180000_zoho_manual_sync.sql` (waits for "apply"; the main part works before it, see the end).

## What was wrong

- **Everything went to Zoho by itself.** A scheduled job ran every five minutes and sent whatever was waiting (25 at a time) to the Zoho book — no one saw what was about to go, or the totals, before it went.
- **Retry sent more than the one row.** Pressing Retry on one red row sent that row *and the next 25 waiting documents* with it, without a preview.
- **The daily reconciliation could write.** It is meant only to read Zoho, but if a mapped account name was missing in OFJ TEST it quietly created that account there.
- From the read-only check of 2 November evening: one supplier payment had been tried **638 times** by the five-minute job, because it waits for a bill that is red. Manual mode stops that.

## What changed

1. **Nothing goes to Zoho by itself any more (11.1).** From the moment this is live, the five-minute job only *counts* what waits ("Manual: 12 items waiting for Sync to Zoho") and keeps the read-only comparison of the books (every recent day that is due, see 6). It still runs every five minutes, so Settings > Background jobs never shows it as late.
2. **"Sync to Zoho" on the Zoho Books page (11.2)**, for the owner and accounts. Tap it and a window opens with:
   - which book it goes to (**OFJ TEST**, or **the REAL book in red** after go-live);
   - one line per kind with **how many and the total** of the documents that reach Zoho **for the first time**: Tax invoices, Payments and deposits, Credit notes, Customer refunds, Supplier bills, Supplier payments, Supplier credits, Card settlements, Expenses (commissions, recovery months), and the customer/supplier records; plus "Money in" and "Money out";
   - on their own lines, never in those totals: **Taken back out of Zoho** (a receipt voided, or "Paid to supplier" reversed, after it reached Zoho: Yes removes it from Zoho), **Already in Zoho** (looked at again: a late proof or scan is attached, an advance applied; no new money) and **Nothing goes to Zoho** (voided or cancelled before it was sent, or internal: the row closes);
   - a payment recorded in the last 10 minutes is **held back** (it can still be undone) and the window says when it can go;
   - documents tried before that still wait show their reason;
   - "See the 12 items" lists every one by name and amount;
   - then **Cancel** or **"Yes, send 12 items to OFJ TEST"**.
   Only the items shown are sent; something recorded after the window opened goes with the next press. On OFJ TEST one press sends at most 120 items (OFJ TEST allows 1,000 Zoho calls a day); the REAL book has no limit. Nothing can be sent while posting to the REAL book is stopped, or while someone else is sending (the window says who).
3. **The results, in the same window (11.3):** "12 posted · 1 removed from Zoho · 1 closed, nothing sent · 1 failed · 2 still waiting", then **Failed** (red, Zoho's reason, a **Retry** button and "Done by hand in Zoho…"), **Still waiting** (with the reason), **Removed from Zoho**, **Nothing sent** (with why), and **Posted ✓** (with Zoho's figures). Retry now sends **that one row only** — on the window and on the page's own list. Each sync is kept (once the database change is applied): "Last syncs" on the Zoho Books page, and each one re-opens with every row's present state. Red rows stay on the page's **Failed** list (every red row, however old) and on accounts' Waiting on you as before. A row the accountant already did by hand in Zoho that turned red again shows no Retry (it could post a second document): it is corrected in Zoho by hand and closed with "Done by hand".
4. **The daily reminder (11.4):** on working days, from opening time, accounts and the owner get one bell: **"12 items waiting to sync to Zoho"** with what they are ("5 tax invoices · 4 payments · 2 supplier bills · 1 card settlement. 1 red row needs a look.") — once a day, never on a day off, never when nothing waits. The bell opens the Sync to Zoho window directly (also when you are already on the Zoho Books page). The same line sits on Waiting on you (accounts and the owner) and as a number next to "Zoho Books" in the menu. These numbers count only what a press of Sync to Zoho would send: a document that waits for something else (for example a supplier payment whose bill is red) is named in one sentence ("1 supplier payment waits for something Sync to Zoho cannot do …: fix that first"), so pressing Sync always clears the number.
5. **The owner's switch (11.5):** "Sending to Zoho" on the Zoho Books page and on Settings > Zoho Books, owner only. **Switch to automatic** asks once ("every five minutes, 25 at a time, without a preview") and then the old behaviour comes back exactly; **Switch to manual** goes back. Every change is written to the change log with who and when, and accounts are told.
6. **The reconciliation only reads now,** and on manual it compares a day once that day's documents have been sent (otherwise a day would turn red just because nothing was sent yet). It looks back over the last ten days, a few days per run, so a day that had to wait — the Saturday before a Sunday off, a holiday — is compared right after the next Sync to Zoho even when it is no longer yesterday. The page's "Check every missing day" says how many days wait for Sync to Zoho.

Untouched: the go-live switch and its checklist, the start date, Stop/Resume, the rule that the REAL book is never written before go-live, the claim that stops two runs sending the same document.

## The lists

**Where things are now**

| What | Where |
|---|---|
| Sync to Zoho (preview, Yes, results, Retry) | Menu > Zoho Books > **Sync to Zoho** (the number on it = items waiting) |
| Manual / automatic switch (owner) | Zoho Books page > **Sending to Zoho** card, or Settings > Zoho Books |
| Past syncs | Zoho Books page > **Last syncs** (tap one) |
| Red rows | Zoho Books page > **Failed** filter, and Waiting on you |
| Daily reminder | The bell, at opening time on working days |

**Words that changed** (they used to promise automatic sending): the Zoho Books page line "The sync also runs by itself every five minutes"; the Backfill message; the LPO's "the bill then tries again by itself"; the supplier save's "Zoho items try again now"; the go-live and Resume messages; the reconciliation page's note; the go-live runbook (`docs/zoho-golive-runbook.md`).

## What staff must do

- **Mathew (accounts), every working day:** when the bell says "items waiting to sync to Zoho" (or the Zoho Books menu shows a number): open **Zoho Books**, press **Sync to Zoho**, check the counts and totals, press **Yes, send**. Leave the window open until the results show ("12 posted · …"), then press Close. If something is **Failed**, read the reason, fix it (for example the supplier's TRN or the account mapping) and press **Retry** next to it.
- **The go-live checklist** wants seven green reconciliation days: the usual Sync to Zoho on working days is enough — days off are compared by themselves after the next press.
- **Omar:** nothing to do unless you want automatic again — then **Zoho Books > Sending to Zoho > Switch to automatic > Yes**.

## Before and after the database change ("apply")

Before it: manual mode is already on, the button, the preview, the sending, the results in the window, the one-row Retry, the reminder and the owner's switch all work. Waiting for it: the stored history ("Last syncs", re-opening a past sync) and the "only one sync at a time" lock (two people pressing at once still never send the same document twice — each document is claimed while it is being sent).

## Review fixes (3 November 2026)

An independent review found six things; all are fixed:

1. **The preview counted money that was not new.** A receipt voided before the press, a receipt or supplier payment taken back after it reached Zoho, an advance applied later, a late proof or scan: each was added to its group's total and to Money in / Money out, and the results called them "Posted". Now one rule (`rowEffect` in `src/lib/zoho-sync-rules.ts`, the facts read by `src/lib/zoho-docs.ts`) sorts every row into *first post*, *already in Zoho*, *taken back out of Zoho* or *nothing goes*; only first posts are in the totals, the others have their own lines, and the results list *Removed from Zoho* and *Nothing sent* apart from *Posted*.
2. **A day before a day off was never compared.** The automatic comparison only ever looked at yesterday, so a Saturday that waited for Monday's Sync was skipped for good (no red bell, and the go-live checklist's seven days stayed open). It now walks back over the last ten days (`reconDaysDue`), three days per run, after every Sync and on every five-minute run.
3. **The reminder, the menu number and the Waiting line counted rows a press cannot move** (the live supplier payment waiting for its red bill since 31 October): it rang every day and stayed red. They now count only what a press would send (`sendsOnPress`); the rest is one sentence.
4. **The Failed list showed only red rows among the newest 400.** It now reads every red row from the database (and every waiting row under Waiting); the chips count in the database.
5. **Tapping the bell while already on Zoho Books did nothing.** The window now opens on every arrival of the bell's link.
6. **Retry could post a second document** for a row done by hand that turned red again. Retry is refused there (`retryRefusal`) and the button is hidden.

Proof: `tests/unit/zoho-sync-rules.test.mjs` (each case) and new steps in `tests/browser/test-s11-zoho-manual.mjs` (a voided receipt not in Money in, the removal and "nothing sent" lines and results, the button's number, an old red row past 401 newer rows, the hidden Retry, the bell tapped twice on Zoho Books).

## Integration (3 November 2026)

Two more things came up when this section was joined with sections 5 to 10 and run on the test server:

1. **Fix 5 above still failed on the first visit.** Opening Zoho Books from the bell's link worked, but a second tap of the bell on the same page did nothing. The page removed `?sync=1` from the address before Next had started watching the address, so Next still thought `?sync=1` was there. The page now waits one moment before removing it. The test (`test-s11`) taps the bell twice and both now open the window.
2. **A returned part's amount in the preview.** Section 7 credits a returned part at the supplier's credit note, invoice or LPO price, and sets the job's cost of the part to 0. The preview now reads the amount through the same rule (`returnCreditOf`), so it shows the amount the supplier credit will post. Before, it showed the part's first cost.
