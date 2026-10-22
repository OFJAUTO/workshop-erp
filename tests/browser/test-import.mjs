// Supplier PDF imports: every supplier PDF the owner sends becomes a permanent check here. Pure-parser test: no dev
// server needed.
//   node tests/browser/test-import.mjs
// 1. Mercedes Deira dealer PDF (20 October 2026): 17 block lines, totals 9,405.90.
// 2. Autovivo Spare Parts quotation Q-2206129 (22 October 2026): "Sl No. | Part No. | Description | Qty | Price |
//    Total" with the Part No. column EMPTY on every line. Read by the headings: 62 parts + the courier charge,
//    totals 255,394.00 + VAT 12,769.70 = 268,163.70. The old left-to-right reading (qty 4,350 × 4,350) is shown to
//    be caught by the safety lock.
// 3. The lock's own rules (qty × price = total, qty over 50, line over AED 500,000, the totals, the override).
import * as mupdf from "mupdf";
import { readFileSync } from "node:fs";
import { makeChecks } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const ROOT = "C:/Users/user/Desktop/workshop ERP";
const pi = await import(`file:///${ROOT}/src/lib/price-import.ts`);
const pc = await import(`file:///${ROOT}/src/lib/pdf-cells.ts`);

function positionedLines(bytes) {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const pages = [];
  for (let p = 0; p < doc.countPages(); p++) {
    const data = JSON.parse(doc.loadPage(p).toStructuredText("preserve-whitespace").asJSON());
    const lines = [];
    for (const block of data.blocks ?? []) for (const line of block.lines ?? []) lines.push({ x: line.bbox.x, y: line.bbox.y, text: line.text });
    pages.push(lines);
  }
  return pages;
}
/** The same reading as the server's PDF upload (src/app/(app)/parts/import-actions.ts → pdfImport). */
function importPdf(path) {
  const bytes = readFileSync(path);
  const read = pc.readPdfCells(mupdf, bytes);
  return { read, result: pi.pdfImport(read, positionedLines(bytes)) };
}
const noLock = (r) => pi.importLock(r.lines, r.totals, { included: () => true, checked: () => false, sourceWord: "PDF" });

