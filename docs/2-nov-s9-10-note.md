# Sections 9 and 10 of 2 November 2026 (built 3 November): quantity + unit on every parts form, and "Pricing done – send to advisor"

Two database changes wait for your "apply" (the code is already in and switches itself on once they are applied):

- `supabase/migrations/20261203160000_part_units.sql` – the unit (pieces, litres, sets) and the advisor's asked quantity.
- `supabase/migrations/20261203170000_estimate_pricing_done.sql` – an estimate remembers when the parts desk sent it back.

Until you apply them: the quantity can already be changed on both screens and every change is written down; the
unit stays "pieces" everywhere (a quantity like 6.5 is still accepted for an oil); the new button already sends ONE
notification, answers next to itself and never sends twice; the parts desk's list already follows the send (it is read
from the "Pricing done" entry in the estimate's history until the estimate keeps its own stamp).

---

## Section 9 – Quantity + unit on every parts form

### What was wrong (E-00058, Rolls-Royce Cullinan 2021)

- The parts desk's estimate page was a **different form** from the car's Parts table. It printed the quantity as plain
  text ("ENGINE OIL – ROLLS ROYCE GENUINE ×1") and its "Save price" button sent no quantity at all, so the desk could not
  fix 1 into 8 litres. The car's Parts table could.
- There was **no unit anywhere**. "7" meant litres only in people's heads; the customer's estimate PDF printed "7" and a
  price per litre with nothing to say so. On E-00058 the 7-litre total (AED 1,155) was once typed as the price of one.
- On a car's quotation the advisor's quantity on a part was **dropped silently** by the server; on an estimate it was
  saved but written down nowhere.

### What changed

1. **ONE parts form.** The estimate desk (`/parts/estimate/…`) now uses the very same row as the car's Parts table:
   Part, Qty and unit, Part number (with None), Type and brand, List, Disc %, Net per unit, Supplier (the list with the
   supplier's discount, From our stock…), Availability, Line total, the price memory, the cost question "Is this the
   real price?" with "Yes, real price", and every change saves as it is typed. The advisor's note for the desk shows on
   the row ("Note from Anas: OEM only"); a price the advisor typed himself shows with **Price is right ✓**; an estimate
   already with the customer is read-only with **The price is different: tell the advisor**.
2. **The quantity can be changed by the parts desk and by the advisor**, and every change is written down in one
   wording, on the row and in the history: **"Advisor asked 1, Parts changed to 8 L"** (or "Technician asked 2, Parts
   changed to 4", "Parts asked 8 L, Advisor changed to 7 L"). The advisor changes a car's part in the quotation editor
   (the box is there now); once the part is ordered it is refused in words ("ask Parts"). Pieces and sets are counted
   whole; litres may be 6.5.
3. **Units: pieces · litres · sets.** A small choice beside the quantity (pcs / L / sets). Oil, coolant, transmission,
   differential and brake fluid start in litres by their name (an oil filter, a coolant hose or a drain plug stay
   pieces); the parts list's own unit wins. **The cost is per unit**: the row says "AED 165.00 per litre × 8 L" and the
   line total 1,320.00, so a 7-litre total can no longer pass as one litre.
4. **Customer documents** print **"ENGINE OIL – ROLLS-ROYCE GENUINE · 8 L"** and **"8 L" in the QTY column** (so the
   price beside it reads per litre) – the estimate, the quotation, the proforma and the tax invoice; the supplier's LPO
   says "8 L" too. Pieces print exactly as before. A litre part prints **one** sticker saying the litres, never eight.
5. **The quantity used last time on the same model** (9.3): on the row, "Last time on ROLLS-ROYCE CULLINAN 2021: 7 L
   (E-00058) · Use". It looks at the cars' priced parts and the estimates' priced parts (so E-00058 counts for the next
   Cullinan); with nothing on that model it offers the same make, naming the model it came from. It is never filled in
   by itself: one tap on Use, and it is written down like any change.

### Lists you asked for (from the code; nothing read from the live database tonight)

- Engine oil, coolant, brake fluid, transmission oil, differential oil and transfer case oil in Settings > Parts list
  become litres when you apply. Compressor oil is left in pieces for you to decide.
- Open parts (not ordered yet) and the part lines of quotations and estimates still being prepared follow the fluid
  rule when you apply; nothing sent, approved, invoiced or on an LPO changes (the documents the customer already has
  stay exactly as he saw them). E-00058 is already with the customer, so it keeps "7" without a unit.

---

## Section 10 – "Pricing done – send to advisor"

### What was wrong

- After the last part was priced, **every later save** of any priced row sent the advisor another "Parts priced":
  J-00016 gave one advisor 94 of them in one morning during three price imports; "Parts changed a quantity", "Part
  removed" and "Part not available" came one by one on top. An estimate's advisor got "Parts priced" again on every
  "Save the new price".
- The estimate page had no button at all; the car's bar said "15 priced, 1 not available" but never "3 of 4".
- A car stayed on the parts desk's "To price" list until every part had a cost, whether or not the prices were sent;
  and a part that had a cost but no supplier was invisible there.

### What changed

1. **One bar at the bottom of both pricing screens** (a car's parts and an estimate's parts), always visible while you
   scroll: **"3 of 4 priced"** with a thin bar, and one big button **"Pricing done – send to advisor"** ("Send updated
   prices" after Edit or after a change on an estimate already sent).
2. **A line not priced yet is listed instead of sending**, right above the button: "1 part not priced yet", each line
   with what it misses and **Go to** (the screen goes to it and the cursor lands in what is missing), **Go to next**,
   and **Send what you have** for when the supplier cannot answer today.
3. **ONE notification to the advisor in charge**: "All parts priced on E-00058" / "All parts priced on J-00970"
   ("Parts priced on J-00970: 3 of 4" when sent with what you have, "Prices updated on J-00970" after Edit), with what
   changed while pricing folded in ("Changes: ENGINE OIL: Advisor asked 1, Parts changed to 8 L"). The answer shows in
   the bar itself ("✓ All parts priced on J-00970 – sent to Anas").
4. **The car or the estimate leaves the parts desk's to-do list** (the Parts page, the Parts dashboard tile and Parts'
   Waiting on you) the moment it is sent. With **Send what you have**, the lines left open stay under **To price**
   ("1 part to price") until they are priced - on a car press Edit to price them, on an estimate price them in place -
   then **Send updated prices**. A car with every part priced but not sent shows **"Priced – send to the advisor"** with
   a **Send to advisor** button until you press it. A new part asked afterwards (the advisor's "+ Add a part",
   additional work, a part Parts add) opens the pricing again by itself and puts the car back - also on a car already
   in work whose prices were never sent.

### The notices held back, and the ones that stay

Held only while a send is expected (before the customer's approval until the first send, or after Edit or a new part
opened the pricing again) - they come inside the one notification instead, to the **advisor** only:
"Parts priced · J-…" (gone completely), "Part not available", "Parts changed a quantity", "Part removed", "Parts split
a bundled part", "Part changed after the quotation went out" (while editing after the send), "Parts changed on J-…:
send the revised quotation" (a new version made while editing: the one notification opens it with "send"), and on
estimates "The parts desk changed your price" and "Parts priced · ESTIMATE …".

Kept as they are: the workshop manager's notices (a quantity, a removal, a split), the owner's supplier-discount
approvals, Parts' own requests, "Price to correct" (the desk's written message on an estimate already with the
customer), and everything after the customer's approval (there is no button there; the revision flow tells the
advisor itself).

