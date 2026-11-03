# Section 3 (2 November 2026, evening): payment hand-over

For: the owner, Mathew and Aleemath (accounts), and the advisors.

## What was wrong

Example: J-00969, the PROFORMA box on the job card reading "Total AED 37,930.00 · Paid so far · Balance".

**The cause, in one line:** the job card hides "Record payment" whenever the owner uses **View as**. The rule is `can(role, "recordPayments") && !staff.viewingAs`. On top of that, accounts have no Jobs or Cars menu, so they never reach the job card.

Checked on the test server with a real accounts login on a copy of J-00969 (the owner records an advance first):

- Accounts **do** see Record payment in the money box, next to "Paid so far AED 300.00 · Balance AED 645.00".
- The owner in View as accounts sees nothing there.

So the owner only ever saw his own button. Accounts used the button at the top of Invoices and payments. That window opened with no car chosen and the search rows showed no car or balance, so it never said which car or customer the money was for.

Advisors had no way to pass a payment they took at the counter to accounts. The only option was the old "Customer says paid" button: no amount, no photo, and only once a proforma had been sent. It was never used on live.

## What changed

1. **View as.** The owner looking as accounts now sees the same Record payment button, greyed, with "View as is read-only – use Act as to record". This applies on the job card, the money page, the car page, the customer page and Invoices and payments.
2. **Accounts reach the job card.** Every car row on Invoices and payments and on the accounts dashboard has a **Job card** link. So does every line on accounts' Waiting on you and every result in the Record payment window. No menu items were added.
3. **The Record payment window's search.** Each result now shows:
   - the car's picture
   - the plate and the make and model
   - the customer
   - the job number
   - what is left to pay: "Balance AED 7,930.00", "Paid in full", "No approved total yet", or "No open job" with any credit

   The plate can be typed the way people say it ("GG 13706", "W 64762"). Before, only the number matched, because the code and the number are kept apart. The top search has the same fix.
4. **Advisors: "Payment received – send to accounts"** in the job card's money box. It is also on the money page, under "Customer says paid". The advisor fills in:
   - the amount (already filled with the balance)
   - how the customer paid (cash, card, payment link, bank transfer, cheque)
   - the auth code or reference, if he has it
   - **a photo of the slip, receipt or transfer (required)**
   - a note

   The window answers "Sent to accounts ✓". Advisors still cannot record money.
5. **Accounts and the owner are told at once.** They get a bell, and a line on Waiting on you in exactly this form: "J-00969 · DUBAI GG 13706 · MERCEDES-BENZ S 580 · \<customer\> · AED 37,930.00 · Card · from Anas". The line shows the slip photo and two buttons:
   - **Record** opens the Record payment window already filled in: the job, the method, the amount, the auth code or reference, and the slip as the proof. Accounts check it against the bank, type the auth code if the advisor had none, and confirm in the usual question. One report makes one receipt, never two.
   - **Query** sends it back with a comment. One-tap reasons: "Not in the bank yet", "Photo unclear", "Amount differs", "Auth code missing", "Already recorded".

   The same reports also show:
   - in a "Payments reported by advisors" box on the accounts dashboard and on Invoices and payments;
   - under the "Customer says paid / reported" filter.
6. **The advisor is told** "Recorded ✓ RCT-…" or gets the query. While a report waits, the job card shows in amber "Payment reported by Anas · … · waiting for accounts". A query shows in red with **Send again** (the first photo goes with it) and **Withdraw**. The money chip reads "Payment reported by Anas, checking". If accounts record the same amount and method straight from the money page, the report closes by itself. If accounts Undo the receipt, the report waits again and the advisor is told.
7. **Reminder.** A report not recorded or queried within **4 working hours** (opening hours only, breaks out) sends one bell to accounts and the owner. Its line turns red. You can change the hours in **Settings > Money**: "Remind about a reported payment after … working hours".
8. **Side fix.** The advisor's "Send payment link" WhatsApp opened with no phone number. The number is there again.
9. **Removed.** The old "Confirm today's counter payments" box on the accounts screens. It was empty, because advisors cannot record money. The reports box is in its place.