/* ---------------- 1. Mercedes Deira ---------------- */
{
  const { result: r } = importPdf(`${ROOT}/tests/fixtures/supplier-mercedes-deira.pdf`);
  check("Mercedes: the dealer layout is recognised", r.format === "dealer", r.format);
  const EXPECTED = [
    ["COOLANT PUMP", "A 177 200 04 00 28", 1, 970.0, 55, 436.5],
    ["CIRCULATION PUMP", "A 463 835 19 00", 1, 2124.0, 55, 955.8],
    ["COOLANT PUMP", "A 000 500 38 00", 1, 1688.0, 55, 759.6],
    ["COOLANT PUMP", "A 000 500 55 00", 1, 1676.0, 55, 754.2],
    ["COOLANT HOSE", "A 463 501 34 00", 1, 282.0, 55, 126.9],
    ["COOLANT HOSE", "A 463 501 33 00", 1, 282.0, 55, 126.9],
    ["COOLANT RADIATOR", "A 167 500 63 01", 1, 3675.0, 55, 1653.75],
    ["BLEED LINE", "A 463 500 91 01", 1, 355.0, 55, 159.75],
    ["CLOSING CAP", "A 210 501 06 15", 1, 210.0, 55, 94.5],
    ["EXPANSION RESERVOIR", "A 213 500 14 00", 1, 725.0, 55, 326.25],
    ["THERMOSTAT", "A 177 200 79 01 64", 1, 5469.0, 55, 2461.05],
    ["COOLANT LINE", "A 177 200 37 51", 1, 479.0, 55, 215.55],
    ["COOLANT LINE", "A 177 200 65 02", 1, 389.0, 55, 175.05],
    ["COOLANT LINE", "A 177 200 84 00", 1, 631.0, 55, 283.95],
    ["COOLANT LINE", "A 177 200 92 00", 1, 802.0, 55, 360.9],
    ["COOLANT LINE", "A 177 200 66 02", 1, 594.0, 55, 267.3],
    ["COOLANT LINE", "A 177 200 38 51", 1, 551.0, 55, 247.95],
  ];
  check("Mercedes: 17 lines", r.lines.length === 17, String(r.lines.length));
  EXPECTED.forEach(([name, pn, qty, list, disc, net], i) => {
    const l = r.lines[i];
    const ok = l && l.description === name && l.partNumber === pn && l.qty === qty && l.list === list && l.discount === disc && l.net === net;
    check(`Mercedes ${i + 1} ${name} · ${pn} · ${qty} · ${list} · ${disc}% · ${net}`, !!ok, l ? `${l.description} · ${l.partNumber} · ${l.qty} · ${l.list} · ${l.discount}% · ${l.net}` : "missing");
  });
  check("Mercedes: no line is flagged or red", r.lines.every((l) => !l.flag && !l.problem && !l.ask));
  check("Mercedes: the VIN is read from the header", r.vin === "W1N4632761X350868", r.vin);
  check("Mercedes: the customer id is read", r.customerId === "P0000412", r.customerId);
  check("Mercedes: the supplier hint comes from the branch line", /Deira Branch/i.test(r.supplierHint ?? ""), r.supplierHint);
  check("Mercedes: the lines add up to the PDF total (9,405.90) ✓", r.totals.sumLines === 9405.9 && r.totals.expected === 9405.9 && r.totals.match === true, JSON.stringify({ sum: r.totals.sumLines, expected: r.totals.expected, match: r.totals.match }));
  check("Mercedes: the safety lock lets it through", !noLock(r).blocked, noLock(r).message);
  check("normalised part number matches with or without spaces", pi.compactPartNumber("A 177 200 04 00 28") === pi.compactPartNumber("A1772000400 28"));
}

