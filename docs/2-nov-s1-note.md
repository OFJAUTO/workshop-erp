# Price calculation and "nothing below cost" (2 November 2026, section 1)

## What was wrong

Peter's revision request on Q-00039 (J-00969) read "Peter added FRONT RH HEAD LIGHT, AED 5,502.73". It looked like the markup had been taken off (12,228.30 − 55% = 5,502.73). **That is not what happened. No markup was subtracted anywhere.**

- AED 5,502.73 was the part's **cost**, not a selling price. The request printed the cost with no label, so it read like a price.
- The cost was wrong. Peter typed 12,228.30 as the list price. That figure was already the net price (the same light on the left side costs 12,228.30). He then picked Gargash as the supplier. Gargash's supplier record carries a standard discount of 55%, and the Parts table fills that in by itself. So the 55% was taken off a second time: 12,228.30 × 45% = 5,502.73.
- The left headlight was priced the normal way: 12,228.30 + 80% = 22,010.94. That is correct.
- If you had pressed "Allow", the right headlight would have joined version 2 at the 5% minimum markup: AED 5,777.87. That is about AED 6,450 below what the light really costs.
- Peter took the right headlight off as a duplicate this morning (08:26 Dubai time). The request was still waiting for you, and your bell for it was unread.

There has always been ONE price calculation, in `src/lib/quotes.ts`: cost + markup, as a percentage or as AED per unit. Every screen, PDF, invoice and profit figure uses it. One exception was found: an early charge (fuel, parking) added to a quotation was priced at its cost instead of the charge typed. That is fixed.

## What changed

1. **Nothing sells below its cost without you.** This covers every line with a cost: parts, other charges, recovery, a service with "our cost", and a package against its worked-out cost (film, tint, ceramic, consumables, installer hours).
   - **Advisors:** a price below cost stays on the screen in red ("Not saved: … only the owner can sell below cost") and is not saved. The server refuses it too.
   - **You (the owner):** a price below cost opens a small window, **"Sell below cost?"**, with the price and the cost. Type why, then press **Approve below cost**. The reason, your name and the figures are written on the quotation and the job. Your approval covers only the figures you saw. If the price goes lower or the cost goes higher later, you are asked again.
   - **A line that falls below cost on its own** (for example, Parts raised the cost) shows a red line under it. "Before sending" stops the quotation until the price is raised or you approve it. You approve it from the line with **Approve below cost…**. An advisor can press **Raise the price, or ask the owner**, and you get a bell.
2. **Revision requests now show the figures.** The request says "… – cost AED x (list AED y less z%)". Your box on the quotation shows each part with its List, Discount, Cost and the Selling price it would get.
   - The request turns **red** when a part would sell below cost, or when its cost is under half of the same part (on this job, or the last price for the same part number).
   - When it is red, "Allow one revision" needs your reason. Your bell starts with "CHECK THE PRICE".
3. **A part added after approval takes the quotation's own markup, never just the bare minimum.** It takes the markup of the matching part (same part number, or the same part on the other side). If there is none, it takes the markup used most on the quotation. The right headlight would get 80%, the same as the left one.
4. **A waiting revision request withdraws itself** when every part behind it is taken off. Your bell for it is marked read.
5. **The "minimum markup is still 5%" question** now uses the minimum for the car's make, like everywhere else.
6. **An early charge** on a quotation now sells at the charge typed, not at its cost.

## Checked again the same night: 13 holes closed

An independent check of this work found gaps. All are closed, and each one is proved by the test.

- **A discount can no longer take a package below its cost.** Before, the check only looked at a line's own price. The package discount (or a "labour and services" discount) came off afterwards, so an advisor could give 10% and sell a package under its cost with no red line.
  - Now every line is judged after its share of the discount.
  - An advisor's discount that does this is refused, in red, in the Discount window itself. Apply does nothing.
  - You can still give it: you are asked why, and your approval is kept with the price after the discount.
- **A cost is never refused.** Before, an advisor who typed the truck's real cost (or a service's "our cost") above the price was refused, so the real cost was lost.
  - Now the cost is always saved. The line turns red, you get a bell, and "Before sending" stops the quotation until the price is raised or you approve it.
- **An advisor's held price is no longer lost or mixed up.**
  - A price below cost stays on the screen in red and is not saved. Anything else typed on that line (a note, a name, a cost) is still saved.
  - The next price is judged against what is really saved, not against the red figure. Once it clears the cost, it is saved.
  - "Put back the saved price" undoes the red figure.
  - "The owner was asked" now shows only when you really were asked.
