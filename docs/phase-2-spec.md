# Phase 2 specification: gate-in, customer approval, job cards, floor board, gate-out

Given by the owner on 7 October 2026 together with Phase 1 approval. This replaces all earlier gate-in notes, including the old `gate-in-spec-phase-2.md` and the gate-in section of the blueprint.

## Gate-in: who and where

- Gate-in by the Gate-in role, service advisors, workshop manager and owner only.
- Can start on PC, tablet or phone. PC or tablet shows a QR code for the job; scanning it on the phone opens the photo and video steps.
- Large one-tap buttons, not drop-down menus. Keep it fast.
- No accessory checklist (no antenna, CD player, spare tyre kit).

## Gate-in: fields (all compulsory unless marked optional)

1. Customer and car, by plate or VIN scan. For returning cars, show last visit summary and previously declined work automatically.
2. Arrived by: collected by our recovery / customer drove it in / delivered by customer's driver / delivered by outside recovery.
3. Vehicle condition: runs and drives / requires assistance to run and drive / does not run, does not drive.
4. Fuel level: empty / quarter / half / three quarters / full. Battery percentage for electric cars.
5. Cleanliness: clean / average / dirty / very dirty or muddy.
6. Dash cam fitted: yes / no. Small text under it: "Dash cam will be disconnected as per terms and conditions."
7. Mileage, with a dashboard photo.
8. Walk-around video (exterior, interior, dashboard), taken once the car is parked inside the workshop. 1080p, 90 seconds maximum, recording stops automatically, compressed and uploaded inside the gate-in screen. Must work well on a phone. Optional extra damage close-up photos.
9. Keys: number received, came with keychain yes / no, and a photo of the keys. No key tag number.
10. Customer requests in their own words, plus one free-text notes box for unusual cases (optional).
11. Customer wants old parts returned: yes / no.
12. Priority (high / normal / low) and promised date.

## Gate-in: rules

- Until the video, dashboard photo and keys photo are uploaded, the gate-in is "incomplete, video pending". It shows that way on the dashboard, the approval link cannot be sent, and the car cannot be assigned to a technician.
- Gate-in date and time come from the server clock, and "gated in by" comes from the login. Both are set automatically and can never be changed by anyone, including the owner.
- After gate-in is complete, photos and videos can be added but not deleted or replaced. Corrections to other fields are logged as amendments showing the original value, the new value, who and when.
- Show vehicle condition, priority and the VIP badge on the car's card on the floor board.
- If a dash cam is fitted, show "Dash cam fitted: disconnect" on the technician's job screen.

## Customer approval page (first approval)

- The advisor sends one link by WhatsApp (copy or tap to send, no WhatsApp API).
- Professional and branded: company logo, white, black and grey style.
- Shows the video at the top, the job card details, the keys record, and a link to the terms and conditions.
- If a dash cam is fitted, show the disconnection line.
- If cleanliness is dirty or very dirty, show: "Vehicle received dirty; existing scratches and marks may not be visible in the video."
- One tick box: "I agree to the terms and conditions and confirm I am the owner of the vehicle or a legal representative authorised to act on the owner's behalf." The customer types their name and taps approve.
- Record the name, the phone number the link was sent to, when the link was opened and when it was approved.

## Gate-out

- Show the gate-in keys photo and count. The advisor enters the number of keys returned and confirms the keychain. If it does not match gate-in, gate-out is blocked; only the owner or workshop manager can override, with a written reason, and it is logged.
- If a dash cam was fitted, a compulsory tick: dash cam reconnected.
- Gate-out date, time and user are locked the same way as gate-in.
- A car with a balance due cannot be gated out unless the owner or accounts approve the release. Every such release is logged.

## Floor board and dashboard

- Follow `workshop-erp-dashboard-design (1).html`: every car with its nine-step track (Gate-in, Inspection, Quote, Approval, Parts, Work, QC, Wash, Ready), its status in plain words, and a Pending row.
- Only the workshop manager assigns and instructs technicians.
- Every handover between people is logged automatically with name and time.
- Daily profit target panel at the top of the dashboard for owner, accounts and advisors, always visible. Green when the target is reached, yellow at the threshold (80 percent) or more, red below. Shortfall or surplus carries to the next day (red minus, green plus) and resets monthly. Show invoiced and collected separately. Until invoicing is live, show a clear "starts with invoicing" state, not zeros.

## Earlier answers that still apply (6 October 2026)

- Phones: advisors, workshop manager and owner may use a phone for the photo and video steps. The QR opens a short-lived link (about 30 minutes) for that one job with no login on the phone; uploads are recorded under the person who showed the QR.
- Scanning: VIN barcode scan plus automatic reading of the plate (and VIN) from a camera photo via an image-recognition service, with typing as the fallback.
- Customer at the counter: the advisor may open the approval page on the tablet for the customer to approve on the spot.
- Video retention: gate-in videos are deleted automatically after 6 months (a setting). Nobody can delete them by hand before that. Photos are kept.
- Car profile picture: can be taken at gate-in or picked from the gate-in video.
