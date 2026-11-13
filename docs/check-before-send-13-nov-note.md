# Check before you send (13 November 2026, URGENT 3)

## Step 0: what existed

- "Send LPO for selected" already had a preview: each supplier, its parts, and the amount incl. VAT.
- It had no part numbers, no delivery time and no warnings.
- The other three send points (prices to the advisor, "Ordered", saving a receipt) sent at one tap.
- That preview is now THE shared window, `src/components/CheckBeforeSend.tsx`, used in all four places. Nothing was built twice.

## What the parts desk now sees

Before anything goes out, one window shows:
- the supplier;
- each part with its part number, quantity and price;
- the total incl. VAT;
- the delivery time;
- for a receipt, the invoice number typed and the photo taken.

It has two buttons: **YES, ALL CORRECT - SEND** and **GO BACK AND EDIT**. Going back closes the window with nothing lost: the ticks and the typing stay.

**Highlighted in red, with the reason:**
- **A placeholder part number:** the part's own name, a word like PAD / DISC / BLADE, a pattern like 1234AA or 123AA, or no number without the "No part number yet" tick.
- **A price that looks like a typing slip:** AED 0 or AED 1, or under half / over double the last price we paid for that part number.
- **A quantity different from the customer's quote.**
- **A cost above the cost the quote was priced on**, with the difference and the new profit on that line.
- **The same part listed twice**, by part number, else by name.
- **A supplier different from the one the part was priced with** (on an LPO).

If nothing is highlighted, it is one tap. If something is highlighted, YES stays grey until "I checked the highlighted lines" is ticked.

**Where it appears:**
- **a)** "Pricing done – send to advisor" and "Send what you have" (jobs and estimates);
- **b)** "Send LPO for selected" (for approval);
- **c)** "Ordered" on a supplier LPO card (sending it to the supplier);
- **d)** saving a receipt, on the LPO page and on the car's Parts page.

Only the parts desk's screens have it. No other role's screens were changed.

**Logged and shown to the approver:**
- Every confirmation is logged (`send_checks`: who, when, which lines were highlighted).
- An LPO waiting for approval shows "Checked before sending: <name> confirmed <time> with 3 highlighted lines", followed by each line and its reasons.

## Proof (TEST only)

- `npm run test:sendcheck`: **13 of 13**. It covers:
  - a clean LPO goes in one tap;
  - an LPO with a part at AED 1, part number "DISC" and quantity 2 against a quote of 1: all three highlighted, and it cannot be sent until the tick;
  - "Go back and edit" keeps the tick on the part and sends nothing;
  - each confirmation is logged;
  - the approver sees the flags.
- Unit `send-check-rules`: 12 of 12.
- Screenshots: `docs/proof/2026-11-13-check-before-send/`:
  - clean window, 1440;
  - flagged window, 1440 and 800;
  - the approver's box.

## Assumptions

- **"Far from the last price"** means under half or over double the last real purchase of the same part number. A part with no purchase history is checked for AED 0 / 1 only.
- **"Supplier different from the one it was priced with"** is checked on LPOs: the LPO's supplier against the part's priced supplier. The prices window has no older supplier to compare with.
- **On the car's Parts page receive panel**, the window shows the parts, the invoice number and the photo. Part numbers and prices show on the LPO page's receive form.
- **The window works without the database change.** The apply adds only the log and the approver's box.
