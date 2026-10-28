// Rebuilds the two Network International "Merchant Transaction Reports" of 24 October 2026 (payment link and card
// machine) as PDF, CSV and Excel from ni-mtr.expected.json, in the bank's layout: the header (period, merchant no.,
// chain ID, date), TRANSACTION DETAILS with the bank's twelve headings (fees printed as minus figures), and the
// summary (POS transactions, commission, fee transactions, VAT, adjustments, chargebacks, suspended, rebates,
// BNPL / instalment fees, net payable). Identifiers are masked. The owner's original files did not arrive; when a real
// file is copied over one of these, this script leaves it alone (pass --force to rebuild anyway).
//   node tests/fixtures/make-ni-mtr.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import * as XLSX from "xlsx";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(here, "ni-mtr.expected.json"), "utf8"));
const MARK = "OFJ test fixture - rebuilt layout";
const force = process.argv.includes("--force");
const HEADS = ["DTOF TRN", "TRMNL ID", "CARD NUMBER", "TRXN TYPE", "ACQ_REF_NBR", "AUTH CODE", "TRAN AMT", "MSF AMT", "TXN FEE", "VAT AMT", "NET AMT", "TRXN DESP"];
const KEYS = ["date", "terminal", "card", "type", "acqRef", "authCode", "amount", "msf", "txn", "vat", "net", "desp"];
const WIDTHS = [52, 50, 78, 40, 96, 42, 52, 46, 40, 44, 52, 50];
const RIGHT = new Set(["amount", "msf", "txn", "vat", "net"]);
const SUMMARY = [["POS TRANSACTIONS", "posCount", "posValue"], ["COMMISSION", null, "commission"], ["FEE TRANSACTIONS", null, "feeTransactions"], ["VAT", null, "vat"], ["ADJUSTMENTS", null, "adjustments"], ["CHARGEBACKS", null, "chargebacks"], ["SUSPENDED", null, "suspended"], ["REBATES", null, "rebates"], ["BNPL / INSTALMENT FEES", null, "instalmentFees"], ["NET PAYABLE / RECEIVABLE", null, "netPayable"]];

const mine = (file) => {
  if (!fs.existsSync(file) || force) return true;
  const head = fs.readFileSync(file).toString("latin1");
  return head.includes(MARK);
};

const s = StyleSheet.create({
  page: { padding: 24, fontSize: 7, fontFamily: "Helvetica" },
  title: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  meta: { flexDirection: "row", gap: 18, marginBottom: 3 },
  section: { fontSize: 8, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 4 },
  row: { flexDirection: "row", paddingVertical: 3 },
  head: { fontFamily: "Helvetica-Bold", borderBottomWidth: 0.5, borderColor: "#000" },
  sumRow: { flexDirection: "row", paddingVertical: 2 },
});
const h = React.createElement;
const cell = (text, width, right) => h(Text, { style: { width, textAlign: right ? "right" : "left", paddingRight: 6 } }, text);

for (const r of data.reports) {
  const pdfFile = path.join(here, `${r.file}.pdf`);
  if (mine(pdfFile)) {
    const doc = h(Document, { title: `Merchant Transaction Report ${r.file}`, creator: MARK, producer: MARK },
      h(Page, { size: "A4", orientation: "landscape", style: s.page },
        h(Text, { style: s.title }, "MERCHANT TRANSACTION REPORT"),
        h(View, { style: s.meta }, h(Text, null, `FROM : ${r.header.from}`), h(Text, null, `TO : ${r.header.to}`), h(Text, null, `DATE : ${r.header.date}`)),
        h(View, { style: s.meta }, h(Text, null, `MERCHANT NO : ${r.header.merchantNo}`), h(Text, null, `CHAIN ID : ${r.header.chainId}`)),
        h(Text, { style: s.section }, "TRANSACTION DETAILS"),
        h(View, { style: [s.row, s.head] }, ...HEADS.map((t, i) => cell(t, WIDTHS[i], RIGHT.has(KEYS[i])))),
        ...r.lines.map((l) => h(View, { style: s.row }, ...KEYS.map((k, i) => cell(l[k], WIDTHS[i], RIGHT.has(k))))),
        h(Text, { style: s.section }, "SUMMARY"),
        ...SUMMARY.map(([label, countKey, valueKey]) => h(View, { style: s.sumRow }, cell(label, 160, false), cell(countKey ? String(r.summary[countKey]) : "", 50, true), cell(String(r.summary[valueKey]), 80, true))),
        h(Text, { style: { marginTop: 14, color: "#888" } }, MARK),
      ));
    fs.writeFileSync(pdfFile, await renderToBuffer(doc));
    console.log("wrote", path.basename(pdfFile));
  } else console.log("left the original", path.basename(pdfFile));

  // The same report as the bank's spreadsheet export: header lines, the table, the summary.
  const rows = [["MERCHANT TRANSACTION REPORT"], [`FROM : ${r.header.from}`, `TO : ${r.header.to}`, `DATE : ${r.header.date}`], [`MERCHANT NO : ${r.header.merchantNo}`, `CHAIN ID : ${r.header.chainId}`], [], ["TRANSACTION DETAILS"], HEADS, ...r.lines.map((l) => KEYS.map((k) => l[k])), [], ["SUMMARY"], ...SUMMARY.map(([label, countKey, valueKey]) => [label, countKey ? String(r.summary[countKey]) : "", String(r.summary[valueKey])]), [MARK]];
  const csvFile = path.join(here, `${r.file}.csv`);
  if (mine(csvFile)) {
    fs.writeFileSync(csvFile, rows.map((row) => row.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(",")).join("\r\n") + "\r\n");
    console.log("wrote", path.basename(csvFile));
  }
  const xlsxFile = path.join(here, `${r.file}.xlsx`);
  if (mine(xlsxFile) || !fs.existsSync(xlsxFile)) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "MTR");
    wb.Props = { Title: MARK, Comments: MARK };
    fs.writeFileSync(xlsxFile, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    console.log("wrote", path.basename(xlsxFile));
  }
}
