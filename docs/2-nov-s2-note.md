# Placeholder costs (2 November 2026, section 2)

## What was wrong

On Q-00039 (J-00969, the S 580) the FRONT LH GRILL SURROUND MOULDING had a cost of **AED 1.00** from a supplier called **"OFJ Additional"**. It was even ordered that way on LPO-00037-1 for AED 1.00. The advisor's selling price of 871.00 then showed as an "87,000%" markup, and the profit on the car looked AED 870 bigger than it is, because the real cost was never entered.

Nothing in the system treated AED 1.00 as odd. When Parts did not have the real price, or the part came off our own shelf, they made the row look finished in three ways:

- a cost of 1.00;
- a made-up supplier, "OFJ Additional" (a real supplier row Peter created on 14 October);
- a made-up part number: a line number such as "12", or "OFJ" / "OFJ1".

From there the row was treated as finished, went onto the quotation, then onto the LPO, and then onto the invoice. The "markup warning" settings on the Settings page had not been used anywhere since 22 October.

## What changed

**2.1 Is this the real price?**
- When Parts type a cost under **AED 5**, the row asks once: *"AED 2.24 – is this the real price?"*. The row stays amber and does not go onto the quotation until someone taps **Yes, real price**. The answer is kept for that exact cost. If the cost changes, the question comes back.
- The question is skipped when the same part number was **bought** before at a similar price (within 20%). That covers real cheap parts, such as the genuine PLUG WASHER at AED 2.24.
- A cost that is **less than half** of the last price paid for the same part number, or of the same part on the other side of the same car, is shown in **red** and asked the same way.
- When the supplier's standard discount is taken off a figure that was already the net price (the Gargash slip on Q-00039), one line appears under the row: *"Supplier discount 55% applied – AED x was already the net price of … Is AED x the LIST price?"*. It is a reminder only and never blocks anything.
- The same question is asked on the parts desk for estimates, and when an advisor uses "I have a price". Once answered for a price, saving the same price again (for example with another availability) is not asked again.
- A part the customer already approved but nobody has ordered yet can still be answered: its row is locked, but **Yes, real price** sits beside the question ("Approved by the customer, not ordered yet"). Only the answer is kept; the part then joins the LPO.
- On the quotation, a part markup over **500%** shows in amber on the line: *"Markup 87,000% – is the cost real? (cost AED 1.00, OFJ Additional)"*. "Quotation complete" then asks once, with **Fix the cost** or **Send anyway**. Send anyway is written on the quotation, and you are told.
- A quotation or estimate cannot be sent while one of its parts **still being priced** has a made-up supplier, or a cost question nobody has answered. A part the customer already approved (to order, ordered or received) never stops a revision: nobody could change it there, and the LPO and "Prices to fix" hold it instead.
- The four figures (ask under AED 5, flag under 50%, similar within 20%, warn over 500%) can be changed in **Settings > Money**. The two old "Markup warning / confirmation" boxes, which did nothing, are gone.

**2.2 A real cost before any LPO**
- **Send LPO for approval** now refuses a part with no price, AED 1.00 (unless Parts confirmed it), a made-up supplier, or a part from our own stock. The message names the part and says what to do.
- **Approving** an LPO checks the same thing. This also covers LPOs raised before this change, such as LPO-00038. The line itself says *"Not a real price yet: …"* beside its Refuse link, and the Approve box lists the lines with Approve switched off until they are fixed: refuse the line (Parts replace it), or, when only the price question is open, Parts tap Yes, real price on the Parts table.
- When only the price question is open, the words say to tap **Yes, real price**, never "Remove: not needed".
- When an LPO is split by supplier, it never again creates a supplier called "Our stock" or "OFJ Additional".

**2.3 From our stock**
- In the Parts row, the supplier list now offers **From our stock…**. It opens the stock list, which you can search by name or part number. Each item shows how many are on the shelf and its average cost each.
- Picking an item sets the part's cost to the stock cost. That cost cannot be typed over on the row.
- **+ Add to the stock list** adds an item that is not on the list yet: its name, its cost each, and how many are on the shelf. If an item has no cost yet, it asks for one.
- When the customer approves, the part leaves the shelf: the stock goes down, and the part's cost is the stock average at that moment. A part from our stock never goes on an LPO.
- A cost typed in the picker ("+ Add to the stock list") or on the stock page is asked like any typed cost: AED 3.00 asks "Is this the real price?" on the row. Only a stock cost that came from real deliveries (a stock order received, or a part bought for a job and kept) skips the question.
- Typing a cost for an item already on the list keeps the item's own cost, and the picker says so first ("… is already on the stock list at AED 49.00 each: that cost is used"). An item on the list with no cost takes the cost you type.
- An item with fewer on the shelf than the part needs shows amber in the picker and on the row ("not enough on the shelf by the count: count it, or order more"). It never stops anything; when the customer approves, Parts get a bell if the count was short.
- A replacement priced From our stock (after a refused or not-needed line) is taken off the shelf at once. It no longer waits at "To order", which used to stop the job's next LPO.
- Rows priced "Our stock" before this change, with no stock item (14 lines on 7 jobs on live), stay priced. They are listed in "Prices to fix" so Peter can pick the stock item. A new "Our stock" always comes from a picked item.
- The parts desk for estimates has the same **From our stock…** button.

