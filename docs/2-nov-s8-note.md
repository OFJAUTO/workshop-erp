# Section 8 (list of 2 November 2026, built 3 November): the Charges section shows the quotation's charges

## What was wrong (J-00969)

On the job card, **CHARGES (RECOVERY, FUEL, OTHER)** said "No recovery, fuel or other charges on this car", although the approved Q-00039 has "RECOVERY, FULL DOWN, TWO WAYS · AED 400.00".

The cause: a charge can be typed in two places.

- On the job card ("+ Add a charge"). These are kept as the car's own charges.
- On a quotation (the "Other charges" block: + Recovery, + Other charge, + Internal cost). These are kept only as quotation lines.

The Charges section read only the first place, so Q-00039's recovery never showed.

While checking this we also found places where a charge could count **twice** (or not at all) in the profit:

- A recovery on the quotation counted its quoted cost on the invoice, and the driver's trip price counted again on top.
- A charge typed on the job card counted in no profit until it was invoiced.
- On a car the customer declined, the costs of its charges were dropped from the profit.

## What changed

1. **The Charges section lists every charge of the car, once** (8.1).
   - Charges typed on a quotation now appear, marked with where they are: "on Q-00039 · approved", "on Q-00039 v2 · being prepared", "on Q-00041 · sent, waiting for the customer".
   - They are **read-only** here. The words say how the charge changes: on an approved quotation "it changes only with a revised Q-00039, which the owner allows"; on a draft "change it on Q-00039". For the owner and advisors the number is a link to the quotation; accounts see the number as plain words (the quotation page is not theirs, so a link would only reload the job card).
   - A revision being prepared never shows the same line twice. The approved figures show until the new version is approved.
   - A charge typed on the job card that went into a quotation shows once, with the quotation's words.
   - Internal cost lines show as "Internal – not charged". A complimentary recovery shows "Complimentary".
   - Not listed: Consumables, the Inspection fee line, the automatic bank charge, and a recovery the customer arranges himself.
2. **"Cost & bill" on each quotation charge** (8.1).
   - The owner, an advisor or accounts types the **real cost from the supplier's bill** (before VAT), the supplier and the supplier's TRN.
   - They attach the bill itself.
   - The answer appears in the box: "Cost AED 480.00 saved ✓".
   - The quotation is not changed. It keeps its quoted estimate, and an approved quotation stays locked.
   - The bill's figure then counts in the profit instead of the estimate.
   - Leaving the cost empty and saving puts the estimate back.
3. **A second recovery asks once** (8.2).
   - **On the job card:** adding a recovery while the car already has one shows an amber box. It names the recovery already there, for example "RECOVERY, FULL DOWN, TWO WAYS · AED 400.00 · on Q-00039 · approved". It also says that another recovery charges the customer twice.
   - The tick **"Yes, it is a different trip – add it"** must be ticked to save it. The server checks this again. The history records who confirmed it was a different trip.
   - **On a quotation:** while another quotation or the job card already has a recovery, the editor shows the same amber note. Instead of "+ Recovery" it offers **"+ Recovery – a different trip"**.
   - A new quotation no longer adds the automatic recovery line when the car already has a recovery - also when that recovery is on an additional estimate carried over at gate-in (the automatic line is decided after those quotations are made).
   - An estimate's recovery is not copied onto a quotation when the car already has a recovery (on another quotation or typed on the job card). The quotation's History and its amber "Recovery already on this car" box say what was left out, with "+ Recovery – a different trip" to add it back when it is another trip.
