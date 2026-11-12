# Change supplier or price without removing – 13 November 2026 (Section 3)

**The case:** NISSAN PATROL, Dubai FF 33052 (J-01007). The parts desk removed five approved parts to change their supplier, then added them again. The new lines were on no quotation, so they read "New – needs approval".

**Built:**
- **"Change supplier / price…"** on the part's ⋯ menu (parts desk and owner):
  - It edits the supplier, cost, delivery time, part number and type **in place**. The part keeps its row, its quotation line, its job and the technician's request.
  - A reason is required. The history keeps old → new, who and when; it shows at the top of the window, and as "Changed 2×" on the row.
  - Before saving, the window shows the line's profit now → after, against the customer's price.
- **Who has to approve:**
  - **Cost down, same type:** applied at once and logged.
  - **Cost up, or another part type (e.g. Genuine → OEM):** the change waits on the owner's Approvals. The owner's own change applies at once.
  - **The customer's approved price never changes here** (approved quotations stay locked). The window asks: "Keep the customer's price (we absorb AED X)" or "Revise the quote" (the owner is asked to allow a revision, and the advisor is told).
- **What happens to the LPO:**
  - **On an LPO waiting for approval:** the line follows the change.
  - **On an approved or ordered LPO, not received:**
    - in the same step, that line is cancelled with the old supplier (the reason goes in the LPO's notes);
    - Parts get a bell to cancel it with that supplier;
    - the part goes on an LPO for the new supplier, waiting for approval.
  - **Already received:** no change from here; it can only go back as a purchase return.
- **The repair, "This replaces…":** a line added again after the approval shows "Added again after approval: ⋯ → This replaces…". Picking the removed part links them, and the new line inherits its quotation line and the customer's approval. The customer is not asked again, because the price did not change.
- **Removed rows** fold into one line at the bottom: "Removed (7)".
- **Part numbers:**
  - "No no. yet" stores NO NUMBER instead of a made-up number.
  - A part number that is only the part's name (PAD, DISC, BLADE, FLUID…) shows "Part number is the name".
  - Both stay flagged until a real number is entered.

**Live, read-only check – cars with lines added again after approval:**
- **J-01007 · Dubai FF 33052 · Nissan Patrol (open).** Re-added, all already received → the removed approved line to link each one to:
  - REAR WIPER BLADE → REAR WIPER BLADE
  - BRAKE FLUID → BRAKE FLUID (LEVEL, CONDITION, CHANGE DUE)
  - ENGINE MOUNTING - 1 → ENGINE MOUNT
  - ENGINE MOUNTING - 2 → ENGINE MOUNTING -2
  - GEAR MOUNTING → TRANSMISSION MOUNTS
- **J-00317 · Dubai W 64762 · Ram Laramie (open):** MAIN BATTERY.
- **J-00990 · Dubai J 94171 · Jeep Grand Wagoneer (open):** AIR FILTER, AUXILIARY WATER PUMP - 1, DRIVE BELT.
- **J-00940 · Dubai K 68723 · Land Rover Discovery (closed):** RADIATOR.
- **J-00978 · Dubai R 27420 · MINI Cooper (closed):** DRAIN PLUG, ENGINE OIL - 5W30.

**Proof (TEST):**
- `npm run test:s13-3` passes 23 of 23. It covers:
  - cost down applied at once;
  - cost up waiting for the owner, then approved on the Approvals page;
  - keep or revise, with AED 50.00 absorbed;
  - the history;
  - the ordered LPO cancelled and the part moved onto a new LPO;
  - the repair link;
  - the part number flag;
  - the removed fold;
  - a received part offers no change.
- Screenshots: `docs/proof/2026-11-13-part-change/`.
- Waits for the apply: `20261215100000_part_changes.sql`. Until then the menu item does not show.
