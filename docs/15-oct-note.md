# 15 October 2026: urgent fixes, gate-in, inspection, quote builder, clocks, stickers, parts step bar

Migration `20261030090000_15_oct_changes.sql` (applied after a backup, `backups/2026-10-15T11-58-34`), proof test
`tests/browser/test-k.mjs` (`npm run test:k`, 55 checks). Every earlier suite still passes (test-h 65, test-j 18,
test-c 67, test-notify 55, test-d 89, test-i 55).

## A. Urgent

**A1. Labour estimate (1,400 h).** Done this morning (note `docs/labour-estimate-fix-note.md`): three labelled boxes on
every hour-based line, labour at cost from Est. h × AED 90, the footer and the internal box agreeing, Q-00004 reset,
the amber safety check. Its test (test-j) still passes.

**A2. Edit a quotation after it has been sent.** A sent, opened, approved, declined or expired quotation shows a black
"Revise quotation" button in its header. It opens version 2 in the same builder with everything copied in: lines, parts,
the discount (and its scope), the expected payment method, the commission, the materials line. Version 1 stays on
record (read only, "Replaced by a newer version" once version 2 is approved). Every copied line remembers the line it
came from, so a work line already started moves to the new line instead of being made twice. The customer's existing
link always opens the latest version sent, with "Updated on 15 Oct, 3:10 pm" at the top; older versions are never shown
(while version 2 is still being prepared the old link says "being updated"). The revised quotation goes out with its own
WhatsApp message (Settings: "WhatsApp revised quotation message", "Your quotation has been updated"). When version 1 was
already approved: the customer approves version 2 again; the car keeps its stage, nothing is reset; parts already in the
ordering flow carry on; parts on lines that left the quotation leave the parts list, and a part already on an LPO,
ordered or received is never removed quietly: Parts are asked "removed from the quote, part already ordered: return or
keep in stock?" on the Parts without a home page. New parts go to Parts for pricing and ordering as normal.

## B. Changes

1. **Payment before release, credit optional.** Every customer pays in full before the car leaves (unchanged rule).
   The customer form has a Payment terms block: the owner alone can switch credit terms on (7, 15, 30 or 60 days);
   everyone else sees the terms as text. With credit terms on, the gate-out shows "Credit terms (30 days): the balance
   is due within 30 days. The car may leave; this is logged" instead of blocking, and the release is written on the job.
2. **Pages must not jump while typing.** Field messages ("Please fill this in") still appear only when the final button
   is pressed, and now hang under the box without taking space, so nothing below moves. The inspection's Saved tick
   keeps its place whether shown or not. The damage note saves itself without redrawing the page. Measured by the test:
   the box and the scroll position do not move while typing.
3. **Damage note quick chips.** One row of chips above the note (Scratches, Dents, Stone chips, Paint peeling, PPF
   peeling, PPF scratched, Cracked bumper, Kerbed wheels, Windscreen chip, Broken light), editable in Settings > Damage
   note chips. A tap writes the word, a second tap removes it, typing always works, and the note saves by itself about
   a second after the last change. The Save note button is gone.
4. **Wheel order.** Front left, rear left, rear right, front right at gate-in and everywhere tyres are listed
   (inspection, report, PDFs).
5. **Materials hidden on mechanical jobs.** The Materials line shows on bodyshop jobs, or on a mechanical job only when
   something was entered.
6. **Software items.** Software update, Software reset and Coding / programming are three checklist items (each with
   its own condition and note) and three labour jobs; "Software update or coding" is gone.
7. **Clocks.** Every clock counts opening hours only: the department break is left out (unless the technician chose to
   work through it) and time after closing never counts. A clock left running stops counting at closing, and the next
   morning the workshop manager (or the bodyshop manager) gets "Clock left running overnight: [car], [person]", once
   per clock. Labour cost uses the same minutes.
8. **Minor and Major service are services.** Both sit at the top of the Services picker and in Most used; Minor service
   has a default price of AED 750 (editable in Settings and on the quote), Major service is priced by the advisor. Both
   left the Labour picker. A service's kind is now explicit (`services.line_kind`).
