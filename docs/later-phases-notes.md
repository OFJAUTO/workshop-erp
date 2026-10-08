# Notes for later phases

Given by the owner on 7 October 2026. Recorded, not built.

## Quotation (Phase 4)

- Advisor requests part prices; parts enter cost and delivery time; advisor adds markup at or above the minimum markup setting; a quote cannot be sent with unpriced parts.
- Customers can approve part of a quote.
- Extra work found during repair goes back for a new quote and approval. A QC fail returns the job to the technician.
- Quoted labour hours are typed in from Alldata per job line and compared with clocked hours.
- Open question: whether quotes above a set total need owner approval before sending.

## Clocking and profit (Phase 4 and 6)

- Job clocking moves forward to arrive with invoicing.
- Profit per invoice = selling price before VAT minus parts, materials, outside work and clocked technician time at the cost rate.
- Technician cost rate (setting, AED 90 per hour, optionally per department) is visible to owner and accounts only. Advisors and parts can see part costs.

## Parts (Phase 5)

- Purchase order approved only by owner or head accountant.
- On delivery: tick each PO line, enter and scan the supplier invoice from phone camera or PC upload (compulsory). "Invoice to follow" is allowed, with a pending list; no supplier payment until scanned; the PO price is used meanwhile and profit is marked provisional. A pending supplier invoice turns red after the set number of days (setting, 7).
- Print a QR label per part (plate, job, part number, description) on the workshop's thermal printer. Shelve by plate. Ask the owner for the printer model and label size when this phase starts.
- Issue by scanning with tablet or phone camera; the technician ticks each part individually and enters his PIN, no "confirm all". Returns are scanned back. A job cannot close with unconfirmed issued parts.

## Hosting

- Supabase is on the Pro plan since 7 October 2026. Compute size decision pending (see Phase 1 Part 1 notes).

## Inspection fee and leaving the workshop (owner notes, 8 October 2026)

- Inspection fee: when a customer declines all quoted work, the inspection fee (setting, AED 750, shown on the approval page) is added to the invoice automatically before gate-out.
- Leaving the workshop: when a car is Ready, the advisor chooses Customer collects / Customer's driver collects / Delivery by recovery.
- Delivery by recovery uses our own truck or an outside company; both must be possible. Outline: book address, date, time and any fee, shown on the Calendar; the payment rule applies before loading; photos or video and a keys check at loading, stamped "Left workshop"; photos and customer confirmation at the door, stamped "Delivered" with time and location; the job closes only after Delivered.
- The same booking works in reverse for collecting a car from a customer.

## Promised date (owner notes, 8 October 2026)

- No promised date box on the job card at any stage before the quotation; the date depends on parts availability.
- The promised date is set only inside the quotation, as the last step before sending, once every part has its delivery date.
- Suggest it automatically: the latest part delivery date plus the working days the labour needs. The advisor can change it.
- Compulsory before the quotation can be sent; warn if it is earlier than the latest part delivery date.
- Once set it shows on the job card and dashboard as read only. The owner or an advisor can change it later with a reason, which is logged (built: the Next step panel on the job card); the customer's quote page shows the current date.
- A quick job from an estimate or a fixed-price package with no parts follows the same rule: the date is set in the quotation.
