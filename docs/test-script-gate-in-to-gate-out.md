# Test script: one car from gate-in to gate-out

A walk through the whole mechanical path with one car. Each step says who does it, where to click, and what you should see. Use test people from the Team page (one per role) or log in as the owner and use "View as" where a role is needed.

Before you start: Settings must have the company details filled (see the delivery note), a mechanical labour rate, at least one technician in the mechanical department, a workshop manager, a Parts person, a QC inspector and an accounts person. Use a made-up customer and car so the records can be marked inactive afterwards.

## Stage 1: Gate-in and approval (built earlier)

1. **Gate-in staff, tablet.** Open **Gate in**. Fill the customer, the car, the mileage, the keys and the photos. Save. The job card opens with a job number.
2. **Service advisor.** On the job card, send the approval link from the stage card (the centre window shows the WhatsApp message; copy it).
3. **Customer.** Open the link on a phone, add the complaints and approve the inspection. The job moves to "Waiting for assignment".

## Stage 2: Inspection, quotation and customer approval (built earlier)

4. **Workshop manager.** Open **To assign**, pick the technician and say whether a road test is needed.
5. **Technician, tablet.** Open **My jobs**, open the car, go through the checklist, add findings with photos and parts needed, finish the inspection.
6. **Service advisor.** On the job card, open the inspection report, approve it and send it to the customer. The part requests now sit on the Parts desk.
7. **Parts.** Open **Parts**, open the request, enter the exact part, the cost and the supplier. Save the price. The technician confirms the part on the tablet.
8. **Service advisor.** On the job card, click **Start quotation**. Check the lines, the labour rate (the standard rate is shown; try a lower rate and see it refused), add a service and a package, then send it to the customer. If the owner has to approve first, log in as the owner and approve from the bell.
9. **Customer.** Open the quotation link, approve some lines and decline one. The job moves to "Approved" and the approved parts appear in the **To order** list on the Parts desk.

## Stage 3: Parts ordering (new)

10. **Parts.** Open **Parts**. In **To order**, tick the parts for one supplier, type the supplier name (the list remembers earlier suppliers) and click **Raise purchase order**. The order opens as PO-00001 "Waiting for approval". Try the **PO PDF** button: it is not there before approval.
11. **Owner or head accountant.** Hear the chime, open the bell, open the purchase order and click **Approve**. If the quotation has a deposit that has not been paid, the page says so; only the owner can approve with a written reason.
12. **Parts.** Open the order. Click **PO PDF** and check the document. Enter an expected date per line and click **Mark ordered**. Put one date in the past: the line shows **Late** and the job card's Parts card counts it.
13. **Parts.** Receive the delivery: in **Receive the delivery**, enter the quantity per line (try a partial quantity first, then the rest), flag one line as **Wrong part** with a note, and click **Record the delivery**. The flagged line is listed for return.
14. **Parts.** In **Supplier invoice**, first tick **Invoice to follow** and save: the order is listed under "Supplier invoices to follow". Then come back, untick it, enter the invoice number, upload a photo or PDF of the invoice, put a different price on one line and save. The line shows the invoice price and the job cost is corrected.
15. **Parts.** Click **Print the QR labels**. A page opens with one label per part at the size in Settings (the Settings page has a **test print** link). Print or just check it.
16. **Parts, tablet.** Click **Issue the parts**. Click **Scan a label** and point the camera at a label, or type the label code and click **Find**. Tick each part, choose the technician, and the technician types their PIN. Click **Issue the ticked parts**. There is no confirm-all. The advisor and the manager get a notification. When every part is issued, the job moves to **Work**.

## Stage 4: Work (new)

