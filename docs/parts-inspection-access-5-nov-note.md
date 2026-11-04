# Parts desk: view + print inspection reports — 5 November 2026 (night)

What the owner asked for (queue of 4 November): the parts desk opens every inspection report
read-only to double-check parts, prints it internal, and never sees customer details or a button
that changes anything.

Half of this was already live from the morning's fix batch (4 November): the parts desk (and the
gate-in person) can open the inspection page read-only with no customer details and no action of
any kind (Fix 2.6), and the **Print (internal)** menu with its four choices — full list, full
with photos, findings only, blank checklist — prints an INTERNAL A4 with no customer name, phone
or price on it (Fix 5, proven by `npm run test:fix5`). This task added the ways in and the proof.

## What is new

1. **"View inspection" from the Parts page**: every car row on the Parts desk (the search results
   and the All cars list) now carries a **View inspection** link on its right. The row itself
   still opens the car's parts page as before.
2. **"View inspection" on the car's parts page** (`/parts/<job>`): a button in the header, next
   to Parts desk.
3. **The inspection list** (`/parts/inspections`): a new page for the parts desk and the owner —
   every inspection, newest first, cars in the workshop above cars that have left, each row with
   the car's photo, plate, job number, the inspection's status (Approved / Submitted / …), the
   technician and the date. One search box (plate, job number or VIN). Opened by the
   **Inspection reports** button at the top of the Parts page. No customer details anywhere on it.

## Proof (`npm run test:partsinspect`, 16 checks as a real parts login)

The links from the Parts page, the car's parts page and the list all open the report; the page
shows no customer name, no phone and no button that changes the inspection; the internal PDF
prints for the parts login; a parts login that tries to change the inspection through the server
is refused (403); a technician is turned away from the inspection list. Screenshots in
`tests/browser/shots/parts-inspect/`.

No database change — nothing on the WAITING FOR APPLY list from this task (the check-in template
row from the resend task is still waiting there).