**2.4 The list for Peter**
- A **"Prices to fix (n)"** card now sits at the top of the Parts page, for Parts and you. Each line shows the job, the car, the part, the part number, the cost, the supplier, the LPO, the quotation and the selling price. Tap a line to fix it.
- Parts' **Waiting on you** has a "Prices to fix" line for the parts not ordered yet (ordered or received ones are on the list only, never a line nothing there can clear).
- A part already ordered or received is fixed on its own row with **Correct the cost…** (red on the row, "Correct the cost" in the list).

**2.5 Part numbers**
- A line number ("12") or "OFJ"/"OFJ1" typed as a part number is refused with plain words: *tap None when the supplier gives no number*.
- They are never shown or printed anywhere: the parts check PDF (the "No." column is the row number, and the part number beside it is now blank for these), QC labels, the receiving form, the Parts list, the handover, the approvals page, the staff invoice page, the quotation's estimate line, or the LPO.
- The database change turns the stored ones into "NO NUMBER", which is what they meant. This covers 188 active parts on 15 jobs, J-00969's "12" included, and estimates still being prepared. LPO and invoice lines keep what was stored, but are never shown with it.

## The list you asked for (2.4)

Read from the fresh backup `backups/2026-11-02T18-28-11` (2 November, 22:28 Dubai). It covers every active part with a cost of AED 1.00 or less, or the supplier "OFJ Additional".

**J-00016 (Dubai C 877, Lamborghini Urus): 31 parts, all supplier "OFJ Additional", not ordered, on Q-00001 v1 (draft).** Part numbers were line numbers (13, 66, 74, 78 to 105).

| Part | Cost | Selling on Q-00001 |
|---|---|---|
| CAMSHAFT ADJUSTER UNIT | 1.00 | 4,484.00 |
| ENGINE FRONT CRANKSHAFT SEAL | 1.00 | 789.00 |
| ENGINE HEAD REPAIR KIT FOR PERFORMANTE | 1.00 | 48,625.00 |
| ENGINE OIL COOLER | 1.00 | 862.00 |
| ENGINE OIL COOLER GASKET | 1.00 | 142.00 |
| ENGINE PLUG SEAL | 1.00 | 138.00 |
| ENGINE REAR SEAL | 1.00 | 1,356.00 |
| ENGINE TIMING COVER SEAL | 1.00 | 240.00 |
| ENGINE VALVE COVER GASKET | 1.00 | 3,236.00 |
| FRONT BUMPER SPOILER | **10,000.00** (also a guess: listed because of the supplier) | 74,635.00 |
| HEAD GASKET (CYLINDERS 1–8) | 1.00 | 3,352.00 |
| LUBRICATOR HOSE | 1.00 | 298.00 |
| OIL SEPARATOR – LH | 1.00 | 2,850.00 |
| OIL SEPARATOR – RH | 1.00 | 2,850.00 |
| ROLLER ROCKER ARM | 1.00 | 3,040.00 |
| SEALING FLANGE | 1.00 | 185.00 |
| SOLENOID VALVE | 1.00 | 850.00 |
| SPRING DISC | 1.00 | 2,720.00 |
| THERMOSTAT | 1.00 | 2,620.00 |
| TIMING CHAIN ADJUSTER | 1.00 | 1,304.00 |
| TIMING CHAIN KIT | 1.00 | 2,563.00 |
| TIMING CHAIN SLIDE RAIL | 1.00 | 2,048.00 |
| UPPER BREATHER HOSE | 1.00 | 452.00 |
| VALVE COVER GASKET – CYLINDERS 1–4 | 1.00 | 1,444.00 |
| VALVE COVER GASKET – CYLINDERS 5–8 | 1.00 | 1,444.00 |
| VALVE TENSIONER | 1.00 | 1,584.00 |
| VANOS ADJUSTER – OUTLET | 1.00 | 921.00 |
| VANOS SEAL | 1.00 | 380.00 |
| VANOSE ADJUSTER OUTLET | 1.00 | 1,392.00 |
| VANOSE O RING | 1.00 | 460.00 |
| WATER PUMP | 1.00 | 2,895.00 |