4. **Every charge counts once in the profit.** There is one rule for this, used by the Charges section, the job's profit, the profit page, the daily target, the owner's report and the advisor bonus.
   - A charge typed on the job card counts its cost from the moment it is saved.
   - A charge on a quotation counts once the quotation is approved: the bill's cost if typed, otherwise the quoted estimate.
   - **Recovery:** a trip on the Recovery page replaces the recovery charge it **is**, trip for trip: our own trucks' trips (no company) replace our trucks' recovery charges, a company's trips replace that company's charges. The quoted figure only stands in for a trip that is not priced yet. Example: quoted 2 trips at 250 each by ABC Towing, ABC's trips priced 220 and 240 → AED 460, not 960.
   - An outside company's tow-in with its own bill keeps its cost when our own truck delivers the car: tow-in 400 + our delivery trip 150 = AED 550 (not 150).
   - While the car is with us, a recovery that names two trips waits for both. Once the car has left, only the trips recorded on it count: a two-way recovery with only the delivery trip recorded costs that trip, and the job is not "provisional" for good.
   - An invoice line or an internal quotation line that carries a charge is never counted again.
   - A declined car keeps its charges' costs.
   - **Charged** (the header and "Profit on these so far") counts only what the customer is really charged: a charge taken off its quotation or on a declined one reads "Not charged" and counts nothing; a job-card charge that went into a revision still being prepared says "Charged to the customer once Q-00039 v2 is approved" (its cost counts already).
   - The recovery cost line names each part, for example "Recovery cost AED 720.00: AED 460.00 from 2 priced trips + AED 260.00 estimated for 1 trip still to price".
   - A charge that costs more than it is charged says only what really happened: "– the owner approved it" (his below-cost approval covers these figures), "– the owner was told" (the notice went out when it was saved), "– entered by the owner", or just "Costs more than it is charged." (for example a quotation priced before the owner's below-cost check of 2 November, like Q-00039 if its cost is still AED 250 a trip).
5. **Advisors still never see the trips' prices.** When the recovery cost comes from priced trips, an advisor sees only what is charged, plus "from the trips – the prices are with accounts".

## Lists

Source: the TEST database copy of about 31 October (the live data could not be read; Q-00039 was approved after that copy).

| Car | What is on it | Before | After |
|---|---|---|---|
| J-00969 | Q-00039 approved, "RECOVERY, FULL DOWN, TWO WAYS · AED 400.00" (owner's report) | Charges section: "No recovery, fuel or other charges on this car" | Listed: "RECOVERY, FULL DOWN, TWO WAYS · AED 400.00 + VAT · on Q-00039 · approved", with Cost & bill |
| J-00493 | a visible recovery line, cost AED 600, 2 trips not priced yet | profit would count AED 600 **plus** the two trips once priced | the two trips' prices only (AED 600 until they are priced) |
| J-00491 | a hidden recovery line, cost AED 300, 2 trips not priced yet | AED 300 | AED 300 until the trips are priced, then the trips' prices |

**To check on live after the update:**

- Q-00039's recovery may be priced at AED 200 a trip while Settings costs full down at AED 250 a trip. If the cost line still says 250, it sells AED 100 below its cost.

## What staff must do

- **Nothing changes for adding charges.** "+ Add a charge" works as before. A second recovery now asks for the tick.
- **Accounts or the advisor, when a recovery company or fuel station sends its bill for a charge that is on the quotation:**
  1. Open the car's job card.
  2. Go to **Charges**.
  3. Tap **Cost & bill** on that line.
  4. Type the figure before VAT and the supplier.
  5. Tap **Save the cost**.
  6. Attach the bill.
- **A car with recovery trips:** the drivers' and companies' prices on the Recovery page are the cost of the recoveries they are (our trucks, or that company). On such a recovery line the "Cost & bill" box then takes the bill for the paper only. An outside company with no trip on the Recovery page keeps its "Cost & bill" box: type the figure from its bill.
- **When a recovery company or our own driver does a trip,** record it on the Recovery page with the right company (empty = our truck), so the trip replaces the right charge.

## Waiting for apply

- The migration `20261203150000_quote_charge_costs.sql` adds the one column needed to keep the real cost of a quotation's charge.
- **Already working without the update:**
  - the list of quotation charges;
  - attaching their bills;
  - the second-recovery question;
  - counting each charge once.
- **Waiting until the owner applies it:**
  - typing the real cost. Until then the box says "Typing the real cost opens once the database update is applied".

## Tests

- **Unit test:** `tests/unit/charge-items.test.mjs`, run with `npm run test:unit` (46 checks at the build, 72 after the review fixes of 3 November: trips matched by who did them, closed jobs, "not charged", the below-cost words, the read-only words).
- **Browser proof:** `tests/browser/test-s8-charges.mjs`, run with `npm run test:s8-charges` against the test server, with the migration applied on TEST. Screenshots are saved in `tests/browser/shots/s8-charges/`.
