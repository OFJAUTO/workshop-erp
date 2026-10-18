# 18 October 2026, afternoon batch — delivery note

Ten sections, each committed and pushed as it finished, each proven by running it (test-z sections S1–S10 plus re-runs of the older suites) with screenshots sent along the way.

## 1. Technician receives parts on his own tablet — DONE
Receiving happens only on the technician's tablet: "Parts for this car" has a tick box per line, Select all, **"I've received these (N)"** and his own PIN; received lines turn light green with his name and the time. The desk-side confirm is gone completely — Peter only ticks parts and presses **"Ready for handover"**, which instantly tells the car's technicians and the workshop manager ("5 parts ready for you: Dubai S 2618 (Tesla Model Y) at the parts desk"); two hours unreceived brings one reminder, never more. Shared bodyshop tablets: tap the car, your face, "Receive N parts", tick, PIN. Nothing blocks starting work (the red banner is now a small amber "N parts not received yet"); receiving stays required only before "Job finished" (Not needed / Returned excepted). A battery's warranty now starts at the tablet receipt.

## 2. Proforma: how will the customer pay — DONE
**Why you didn't see it on 15 October:** it was built the night of 15–16 October, a few hours after your message — and both proformas sent since (PRO‑00002, PRO‑00003) did go through it. Finished today: the chooser is exactly **Card in the shop / Payment link / Bank transfer / Cash** (cheques stay a recording method for accounts); picking Payment link always shows the paste box, with "Create the link" (Network International) offered only while the gateway keys exist and no link is pasted; an empty link cannot send; pasted links are stored, never fetched or opened by us. The message adds "You can pay by card online: open the link and tap *Pay now*." Recording a **card** payment requires a photo of the card slip, a **transfer** its proof — refused without one, kept on the job's files, shown as "Card slip"/"Proof" next to the receipt. Method changeable and re-sendable at any time; accounts see the expected method on every row; cash prints its receipt as before.

## 3. Parts screens — DONE
Ordered supplier LPO cards turn light green with "Ordered ✓"; pending ones stay white with a black border; "All ordered ✓" shows once every LPO is out; received lines inside a card turn green. Receiving is one flow on the parts page: tick, Select all, "Mark N received", then a panel on the same page with a sticker switch per part (on by default, one per unit), the supplier invoice number/date/amount (empty = to follow), and "Print stickers" / "No stickers". Received lines stay collapsed and green. The step bar follows one rule everywhere: done = light green with ✓ and stays green; current = the FIRST unfinished step in black — Pricing can never show as current while later steps are done.

## 4. Part stickers always fit — DONE
The part name is never "…": the font shrinks until the whole name fits one line, then wraps to two lines, still shrunk to fit (real line boxes counted). The job number always sits on one line ("J-00112"), shrunk, never broken. "Print all (N) · Printer 1" leads the page; "Print this one" stays per sticker. The preview is the same component in millimetres, so it matches the print exactly. Proven with "Front/Rear stabiliser link left/right hand side with bushes" on a real job.

## 5. Job card stage boxes — DONE (properly this time)
Done = the entire box light green with ✓. Current = white with a black border. Part-way (road test done, or some parts steps done) = amber. Not started = grey. The parts dots follow the same logic (current = white dot in a black ring). Proven with screenshots of a real job at the Parts stage and in Work.

## 6. Send to wash checks the wash — DONE
"Send to wash" opens: "Is the car wash free? Check with the wash team before sending", with the live picture — "In the wash now: N cars / Waiting: N", each plate and model — or "Wash is free" in green; then "Yes, send to wash" / "Cancel". "Skip the wash" stays one tap, no pop-up.

## 7. Recovery — DONE
**A.** The new trip form starts with two big buttons. **Our truck**: the saved driver (pre-selected), none of his details shown — just pin, location details, date (today) and an optional job number. **External recovery**: Flatbed | Closed box, a saved company or a new one typed once and kept with its mobile; same link for both.
**B.** What was used before: a **straight line** between the pins (your real Jamshaid delivery to Maple 2 measured ≈9.3 km straight; the road is longer — Google Maps shows roughly 12–14 km for that run). It is now the **real road route** via the Google Routes API, pick-up = pin→OFJ, delivery = OFJ→pin; maps.app.goo.gl short links are expanded by their redirects (map links only — never payment links). **Add the key in Vercel as `GOOGLE_MAPS_API_KEY`**; until then (or when a route fails) the log says "Distance not found – enter km" for a by-hand figure — never a silent straight line — and the "≈" is gone. The exact Google comparison will fill in by itself on the next trip after the key is added.
**C.** Drivers are paid monthly: per-trip "Paid" is gone (Approve/Query stay); the monthly view has one "Mark October paid – AED X" per driver/company, working only when every trip is approved ("N trips not approved yet" otherwise), written to the books and locking the month (changes need you).
**D & E.** "Export to Excel" is a real .xlsx: Date, Pick-up/Delivery, Plate, Job number, Driver/company, From, To, Road km, Price, AED/km, Status — bold frozen header, fitted columns, real dates, numbers as numbers, bold TOTAL TO PAY. "All drivers" = one sheet each plus a summary. The accounts export is .xlsx too; **no CSV remains anywhere**.

