# Section 4 (17 November 2026): change the supplier when the first one cannot deliver

**Status of the 12 Nov ask ("Change supplier / price"):** it has been live since 13 November, but only on the Parts page in the part line's **⋯ menu** ("Change supplier / price…"). Every dearer change went to the owner.

## What changed

- **A visible button on the part line.** An approved or ordered part (not received yet) shows its supplier as a button in the Supplier column: **"<supplier> · Change"**. It works on parts that are:
  - approved;
  - on an LPO waiting for approval;
  - on an LPO ordered but not received.
  The ⋯ menu keeps the same entry.
- **Quick reasons to tap:** "Cannot deliver today", "Out of stock", "Better price", "Other" (Other opens a box for the words).
- **Who approves (one rule, `approverFor` in `src/lib/part-change-rules.ts`):**
  - **Cheaper or the same cost, same part type:** no approval. It is applied at once and logged.
  - **Dearer, but the line still makes at least the minimum markup set in the ERP** (Settings → parts minimum markup, now 5%): the **advisor in charge of that car** approves with one tap.
  - **Below the minimum markup, another part type (for example Genuine → OEM), or the customer's price must change:** the **owner** approves.
  - The owner's own change applies at once.
  - The window says which of the three it is before saving, and the button reads "Save the change", "Send to the advisor" or "Send to the owner".
- **The approver's alert carries the whole decision:** the part, the old supplier and price, the new supplier and price, the difference (each and on the quantity), the delivery time before → after, the profit on that line before → after (and what the customer pays), and the reason.
  - The bell opens **/parts/change/<id>**, one page with **Approve the change** and **Refuse** (with an optional note). The answer shows next to the buttons.
  - An advisor sees "Waiting for the owner" (no buttons) on a change that needs the owner.
- **LPOs:**
  - A part on an LPO waiting for approval moves with the change: that LPO's lines and each supplier's subtotal follow.
  - A part on an LPO ordered but not received: the old line is cancelled with the reason (the parts desk is told to cancel it with that supplier), and the part goes on the new supplier's LPO, waiting for approval.
- **The approved quote stays locked.** The customer's price does not change unless the quote is revised; "Keep the customer's price (we absorb AED x)" or "Revise the quote" is asked when a dearer or different part was already approved.

## Proof (TEST)

- `npm run test:s17-4` passes 13 of 13, signed in as the parts desk, the advisor and the owner. It covers:
  - the visible button and the reasons;
  - dearer within the markup → the advisor's bell with the whole decision → one tap → changed in place, the customer's price unchanged;
  - cheaper → at once;
  - below the markup → the owner (the advisor cannot decide), and refused;
  - another part type → the owner.
- `tests/unit/part-change-approver.test.mjs` passes 9 of 9.
- Screenshots in `docs/proof/2026-11-17-change-supplier/` (1440 and 800 wide).

No database change.
