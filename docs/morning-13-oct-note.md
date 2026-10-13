# Morning list of 13 October 2026: delivery note

One migration after a backup (`backups/2026-10-13T07-27-05`): `20261025090000_morning_13_oct.sql` (the `upload_failures` log, `suppliers.import_mapping`, and the data fix that takes part numbers out of quotation line titles). Browser test `tests/browser/test-f.mjs` (`npm run test:f`): 88 of 88.

## Last night's PART 1

Re-run this morning on a clean dev server: `npm run test:d` (the PART 1 proof: rows that never move, number boxes that keep what is typed, Pricing done blocked only by Not finished and Waiting for owner approval) 89 of 89; the other suites: PART 2 57 of 57, 12 October 67 of 67, notifications 55 of 55, day one 72 of 72, overnight 66 of 66, this morning's 88 of 88. Four old checks were brought in line with today's screens (the Parts name is corrected through the picker, "+ Photo" is a button, a learned suggestion chip can carry the words "Close to minimum", a pending LPO has no PDF).

## 1. Gate-in: the button says what is missing

- `src/lib/media-checklist.ts` turns the checklist into words. The header button (`FinishGateInButton`) reads "Finish later: car picture missing" for one item, "2 items missing: car picture, keys back" for several; the words "video pending" appear only when a video is the missing item. The grey line under the checklist reads "<n> item(s) left: <names>".
- Pressing the button turns every missing item red (items, the summary rows, the grey line), scrolls to the first and shows "Go to next" and "Leave it for now" right under the button. Nothing is red before the press. When the last item arrives the button becomes "Open job card" / "Done, next car" by itself.
- The job card's button names the missing item too ("Finish gate-in: car picture missing"); the job status label is now "Gate-in incomplete" (it used to say "video pending" whatever was missing).

## 2. The car picture never fails quietly

- `CarPictureCrop`: after "Use photo" the cropped picture stays on the item as a preview with "Uploading… n%"; the item turns green only when the server has recorded the file and the checklist counts it (`checklist.carPicture === true`). A failed or cut-off upload (no connection, the phone asleep, the register step lost) turns the item red with the preview, the error in words and a Retry button; Retry sends the same cropped picture again. Closing the crop with a photo in it asks "Use this photo as it is?" (Use as it is / Discard the photo / Keep framing) instead of throwing it away.
- Every upload now has a stall detector (`putWithProgress`: 90 seconds without progress ends with "The upload stopped… Tap Retry") and a 60-second limit on the server steps, so a photo button can never stay dead.
- Failures are recorded: `upload_failures` (job, inspection, kind, step, error, person, device, browser, size, online/visible at the time) through `POST /api/media/failure` (`reportUploadFailure` in `src/lib/upload-client.ts`, sent as a beacon). The owner reads them in Settings > Failed uploads (`/settings/uploads`): time, person, device or browser, step ("Opening the camera", "Reading the photo", "Asking for an upload address", "Sending the file", "Recording the file"), the error, the job.
- The same check on every other gate-in item: `MediaCapture` (dashboard, keys, wheels, damage) keeps a small preview of each photo while it uploads, turns red with Retry on failure and logs it; `VideoCapture` logs failures, keeps the file for Retry, and no longer hangs on "Checking the video…" for a format the browser cannot read (eight-second limit). A file that was sent but not counted by the checklist is treated as a failure ("sent but the gate-in did not count it. Tap Retry"), never as Done.

## 3. Customer videos

- The approval page shows the videos through `CustomerVideos` with its own feed `GET /api/customer/media?t=<approval token>`. A video still on its way has its slot with "Video getting ready… It will appear here by itself. No need to refresh."; the page asks every 8 seconds (for up to two hours, and whenever the page comes back to the front) and swaps in the player when the file arrives. Never an empty player.
- Addresses do not go stale: the player starts with a poster and a Play button; on Play, an address older than 40 minutes (or one that failed) is renewed from the feed before playing, so a page left open or opened hours later still plays. Every player is `playsInline` and `muted` with the controls to unmute, `preload="metadata"`.
- A video that will not load shows "Couldn't load the video. Tap to try again." (the tap renews the address and reloads); after a second failure it adds "This video format may not play on this phone."
- Format: the files are served as they were recorded (MP4 or MOV). There is no transcoding service in the stack, so an iPhone recording in High Efficiency (HEVC) cannot be converted to H.264 for Android. Until a conversion service is chosen (see "Waiting for you"), the recording button on iPhones and iPads shows the one-line hint "Settings › Camera › Formats › Most Compatible, so the customer's phone can play the video".

