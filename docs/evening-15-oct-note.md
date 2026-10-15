# Evening of 15 October 2026: our-stock parts missing, parts desk, parts editing, revise and declined

Migration `20261031090000_evening_15_oct.sql` (backup `backups/2026-10-15T14-59-22` first), proof test
`tests/browser/test-l.mjs` (`npm run test:l`, 42 checks). Every earlier suite still passes (test-k 55, test-h 65,
test-notify 55, test-d 89, test-c 67, test-j 18, test-i 55).

## 1. Our-stock parts missing from the quote (urgent)

**Cause.** A priced part only ever joined the job's *draft* quotation. On J-00111 the oil was added and priced at 10:52,
after Q-00005 had been sent; with no draft the line went nowhere, and the revision made at 14:31 copied the old lines.
Our stock had nothing to do with it: any part priced after sending was lost.

**Fix.** A priced part always finds a quotation to land on (`src/lib/quote-versions.ts`): the open draft when there is
one, otherwise the next version is started from the latest sent or approved one and the advisor is told "Parts changed
on J-xxxxx: send the revised quotation" with a one-tap link that opens the version with the send window ready.
Revising a quotation also pulls in any priced part that had no line. Our stock still skips the LPO and ordering only.

**Existing quotes.** Every open job's latest quotation was checked against its priced parts:
- **Q-00005 version 2 (J-00111, Dubai A 114 Land Rover Defender)**: ENGINE OIL 0W20 ×9 at AED 49 added to the draft,
  AED 463.05 on the line at the 5% minimum markup. History: "Parts added Engine oil - 0W20 ×9".
- No other open quotation had a missing part. No approved or invoiced quotation was affected, so there is nothing for
  the owner to decide.

**Safety check.** "Quotation complete" counts the priced parts against the quotation: "1 priced part is missing from
the quote" names it, with "Add it" (one tap, then the completion runs again) or "Leave it off" (logged in the history).

## 2. Cars never disappear from the parts desk

A search box at the top of the parts desk finds any car by plate, job number, VIN or customer name, gone-out cars
included. The "All cars" section at the bottom lists every open car with parts, newest first: plate, car, job number,
customer, the five parts-step dots and the status. Once every part is handed over the row turns green and stays until
the car has gone out; after that the search still finds it ("Gated out"). Tapping a row opens the car's parts page.

## 3. Parts add, edit or delete parts at any time; the quotation follows

- Before the quotation is sent: the change lands on the draft at once (normal markup). The quote history shows
  "Parts added ENGINE OIL 0W20 ×9", "Parts changed …" or "Parts removed …" with who did it.
- After it is sent but not approved: the change goes into the next version (a draft); the sent one is marked replaced;
  the advisor gets "Parts changed on J-xxxxx: send the revised quotation" with the one-tap link.
- After the customer approved: the same; the approved version stays approved until the customer approves the new one;
  work and ordered parts carry on.
- An ordered part cannot be deleted without choosing "Return to supplier" or "Keep in stock" (the two buttons in the
  remove window); it leaves the quotation either way and is written up on Parts without a home.
- Parts never see versions: they price, order and send out; the system handles the rest.

## 4. Revise quotation easy to find

"Revise quotation" is in the bottom bar next to "Send again" (always visible) and at the top next to Preview PDF. The
separate Revise box is gone. "Declined by the customer?" shrank to a small "Mark as declined" link; the reason box only
opens when tapped. Every page leaves room at the bottom (the main area ends with a 7 rem gap) so a fixed bar never
covers the last section.

## 5. After "Mark as declined", two clear choices

Straight after marking declined: "Revise quotation" (opens the next version at once) and "Proceed to gate-out". The
second makes the job "Declined, car going out": open parts requests are cancelled (Parts stop pricing them), unordered
parts leave the list, parts already on an LPO are put to Parts, the workshop manager gets "J-xxxxx declined: make sure
the car is put back together and ready for collection", and the car appears in gate-out as normal (photos, km, fuel,
signature). "Add a charge (optional)" under the button takes a name (DIAGNOSIS…) and an amount: a small tax invoice is
issued and must be paid before gate-out like any invoice. Without it the car goes out free, written on the job.

## Not done

Nothing on the list was left out. Two points worth knowing: the parts desk search looks at the plate number, the job
number, the VIN and the customer's name (not the phone); and a charge on a declined job is one line at the standard VAT.

## Assumptions

- "Already ordered" for a deleted part means on an LPO, ordered or received; a part merely marked to order is removed
  with Put back.
- The next version made by Parts copies the latest sent or approved version in full (lines, discount, commission,
  payment method, materials) and adds the priced parts with no line.
- An approved version stays approved until the customer approves the revised one (work carries on meanwhile).
- The declined job's status is "ready" underneath (so gate-out works unchanged) and shows as "Declined, car going out"
  on the job card and the gate-out page.
- The charge invoice is a tax invoice with one line in the services section at the standard VAT rate.
