# Section 6 (15 November 2026): labels print black only

## The cause

- **The battery label:** "INSTALLED … / VALID UNTIL … / 12 MONTHS WARRANTY" was white text on a black box.
- **Why it vanished:** browsers do not print background fills unless "Background graphics" is ticked. The thermal printer prints black or nothing, so the lines showed pale in the preview and printed blank.
- **The same mistake was on:**
  - the oil service label (the "Next service" box);
  - the PDF versions of the part, battery and service stickers;
  - the item tags (dark-grey and grey text).

## What changed (one rule, every label type)

- **Black text on white only.** Every word is pure black (#000); no filled boxes, no background colours, no white text, no grey, no opacity, no shadows.
- **The battery label:**
  - INSTALLED and VALID UNTIL are bold, black, the same size, and the biggest text after the title (the VIN and the other lines stay smaller);
  - a thin black OUTLINE sets them apart with "n MONTHS WARRANTY", never a fill.
- **The oil service label:** the "Next service, whichever comes first" box is a thin black outline with black bold text.
- **The PDF stickers (part, battery, service):** outlines and black text; the battery PDF now prints the same three lines.
- **Item tags:** all text black.
- **The part label** (screen and PDF) and the part-label PDF were already black on white, and stay so.
- **There is no PPF or tint label in the ERP.** The bodyshop warranty is a certificate on paper, not a label.
- **A quick check** (`tests/unit/label-black.test.mjs`, in `npm run test:unit`) fails if any label template uses:
  - a fill other than white;
  - a colour other than black for text or lines;
  - an opacity, a shadow or a see-through colour.

## Proof (TEST only)

- **`node --env-file=.env.test.local tests/browser/test-labels-black.mjs`: 10 of 10,** as the owner. Each label type (part, battery, service) is printed with "Background graphics" OFF and rasterized. It checks:
  - every word is black, with no fill, opacity or shadow;
  - the battery's INSTALLED / VALID UNTIL / 24 MONTHS WARRANTY and the service's next date all print;
  - the date lines are the biggest after the title;
  - no grey area;
  - the part-label PDF the same.
- Print previews with background graphics off: `docs/proof/2026-11-15-labels-black/` (part, battery, service, part-label PDF).
- No database change.

## NEEDS OMAR

- Print one battery label and send a photo.
