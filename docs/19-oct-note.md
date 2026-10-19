# 19 October 2026 - the full batch (staff testing day)

Eleven sections, one push per section. Migrations: `20261109090000_recovery_km_error.sql`,
`20261109093000_recovery_rls.sql`, `20261109110000_realtime_recovery.sql`. Tests added:
`npm run test:perms` (32 checks), `npm run test:preview` (27), `npm run test:live` (5).

1. **Money permissions.** Recording payments and deposits, proof photos, cheque status: accounts and the
   owner only (`recordPayments` lost `service_advisor`; `methodsFor` gives accounts all five methods and
   advisors none). The advisor's invoice page shows a read-only "Waiting for accounts" line. RLS already
   refused advisors at the database. The recovery Excel export is owner+accounts. Acting-as follows the
   acted person's role (verified by test). No payment so far was recorded by a non-accounts user.
2. **WhatsApp previews.** Every short link (/q /i /r /m /d) was a 302, so WhatsApp's robot never saw og
   tags. Each now answers HTTP 200 with generic og tags (never a name, plate or amount) and the square
   logo `public/og/ofj-square.png` (300×300, 3.4 KB), then meta-refresh + script sends the person on
   (`src/lib/short-preview.ts`). Off-site targets (map pins) stay plain 302s. Payment links are never
   shortened. WhatsApp caches old links: test with a brand-new one.
3. **Parts status is one live calculation.** `partsLiveOf`/`partsPlanned`/`planningOnOf` in
   `src/lib/parts-data.ts` compute everything from part rows (missing, late = due date passed and not
   received, to order, handed = technician-PIN confirmations only); `loadPartsLiveMap` for bulk. The job
   card, dashboard and Waiting list pass `extra.parts` to `nextStepOf`; stock-only or fully received cars
   say "Release work", never "Send LPO". The Planning card's delay note shows only while a part is missing
   AND overdue. `jobs.parts_state` is written but no screen reads it. Dead desk handover paths deleted
   (requestHandover/confirmHandover/cancelHandover/pendingHandoversFor).
4. **Technician's parts list.** Rows start UNTICKED grey; a tick turns the row light green (#E8F5EC /
   #7FC195); the button needs ≥1 tick + PIN; received rows collapse under "Received (N)" and can't be
   unticked; header counts live, "All N received ✓" at the end.
5. **Stickers.** `StickerSheet` (labels + handover pages): grid, tick box right of each sticker, all
   ticked, Select all / Clear all, one "Print selected (N)" print job (one page per sticker, in order).
   "Print this one" removed everywhere. The single-sticker oil page keeps its one button.
6. **Parts cost.** The parts page bottom bar: "Our cost: AED X + VAT 5% AED Y = AED Z", per-supplier
   split, "Selected: AED X" for ticks; columns renamed "Net each" + new "Line total" (qty × net each).
   Removed/not-needed/returned lines count nowhere. Parts, advisors, owner only.
7. **Print / PDF.** `/api/pdf/parts-check/[jobId]` (role-gated 403): A4 landscape "PARTS PRICE CHECK -
   INTERNAL", pen tick boxes, 12 columns, notes in grey, supplier subtotals, GRAND TOTAL, repeating
   headings, "INTERNAL - NOT FOR THE CUSTOMER · Page n of m" every page.
8. **Recovery distance.** Root cause: `workshop_location_pin` was EMPTY (set now from ofjauto.com:
   25.1165302,55.2168173). `recovery_trips.km_error` stores why a distance is missing (Google's status +
   message, never the key); "Recalculate distance" per trip (owner+accounts); cron step 22 recalculates
   km-less trips hourly on the server where GOOGLE_MAPS_API_KEY lives. All four stuck trips now carry
   real road km (pickup = pin→OFJ 13.0 km vs delivery = OFJ→pin 14.4 km for the same pin).
9. **Recovery money.** Advisors see the trips list only (date, kind, car, who, pin, photo, plain
   Booked/On the way/Delivered ✓ status, "Price: with accounts" on external trips) and the New pick-up
   form; owner+accounts keep totals, prices, AED/km, approve/query, Mark month paid, exports,
   recalculate. RLS was OFF on recovery_trips and recovery_drivers (any login could read prices and
   phones over REST) - now on, owner+accounts only; recovery_payouts tightened the same way.
10. **Live screens.** LiveRefresh: realtime + 30 s quiet re-fetch everywhere (60 s overrides removed),
    hidden tab pauses and catches up on return, changed rows flash their `[data-flash-id]` card, the
    dashboard shows "Updated just now", offline shows a grey "Offline – reconnecting…" chip.
    recovery_trips joined the realtime publication; RLS filters what each person's feed carries.
11. **Scans mailbox.** Everything is built (16 Oct); not connected because GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET and SCANS_MAILBOX were never added in Vercel. Redirect URI:
    `https://erp.ofjauto.com/api/google/mailbox/callback`. The Connect button appears on /scans (owner
    only) once the variables exist.
