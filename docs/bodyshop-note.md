# The bodyshop (14 October 2026, evening): studio jobs, accident repair, due dates, sign-off, premium customer pages

Plain words on what was built, where to click, and what to expect. Migrations `20261028090000_bodyshop.sql` and `20261028093000_bodyshop_settings.sql` (both applied after a backup). Test `npm run test:i`.

## 1. Quote before the car arrives

- **Bodyshop > New bodyshop quotation** (advisors): pick the customer and the car (make, model, year, colour are enough; the VIN can come at gate-in). The usual quotation builder opens. Behind it sits a *booked* job: it has a job number but stays off the floor board until the car is gated in.
- **Packages** live in **Settings > Services > Bodyshop packages**: Full PPF, Coloured PPF, Window tint, Peelable door jambs, Full peelable colour change, Full respray, Old PPF removal, Wash, Accident repair, Other. No fixed price and no car-size pricing: the advisor types the price every time; "Last time AED 18,000" shows as a small hint under the name.
- **Coloured PPF** lines have Film colour and Code boxes; **Window tint** lines have a Shade % box. They are kept on the quotation and shown on the bodyshop page and the warranty certificate.
- **Old PPF removal** on a quotation shows the note "We take great care removing old film, but paint underneath can occasionally lift." on the link and the PDF. Approve works only after the customer ticks "I understand old film removal may lift paint"; who ticked and when is saved on the quotation. The server refuses an approval without the tick.
- The quotation uses the same layout, link, PDF, proforma and invoice as the mechanical side, labour discount and round-off included.

## 2. Deposit and booking

- Once the customer approves, the advisor sees three steps on the bodyshop page: quotation, arrival, deposit.
- **Book**: arrival day and time, promised handover day. A car-drop appointment for the bodyshop lands on the calendar, linked to the job.
- **Request deposit** (optional): an amount or a percentage. It makes a proforma for the deposit (PRO number, link, Pay now as usual). When the final proforma is prepared at Ready, the deposit proforma folds into it and its payments move across, so the deposit is deducted on the final invoice.
- **Gate-in**: start it from the calendar entry as usual. The gate-in opens the booked job instead of making a new one. Nothing is retyped. The gate-in photos (chips and scratches) protect us before film goes on.

## 3. Stages

- When the gate-in photos are complete, the stages are built from the approved packages and the first one goes active. PPF: Old PPF removal (if quoted) → Strip → Prep → Peelable paint (if door jambs quoted) → PPF install (and tint) → Refit → Final detail and check → Electrical reset → QC → Handover. Tint only: Tint → Clean → QC → Handover. Full peelable colour change or full respray: Strip and paint → Detailing → QC → Handover. Accident repair: Strip and repair → Paint → Refit → Detailing → QC → Handover (body parts go through the normal parts flow and LPOs). Several kinds merge in order.
- The bodyshop manager can **add, remove and reorder** stages on any car and change any due date with a tap (the bodyshop page).
- **Removed items**: at Strip, tick what came off (one-tap list plus typing) with a photo. Refit cannot be marked done until every item is ticked back on.
- **Electrical reset** appears as a task on the mechanical manager's **To assign** page with a Done button; the electricians are told when it is their turn.
- QC done (or the last stage before the handover) puts the car at **Ready**, prepares the proforma and opens the release sign-off.

## 4. People

- **Bodyshop manager**: the workshop manager of the bodyshop department (Arsalan). He sees every car and stage, leads strip and refit, puts anyone on any car, changes due dates and must sign every car before it leaves.
- **Team leaders**: a new role, one per section through their department: PPF and tint, Paint, Detailing and cleaning. **Team > Add** with role Team leader. Each sees **My section**: their cars in due order, one tap per person to put them on a car, "Need help" to pull anyone from another team, and the stage's Done button. They see no prices, costs or profit anywhere.
- **Installers, painters, denters, detailers**: technicians in the PPF, Paint, Detailing or Bodyshop department. They clock in and out on their section's shared tablet with their PIN. Labour cost = clocked minutes × the hourly cost rate (per department in Settings, else the workshop rate).

## 5. Due dates