/* ---------------- 2. Autovivo Q-2206129 ---------------- */
{
  const exp = JSON.parse(readFileSync(`${ROOT}/tests/fixtures/supplier-autovivo-q2206129.expected.json`, "utf8"));
  const { read, result: r } = importPdf(`${ROOT}/tests/fixtures/supplier-autovivo-q2206129.pdf`);
  const parts = r.lines.filter((l) => l.kind !== "charge");
  const charges = r.lines.filter((l) => l.kind === "charge");
  check("Autovivo: read by the column headings (not a guess)", r.format === "generic" && /sl no/i.test(r.headings[0] ?? "") && r.mapping.partNumber !== undefined && r.mapping.serial !== undefined, `${r.format} · ${r.headings.join(" | ")}`);
  check("Autovivo: 62 parts + 1 non-part line", parts.length === 62 && charges.length === 1, `${parts.length} parts, ${charges.length} charges`);
  let allOk = parts.length === exp.parts.length;
  exp.parts.forEach(([name, qty, price], i) => {
    const l = parts[i];
    const ok = l && l.serial === String(i + 1) && l.description === name && l.qty === qty && l.net === price && l.total === Math.round(qty * price * 100) / 100 && l.partNumber === null && !l.problem && !l.ask;
    if (!ok) allOk = false;
    // The owner's named lines are printed one by one; every line is compared.
    if ([1, 3, 21, 28, 47, 58, 62].includes(i + 1) || !ok) check(`Autovivo ${i + 1} ${name} · qty ${qty} · price ${price.toFixed(2)} · total ${(qty * price).toFixed(2)} · part no. blank`, !!ok, l ? `${l.serial} · ${l.description} · ${l.qty} · ${l.net} · ${l.total} · pn ${l.partNumber} · ${l.problem ?? ""}` : "missing");
  });
  check("Autovivo: all 62 lines exactly as on the PDF (name, qty, price, total, part number blank)", allOk);
  const c = charges[0];
  check("Autovivo: COURIER CHARGE 1.00 × 7,500.00 is a supplier charge, not a part", !!c && c.description === "COURIER CHARGE" && c.qty === 1 && c.net === 7500 && c.total === 7500 && !c.serial, c ? JSON.stringify({ d: c.description, q: c.qty, n: c.net, t: c.total, s: c.serial }) : "none");
  check("Autovivo: totals 255,394.00 (62 parts + courier) ✓ matches the PDF total", r.totals.sumLines === 255394 && r.totals.expected === 255394 && r.totals.match === true, JSON.stringify(r.totals));
  const vat = r.totals.found.find((f) => /vat/i.test(f.label))?.value;
  const net = r.totals.found.find((f) => /net total/i.test(f.label))?.value;
  check("Autovivo: VAT 12,769.70 and net total 268,163.70 read", vat === 12769.7 && net === 268163.7, `${vat} · ${net}`);
  check("Autovivo: VIN ZPBEC3ZL2RLA32299 read from the header", r.vin === "ZPBEC3ZL2RLA32299", r.vin);
  check("Autovivo: the supplier is pre-filled (Auto Vivo Italian Luxury Car Parts on our list)", pi.supplierMatches(r.supplierHint, "Auto Vivo Italian Luxury Car Parts") && !pi.supplierMatches(r.supplierHint, "Al Futtaim Auto Parts LLC") && !pi.supplierMatches(r.supplierHint, "Mezan Al Sham"), r.supplierHint);
  check("Autovivo: the safety lock lets the correct reading through", !noLock(r).blocked, noLock(r).message);

  // The old left-to-right reading of the same PDF: the bug the owner saw on J-00016.
  const old = pi.readTable(read.rowPages.flat());
  const first = old.lines[0];
  check("Old reading reproduces the bug (qty 4,350 × 4,350, name '1.00')", first && first.qty === 4350 && first.net === 4350 && first.description === "1.00", first ? `${first.description} · ${first.partNumber} · ${first.qty} · ${first.net}` : "none");
  const lock = noLock(old);
  check("Old reading: the totals check sees AED 6.9 bn against 255,394", old.totals.match === false && old.totals.expected === 255394 && old.totals.sumLines > 6e9, JSON.stringify({ sum: old.totals.sumLines, expected: old.totals.expected }));
  check("Old reading: Apply is BLOCKED with the plain message", lock.blocked && /Lines add up to AED 6\.\d bn but the PDF total is AED 255,394 – check the red lines/.test(lock.message ?? ""), lock.message);
  check("Old reading: every line is asked about (qty over 50 / line over AED 500,000)", lock.askKeys.length >= 60, String(lock.askKeys.length));
  const ticked = pi.importLock(old.lines, old.totals, { included: () => true, checked: () => true, sourceWord: "PDF" });
  check("Old reading: ticking every line still does not unlock a wrong total", ticked.blocked && ticked.totalsBad);
}

/* ---------------- 2b. Al Tayer style quotation (docs/supplier-pdf-sample.pdf) ---------------- */
{
  const { result: r } = importPdf(`${ROOT}/docs/supplier-pdf-sample.pdf`);
  const want = [["LR061234", "Brake pad set front", 1, 612, 612], ["LR098765", "Brake disc front", 2, 845.5, 1691], ["A 167 330 68 00", "Oil filter element", 1, 95, 95], ["LR055555", "Wiper blade set", 1, 120, 120]];
  check("Sample: 4 lines read by their headings", r.lines.length === 4 && r.lines.every((l, i) => l.partNumber === want[i][0] && l.description === want[i][1] && l.qty === want[i][2] && l.net === want[i][3] && l.total === want[i][4]), JSON.stringify(r.lines.map((l) => [l.partNumber, l.description, l.qty, l.net, l.total])));
  check("Sample: 'Net Amount: 2,518.00' written as one text is the total ✓", r.totals.expected === 2518 && r.totals.match === true, JSON.stringify(r.totals));
  check("Sample: VIN read", r.vin === "SALGS2SE8JA123456", r.vin);
}

