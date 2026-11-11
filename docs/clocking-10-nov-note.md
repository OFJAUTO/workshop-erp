# Clocking: Start / Pause / Stop after the PIN (10 November 2026, Section 7)

- Bodyshop section tablet: tap the car, tap your face, type your PIN, then **choose Start, Pause or Stop**. Nothing changes until a button is pressed (before, the PIN alone clocked the person in or out).
- **Start** clocks on this car. Starting a car while on another pauses the other by itself ("moved to another car"). One car at a time per person.
- **Pause** asks why with one tap: Break · Waiting for parts · Waiting for approval · Other.
- **Stop** = "my part is done".
- A confirmation shows for a few seconds, e.g. "Usama: paused on Jeep Wrangler (waiting for parts)."
- **Breaks pause by themselves** on the bodyshop side too (hourly job): Settings > Breaks (bodyshop 13:30–14:30, mechanics 12:30–13:30, Friday both 12:30–14:00). After the break the face on the tablet says "Paused (break) · Back on this car?" and Start reads "Back on this car".
- Already in place and unchanged: the end-of-day stop at closing time (Settings > opening hours; set it to 18:00 for 6 PM) flagged to the manager; labour cost counts clocked minutes only (pauses and breaks are not counted).
- Shared pieces: `src/lib/clock-choice.ts` (the words and reasons) and `src/components/ClockChoice.tsx` (the three buttons). The mechanical technician's own screen already has Start / Pause with reasons / Job finished and the break pause; it keeps them.

No database change (the pause reason is stored in the existing `closed_reason`). Test: `test:sim` path d7 (12 checks); test-i updated (55/56: its check 4, the team leader's one-tap pick, fails on the TEST copy for a reason outside this section and is listed in the handover).