- The promised handover is spread back into a due date per stage (by the hours each stage usually takes, over the working days). Red = late, amber = due today.
- Heads-up one stage early: "G63 coming to PPF install after prep, about 6 h."
- The hourly round moves every later due date and the handover when a stage runs late, and tells the bodyshop manager and the advisor: "G63 Prep late by 1 day. Handover now Sat."
- **The board**: Bodyshop (in the menu) and the TV board at `/board/bodyshop` on a registered device, no login. The Going out strip sits on top, then each section's cars in due order.

## 6. Materials and profit

- The internal box of the quotation has a **Materials** line (film, paint, consumables). It adds to the total cost. The owner's card on the bodyshop page and the monthly summary show price − materials − clocked labour − commission − bank charge.

## 7. Customer experience

- The quote link shows a small "OFJ PPF · 10-year warranty" block under the total for PPF jobs; the PDF carries one line under the services.
- **Updates**: three moments, each one photo and one line: "Your car has arrived", "Film is going on", "Your car is ready for collection". The team leader picks the photo with a tap (or adds one); Send opens WhatsApp with the short message and a link. The link opens a one-photo page. The ready message links to the handover page.
- **Handover page** (one link per car): before and after side by side, the warranty certificate (PDF), the care instructions and the final check date. No staff names, costs or notes.
- **Warranty certificate** (PDF): OFJ logo, OFJ PPF, customer, car, VIN, film, install date, valid until (+10 years), the wording from Settings. Certificate number W-<job number>.
- **Settings > Bodyshop**: brand name, warranty years, warranty wording, care instructions, the old-film note, the three messages and the final-check reminder.

## 8. Final check visit

- At gate-out of a PPF car the page offers the final check date (7 to 14 days, default 10 from Settings). It goes on the calendar as a customer visit linked to the job, and the advisor gets the usual reminder the day before to send the WhatsApp.

## 9. Reports

- **Reports > Monthly** has a Bodyshop block: cars in progress, late today, days per job, profit, materials against price, and one line per car handed over in the month.

## 10. Shared section tablets

- Register the tablet (owner, on the device) and pick its section: PPF, Paint, Detailing or Strip and refit. It then opens `/tablet/bodyshop`: the section's cars in due order; tap a car, tap your face, type your PIN: clocked in (or out). Nothing else.

## 11. Release sign-off

- Before the handover the car needs one tap with a PIN from the bodyshop manager (always), the detailing leader (always), the PPF leader (if PPF, coloured PPF or tint ran) and the paint leader (if paint or peelable paint ran). The panel shows "Waiting on: …" until all have signed. Gate-out refuses the handover until then. The owner signs on behalf of anyone, no PIN.
- **Not ready** with a short reason sends the car back to that section's last stage, moves the handover a working day and tells everyone.

## 12. Nobody is surprised

- The Going out strip shows cars due out today and tomorrow with their sign-off chips.
- The day before a car is due out, the manager and every leader involved hear: "G63 due out tomorrow. Sign-off needed from PPF and Detailing."
- At handover everyone involved hears "G63 has left the workshop". A changed handover date is announced at once.

## Assumptions

- A bodyshop car is any job with department Bodyshop; it has no inspection step. Mixed (mechanical and bodyshop) cars keep the mechanical path.
- The bodyshop manager is the workshop manager whose department is Bodyshop, Paint, PPF or Detailing; the mechanical workshop manager does not see the Bodyshop menu.
- A team leader's section comes from their department. There is no slide-out menu in the app.
- QC in the bodyshop is a stage marked done by the manager or a leader, not the mechanical QC inspector.
- Stage hours (for spreading the due dates) are fixed defaults in `src/lib/bodyshop-kinds.ts`.
- The bodyshop profit uses the quotation total × the expected payment method's bank charge as the bank charge.

## Found by the test run (14 October, evening)

- Gating in a booked car failed: the `protect_job_stamps` trigger refused the real gate-in time on the booked job. Migration `20261028100000_booked_gate_in_stamp.sql` lets the stamp change once, while the job is still booked; after that it never changes, as before.
- Every bodyshop photo upload (customer updates, the handover's after picture, removed-item pictures) was refused by the database: the `job_files.kind` check did not know `bodyshop_photo` and `bodyshop_removed`. Migration `20261028103000_job_files_bodyshop_kinds.sql` adds them.
- Finishing a stage closes the open clockings on it (the minutes are kept), so a person who taps the section tablet after that is clocked in again on the new stage; the test now checks both directions.
