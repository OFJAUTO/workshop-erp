# Section 5 (2 November 2026, evening; built 3 November): the auth code is optional, made-up codes are flagged, and the bank report fills it in

For: the owner, Mathew and Aleemath (accounts), and the service advisors.

## What was wrong

On 2 November a part payment of AED 30,000 by payment link was recorded on J-00969 (RCT-00040). There was no auth code to hand, but the Record payment window would not save without one, so **"111111" was typed** just to get past the box.

**The cause, in one line:** the auth code box was *required* on every card and payment-link payment, in the window, on the money page and in the deposit panel. Nothing recognised a code that was clearly made up.

What that meant:

- "111111" sits on RCT-00040 as if it were the bank's code, and the customer's receipt prints **"Auth code 111111"**.
- The next payment typed with "111111" within 60 days would have been **refused** as "already on RCT-00040".
- The bank's settlement report never filled a code in. A payment with no real code could only be matched to the bank's line by picking it by hand.
- A payment already settled by hand (RCT-00040 is in STL-00004) was invisible to a later bank report. Its line could only be marked "Not ours".

## What changed

1. **The auth code is optional everywhere.** This covers the Record payment window, the money page, the invoice page, the deposit panel, and the advisors' "Payment received – send to accounts". The box reads **"Auth code (optional)"** with **"Optional – helps match the bank report"** under it. A code of the wrong length (1 to 5 characters) is still refused, with the words "leave it empty if you don't have it".
2. **Made-up codes are recognised.** These count as made up:
   - one character six times (111111, 000000, 999999, AAAAAA);
   - a straight run of digits up or down (123456, 012345, 654321, 987654 …);
   - a few patterns (121212, 123123, 112233, ABCDEF, ABC123, QWERTY).

   When someone types one, an amber line says: "111111 is not a real code: the payment is saved as 'Auth code missing'." The payment **is saved**, but the made-up code is never stored. The job's history keeps what was typed ("auth code missing (111111 typed, not a real code)").
3. **The question before Record says it plainly.** For example: "Record payment of AED 30,000.00 · as an advance on the job · Payment link · **auth code missing (flagged)**". The deposit panel and the full-payment question say the same.
4. **"Auth code missing" is an amber flag inside the ERP only.** It never appears on anything the customer sees.
   - Where it shows: next to the payment on the money page (/jobs/…/invoice) and on the invoice page (/invoices/…). On Invoices and payments it shows as a line under the car's row: receipt, amount, method and time.
   - The owner and accounts get **"Add auth code"** beside the flag. Advisors see the flag but cannot add the code.
   - On Card settlements the payment reads "auth missing" instead of a code. The receipt PDF prints the code only when it is a real one, so **RCT-00040's receipt no longer shows "111111"**.
5. **New chip on Invoices and payments: "Auth code missing".** It lists every car (or customer credit, or pending charge) with a card or link payment that has no real code. A car stays on this list until the code is added, even if it has left paid in full. The chip counts its rows. The heading under it also says how many payments those rows hold.
6. **"Add auth code" (owner and accounts).** Type the real code and press Save. Nothing is recorded again: the receipt number, the settlement, the bank fees, the balances and Zoho Books (which never receives auth codes) stay exactly as they are. A made-up code is refused right beside the box, in red ("111111 is not a real code: type the code from the payment confirmation."), and Save stays off until a real one is typed. A code already on another receipt is refused, naming that receipt. The change is written in the change log (who, the code, what it was, "by hand") and in the job's history.
   - On the money page, the invoice page and the lists of money not allocated (customer page, car page, job card, money page, the "Unallocated payments" card), the saved code then shows in the same place as "Auth 219769".
   - On Invoices and payments and the accounts dashboard, the save takes the amber line away (under the "Auth code missing" chip the whole row leaves the list), so the answer opens in a **centre window**: "Auth code saved ✓ · Auth 219769 saved on RCT-00040." with **OK**.
7. **The bank report fills the code in (Card settlements → Upload the settlement report).** Some lines carry a code that no payment has. When **one** payment with a missing code fits such a line, the line reads **"Suggested match"**. "Fits" means the same amount to the fils, the same method (or the line does not say), and dates no more than 3 days apart. For example: "Suggested match: RCT-00040 · AED 30,000.00 · payment link · 1 day apart · its auth code is missing".
   - One tap on **"Confirm – save auth 4X7Q21 on RCT-00040"** saves the bank's code on the payment. The change log records it as "from the bank report <file>, line n". The line turns "Matched ✓".
   - A suggestion is only ever **one to one**: the line fits exactly one payment AND that payment fits no other line of the report. When **two or more** payments could fit a line, or **one payment fits two lines** (two AED 750 inspection fees on the same day, say), nothing is suggested: the words say so ("RCT-… has its auth code missing and fits this line and line 2 alike"), and those payments are first in the list to pick from. The same check runs again when Confirm is pressed.
   - Picking a missing-code payment by hand works too: the line says "Auth … will be saved on RCT-… when you record", and Record saves it.