## Fixes after the independent check (3 November 2026)

A second person checked this work and found 13 problems. All are fixed and tested (`npm run test:s3-payreport`, new section H).

1. **The big button on the job card now opens the advisor's payment.** When a report waits, the money box's main button reads **Record the reported payment** and opens the window filled in with his slip. Before, it opened an empty window. That could lead to the same money being recorded twice.
2. **The window opened on a report offers only that car.** If the money is really something else, press **Record a different payment instead (this report keeps waiting)**. If the advisor put it on the wrong car, press **Query**.
3. **On the money page** (Payments and invoice), while a report waits, the page's own payment form is folded under **Record a different payment (not the one Anas reported)**. The report's **Record it** is the obvious button.
4. **A different payment never closes the advisor's report.** Example: two card payments of AED 5,000 on the same car. Accounts record the second one, with auth code 222222. The advisor's report with auth code 111111 stays waiting. A report closes by itself only when the amount and method match and the auth code or reference does not say otherwise.
5. **A queried payment that turns up later closes itself.** Example: accounts query a transfer with "Not in the bank yet", and the money arrives the next day. When accounts record it (same amount and method), the advisor is told "Recorded ✓ RCT-… · the query is settled". If the advisor presses **Send again** after money was recorded on the car since the query, he is asked first: "RCT-… was recorded on this car after the query. Is this a different payment?"
6. **A voided receipt reopens the report.** If the owner or the head accountant voids a receipt made from an advisor's report, the report waits for accounts again. The advisor is told "Receipt voided · your payment … waits for accounts again". The job card never shows a green "Recorded ✓" on a voided receipt.
7. **PDF and video slips.** A bank transfer confirmation sent as a PDF shows as a **PDF** tile that opens the file in a new tab. A video plays in the viewer. Before, both showed as a broken picture.
8. **One rule for the advisor's button.** It shows on the job card and on the money page alike whenever something is still owed, including a car that left on credit. A car paid in full has no button on either page.
9. **The search in the Record payment window.** A customer found by name or mobile now shows each of their cars: the open job, else a job that left still owing, else the car alone ("No open job · nothing owed"). "No car on record" now only shows for a customer with no car at all. A car whose last visit left with nothing to pay is no longer offered as the place for new money.
10. **View as accounts on the money page.** The owner now sees the greyed **Record payment** button in every state: car gone owing, proforma not sent yet, sent and unpaid, deposit. Before, some states said "Waiting for accounts to record the payment" instead.
11. **A copied tab cannot swallow a second payment.** If the advisor's window was already used to send AED 1,000 cash and he sends a different payment from a copy of it, he is told so in plain words. Nothing is sent, the window starts fresh, and he attaches the photo again. Before, it said "Sent ✓" and the second payment was lost.
12. **Auth codes and references stay on one line** in the payment lines.

Nothing on live was changed. These fixes need no database change beyond the waiting migration.

## Lists

Nothing on live was changed or corrected. The new table starts empty. The live database was read once, read-only, for the backup.

## Database change: WAITING FOR APPLY

Migration `20261203110000_payment_reports.sql` (backup `backups/2026-11-02T21-55-08`). It adds:

- the reports table: logged-in owner, accounts and advisors may read it; only the server writes it;
- the photo kind for the slip;
- the 4-hour setting.

Until you reply **"apply"**:

- the advisors' button is not shown;
- the View as greyed button, the Job card links and the new search already work.

## What staff do

- **Advisors:** when a customer pays you at the counter, take a photo of the slip, receipt or transfer screen. Then press **Payment received – send to accounts** on the job card, check the amount and method, add the photo and send it. Do not wait for accounts. If they query it, the job card shows the comment in red: press **Send again** or **Withdraw**.
- **Mathew and Aleemath:** open **Waiting on you** (or the bell). Press **Record** on the line, check the slip against the bank, type the auth code if it is missing, and confirm. If something is wrong, press **Query** and say what.
- **Owner:** you get the same lines and bells. In View as, the Record buttons are greyed. Use Act as to record for someone.