**A held notice is never lost.** Every held notice keeps the car on the parts desk's list ("Priced – send to the
advisor", or "To price" while a line is open) until the button is pressed. If the customer approves first, what was
held goes to the advisor by itself in the same one notification ("Parts changes on J-…"), and the hourly clean-up
does the same for a car approved another way. A car past the customer's approval whose prices were never sent holds
nothing: the notices go to the advisor at once, unless a new part opened its pricing (then it is listed until sent).

---

## Review fixes (3 November 2026)

An independent review found 30 points (several the same thing seen twice). What changed:

- **Held notices and the to-do list follow ONE rule** (a send is expected): a car in work whose prices were never sent
  no longer swallows "Part not available", "Part removed", quantity, split and "send the revised quotation" notices; a
  new part on such a car opens its pricing and lists it; a change with nothing newly priced (a part marked not
  available or removed) keeps the car on the list; the customer's approval sends what was still held.
- **Send what you have** keeps the open lines on "To price" (cars and estimates), as the bar says; an open request on
  an approved car is on "To price" again.
- **Estimates:** a half-typed line (a cost but the row not finished) counts as "to price" everywhere, before and after
  the database change; "Price is right ✓" on the advisor's own price makes the line priced on the bar at once (his
  price never asks for a part number, type or availability); before the estimate keeps its own stamp the send is read
  from its history, so the bar turns green, the answer shows next to the button, and a second tap (or an old tab)
  says "Already sent … Nothing changed since." and sends nothing; the parts desk's estimate list reads only the
  estimates still open, page by page.
- **Gate-in:** a half-typed estimate price comes onto the car as a part not finished (Parts finish it there), never as a
  priced part on the quotation.
- **Units:** a fluid the technician lists ("ENGINE OIL 0W-20") reaches Parts in litres; a price import of 6.5 litres is
  accepted; before the database change the advisor may type 6.5 on an oil; switching a 6.5 L line to pieces is refused
  ("Change the quantity first, then the unit"); − and + step one unit from the number (6.5 L → 7.5 L); the LPO card and
  its Copy text say "× 8 L · AED 165.00/L"; parts converted to litres when you apply never show a false "asked 8,
  changed to 8 L".
- **Words:** a part from the inspection or from additional work reads "Technician asked …" (never the manager or the
  advisor who approved it); the row names whoever changed the quantity ("Advisor changed to 8 L").
- **The bar:** Go to folds the list into one line and brings the row above the bar, with Go to next and Show the list.
- **Speed:** the last-quantity chip reads in short pieces, so it keeps working for the busiest makes.

## What staff must do

- **Parts:** price every line as before, then press **Pricing done – send to advisor** at the bottom – on a car and on
  an estimate. Nothing reaches the advisor until you do. Set litres for oil and fluids (the box beside the quantity),
  and type the price **per litre**.
- **Advisors:** you hear once per car or estimate. You may change a part's quantity on the quotation yourself while it
  is not ordered; Parts are told.

## For the integrator

- Apply both migrations to TEST, then run `npm run test:s9-s10` (both suites; test:s10-pricing now has sections A-D:
  A4b Go to keeps the row in sight, B7b/B7c the answer and no second send, B8/B9 the open line stays listed, C Price is
  right, D a car in work never sent), `npm run test:notify` (step 6 presses the bar), `npm run test:l` (section 1
  check 3 presses the bar), `npm run test:s2-costs` (all sections; F rewritten for the shared row), `npm run
  test:estparts` (B and D), `npm run test:d` (U3), `npm run test:h` (6), `npm run test:c` (12), `npm run test:e`,
  `npm run test:f` (C), `npm run test:g`, `npm run test:p`, `npm run test:popups` (the list and the new Go to line)
  and the layout check of `/parts/[jobId]` and `/parts/estimate/[id]`.