## 4. Photo buttons on the tablets

- `CameraCapture` opens the camera inside the page (live preview, one big shutter, Flip, Done for several photos) on any phone or tablet whose browser can open a camera; the page never switches to the camera app, so it can never be reloaded behind the photo and the picture always comes back. On a PC the file picker opens as before. `PhotoButton` is one real `<button>` for every photo (no label tricks): "+ Photo" is the camera, "From gallery" the device's photos.
- If the browser has blocked the camera, the window says so and lists the exact taps for the device in hand (iPad or iPhone Safari: the "AA" button › Website Settings › Camera › Allow, or the Settings app › Safari › Camera; Android Chrome: the lock icon › Permissions › Camera › Allow, or Android Settings › Apps › Chrome › Permissions). No camera, or a camera in use by another app, is said in words. "Use the camera app instead" is always there as a fallback. A camera that would not open is logged as a failure too.
- Used everywhere a photo is taken: the inspection ("+ Photo", "+ From gallery", `InspectionMedia`), the gate-in items and the car picture, the wheels, and every job file button (`JobFileUpload`: work photos, the delivery and gate-out, the QC post-scan, supplier invoice scans, the road test). Videos keep the camera app (a browser's own recorder writes different formats on iPhone and Android, which would make item 3 worse); their buttons are real buttons as well.

## 5. The Parts table widths

- Checked at 1366 px and 1920 px (the browser test measures the text against the box). At 1366 the row has two lines: Part · Qty · List · Disc % · Net · Supplier · Availability on the first, the part number (a 26 rem box, 22 characters with their spaces in full, next to Copy) and the type on the second. From 1760 px (110 rem) everything sits on one line with a 17.5 rem part number column. A 22-character part number such as "A 222 320 04 38 80" is never cut, typed or saved.
- The Part column is capped at 11 rem (the width of "Upper control arm"); a longer name wraps onto a second line inside the same row height (the rows were measured equal before and after).
- Supplier is 14 rem and the dropdown shows the name only ("E2e Al Futtaim Auto Centre" in full; the standard discount still lands in the Disc box when a supplier is picked). Availability is 12 rem; the days box appears beside it only for "Other…", so the dropdown has its full width the rest of the time.

## 6. The categorised picker for Parts

- One `PartPicker` everywhere a part is chosen: the technician's inspection, the advisor's "+ Add a part", and now the Parts desk. Categories on the left in the owner's order (Servicing, Brakes, Wheels and tyres, Suspension and steering, Engine, Fuel and exhaust, Cooling, Air conditioning, Transmission and driveline, Electrical, Other; `CATEGORY_ORDER`), the parts of the category on the right, the search box on top, Suggested and Most used first where they apply.
- Adding ("+ Add a part the technician did not list"): tap several, each turns light green with a tick, quantity and position only where they matter (paired parts: Front pair / Rear pair / All four), then Done; one row per part with its positions ("front pair · Added by Parts"). Editing (tapping the name, or "Edit part name" in the menu): one tap picks the new name and the row keeps "Technician wrote: <original>" at once (and after the save).
- Manual always: "Custom part" at the bottom opens a box for the name; a search with no match offers "Use '<typed text>' as a custom part". Custom names typed on the Parts desk are counted (`noteCustomPartNames`) and offered to the owner in Settings > Parts list like the technicians' ones.

## 7. Import prices

- "Import prices" on the Parts page opens `/parts/<job>/import`. Four ways in, every one ending on the check screen; nothing is written before Apply; manual entry is untouched.
- a) Upload file: Excel or CSV, one or several, by button or drag and drop. Mercedes B2BConnect is recognised by its headings (Part → part number with runs of spaces collapsed to one, Quantity → qty, Designation → description, List Price → list, Net Price → net, discount = 1 − net/list, the file's VIN compared with the car's with an amber warning and a tick before Apply when different, every other column ignored, numbers with commas read). The sample `docs/B2BConnect_Format_9.xlsx` reads 98 lines at 55%.
- b) Paste from email: a plain-text box (Ctrl+V anywhere on the page works too). Both layouts are detected: tab-separated rows, and one value per line (headings first, values in groups of the heading count, lines of spaces, then "Gross Amount", "Vat", "Net AED" with their values). The Land Rover mapping: Product → part number, Description, Quantity, Unit Price(AED) → net (no list, discount blank), Availability → In stock / "1 day" → Next day / "<n> days" → n days / "will update" or anything unclear → "Supplier to confirm" (amber); WipNo, Total, LineNo ignored. The reader is general (headings, then rows of the heading count), so other suppliers' tables and cells copied out of Excel read the same way. Samples: `docs/landrover-paste-sample-tabs.txt`, `docs/landrover-paste-sample.txt`.
- c) Upload screenshot: built behind the environment key, off until it exists (the tab says so plainly). See the report for the service and the cost.
- d) Unknown formats: the mapping step shows the columns with a choice each (Part number, Description, Quantity, List price, Net price, Line total, Availability, VIN, Ignore); "Read with this mapping" reads the lines on the spot; "Save for this supplier" keeps it on the supplier (`suppliers.import_mapping`) and the same headings are recognised next time ("saved mapping").
- Cross-check: the lines (net × qty, or the line totals) are added up against the total before VAT found in the source (Gross Amount, Subtotal, Total before VAT, Net amount; or Total minus VAT). Match: a green line with both figures. Mismatch: "Totals don't match, check the prices" in red, no "Confirm all", and Apply only once every line is confirmed by hand. No total: a grey line saying so. Anything unreadable is left blank, never guessed; a source with no table at all says so and offers the mapping step.
- Check screen: supplier (required, pre-selected from the file where it says), the VIN line, the totals line, warnings (duplicate part numbers, nothing under the headings), then every imported line (description, part number, qty, list, discount, net, availability chip) beside its match on the car's list: same part number first, else the closest name (each row suggested to one line only; two lines pointing at the same row turn red with "Same match as another line: change one" and hold Apply). Per line: the match dropdown (Change match, "+ Add as new part", "Skip this line") and Confirm; "Confirm all matched" when the totals agree (never for screenshots). Apply counts the confirmed lines.
- Apply goes through the same save as a typed row (`autoSavePartRow`): part number, list, discount, net, quantity, supplier and availability; a list price without a net takes the supplier's standard discount; the owner's approval limit, the row states and Pricing done apply unchanged; "Supplier to confirm" leaves the availability box open. Dealer files set the type to genuine when the row has none. A job event records the import.
- Part numbers never reach a customer: quotation line titles are the name only (the data fix cleaned the old "(number)" suffixes), the quotation, estimate, proforma, tax invoice and receipt PDFs print no number (the LPO, the supplier copy and the internal screens keep them).

## Assumptions

- "Supplier to confirm" availability leaves the row's availability open (Not finished: availability) rather than a new state; the check screen shows the amber chip.
- The categorised picker on the Parts desk replaced the typed name box and the browser prompt; typing is still there through "Custom part" and the search box. The manager's parts list on the report page only confirms the technician's list (no adding), so it has no picker to swap.
- On a PC the photo buttons open the file picker, not the webcam; the in-page camera is for phones and tablets.
- The customer's videos start muted (as asked) with the controls to unmute; the player renews its address after 40 minutes (the address itself lives an hour).
- The Land Rover sample files were written from the description in the morning list (the originals were not on this PC); the B2BConnect sample is the third file from Downloads, saved as `docs/B2BConnect_Format_9.xlsx`.
- A B2BConnect file has no grand total, so its totals line says there is nothing to check against; the per-line totals are still read.

## Not done

- Video conversion to H.264 for every phone (needs a service; see the report).
- Phone tests from WhatsApp on an iPhone and an Android (no phones here); the player was tested in Edge at phone width.
- Reading screenshots is wired but off until the key exists.
