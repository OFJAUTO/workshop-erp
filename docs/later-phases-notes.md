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