9. **Capitals.** Line descriptions, the customer and the car show in capitals on the quote screen, the pickers, the
   customer link, the quotation, estimate, proforma and tax invoice PDFs. The text is stored as typed; only the display
   changes. Notes stay in normal case.
10. **Labour charges.** The first item in the Labour picker and in Most used; one tap adds it, the advisor types the
    hours, the rate comes from Settings. It is an hour-based line, so estimate, discount and internal cost work the
    same. With a Labour charges line on the quotation, the technician's screen, the work order and the job card list the
    inspection's findings as his tasks.
11. **Discount can include services.** The Discount box has "Labour only" (default) and "Labour + services". The second
    applies the % or AED to hour lines and our own services (minor, major service...); outside work (a service line
    with an "our cost") is never discounted. The customer sees "Labour and services discount (10%): − AED ..." in bold
    green on the screen, the link, the PDF and the invoice. The round-off is unchanged.
12. **Stickers on the label printer.** Every sticker prints at its exact size with no browser margins (`@page` at the
    sticker's size, margin 0). The handover sticker page has one "Print this one" button per sticker (and Print for all).
    The battery and oil service stickers each have their own size in Settings > Stickers.
13. **Markup reminder.** "Quotation complete" with every part still at the minimum 5% asks once: "Parts markup is still
    at the minimum 5%. Set it now?" with Set markup (jumps to the markup box) and Continue anyway (no approval, logged
    with who and when). The owner's monthly summary lists who skipped the markup and on which quotation.
14. **Removing a job removes its parts.** Removing a labour or service line with parts under it asks once: "Also remove
    its 3 parts?" (Yes first). The parts leave the quotation and the parts list; a part already on an LPO, ordered or
    received is not removed quietly: Parts are asked "customer declined, part already ordered: return or keep in stock?".
    A part taken off the quotation on its own leaves the parts list the same way. Bulk tick boxes and Delete all on the
    Parts table are unchanged.
15. **Parts page step bar.** Five steps across the top of every car's parts page: Pricing → Request approval → LPO for
    vendor → Parts received → Handover. Done steps are green with a tick (tappable to view), the current step is black
    and is the one button, later steps are grey. Each step turns green by itself: Pricing done; the main LPO approved
    (or nothing to order); every supplier LPO ordered; every part received ("4 of 7 received" while partial, with one
    Received button per part on the page); every part confirmed by the technician. Parts from our stock skip the LPO
    steps. Edit pricing or new parts on a revised quotation send the later steps back to grey. The same five steps show
    as dots on the parts desk and on the job card's Parts tile. One rule for all three (`src/lib/parts-steps.ts`).

## Not done

- B2 is a rule applied to the shared pieces (field messages, the Saved tick, the damage note, the refresh gate that
  already existed). Every form was not re-typed field by field; the test covers the damage note. Report any box that
  still jumps and it will be fixed.
- B7: the live clock on the technician's screen already pauses for the break; after closing, the hourly job stops the
  clock within the hour and the stored minutes never go past closing time. The "left running overnight" notice goes to
  the manager at the first hourly run after opening.

## Assumptions

- Credit terms live on the customer, in days; 7, 15, 30 and 60 are offered. The due date is written on the job's
  release note.
- "Outside work" for the discount means a service line with an "our cost" typed on it; our own services have none.
- "Already ordered" for parts leaving a quotation means on an LPO, ordered or received; a part merely marked to order
  goes off the list and can be put back.
- Minor service's AED 750 is a default on the services list; the advisor can change it on the quote.
- The markup reminder fires only when every part line sits at the minimum and nobody pressed Continue anyway before
  on that version.
- Capitals are display only (CSS and PDF styles); search and the stored text are untouched.
- The step bar reads the parts' own states; the LPO approval step uses the main LPO when the page has it.
- The damage note chips are a plain list in Settings; several can be picked; the words are joined with commas.