/* ---------------- 3. The lock's rules ---------------- */
{
  const L = (o) => ({ key: o.key ?? "k", partNumber: null, description: "X", qty: null, list: null, net: null, discount: null, total: null, availability: null, vin: null, raw: [], ...o });
  check("rule: 2 × 270 = 540 passes", pi.lineChecks({ qty: 2, net: 270, total: 540 }).problem === null);
  check("rule: 1 × 4,350 ≠ 18,922,500 is red", /≠|says/.test(pi.lineChecks({ qty: 1, net: 4350, total: 18922500 }).problem ?? ""));
  check("rule: ±0.01 is allowed (3 × 33.33 = 99.99 printed 100.00)", pi.lineChecks({ qty: 3, net: 33.333, total: 100 }).problem === null);
  check("rule: qty 51 is asked about", /over 50/.test(pi.lineChecks({ qty: 51, net: 10, total: 510 }).ask ?? ""));
  check("rule: a line over AED 500,000 is asked about", /500,000/.test(pi.lineChecks({ qty: 1, net: 600000, total: 600000 }).ask ?? ""));
  check("rule: qty 1.00 to 20 with a normal price asks nothing", pi.lineChecks({ qty: 6, net: 325, total: 1950 }).ask === null);
  const t = pi.checkTotals([L({ qty: 1, net: 100, total: 100 })], [{ label: "Total", value: 100 }, { label: "VAT 5%", value: 5 }, { label: "Net Total", value: 105 }]);
  check("rule: 'Total + VAT = Net Total' finds the total before VAT", t.expected === 100 && t.match === true, JSON.stringify(t));
  const bad = pi.checkTotals([L({ qty: 1, net: 120, total: 120 })], [{ label: "Total", value: 100 }]);
  const lk = pi.importLock([L({ qty: 1, net: 120, total: 120 })], bad, { included: () => true, checked: () => false, sourceWord: "PDF" });
  check("rule: a totals mismatch blocks Apply", lk.blocked && lk.totalsBad);
  const ov = pi.importLock([L({ qty: 1, net: 120, total: 120 })], bad, { included: () => true, checked: () => false, totalsOverride: "Supplier forgot the 20 AED discount line", sourceWord: "PDF" });
  check("rule: Parts' typed reason opens a totals mismatch (and nothing else)", !ov.blocked);
  const skipped = pi.importLock([L({ key: "a", qty: 4350, net: 4350, total: null })], { found: [], sumLines: null, expected: null, match: null }, { included: (l) => l.key !== "a", checked: () => false });
  check("rule: a skipped line never blocks", !skipped.blocked);
  const lines = pi.finishLines([L({ key: "1", partNumber: "1", description: "BUMPER CARRIER", qty: 1, net: 4350, total: 4350 }), L({ key: "2", partNumber: "2", description: "CROSS MEMBER FRONT", qty: 1, net: 1740, total: 1740 }), L({ key: "3", partNumber: "3", description: "BRACKET", qty: 2, net: 270, total: 540 })]);
  check("rule: line numbers 1, 2, 3 in the part number column are cleared (the screenshot bug)", lines.every((l) => l.partNumber === null && l.serial), JSON.stringify(lines.map((l) => [l.partNumber, l.serial])));
  check("rule: words like courier/freight make a charge", pi.isChargeText("COURIER CHARGE") && pi.isChargeText("Air freight") && !pi.isChargeText("FRONT BUMPER"));
  const shifted = pi.readTable([["Sl No.", "Part No.", "Description", "Qty", "Price", "Total"], ["1", "", "BUMPER CARRIER", "1.00", "4,350.00", "4,350.00"]]);
  check("rule: an empty Part No. cell in a pasted table stays empty", shifted.lines[0]?.partNumber === null && shifted.lines[0]?.description === "BUMPER CARRIER" && shifted.lines[0]?.qty === 1, JSON.stringify(shifted.lines[0]));
}

process.exit(summary() ? 1 : 0);
