# Enter price myself — 5 November 2026

The real case: an estimate's part **"STAR LIGHT WITH SHOOTING STAR MODULE LARGE"** (E-00069) read
"With the parts desk · 0 of 1 priced", and tapping **"I have a price" glitched** — the price could not
be entered.

## The cause (one line)

The price boxes opened as a row INSIDE the sideways-scrolling parts table, so on a phone or a tablet
(scrolled right to reach the button) they opened **off-screen to the left** — the row reflow was the
visible "glitch", and the boxes were nowhere in sight. A robot scrolls to them by itself, a person
cannot, which is why no test ever caught it. (Measured on TEST: the cost box at x = −499 px on a
phone, x = −97 px on a tablet scrolled right.)

**A second cause, found while checking your list** ("the line jumping back to 'With the parts
desk'", "values resetting"): the quotation screen's delayed refresh forgot which lines you were
editing **even while a save was still on its way** (a part's price save takes several seconds), so a
refresh landing in that window brought the server's older copy back over the line — the price
vanished and the line jumped back to "With the parts desk". A save in flight now holds the refresh;
when the queue empties the screen refreshes with the up-to-date copy.

A third, smaller one in the new window itself is avoided by design: its number boxes update on every
key, so "Use this price" works the moment a cost is typed (the shared number box waits a second).

## What was built

**One centre pricing window** (`Enter price myself`) that always opens in the middle of the screen,
on phones, tablets and computers alike — never inside the scrolled table. On every part line, for the
owner and advisors, the two clear choices:

- **Send to parts desk** (as before), and
- **Enter price myself**: the **cost is compulsory and can never be 0**; supplier, type and
  availability are optional. **Markup in % or AED** (the 5% minimum still stands — a lower figure is
  put back up unless the owner types it), **or type the selling price** and the markup is worked out.
  A **cost under AED 5**, or a **selling price below cost**, warns in red and asks for a tick; the
  "is this the real price?" question (cheap or far-below costs) still comes once, as everywhere else.

After saving, the line reads **"Priced by \<name\>, \<date time\>"**, the counters ("0 of 1 priced",
"1 part still waiting for the parts desk") update at once, and the estimate can be sent.

**The parts desk**: the part **leaves their waiting list immediately**. If they already had it, they
are told **"Priced by advisor"** once; they can still see it later (for checking and ordering) and
tap **"Price is right ✓"** — a later look, never a hold. **"Send to parts desk instead"** puts it
back on their list with what was typed kept as a note ("Advisor had: AED 400.00 each from …").

**Job quotations** work the same way: a part still with the desk shows under "With the parts desk,
no price yet" with its own **Enter price myself**; the price lands on the part itself, the quotation
line follows with the chosen markup, and the desk sees "Priced by \<name\> — Price is right ✓" on
their Parts page. **When the real cost arrives from the supplier's invoice, it still replaces the
entered cost for the job's profit, exactly as before, and the owner sees the difference.**

**Carry-over**: when the estimate becomes a job, "Priced by advisor", who, when and the cost come
across onto the part exactly (including the desk's later ✓ if given).

## The database change (WAITING FOR APPLY)

`20261205180000_advisor_price_parts.sql` — three columns on parts (advisor's own price, the desk's
later check). **Estimates need nothing and work at once on deploy.** Until the apply, the JOB-side
buttons stay hidden and the server refuses them in plain words; nothing live changes.

## Proof

`test:sim` path **i** (new, part of the simulation): the pricing window opening **fully on screen on
a tablet scrolled right** (the exact glitch, now impossible), smooth typing with no lost characters,
cost 2,000 at 50% selling at 3,000 live, "Priced by \<name\>" on the line, the desk told and their
list clear, the selling-price entry working the markup out (500 on 400 = 25%), "Send to parts desk
instead" with the note, and the whole job-quotation side (the part priced at 350 + markup 40, the
desk's "Price is right ✓"). `test:estparts` reworked to the window (supplier left empty on purpose —
optional). Screenshots in `tests/browser/shots/sim/i*.png`.
