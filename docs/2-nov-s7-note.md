# Removing an ordered part (2 November 2026 list, section 7; built 3 November)

## What was wrong (7.1)

On J-00969 the FRONT LH GRILL SURROUND MOULDING was ordered on LPO-00037-1 (from "OFJ Additional", AED 1.00, nothing delivered). On 2 November at 05:42 "Remove: not needed (ordered: choose its ending)" was pressed and the window closed as if it had worked. The part stayed "Ordered", stayed on LPO-00037-1 and stayed in "Our cost". Three things were wrong at once:

1. **"Return to supplier" could never work from the Parts table.** Recording a return needed a credit note number or its scan, but the Parts window had no box for one, so the save was always refused. For a part that was never delivered there could not be a credit note anyway. The real ending, "Cancelled with the supplier", did not exist at all.
2. **The refusal was hidden and only half the change was saved.** The window closed BEFORE the server answered. The refusal then appeared as tiny red text at the far end of the row. By then "not needed" was already saved, so a second try only said "Already marked not needed". Nothing was written to the error log.
3. **Even a successful ending changed nothing you look at.** No step touched the part's order status, its LPO line, the LPO total, the job's cost or the quotation. The page reads "Ordered", the LPO and Our cost from exactly those, so the part could only stay as it was.

The same chain had more faults:
- "Keep in stock" put a part that never arrived straight onto the shelf.
- A part that was never delivered was marked "back with Parts".
- The advisor and the workshop manager were never told.
- The goodwill approval Peter asked for at 08:47 could not be reached: the Returns and leftovers list left out every part waiting for the owner.
- A part marked "back with Parts" quietly came off the customer's bill. On J-00969 that would have changed the approved price of Q-00039 (AED 871.00 less) without anyone revising it.

## What changed (7.2 and 7.3)

**The three endings.** One rule decides which ending fits. The window greys the others and says why:

