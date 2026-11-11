# View as customer (10 November 2026, Section 10)

- **View as customer** next to "Job card" on: the inspection report page, the quotation page, the estimate page, the money page (proforma / invoice) and the job card (the customer's vehicle check-in with the gate-in photos and videos).
- It opens exactly the customer's page (the same component) in a phone-sized frame, with anything marked "Hide from customer" hidden, plus "Open in a new tab".
- Read-only: a black bar says it is a staff preview; the customer's action (approve, pay now) is switched off; staff viewing never counts as "Opened by the customer" (no opened stamp, no bell, the PDF's "viewed in full" stamp is not set either).
- Not sent yet: the frame and the bar say **"Preview – not sent yet"**. A report or quotation with no link yet gets its link made when the button is pressed (exactly as the send would make it), never sent.
- Not included: the warranty certificate page has no button yet (its page keeps working as before).

No database change. Test: `test:sim` path d10 (6 checks). Proof: `docs/proof/2026-11-10-view-as-customer/d10-inspection-report-phone.png` (an inspection report seen as the customer, on TEST; J-00995 is a live car, so it was not opened from here).
