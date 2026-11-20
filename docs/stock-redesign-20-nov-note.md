# Stock page redesign, view access and the stock count (20 November 2026, Section 5)

## Now (Parts → Stock)
- **Four tiles:** TOTAL ITEMS / IN STOCK / LOW STOCK / OUT OF STOCK. A tap filters the list.
- **Search and filters:** search by name or part number (spaces and dashes ignored); filters for category, brand and status. Two clean-up chips: **No minimum set** and **Placeholder part numbers** (123W, 5ZH2 and the like).
- **One row per item:**
  - photo, name, part number, category tag, brand, quantity with its unit (and the minimum, or "no minimum"), cost, status tag;
  - sortable by name, category, quantity, cost and status; 50 items a page.
- **The side panel** (Open on a row): Issue to a job, Adjust, Reorder, Edit, Archive, Merge.
  - The repeated "Edit the item or adjust the figure" line is gone.
  - Issuing keeps its rules: technician, job, and the technician's PIN above the limit.
  - Reorder starts the stock LPO draft for that item.
- **Header buttons:** **+ Add stock item**, **Manage categories** (owner and parts desk: add, rename, archive; the ten starting categories are seeded), **Stock count**, New workshop order, **Labels**, Stock report.
- **Clean-up:**
  - **Merge** a duplicate into the item (e.g. BOSCH BRAKE FLUID twice): its quantity moves, its history stays, and it is archived "merged into".
  - **One unit per item** from a fixed list: pc, L, ml, set, pair, m, kg, g, box, roll, can, bottle. "Ltr" is read as L and "pcs" as pc; anything else is refused.
  - Every item has a minimum level (the "No minimum set" list shows the ones at 0).
- **View access:** a personal **Can view stock** switch on the Team record (owner only).
  - The person sees Stock in the menu with items, quantities and status: no costs, no stock value, and no issue, adjust, reorder or edit.
  - The server refuses every stock action for them, whatever the screen shows.
- **Stock count** (no delete, no reset):
  - entered item by item, each figure saved as typed, so it can be continued another day; "Not found" is a tick;
  - before anything changes it shows the difference per item, its value and the total change;
  - **Send the count to the owner** puts it in the **approval box**. Only on approval do the figures change and are the items not found archived.
  - The first count is dated **OPENING COUNT <date>** and shows in the month's stock report. Nothing posts to Zoho.
- **Shelf labels:** the Labels tab → tick the items → **Print**. Black only, with a QR code; scanning it opens the item on the stock page to issue or count it.

## Assumptions
- The parts desk and the owner manage stock (as today). Accounts see the stock report, not the stock page.
- Until "apply", the old monthly count (which applies at once) stays, so nothing live breaks. Categories, brand, photo, merge, the new count and the view switch all switch on with the apply.
- test-p's stock steps were written for the old layout. The simulation's stock steps still pass (the one-tap Archive on an empty item is kept).

Test: `npm run test:s20-5` (16 checks: parts desk, owner, and a technician given view-only access; TEST) and unit `stock-rules`. Proof: `docs/proof/2026-11-20-stock/`.

**NEEDS OMAR:** reply "apply" (WAITING FOR APPLY #3). Then:
- **Approve the opening stock count** in Approvals when the parts desk sends it.
- **Tell me if Deepak should also be able to issue stock.** Today the switch is view only: Team → Deepak → Stock → Can view stock.