| The part | Cancelled with the supplier | Return to supplier | Keep in stock |
|---|---|---|---|
| Ordered, nothing delivered (J-00969's grill) | **yes** | greyed: "Not delivered yet: nothing to return" | greyed: "nothing to put on the shelf" |
| Approved, not ordered yet | **yes** (it comes off the order list and off an LPO still waiting) | greyed | greyed |
| Delivered (or partly: the rest is cancelled with the supplier) | greyed: "Already delivered" | **yes** | **yes** |
| Taken from our own shelf | – | greyed | **yes** (back on the shelf) |
| With the technician | "bring it back to Parts first" | | |
| Wrong or faulty, being exchanged | keeps its own ending on Returns and leftovers (back to the supplier with the credit note) | | |
| Replaced by another supplier's part (Replace) | takes the same endings as any part not needed (it is not "being exchanged") | | |

**After Save** (Parts table, Returns and leftovers, the handover page; one ending function behind all three):
- **The row greys** and reads **"Removed – Cancelled with the supplier by Omar: Not required for this job"**. The "Ordered" chip and the Put back button are gone, and the line total shows a dash.
- **The job's cost:** the part leaves Our cost. Its cost on the job becomes 0, so the profit, the invoice's internal cost and the parts check PDF follow. A **proforma already made** for the car follows too: its internal cost of the part goes to 0, so the tax invoice it becomes copies 0 (the customer's figures do not change). A **tax invoice already issued** is never changed from here: the owner gets "Cost correction needed · J-…" with the part and its cost, and the answer says so.
- **The LPO:**
  - A **cancelled** line comes off the LPO. The LPO card shows it crossed out ("Cancelled – not delivered") and the total goes down ("AED 150.00 before VAT · 1 line cancelled"). An LPO with no line left is **cancelled** and stays in sight, greyed, under "Cancelled LPOs". Each change is written in the LPO's notes.
  - A **returned** or **kept** line was delivered and invoiced, so it stays on the LPO, marked "Returned – credit note awaited" or "Kept in our stock". The card shows "Returns −AED x (supplier credit) · net AED y".
- **The supplier:** after a cancellation or a return the window shows the message for the supplier ("Please cancel: …" or "We are returning: … Please send the credit note.") with a **Copy** button. A part only **partly delivered** (say 1 of 4) asks the supplier to cancel the rest as well ("Please cancel (not delivered): … × 3"), whether the one that came is returned or kept in stock.
- **An LPO left with only a courier or freight charge** (every part on it cancelled after it was ordered) stays ordered at the charge, because the supplier may still bill it. If the supplier waives it, tap **Waived – remove** next to the charge under **Supplier charges** on the car's Parts page: the charge comes off and the LPO, now empty, is cancelled. The answer shows next to the charge.
- **Stock:** "Keep in stock" puts the part on the shelf at what it cost. The stock item's count and average cost go up.
- **Return to supplier is tracked.** With the credit note in hand (number and/or scan) the return is complete at once. Without it, the part waits on **Returns and leftovers > Waiting for a supplier credit note**: part, car, supplier, LPO, the amount to be credited and the days waiting (amber after 7 days). **Record the credit note** later (number or scan, plus the amount and date when known) completes it. It then goes to Zoho Books as a supplier credit. The amount credited is what the supplier **billed** for the part: the amount typed from the supplier's credit note when there is one, else the price on the supplier's invoice, else the LPO price (never the job's cost, which the ending set to 0). "To be credited" on the list uses the same figure. On the car's Parts page the row carries an amber "Credit note awaited" tag; **⋯ > Record the credit note** opens the list at that part. The Parts desk's "Returns and leftovers (n)" count includes these.
- **Quotation:** if the part was on a quotation the customer **approved**, the approved price is **never changed**. The line stays on the quotation and on the bill until a revised quotation is approved by the customer. Everything below happens on **the quotation that charges the part**, never on another quotation of the same car (an additional quotation approved later, or one still being prepared). The advisor gets a bell: "Part removed after approval · J-00969: revise the quotation" with the part, its AED on the quotation and the ending. The owner is asked to allow the revision, as for any change from Parts (if he had already allowed one, the new version is made at once for the advisor to send). The revised version leaves the part off by itself. If the quotation is still a draft, the line simply leaves it. If it was sent but not answered yet, a new version without the part is made for the advisor to send. If a **tax invoice is already issued**, the quotation cannot change any more: Parts and the advisor read "the owner settles the difference with a credit note" (never "revise"), and the owner is told. The workshop manager hears of every ending; his bell opens the car's work order.
- **7.3, if saving fails:** the window stays open with "Saving…" until the server answers. An error shows in red inside the window, under the buttons: "Couldn't save – nothing was recorded. Try again or tell the owner." Nothing is half done, because every step is checked and a failed step puts the earlier steps back. The technical error goes to the error log (app_errors). If two people end the same part at once, the second is told so and nothing is saved twice. A lost connection says "Not saved: no connection. Nothing was changed – try again."
- **The same on Returns and leftovers and the Hand over page:** "Save the ending" and "Record the credit note" wait for the server. A refusal or a failed save shows in red **inside the card that was tapped** (the page never jumps to words at the top), and the next tap works at once. A saved ending opens a window on the page with what happened and the message for the supplier (Copy), because the card itself leaves the list.

**Small fixes on the way**
- Returns and leftovers now lists the parts waiting for the owner's goodwill approval, with his **Approve** button. Peter's request on J-00969 had been invisible. Such a part can also be given its real ending instead.
- A line no longer leaves the customer's bill because its part went back to the supplier. Only a revised quotation the customer approved takes a line off.
- A supplier invoice price entered later never puts an ended part's cost back on the job.
- A part with an ending cannot be put back, edited or replaced from an old screen.
- Every stock movement now says when it did not save.
- Zoho Books: the owner's Backfill and the go-live replay now include parts returned through an ending (they leave the job, and the old search looked at parts still on it only).
- A part not needed and then replaced by another supplier's part no longer shows the old "Where does it go?" with "Moved to stock" for a part that never arrived.

## Lists the owner asked for

From reading the code and the research of 2 November (read only; no new live read for this note):
- **J-00969, FRONT LH GRILL SURROUND MOULDING** (LPO-00037-1, nothing delivered, Peter's goodwill request open): fitting ending **Cancelled with the supplier**. Result: LPO-00037-1 goes to AED 0.00 and is cancelled (it was its only line); Our cost −AED 1.05 with VAT; the line on Q-00039 (AED 871.00) stays until a revised quotation is approved; the advisor is told, the owner is asked.
- **J-00317, Transmission mount**: marked not needed on 31 October, never ordered, no ending. It now shows on Returns and leftovers with **Cancelled with the supplier**.
- Nothing else on live had "not needed" with an ending missing (research of 2 November: only these two parts carried "not needed").

## What staff must do

1. **J-00969 (Peter or the owner):** open the car's Parts page. On the GRILL SURROUND MOULDING row tap **⋯ > Remove: not needed (ordered: choose its ending)**, keep **Cancelled with the supplier**, tap a reason (or type "Not required for this job"), then **Save the ending**. Copy the message for OFJ Additional if needed, then tap Close. Then the advisor revises Q-00039 once the owner allows it, and sends it to the customer.
2. **J-00317 (Peter):** on **Parts > Returns and leftovers**, give the Transmission mount its ending (**Cancelled with the supplier**, then **Save the ending**).
3. **From now on:** when a supplier sends the credit note for a returned part, open **Returns and leftovers > Waiting for a supplier credit note** and tap **Record the credit note** (number, or a photo of it).

## Database

Migration `20261203140000_part_endings.sql` (waiting for "apply"). **Everything works without it, from the deploy.** Before it, a cancellation or a return still waiting for its credit note is stored in the existing columns, and the credit note's number goes in the old note field. The migration:
- names the two new states;
- adds the credit note's own columns (number, amount, date, who and when);
- names the endings already saved the old way;
- adds an index for the waiting list.

It creates no table and no function.

## Tests

- Unit: `tests/unit/part-endings.test.mjs` (51 checks, all passed): which endings fit each kind of part (a replaced part included), how they are stored before and after the migration, the LPO after a line ends, the words on screen and for the supplier (the rest of a part only partly delivered), what a return is credited at.
- Browser (to run on the TEST server): `tests/browser/test-s7-remove.mjs`. It covers: an ordered part on an approved quotation cancelled, with an additional quotation approved later left alone and the managers' bell opening the work order; a delivered part returned (its proforma cost goes to 0) and its credit note recorded later from Returns and leftovers, answered in a window; a delivered part kept in stock while a tax invoice is out (credit-note words, the owner's "Cost correction needed", the invoice unchanged); 1 of 4 parts delivered and kept (the supplier asked to cancel 3); a save that fails, with the error inside the window and nothing saved; then the same window saving, the LPO kept at its courier charge and "Waived – remove" cancelling it; on Returns and leftovers a refused ending shown inside the card and the next tap saving. Screenshots go to `tests/browser/shots/s7-remove/`.
- Brought up to date for the new rule: `test-l` (section 3: an ordered part, nothing delivered, is cancelled), `test-p` (section 1: "Keep in stock", the answer in a window), `test-zoho3` (section 4: the returned part is a received one; the answer in a window).