**The other jobs:**

| Job | Car | Part | Part no. | Cost | Supplier | Where it stands | Quotation | Selling |
|---|---|---|---|---|---|---|---|---|
| J-00969 | Dubai GG 13706 Mercedes-Benz S 580 | FRONT LH GRILL SURROUND MOULDING | 12 | 1.00 | OFJ Additional | ordered on **LPO-00037-1** | **Q-00039 v1 approved** | 871.00 |
| J-00609 | Dubai Z 16054 Range Rover Sport | ENGINE FLUSH | 8 | 1.00 | OFJ Additional | received | **Q-00030 v1 approved** | 150.00, invoiced on **PRO-00001 and tax invoice INV-00002** (cost 1.00) |
| J-00017 | Dubai E 55138 Rolls-Royce Ghost | DRAIN PLUG AND WASHER | OFJ1 | 1.00 | OFJ Additional | received | Q-00002 v1 approved (1.40); Q-00033 v1 opened (1.05) | 1.40 |
| J-00343 | Dubai Y 55055 Audi RS3 | WINDSHIELD MOULDING STRIP | OFJ | 1.00 | OFJ Additional | not ordered | Q-00045 v1 draft | 1.05 |

**Estimate parts with a made-up supplier:** E-00054 v1 (draft) has three: TAILGATE / BOOT LID (cost 55.00, supplier "GG"), ROOF PANEL (5.00, "HH") and DOOR (5.00, "G"). These look like test rows.

## What staff must do

- **Peter (Parts):**
  - Open **Parts → Prices to fix** and work down the list.
  - For each part, type the supplier's real price and pick the real supplier. If the part comes from our shelf, choose **From our stock…** and pick it (add it to the stock list the first time).
  - For J-00016, that is the 31 lines above. The quotation follows by itself while it is a draft.
  - When there is no part number, tap **None**. Never type a line number or "OFJ".
  - The first time each stock part is used, add it to the stock list with its cost and how many are on the shelf. These are the oils, filters, the coolant, the drain plug washers and so on. The stock list has 4 items today, all with 0 on hand.
- **Ordered or received parts** (J-00969, J-00017, J-00609): open the car in Parts; the row is red with **Correct the cost…**. Tap it and choose:
  - **It came from our stock…**: pick the stock item (add it the first time). The shelf goes down once, the cost becomes the stock average, the supplier "Our stock". This is J-00017's drain plug and washer, and J-00609's engine flush.
  - **Bought from a supplier**: pick the real supplier and type the real cost each. For J-00969's grill moulding this also re-addresses LPO-00037-1 from "OFJ Additional" to the real supplier, as long as no supplier invoice is entered on it yet. The LPO's approved price stays; the supplier invoice then brings the real price through the usual price rule (your OK above the limit).
  - It is written on the job (before → after). The customer sees nothing. A proforma already made follows on its internal cost.
  - Do J-00017 before its invoice is made, so the invoice carries the real cost.
  - J-00609's tax invoice INV-00002 keeps its internal cost of 1.00: Correct the cost refuses a part already on a tax invoice (see below).
- **You:** when an advisor sends a quotation with a markup over 500%, you get a bell. Check whether the cost is real.

## Left as it is

- The **"OFJ Additional" and "Our stock" supplier rows are not deactivated**, because live parts still use them. Any row that uses OFJ Additional shows **Not a supplier** and stays unfinished until Parts fix it. Once Peter's list is done, they can be switched off on Parts > Suppliers.
- **No correction for a part already on a tax invoice.** J-00609 (INV-00002) keeps its internal cost of AED 1.00, so its profit and the advisor's bonus figure stay AED 1 too high in cost terms until this is corrected by hand. A safe owner-only correction (internal figure only, never what the customer sees) can be the next small task.
- The test stock item "Rear brake discs · E2E-DISC-1" (8 on hand, AED 49.00), left on live by a browser test on 16 October, is switched off by the second database change below.

## Database changes

Migration `20261203100000_part_costs.sql` is **applied on live** (2 November, 19:26 UTC, at your "apply"; backup `backups/2026-11-02T19-26-11`; nothing in it changed after the review). It added:
- the "Yes, real price" columns on parts and estimate lines, and the estimate line's stock item;
- the four settings rows;
- the "NO NUMBER" fix: 445 part numbers, 188 of them on active parts (J-00969's "12" included).

So the cost question asks with its "Yes, real price" button and holds the row from now on.

Migration `20261203101000_stock_test_leftover.sql` (backup `backups/2026-11-02T20-42-18`) **waits for apply**. It switches off only that test stock item: the exact row, only while it is still on and no part uses it. Until then the item still shows in "From our stock…". Its cost counts as typed, so it gets the "Is this the real price?" question.
