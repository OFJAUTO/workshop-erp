// Supplier PDF import (20 October 2026, section 3): the Mercedes Deira dealer PDF reads into exactly
// 17 lines with the right names, part numbers, quantities, list, discount and net-each values, and the
// lines add up to the PDF's own total. Pure-parser test: no dev server needed.
//   node tests/browser/test-import.mjs
import * as mupdf from "mupdf";
import { readFileSync } from "node:fs";
import { makeChecks } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const pi = await import("file:///C:/Users/user/Desktop/workshop ERP/src/lib/price-import.ts");

function positionedLines(bytes) {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const pages = [];
  for (let p = 0; p < doc.countPages(); p++) {
    const data = JSON.parse(doc.loadPage(p).toStructuredText().asJSON());
    const lines = [];
    for (const block of data.blocks ?? []) for (const line of block.lines ?? []) lines.push({ x: line.bbox.x, y: line.bbox.y, text: line.text });
    pages.push(lines);
  }
  return pages;
}

const pages = positionedLines(readFileSync("C:/Users/user/Desktop/workshop ERP/tests/fixtures/supplier-mercedes-deira.pdf"));
const r = pi.parseDealerBlocks(pages);
check("the dealer layout is recognised", !!r, r ? r.format : "null");

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

check("17 lines", r.lines.length === 17, String(r.lines.length));
EXPECTED.forEach(([name, pn, qty, list, disc, net], i) => {
  const l = r.lines[i];
  const ok = l && l.description === name && l.partNumber === pn && l.qty === qty && l.list === list && l.discount === disc && l.net === net;
  check(`${i + 1} ${name} · ${pn} · ${qty} · ${list} · ${disc}% · ${net}`, !!ok, l ? `${l.description} · ${l.partNumber} · ${l.qty} · ${l.list} · ${l.discount}% · ${l.net}` : "missing");
});
check("no line is flagged (sum ÷ qty = net each on every line)", r.lines.every((l) => !l.flag));
check("the VIN is read from the header", r.vin === "W1N4632761X350868", r.vin);
check("the customer id is read", r.customerId === "P0000412", r.customerId);
check("the supplier hint comes from the branch line", /Deira Branch/i.test(r.supplierHint ?? ""), r.supplierHint);
check("the lines add up to the PDF total (9,405.90) ✓", r.totals.sumLines === 9405.9 && r.totals.expected === 9405.9 && r.totals.match === true, JSON.stringify({ sum: r.totals.sumLines, expected: r.totals.expected, match: r.totals.match }));
check("normalised part number matches with or without spaces", pi.compactPartNumber("A 177 200 04 00 28") === pi.compactPartNumber("A1772000400 28"));

process.exit(summary() ? 1 : 0);
