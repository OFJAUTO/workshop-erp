# Section 2 – Labels: the gate-in 404 and the battery warranty label (13 November 2026, evening list)

## The gate-in 404: the cause

The battery warranty label prints through the part handover's print page. That page let only the parts desk and the owner in, and answered everyone else with a bare **404**. Gate-in could open Labels, but every "battery warranty label" link failed.

**Fixed:**
- **Gate-in prints the battery warranty labels of a handover.** Only battery labels; part labels stay with the parts desk. Gate-in's print doesn't mark the handover's part labels as printed.
- **Gate-in on Labels:** opens Labels (warranty labels and History) and prints warranty and service labels.
- **The rename:** "Stickers" is now "Labels" everywhere:
  - `/labels`, `/settings/labels`;
  - `/print/labels/…`, `/print/warranty-label/…`, `/print/service-label/…`, `/print/label-test`;
  - `/api/pdf/labels/…`.
  - **Every old "stickers" address moves to the new one by itself.** Bookmarks and printed QR links keep working.
- **A refused page never answers 404.** It says "You don't have access to this page. Ask the owner." This is now true on 15 pages that used to give a bare 404: the print pages, parts pages, QC, road test, supplier invoices and payments, pending charges.

## The dead-link check

`tests/browser/dead-links.mjs` opens, for every role, every menu item and every link on those pages, one level deep:
- **Roles:** owner, advisor, accounts, parts, workshop manager, technician, gate-in, QC, team leader.
- **First run:** 256 pages. The only dead link was "Print today's labels" on Parts arrivals (404 when nothing was received that day). It now opens a plain page saying "No labels to print yet".
- **After the fixes:** no 404 and no 500 anywhere.

## The battery warranty label (your real print: MAIN BATTERY, INSTALLED 12 NOV 2026)

- **Pure black only:**
  - the logo's greys print black (near-white becomes white);
  - an uploaded logo is forced to black and white;
  - the same applies to the service label's logo;
  - the part label's logo was already pure black.
- **"INSTALLED 12 NOV 2026"** and **"VALID UNTIL 12 NOV 2027"** are bold capitals inside the black band, as big as the band allows on one line. Under them: "12 MONTHS WARRANTY".
- **The VIN is always on one line;** the text shrinks to fit.
- **The OFJ logo is bigger** (11 mm high instead of 8 mm).
- **No empty gap:** the parts sit together from the top, and the QR follows the dates.
- **The QR is unchanged** (staff only).

## Proof (TEST only)

- `npm run test:s2-labels`: **13 of 13**, signed in as gate-in. It covers:
  - the old address moves;
  - the print links use the new addresses;
  - battery and service labels print (no 404), battery labels only;
  - black and white only (every colour on the label checked);
  - the logo's fills only black or white;
  - INSTALLED / VALID UNTIL in capitals;
  - the VIN on one line;
  - both date lines inside the band;
  - the plain refusal.
- Dead-link check: no dead links.
- Layout checks clean for gate-in and parts at 800 × 1280 and 1440 × 900.
- Screenshots: `docs/proof/2026-11-13-labels/`:
  - `3-battery-label-print-preview.png` (the print preview, black and white);
  - Labels for gate-in at 1280 and 800;
  - the refusal page.

## NEEDS OMAR: a real test print

1. On the counter PC, open **Labels** (left menu) → **Warranty labels**.
2. Pick a car with a battery and press its battery **Print** button. The label opens in a new tab.
3. Press **Print**, and choose the **large label printer** (50 × 100 mm).
4. Print one label. Send me a photo of it.
   - Check that the dates are bold and readable, the VIN is on one line, and there's no grey.
