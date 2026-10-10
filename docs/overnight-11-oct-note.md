# Overnight build, 10 to 11 October 2026

Built while you slept, from your evening list. One migration (`20261020090000_overnight_round4.sql`, backup first) was applied to the live database; everything else is code. The earlier list (fixes from the first day of staff testing) was confirmed finished first. The new work was tested by running a headless browser against a local copy of the site: a loose-item job through the whole path (gate-in, quotation, QC, collection in two visits, the owner's report), a parts handover with the technician's PIN and a battery warranty sticker, a per-tyre service through to the work order, the break on the technician's clock, the workshop load list, the scan email page, and the technician screens at phone width. Every test row was removed afterwards, including the stray test job from your live site.

## A. Bugs

- **A1** The test job "Stage Customer / Q-STAGE-1" is gone from the live site. The test harness now cleans up at the start and at the end of every run, including anything a test created through the screens (test customers have a phone starting +9715000000).
- **A2** Approved work always reaches the work order. A fixed-price service carries a time allowance; the work order gets allowance × quantity (a 0.3 h balancing on 4 tyres is a 1.2 h line). Tested through the real approval path.
- **A3** The black Next step button follows the workshop path; sending a tax invoice early stays a side action. Verified in code and left as a safeguard.
- **A4** The scan report is step one of the inspection, compulsory: the technician reads the PDF (or attaches it by hand, or says "Scan not possible" with a reason); Start inspection stays grey until then.
- **A5** Every hours box takes 0.1 steps, also under one hour: 0.5, .7 and 1,3 (comma) were typed and saved as 0.5, 0.7 and 1.3; the manager's budget box takes 0.5. Part quantities, sticker counts and recovery trips are whole numbers; litres keep decimals.

## B. Services

- **B1** A fixed-price service has "Price is per" (Job, Tyre, Wheel, Injector, Cylinder, Axle, Unit, or your own word), "Usual quantity" and "Time allowance (hours)" in Settings > Services. On the quotation the line shows "AED 50 per tyre × 4 = AED 200" with a quantity box; customer pages and PDFs show unit price, quantity and total.
- **B2** Consumables are off by default and never added by themselves. "+ Consumables" in Other charges adds the line at the amount from Settings.

## C. Parts handover

- **C1** No scanning. Labels are optional and off by default (Settings > Stickers); "Print label" sits on the part for shelf parts.
- **C2** Parts taps "Hand over" and ticks the parts. The technician gets "Peter is handing you 4 parts for Dubai S 30303" on his own device and types his PIN there. Until he does, the parts still count as with Parts; the Parts screen turns green when he confirms.
- **C3** A technician without a personal device signs at the counter: "Sign here" opens a four-digit box on the Parts screen and nothing else. Parts sees who has a personal device in the list.
- **C4** A handover is a batch: several parts, one PIN.

## D. Stickers

- **D1** Part sticker 20 × 20 mm (logo, QR, date, last 8 of the VIN), optional, a − + counter per part, "Hand over and print 3 stickers". Reprints from the Parts trail are written down.
- **D2** Battery warranty sticker (about 60 × 60 mm): compulsory, locked to the quantity, printed before the technician can confirm. Brand, model and serial are kept; the warranty length comes from Settings (overall and per brand). Scanning the QR shows "In warranty until …" or "Expired" to anyone.
- **D3** Oil service sticker: serviced date (work start), next service a year later or +10,000 km (+6,000 miles), editable, compulsory when the approved work includes an oil change. The job card says "Oil service sticker: not printed yet"; gate-in, Parts, advisors and you can print it; QC has the line "Oil service sticker fitted and details correct"; the next service is saved on the car.
- **D4** Settings > Stickers: sizes, wording, defaults, intervals, part types that get a sticker, the required switches, logo upload, a live preview and a test print.
- Every QR is a short link (`erp.ofjauto.com/s/<code>`): staff land on the record, anyone else on a plain page. Printing uses the browser's print window on an exact-size page, with a PDF as the fallback. Tell me the printer model when you have it.

## E. Workshop

- **E1** Working time 8:00 to 17:00, Monday to Saturday; breaks Mechanical 12:30 to 13:30, Bodyshop 13:30 to 14:30 (Settings), and a person's own break on the Team form.
- **E2** The clock pauses itself at the break ("Break", never counted against the technician) and offers "Keep working", which is written down. Timers and finish dates skip the break. The wash board shows "On break until 14:30" during the bodyshop break.
- **E3** One clock per technician. Starting on a second car pauses the first with the reason "Another job".
- **E4** The assignment list is one thin line per technician, freest first: tick box, photo with a status ring (green free, amber on a car but clock off, red working), what he is doing now, his cars as plate tags, and a load bar for the week (green under 60%, amber to 90%, red above). Ticking a busy technician asks once and never blocks. The same list without tick boxes is the "Workshop load" page in the menu.
- **E5** Device modes. A red dot on a photo on the tablet login means that person has something waiting. A personal device stays logged in and never locks; the PIN is asked only to sign for parts and to finish a job. Logging out never stops a clock. Switching a device between shared and personal is one tap on the Tablets page; "Block this device" locks a lost tablet out at once. Every handover records the device and the PIN.
- **E6** The technician screens were checked at phone width (390 px): no sideways scrolling.

## F. Small things

- **F1** Job card tiles: green with a tick when done, black ring on the current step, amber when waiting on someone, grey when not started.
- **F2** The speaker icon in the notification panel opens the sound and tone choice, with a play button per tone.
- **F3** The bell is a quarter bigger.
- **F4** Scan VIN is gone. The VIN is typed with the 17-character check; I, O and Q are refused; the model year comes from the VIN; a known VIN offers the existing car.

## G. Loose items

- Gate-in has "Loose items, no car" next to the car search. The short form: the customer (search or new, name and phone), one line per item (Wheel, Tyre, Engine, Gearbox, Bumper, Bonnet, Door, Seat, Headlight, Part, or your own word; a few words; how many; a photo), who brought them, what the customer wants, what we saw at the counter, which side does the work, priority.
- Each item gets a QR tag (Print the tags on the job card: logo, job number, customer, item, QR).
- The path is Gate-in → Quote → Approval → Work → QC → Ready → Collected. No job-card approval, no inspection report, no wash: the quotation opens straight away and QC pass makes the items Ready. The track and the job card hide the steps that do not apply.
- Items go home one by one: the gate-out page lists them with tick boxes; "2 items collected, keep the rest" leaves the job open; the last item closes it. The same money rules apply (no invoice or a balance: the owner or accounts release it with a reason).
- The dashboard and the jobs list show a "Loose items" badge; customer pages and PDFs say "Items" instead of "Vehicle".

## H. Your reports

- **Per job, written at gate-out** and sent to you as a notification: verdict (good, acceptable, needs a talk) with the reasons; money (invoiced, discount, parts, technician time, other costs, profit and margin, collected, balance); time (in the workshop, promised, late, hours charged against hours on the clock); where the time went, step by step against the targets, with the delays in words; the people (advisor, manager, technicians with their minutes, QC, gate-in, gate-out); the customer (visits, VIP, comebacks); and the things to look at (overrides, releases with a balance, QC fails, send-backs, pauses not accepted, late parts, discounts, a thin margin, a loss).
- **Reports in your menu**: Monthly summary (the numbers, verdict counts, what came up, every job), Finished cars (needs a talk first), People (technicians with efficiency and send-backs, advisors with invoiced, profit and discounts, managers, QC). A month arrow on each; "Download PDF" on the monthly summary.
- On the 1st of each month the summary of the month before comes to you as a notification with the link (the hourly job sends it once).
- Settings > "Good margin, %" (25 by default): a margin under it makes a good job acceptable; a loss always needs a talk.

## I. Scan reports by email

- The receiving end is written for Postmark's inbound email. Scan reports > "How to set up" walks through it: the account (free up to 100 emails a month, then about 15 dollars), the server and its inbound stream, pasting the system's address into Webhook URL, the Postmark inbound address to type into the Autel, the optional MX record at Squarespace (one record added for `inbound.ofjauto.com`, nothing changed) for `scans@inbound.ofjauto.com`, forwarding from Gmail, and how to test.
- Emails that are not scan reports (a forwarding confirmation, a reply) are kept under "Other emails" with their subject and text, and can be put away.
- The system's address is hidden behind "Show the address" (you only), with Copy and "Generate new token"; after a new token, paste the new address into Postmark.

## Assumptions

- A loose-item job still passes through the planning card after the customer approves (Parts plan any parts, the manager picks the technician and releases it); that is where the technician is chosen, so I kept it rather than invent a second way.
- Loose items hang on a hidden "vehicle" record of kind "loose" (make "Loose items"), so quotations, invoices, QC and the reports keep working unchanged. It never shows as a car anywhere.
- The owner's per-job report is also built on the fly for jobs that closed before tonight, the first time you open them.
- Postmark was assumed as the inbound email service (the endpoint reads its JSON). Any service that posts the same shape works; nothing was signed up for.
- Battery stickers use the large sticker size (60 mm) and the item tags too; the printer model will decide the exact sizes.

## Not done

- The phone app and the bodyshop path remain as before.
- Zoho Books is still to do.
- "Offer the existing car when the VIN is known" on the new-car form checks the VIN on save (it refuses a duplicate and says to search for the car); it does not yet jump to the existing car by itself.

## Waiting for you

- The printer model for the stickers and tags.
- The Postmark account (or tell me the service you prefer), then the two addresses from the page.
- Confirm the breaks and the good-margin percentage in Settings.