- **When you allow a Parts revision, the new version carries the part's NEW cost.** Before, a part Parts had re-priced kept the old approved cost on version 2, so the box showed you one price and the customer got another.
  - The same applies to a changed type, brand or side, which your box now also lists.
- **Your reason covers only what you saw.** Before, your note on a red request was written on every line below cost on the new version, including lines that were never in your box. Now it covers only the red rows you saw, at the figures you saw.
- **An early charge (fuel, parking) added after approval now appears in your box and goes onto the new version when you allow it.** Before, "Allow" closed that request with the false words "the part was taken off".
- **"Nothing left to change" only when it is true.** A request closes by itself only when every part it names was taken off. Whoever asked is told.
- **An advisor's own revision request is never withdrawn because Parts took a part off.**
- **A part added after approval learns its markup only from real markups.** On Q-00039 the grill moulding has a placeholder cost of AED 1.00 plus AED 870, which works out to 87,000%. A new part with no twin would have sold at 871 times its cost. Now:
  - Placeholder costs (under AED 10) and AED markups are ignored.
  - When two markups are used equally, the lower one is taken.
  - On Q-00039 a new part gets 80%.
- **A front part and a rear part are no longer treated as the same part.** "REAR BRAKE PADS" is no longer compared with "FRONT BRAKE PADS", so a correct rear price is not flagged "CHECK THE PRICE". Left and right are still matched.
- **A bodyshop service is judged against the cost the internal box counts for it:** its installer hours at the bodyshop rate, and on a plain PPF job its share of the film.
- **The estimate screen now works out package costs from the full car name**, including the variant (for example "Range Rover LWB" is a big car), like the server does.

## The lists you asked for (before → after)

The live data comes from the read-only backup `backups/2026-11-02T15-57-56`, taken tonight at 19:57 Dubai time: 52 quotations and estimates, 1,114 lines, every version and status.

| Check | Found |
|---|---|
| Lines selling below their cost | **0** |
| Lines where the markup was subtracted (price = cost − markup) | **0** |
| Stored line totals that differ from the one price calculation | **0** |
| Negative markups | **0** |
| Early-charge lines priced at cost | **0** (no charge has gone onto a quotation yet) |

So **no line or quotation price changes**. The one affected item is a revision request:

| Item | Before | After |
|---|---|---|
| Q-00039 v1 revision request (31 Oct, still waiting) | "Peter added FRONT RH HEAD LIGHT, AED 5,502.73". The cost was shown without a label, and the part has been taken off as a duplicate. | Withdrawn when you apply the database update, with the reason written on the quotation. Your bell is marked read. Had it stood, it would now read "… – cost AED 5,502.73 (list AED 12,228.30 less 55%)", RED: "cost is 55% under FRONT LH LIGHT on this job (AED 12,228.30)", and the part would sell at 80% (AED 9,904.91 on that wrong cost). |
| Q-00020 v1 (J-00317) bell "Peter added TRANSMISSION MOUNT, AED 1,192" | The request was closed this morning, but the bell is still unread. | Marked read. |
| Q-00027 v2 (J-00556, replaced by v3) "New link needed for estimate" | An advisor's request on an old version, still open. | Not touched. Decline it on the quotation page if it is no longer needed. |

## What staff must do

- **Parts (Peter):** when you type a price and then pick a supplier that has a standard discount, look at the net price that appears. If the price you typed was already the net price, set the Disc % back to 0.
  - Gargash's supplier record says **standard discount 55%**. It was set on 12 October, during testing. Check with Gargash whether they really give 55% off list. If they do not, change it to 0 on **Parts → Suppliers**.
- **Advisors:** a red "Below cost" line means raise the price, or press **Raise the price, or ask the owner**.
- **Owner:** reply **"apply"** to switch on approving below cost and the self-withdrawing requests. It is in the WAITING FOR APPLY list. Until then, a price below cost is refused for everyone, you included.

## Where to find it

- A quotation: **Jobs → the car → Quotation**. A red line under a line that is below cost; your **Approve below cost…** button on it.
- A revision request: the quotation page, in your box under "Before sending". It opens straight from the bell.
- A discount that would take a line below its cost: the red words in the **Discount** window, next to **Apply**.
- Proof: `npm run test:s1-price` (sections A to H; screenshots in `tests/browser/shots/s1-price/`) and `tests/unit/below-cost.test.mjs` (`npm run test:unit`).