## 8. Advisor bonus — DONE
/bonus (linked from "My month"). Counts only tax-invoiced, fully paid jobs with pure profit ≥ AED 12,000 — the same profit figure as your target — with bodyshop lines (PPF, coloured PPF, tint, paint, colour change, peelable) taken out of both the check and the bonus. Default 5% (Settings), owner override per invoice with a reason (more, less, zero). Period 26th–25th, live at any time. Advisors see only their own invoices and bonus, "Waiting for owner approval" — no costs, no rates, no colleagues. You see everyone, approve the period in one tap (rows freeze), and take the Excel for Mathew (one row per invoice, totals per advisor). A credit note removes its bonus; one already paid is deducted from the next period. Only you approve or change.

## 9. Link previews — DONE
Every customer link carries a small square logo image (296×296, 7 KB) so WhatsApp shows the compact preview. Prefixes: **/q** quote, **/i** invoice/proforma, **/r** receipt, **/m** other, /d the driver's button (the staff quick-code sign-in moved to /k — those codes live one minute, nothing breaks). The driver's map pin stays a plain Google Maps link so his app shows the map.

## 10. Dashboard layout + less clutter — DONE
Every home screen (advisor, owner, accounts, Parts, technicians' My jobs) leads with "Good morning, <first name>" (Dubai time; acting-as greets that person), the date bigger and bold, and the one search bar — grey fill, rounded, magnifier, instant results from two letters with photo, plate, model, customer and stage; closed cars marked "Gone"; on tablets the search takes its own full row. "WAITING ON YOU (N)" is one box (the two old boxes folded in), opening in place, shrinking to "Nothing waiting ✓". The team target is one slim line with the ⓘ explanation and the private "My month". The summary is one slim row (label+number, tooltips instead of grey captions, 0 in plain grey, tappable with a black border). The cars list follows with small Stage (only non-empty options, with counts) and Sort dropdowns — the Pending chip row is deleted — and "On the clock" hides when empty.

## Vercel environment variable to add
- **`GOOGLE_MAPS_API_KEY`** — a Google Cloud API key with the **Routes API** enabled. Add it in Vercel → workshop-erp → Settings → Environment Variables (Production), then Redeploy. Road distances start computing on the next trip.

## Assumptions
1. **S1**: a technician may receive any part physically at the desk even if Parts forgot to press "Ready" (Ready is the notification trigger, never a gate). Legacy "waiting for PIN" handovers became "ready at the desk".
2. **S2**: cheques stay available to accounts when recording, just not as the advisor's expected-method choice; no proof photo is demanded for cheque/cash/link (the cheque has its number and date; a link records itself).
3. **S3**: the supplier invoice typed at receiving lands on the supplier LPO(s) of the ticked parts; one delivery is assumed to be one supplier's invoice.
4. **S4**: a name longer than ~50 characters may take a third line at the smallest size rather than become unreadable; real part names fit two.
5. **S5**: the Parts stage box shows amber (part-way) whenever some of its five steps are done but not all — which is most of the time a car sits in Parts, by design.
6. **S7**: the gate-out delivery block already picks the saved driver with one tap and keeps its layout; the new two-button form is the Recovery page's new-trip form. Pick-up distance = pin→OFJ, delivery = OFJ→pin; a trip with no pin (or no key) asks for the km by hand.
7. **S8**: an invoice belongs to the period of its invoice date and counts once fully paid; the bodyshop exclusion takes out those lines' sale value, the materials cost and the bodyshop tablets' clocked labour; the AED 12,000 line is fixed in code (the rate is the setting).
8. **S9**: the quick-code sign-in moved from /q to /k; codes expire in one minute so no printed code breaks.
9. **S10**: the bell stays in its usual top corner (the shell); the greeting row holds the search and "Gate in a car". The greeting+search landed on the five home screens named above; inner pages keep their own headers.
10. The DB was backed up before every migration (backups/2026-10-18T06-45-46 and backups/2026-10-18T10-26-33); all test rows were removed through tests/e2e-cleanup.sql after every run.
