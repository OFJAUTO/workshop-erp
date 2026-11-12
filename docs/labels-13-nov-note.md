# Labels (renamed) and the battery warranty label – 13 November 2026 (Section 10)

**Why the battery label page was blank** ("No stickers were asked for on this handover"):
- Since the 18 October change (the technician receives parts on his own tablet), every handover saved an EMPTY label list.
- The battery itself was recognised (its warranty was started), but the print page had nothing to print.

**Live, read-only check:** battery handovers with no label (the empty list):

| Job | Battery brand | Fitted |
|---|---|---|
| J-01005 (2 batteries) | not entered | 12 Nov |
| J-00317 | VARTA | 10 Nov |
| J-00989 | not entered | 7 Nov |
| J-00017 | not entered | 26 Oct |
| J-00460 | not entered | 26 Oct |

All of them print now with no data change: the label list is rebuilt from their battery warranty.

**Built (no database change):**
- **Batteries:**
  - Handing a battery to the technician always saves its warranty label, ready to print.
  - The print page and its PDF share ONE label list (`src/lib/handover-labels.ts`) that rebuilds older handovers from their battery warranty.
  - An empty print page offers "Print a battery warranty label" and the way back.
- **One size for both large labels:** the battery warranty label uses the SAME size setting as the service label (50 × 100 mm), never the 50 × 25 part label.
  - Printer setup shows the size per label type, each with a test print (part label, battery warranty label, service label).
- **"Stickers" is now "Labels":**
  - the menu, the page, the tabs (Part labels, Warranty labels, History, Printer setup), the buttons ("Print label") and the messages;
  - the gate-in role gets Labels with Warranty labels and History only (assumption, as asked).
- **The Warranty labels tab:**
  - **Each label is its own box:** "Oil service – Print label", "PPF film – batch ___ – Print label", "Window tint – batch ___ – Print label". Batch is asked on PPF and tint only.
  - **Only the labels that fit the car's work** (from its approved quotation lines: oil/service, PPF, tint, the owner's own types by their words) are offered; the rest sit behind "Other label (n)".
  - **Battery rows** show the plate, the car and the battery brand.

**Proof (TEST):**
- `npm run test:s13-10` passes 8 of 8:
  - the handover carries the battery label, and the print page shows it;
  - an old handover with an empty list still prints;
  - battery and service labels are the same size (not 50 × 25);
  - Labels on the page and tabs;
  - battery rows with plate, car and brand;
  - a test print per label type;
  - gate-in sees Warranty labels and History only.
- Print previews side by side (same size): `docs/proof/2026-11-13-labels/s10-test-battery-1366.png` and `s10-test-service-1366.png`.
- test-v: section 3 passes with the new wording. Section 2's part-sticker checks (40 × 30, "1 OF 2") have been stale since 5 November (50 × 25) and 9 November (the simple label). They are not from this change.