17. **Technician, tablet.** Open **My jobs** and click **Clock in** (late shows in **Attendance** if after the opening hour).
18. **Workshop manager.** On the job card click **Work order**. No prices are shown. Assign the whole job or single lines to technicians and click **Save assignments**. The technician gets a notification.
19. **Technician, tablet.** Open the car in **My jobs**. Click **Start work on this car**. The clock runs. Click **Pause with a reason**, pick a reason, click **Pause now**; then start again. Tick **Mark done** on each line, add a note and a photo. The reminders about the dash cam and old parts are on the screen.
20. **Technician.** Click **Flag additional work**, describe what was found and the parts needed, and click **Send to the manager**.
21. **Workshop manager.** On the work order, the additional work shows with **Approve: send to the advisor to quote** and **Refuse**. Approve it. The advisor gets a notification and the job card shows **New quotation** for the extra work; the customer approves it the normal way (steps 8 and 9) and the new lines appear on the work order.
22. **Workshop manager.** When every line is done and every part confirmed, click **Confirm work complete, send to QC**. The button stays grey until then. The clocked hours against the quoted hours are on the work order; the owner's dashboard shows the cost.

## Stage 5: QC (new)

23. **QC inspector, tablet.** Open **Cars for QC** and open the car. The checklist lists the complaints, the work lines, the parts fitted and the general checks from Settings. Enter the mileage, upload the post-scan PDF or write why there is none, mark one item **Fail** with a remark and click **Finish: fail, back to Work**. The job goes back to Work with the failed item listed; the rework count goes up for the technician.
24. **Technician and manager.** Fix it, mark the line done, confirm work complete again.
25. **QC inspector.** Open the car again: only the failed item is listed. Mark it **Pass** and click **Finish: pass**. The car moves to the wash.

## Stage 6: Wash (new)

26. **Manager, QC or advisor.** Open **Car wash**, click **Wash done** (a photo is optional). Or, as the advisor or the owner, click **Skip the wash**, write the reason and click **Skip, car is Ready**. The job is now **Ready**.

## Stage 7: Invoice and payment (new)

27. **Service advisor.** On the job card click **Ready to invoice**. Accounts get a notification.
28. **Accounts.** Open **Invoices** or click **Issue invoice** on the job card. Check the lines: approved quotation lines, additional work, the inspection fee, the Consumables line. Try **Labour: combined** and **itemised**, type an **Agreed total** (the discount lands on labour and services only, within the limit) and click **Recalculate**. Click **Issue a proforma (for a deposit)** once, then **Issue the tax invoice**. The number is INV-00001 (or the next number from Settings). The invoice is now locked.
29. **Accounts.** On the invoice, record a payment: **Cash** for part of the amount (a receipt PDF appears), then **Cheque** for the rest (the balance stays open, the status box says "Cheque pending clearance"). Click **Cleared**. Then try a **Card** payment on another invoice and see the bank charge in the profit list.
30. **Accounts.** Click **Ask the owner for a credit note**; the owner approves it from the bell and issues it with **Issue a credit note**.
31. **Service advisor.** On the job card the "Your car is ready" message is now available: open it, check that the invoice link and the balance are in the message, and copy it. Open the link on a phone: it shows the logo, the invoice and the balance due, no login needed.

## Stage 8: Gate-out (new)

32. **Gate staff or advisor, tablet.** On the job card open the gate-out page. If a balance is still due, the page says so and the owner or accounts must click release with a reason. Choose **Customer collects**: enter the number of keys handed back (a different number than at gate-in needs a reason), tick **Dash cam reconnected** and **Old parts handed over** if asked, take the handover photos, enter the name of the person collecting, tick the confirmation and click **Gate out and close the job**. The job closes and the gate-out time and user are locked.
33. **Delivery variant.** With another car choose **Delivery by recovery**: enter the address, the date and time, **Our truck** or **Outside company** with the fee, take the loading photos and click **Stamp: left the workshop**. The job shows "Out for delivery". Later enter the name of the person who received the car, add a photo and click **Stamp: delivered, close the job**.
34. **Service advisor.** After the number of days in Settings, the job card shows the follow-up reminder with the WhatsApp message; click **Follow-up done**.

## Stage 9: Profit and reports (new)

35. **Owner.** The dashboard profit panel now counts the invoices of the day against the target, with the carry since the start of the month. Open **Profit** for the list per invoice; provisional ones (supplier invoice not in, cheque pending) are marked.
36. **Accounts.** On **Invoices**, use the export link to download the spreadsheet of invoices and payments.

## Clean-up

Mark the test customer, car and job inactive from their pages. Nothing is deleted.
