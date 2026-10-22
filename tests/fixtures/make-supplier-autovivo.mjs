// Rebuilds tests/fixtures/supplier-autovivo-q2206129.pdf in the Autovivo Spare Parts layout from the values in
// supplier-autovivo-q2206129.expected.json: "Sl No. | Part No. | Description | Qty | Price | Total" with the
// Part No. column EMPTY on every line, headings centred over their columns, numbers right-aligned, the headings
// repeated on page 2, the courier line without a Sl No., and Total / VAT 5% / Net Total at the end.
// The owner's original PDF (Q-2206129-2.pdf) was not available as a file; when it is copied over this one, the
// test reads the original instead. This script never overwrites a file it did not make (pass --force to do so).
//   node tests/fixtures/make-supplier-autovivo.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "supplier-autovivo-q2206129.pdf");
const data = JSON.parse(fs.readFileSync(path.join(here, "supplier-autovivo-q2206129.expected.json"), "utf8"));
const MARK = "OFJ test fixture - rebuilt layout";
if (fs.existsSync(out) && !process.argv.includes("--force")) {
  const head = fs.readFileSync(out).toString("latin1");
  if (!head.includes(MARK)) {
    console.log("The original supplier PDF is in place: left as it is.");
    process.exit(0);
  }
}

const h = React.createElement;
const money = (n) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const W = { sl: 38, pn: 92, desc: 225, qty: 48, price: 72, total: 80 };
const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 60, paddingHorizontal: 22, fontSize: 8, fontFamily: "Helvetica" },
  logo: { fontSize: 22, fontFamily: "Helvetica-Bold", color: "#c0392b" },
  title: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 6, marginBottom: 8 },
  boxRow: { flexDirection: "row", gap: 10 },
  box: { flex: 1, borderWidth: 0.6, borderColor: "#444", padding: 5 },
  boxTitle: { fontFamily: "Helvetica-Bold", fontSize: 8.5, marginBottom: 3, textDecoration: "underline" },
  meta: { flexDirection: "row", borderWidth: 0.6, borderColor: "#444", marginTop: 6 },
  metaCell: { flex: 1, padding: 4, textAlign: "center", fontFamily: "Helvetica-Bold" },
  th: { flexDirection: "row", backgroundColor: "#e8e8e8", borderWidth: 0.6, borderColor: "#444", marginTop: 6 },
  tr: { flexDirection: "row", borderBottomWidth: 0.4, borderLeftWidth: 0.6, borderRightWidth: 0.6, borderColor: "#999", minHeight: 12.5, alignItems: "center" },
  c: { paddingHorizontal: 3, paddingVertical: 2 },
  footer: { position: "absolute", bottom: 18, left: 22, right: 22, textAlign: "center", fontSize: 6.5, color: "#555" },
});
const cell = (w, text, align, bold) => h(Text, { style: [s.c, { width: w, textAlign: align, fontFamily: bold ? "Helvetica-Bold" : "Helvetica" }] }, text);
const header = h(View, { style: s.th, fixed: true },
  cell(W.sl, "Sl No.", "center", true), cell(W.pn, "Part No.", "center", true), cell(W.desc, "Description", "center", true),
  cell(W.qty, "Qty", "center", true), cell(W.price, "Price", "center", true), cell(W.total, "Total", "center", true));
const row = (sl, desc, qty, price) => h(View, { style: s.tr, wrap: false },
  cell(W.sl, sl, "center"), cell(W.pn, "", "left"), cell(W.desc, desc, "left"),
  cell(W.qty, money(qty), "right"), cell(W.price, money(price), "right"), cell(W.total, money(qty * price), "right"));
const totalRow = (label, value) => h(View, { style: { flexDirection: "row" }, wrap: false },
  h(Text, { style: [s.c, { width: W.sl + W.pn + W.desc + W.qty }] }, ""),
  cell(W.price, label, "right", true), cell(W.total, money(value), "right", true));

const doc = h(Document, { title: "Q-2206129-2", author: MARK, subject: MARK },
  h(Page, { size: "A4", style: s.page },
    h(Text, { style: s.logo }, "autovivo"),
    h(Text, { style: { fontSize: 6.5, color: "#555" } }, "ITALIAN LUXURY CAR PARTS"),
    h(Text, { style: s.title }, "QUOTATION"),
    h(View, { style: s.boxRow },
      h(View, { style: s.box },
        h(Text, { style: s.boxTitle }, "CUSTOMER DETAILS"),
        h(Text, { style: { fontFamily: "Helvetica-Bold" } }, "OFJ AUTOMOTIVE"),
        h(Text, null, "Attn:"),
        h(Text, null, "Address: Al Quoz Industrial, Dubai, United Arab Emirates"),
        h(Text, null, "Phone:"),
        h(Text, null, "TRN:")),
      h(View, { style: s.box },
        h(Text, { style: s.boxTitle }, "VEHICLE DETAILS"),
        h(Text, null, `VIN NO: ${data.vin}`),
        h(Text, null, `Vehi Model: ${data.model}`))),
    h(View, { style: s.meta },
      h(Text, { style: s.metaCell }, `QUOTATION NO. ${data.quotation}`),
      h(Text, { style: s.metaCell }, "CUSTOMER ID"),
      h(Text, { style: s.metaCell }, `DATE ${data.date}`)),
    header,
    ...data.parts.map(([desc, qty, price], i) => row(String(i + 1), desc, qty, price)),
    ...data.charges.map(([desc, qty, price]) => row("", desc, qty, price)),
    h(View, { style: { marginTop: 6 } },
      totalRow("Total", data.totals.beforeVat),
      totalRow("VAT 5%", data.totals.vat),
      totalRow("Net Total", data.totals.total)),
    h(Text, { style: { marginTop: 8, fontSize: 7.5 } }, "Two Hundred Sixty Eight Thousand One Hundred Sixty Three Dirhams and Seventy Fils Only"),
    h(Text, { style: s.footer, fixed: true }, `AUTOVIVO SPARE PARTS LLC · DUBAI, UNITED ARAB EMIRATES · ${MARK}`)));

fs.writeFileSync(out, await renderToBuffer(doc));
console.log(`Written ${path.relative(process.cwd(), out)}`);
