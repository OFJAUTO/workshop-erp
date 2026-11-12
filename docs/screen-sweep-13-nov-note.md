# Screen sweep – 13 November 2026 (Section 1)

On TEST, every page for every role was checked at 1920×1080, 1366×768, 1280×800 (tablet sideways) and 800×1280
(tablet upright), plus every pop-up. Most fixes are in the shared components, so one repair corrects every page.

## The new automatic checks (so it cannot come back)

In `tests/browser/layout-rules.mjs` (run by `npm run test:layout` on every page and pop-up, and by `proof-s1-sweep.mjs`):

- **Spills out of its box.** A box whose content is wider than the box fails, whether the extra is cut off or has to be scrolled sideways. From 1024 px wide, every box must show all of its content. On an upright tablet, a wide money report may scroll inside its own box only when the box says so (`data-scroll-ok`).
  - The old check let anything inside a sideways-scrolling strip pass. That is how the parts tables were cut off at the right edge without any check failing.
- **An amount split over two lines.** "AED" at the end of one line with "200.00" on the next fails.
- **More pages are now checked:**
  - the gate-out page;
  - the team form (`/team/new`);
  - Labels → Warranty and History;
  - a draft quotation and a draft estimate that have parts and labour. Before this, only an approved quotation was checked, so the editor itself was never measured.

## Before → after (every page touched)

| # | Page | Before | After |
|---|---|---|---|
| 1 | Quotation and estimate editor, Parts | A 1,200 px table in a 1,020 px card (1,244 px in a 710 px card on an upright tablet). "For job" and "Priced by parts desk" were cut off at the right edge, and every row had empty space. | Each part is two lines that always fit: (1) number, part, availability, qty, cost; (2) markup, selling, total and its buttons. Each figure has a small label. "For job: 2. WATER PUMP …" sits under the part name with numbered jobs. "No job" now reads "Not linked to a job yet". The empty tag line and the hidden "Below the minimum" line no longer add height. |
| 2 | Quotation and estimate editor, layout | Below 1536 px wide the lines sat in a two-thirds column next to the totals. | The lines use the full width up to 1536 px. The profit stays in the bar at the bottom. |
| 3 | Approved (locked) quotation | Narrow card, with amounts broken over two lines ("AED / 200.00"). | Full width, and every amount stays on one line. |
| 4 | Team form | When the choice strip wrapped, the leftover options stretched into giant cells. | Every option is the same size and aligned left (`ChoiceButtons`, used on every form). |
| 5 | Job page header (e.g. J-00991) | "Gate out" sat higher than the other buttons. Its note underneath pushed it up. | Every header button lines up along the top (`PageHeader`, every page). |
| 6 | Labels → Warranty labels | The BATCH boxes sat between buttons, so it was unclear which label they belonged to. | Each label is its own box: "Oil service – Print", "PPF film – batch ___ – Print", "Window tint – batch ___ – Print". |
| 7 | Gate-out page | The sign-off message showed twice: as a grey bar, then as a red box after pressing the button. | It shows once, in red, at the button. The button stays off until the release is signed. (The owner's release comes in Section 5.) |
| 8 | Job page | The green "Department changed to Bodyshop…" banner stayed on the page. | It is now a short message ("Department changed to Bodyshop ✓") that goes away by itself after 7 seconds (`FlashNotice`). The same applies to every success message on the job page. |
| 9 | Parts desk table (job and estimate) | 1,005 px of content in a 934 px card on a 1280 tablet. | It sizes itself by the width of its own box, never the window:<br>• one line on a wide box;<br>• two lines with the supplier at full width from 968 px;<br>• two lines with a slightly narrower supplier on a 1280 tablet;<br>• stacked on an upright tablet. |
| 10 | Settings → Breaks | The 7-day × 2-department grid was 873 px in a 749 px box. | Days down, Mechanical and Bodyshop across. It fits everywhere. |
| 11 | Scoreboard | The 10-column table was 1,044 px in a 974 px card. | Tighter columns. It fits at 1280, and scrolls inside its own box on an upright tablet. |
| 12 | Settings → Problems | Long file paths were cut off. | They wrap, so the whole path is visible. |
| 13 | Parts accounts | Five money tiles on an upright tablet broke their amounts. | The tiles wrap to the width available. Amounts never split. |
| 14 | Badges, the money line, the quotation history, the estimates list, the inspection-fee report, the invoice page, Profit | Amounts and codes broke over two lines in narrow places. | `Badge`, `PaidSoFar`, `MoneyRow`, `QuotationList` and the shared `Words` keep amounts and codes whole. |
| 15 | Gate-out "Different number of keys?", the quotation's ✎ and blocker links, the estimate's "e.g. 50" box | 19–32 px tall on a tablet. | 44 px on touch screens. The tiny ▲▼ move arrows are hidden on touch screens; drag ⋮⋮ and the ⋯ menu still move lines. |

## Proof

`docs/proof/2026-11-13-screen-sweep/` has the ten worst pages, each at 1366×768 and 800×1280 (`proof-s1-sweep.mjs` measures each page with the rules above while it takes the picture). The "before" pictures were not kept: the measured figures in the table above are the before.

## Assumptions

- Three wide money reports may scroll inside their own box on an upright tablet:
  - Profit;
  - the monthly report;
  - the inspection-fee report.
- "Boxes and buttons that do not respond" cannot be measured automatically. Every button on the pages above was opened by the existing screen tests.