8. **Payments settled by hand are recognised on the report.** A line whose payment is already in a settlement typed in earlier (like STL-00004 for RCT-00040) reads **"Already settled in STL-… ✓"**. It counts as handled and is never settled twice. A report with nothing new reads "Nothing new to record: every payment on this report was already settled" when you press Record.
   - When a line could be one of several payments and one of them is already settled by hand, that one is offered in the list too, as "RCT-00040 · … · already settled in STL-00004". Picked, the line counts as handled, nothing new is recorded for it, and the bank's code is saved on RCT-00040 when you press Record. The other payment is left waiting.
   - A recorded report opened again (or right after Record) still shows those lines as "already settled in STL-…", never "Not ours".
   - Excel files: a report saved again in Excel has real date cells, which the spreadsheet prints as "10/24/26". These are now read as 24 October 2026 (before, the review page crashed with an error).
9. **Accounts export.** The Payments sheet has an **"Auth code"** column: the code, or "missing".

## The list asked for

- **Flag RCT-00040 now:** done by the rule itself, with **no change to the live data**. "111111" stays in the column, so the change log keeps it. From the deploy, RCT-00040 reads "Auth code missing" on J-00969's money page and under the "Auth code missing" chip, and its receipt prints no code. Source: the research read of the live database on 2 November. RCT-00040 was then the only card or link payment with an empty or made-up code out of 7.
- **Every card and link payment by 2 November** (live, read 2 November):

| Receipt | Method | Code | After this change |
|---|---|---|---|
| RCT-00036 | link | 756117 | real – shown |
| RCT-00037 | link | 004977 | real – shown |
| RCT-00038 | link | HKTGJK | real – shown |
| RCT-00039 | card | 873553 | real – shown |
| **RCT-00040** | **link** | **111111** | **Auth code missing (flagged)** |
| RCT-00041 | card | B0A60C | real – shown |
| RCT-00042 | link | 041975 | real – shown |

## What staff must do

- **Accounts:** open Invoices and payments → **Auth code missing**. For each line, find the code on the card slip or the payment confirmation and press **Add auth code**. For RCT-00040 there is a second way: when the bank's settlement report covering 2 November is uploaded on Card settlements, its line shows "Suggested match: RCT-00040 … settled in STL-00004". One tap on **Confirm** saves the bank's code, and the line then reads "Already settled in STL-00004 ✓".
- **Everyone recording money:** if you do not have the code, **leave the box empty**. Never type a made-up code: it is not saved anyway, and the payment is flagged the same way.
- **Advisors (Payment received – send to accounts):** type the code if you have it, or leave it empty. A made-up code is ignored and never reaches accounts' box.

## Notes

- **No database change.** The flag is worked out from the code itself, so nothing waits for "apply".
- A real bank code that happens to look made up (about 1 in 100,000) shows the amber flag too. It cannot be added by hand or suggested from the bank report, so that payment simply keeps its amber flag: nothing else depends on it.
- Correcting a code that is already real (a typing slip) is not part of this change.
- The made-up list is fixed in the program, not a setting.
- Tests: `npm run test:s5-authcode` (on the test database with test payments only; sections A-I, the review's G, H and I included), `test:fees3` (rewritten to the optional box), `test:mtr`, `test:unit`. All other money tests (s3, s4, payanytime, m, paymethods, fees4, fees5, settle) are green.

## Review fixes (3 November 2026)

An independent review found seven points; all are fixed:

1. Two missing-code payments fit a report line and one was settled by hand: the words said "pick it", but the settled one could not be picked, so the wrong (open) payment could be settled. Now the settled one is offered as "already settled in STL-…" and picked it fills its code.
2. Money not allocated (on a customer's account) had no amber flag in its own list. It has now, with Add auth code.
3. A suggestion could put another payment's bank code on the wrong receipt when two lines fit one payment (the first line in the file won). Suggestions are now one to one, and Confirm checks it again.
4. A recorded report showed its "already settled" lines as "Not ours". Fixed (also after a reload).
5. The Add auth code box said a made-up code "is saved as missing", then the server refused it. The box now says what the server says, and Save waits.
6. and 7. On the money lists the "✓ Auth … saved" answer disappeared with the row it was on. It now opens a centre window.
8. An Excel report with real date cells crashed the review page ("Invalid time value"). The dates are read correctly, an impossible date is no date, and the review can never crash on one.

Proof (TEST database, production test server): `npm run test:s5-authcode` 49/49 (new sections G, H, I), `test:fees5` 16/16, `test:fees3` 15/15, `test:payanytime` 75/75, `test:mtr` and `test:unit` all passed, `test:security` passed, the layout check of the changed pages (accounts and owner, 800×1280 and 1440×900, with a seeded report) and the pop-up check (210 shots, the new "Auth code saved" window included) found nothing. Screenshots: `tests/browser/shots/s5-authcode/` (G2, G5, H2, I3) and `tests/browser/shots/layout/popup-auth-code-saved-money-list--*.png`.
