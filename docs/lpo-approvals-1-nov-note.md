# LPO approvals and the intake manifold (1 November 2026, LPO-00038 on J-00317)

## 2.1 Why line 13 was not on LPO-00038

The new TRANSMISSION MOUNT (Al Futtaim) was added after the customer had approved Q-00020. A part added after approval waits for the customer's approval of a revised quotation (it asked the owner "allow a revised quotation?" at 07:16), so it never became "To order". It was also only priced at 09:00:58, a minute after Peter sent LPO-00038 (08:59:39). The LPO takes only parts marked To order, so it was left out without a word.

## What changed

- **Refuse one line.** The owner or the head accountant can refuse a single line of an LPO that waits for approval ("Refuse this line", with a reason) instead of refusing the whole LPO. The part is then:
  - greyed on the Parts list with "Refused by Omar – <reason>";
  - never "To order" again, and never on an LPO again;
  - listed under "Refused lines" on the LPO.

  Parts are told to replace it. The rest of the LPO keeps waiting. Refusing the last line cancels the LPO.
- **Replace (another supplier).** A refused line, or one marked not needed before it was ordered, gets a "Replace (another supplier)" button. The new row:
  - copies the name, quantity and positions;
  - says "Replaces the refused line (Al Tayer Motors LLC)";
  - takes over the customer's approval: once priced it is To order at once (no revised quotation), and the customer's price stays as approved;
  - has its cost used on the invoice and in the profit.
- **Nothing priced and To order is left out.** Once a job has an LPO:
  - a part that becomes To order and is priced joins the LPO waiting for approval by itself, with its supplier as a new section and the total updated. The owner and the head accountant get "1 part added to LPO-00038".
  - if the LPO was already approved, a new LPO for approval is made for the added part.
  - a part changed while its LPO waits (price, quantity, supplier) updates its line, and the approvers are told.
- **Saving a line.** A row with typing not yet sent shows "Not saved yet". "Send LPO for approval" names the lines not finished ("1 line not finished: …") and asks before sending without them.
- **Waiting on you.** The owner's and accounts' Waiting on you list every LPO waiting for approval, additions and new requests included. The accounts list had lost them for a moment in this batch; that is fixed and checked.

## 2.5 The "No." column (5, 6, 7, 8, 10, 11, 12, 13, and 11 twice)

Yes. These are line numbers typed into the part number box: the box must be filled, so the desk typed 1, 2, 3… On live, 174 of 232 parts have a "part number" under 4 characters, mostly 1–21. Now:

- a part number of 1–3 digits is refused with words ("13 looks like a line number");
- "None" fills in NO NUMBER when the supplier gives no number;
- the LPO, the supplier copy (PDF), the supplier list and the copy text never show a line number or NO NUMBER. They show the real part number or nothing.

Numbers already stored are left as they were, but no supplier sees them.

## 2.6 The 0% on every line

That column is the supplier's discount (Disc %), not our markup. The header now says so when you point at it. Q-00020 applied the advisor's markup of 30% on every part. The minimum (5%) holds in two places:

- the save pulls an advisor's lower markup back up to 5% (checked again in this batch);
- a quotation with a part below cost plus the minimum, after every discount, cannot be sent (`floorProblem` in the send blockers).

The owner alone may go below the minimum, and that is logged.

## 3. Intake manifold

- **Tablet:** under ENGINE BAY, right after Valve cover, with the hint "cracks, leaks, gasket, flaps / runner actuator". It has the same statuses, notes and photos as the other items.
- **Report:** a finding shows in the report under ENGINE BAY, and on the quotation's report strip.
- **Add a part:** "Intake manifold" and "Intake manifold gasket" are always under Engine.
- **Existing reports** keep the checklist they were done with.

## Database (WAITING FOR APPLY)

Migration `20261202110000_lpo_refusals_intake.sql`:

- adds `part_items.refused_at/refused_by/refused_reason/refused_po_id`;
- adds Intake manifold to the live checklist;
- fixes J-00317: the Al Tayer mount is marked refused, the Al Futtaim mount is its replacement on LPO-00038, the owner is told "1 part added to LPO-00038", and Peter's revision request is closed.

Until it is applied:

- the line refusal stays hidden (the whole-LPO refusal works as before);
- Replace already works for parts marked not needed;
- the automatic additions, the part number rule and the warnings work.

## Proof

`npm run test:lpo` (test database, 29 checks), screenshots in `tests/browser/shots/lpo-approvals/`.
