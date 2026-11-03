// The settlement report reader on its own (no server): both Network International reports of 24 October 2026, each as
// PDF, CSV and Excel, must give the same header, line, fees and net payable; the method comes from the terminal ID
// (Settings) or the TRXN DESP hint; an adjustment or a refund is flagged red; matching by auth + amount + date.
//   node --import ./tests/unit/register.mjs tests/settlement-report-check.mjs        (npm run test:mtr)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as XLSX from "xlsx";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const rep = await import(pathToFileURL(path.join(root, "src/lib/settlement-report.ts")).href);
const cells = await import(pathToFileURL(path.join(root, "src/lib/pdf-cells.ts")).href);
const fees = (await import(pathToFileURL(path.join(root, "src/lib/bank-fees.ts")).href)).bankFeesFrom;
const mupdf = await import("mupdf");
let bad = 0;
const check = (name, ok, detail = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const noTerminals = fees({ bank_charge_card_percent: 2.15, bank_charge_link_percent: 1.75, bank_fee_link_txn_aed: 1, bank_fee_vat_percent: 5 });
const withTerminals = fees({ bank_charge_card_percent: 2.15, bank_charge_link_percent: 1.75, bank_fee_link_txn_aed: 1, bank_fee_vat_percent: 5, bank_terminal_ids_card: "XXXX7702", bank_terminal_ids_link: "XXXX7701" });

const csvRows = (text) => text.split(/\r?\n/).filter((l) => l !== "").map((l) => { const out = []; let cur = ""; let q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; } out.push(cur); return out; });
// The server's own Excel read options (one rule): real date cells come out as "2026-10-24".
const xlsxRows = (buf) => { const wb = XLSX.read(buf, { type: "buffer", ...rep.REPORT_XLSX_READ }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { ...rep.REPORT_SHEET_ROWS }); };

const WANT = {
  "ni-mtr-link-24oct": { method: "link", auth: "756117", amount: 10000, msf: 175, txn: 1, vat: 8.8, net: 9815.2, netPayable: 9815.2 },
  "ni-mtr-pos-24oct": { method: "card", auth: "219769", amount: 1470, msf: 31.61, txn: 0, vat: 1.58, net: 1436.81, netPayable: 1436.81 },
};
for (const [file, w] of Object.entries(WANT)) {
  const parsed = {
    pdf: rep.parseReportPdf(cells.readPdfCells(mupdf, fs.readFileSync(path.join(here, "fixtures", `${file}.pdf`))).cellPages, noTerminals),
    csv: rep.parseReportRows(csvRows(fs.readFileSync(path.join(here, "fixtures", `${file}.csv`), "utf8")), noTerminals),
    xlsx: rep.parseReportRows(xlsxRows(fs.readFileSync(path.join(here, "fixtures", `${file}.xlsx`))), noTerminals),
  };
  for (const [fmt, p] of Object.entries(parsed)) {
    const l = p.lines[0];
    check(`${file}.${fmt}: read as a Merchant Transaction Report`, p.problems.length === 0, p.problems.join(" "));
    check(`${file}.${fmt}: header FROM 24 Oct TO 24 Oct, merchant and chain ID`, p.header.from === "2026-10-24" && p.header.to === "2026-10-24" && /4[0-9]{3}$/.test(p.header.merchantNo ?? "") && !!p.header.chainId, JSON.stringify(p.header));
    check(`${file}.${fmt}: one sale, auth ${w.auth}, ${w.amount} − MSF ${w.msf} − fee ${w.txn} − VAT ${w.vat} = ${w.net}`, p.lines.length === 1 && l.kind === "sale" && l.authCode === w.auth && l.amount === w.amount && l.msf === w.msf && l.txn === w.txn && l.vat === w.vat && l.net === w.net && l.adds && l.date === "2026-10-24", JSON.stringify(l));
    check(`${file}.${fmt}: method ${w.method} from the TRXN DESP hint`, l?.method === w.method && l?.methodBy === "description");
    check(`${file}.${fmt}: net payable ${w.netPayable} read and agreeing with the lines`, p.summary.netPayable === w.netPayable && p.totals.agrees === true, JSON.stringify(p.summary));
    check(`${file}.${fmt}: nothing red (no adjustment, chargeback, suspended or refund)`, !p.flags.some((f) => f.tone === "red"), JSON.stringify(p.flags));
  }
  const byTerminal = rep.parseReportPdf(cells.readPdfCells(mupdf, fs.readFileSync(path.join(here, "fixtures", `${file}.pdf`))).cellPages, withTerminals);
  check(`${file}: with the terminal IDs in Settings the method comes from the terminal`, byTerminal.lines[0]?.method === w.method && byTerminal.lines[0]?.methodBy === "terminal");
}

// Review, 3 November 2026: the bank's CSV saved again in Excel holds REAL date cells, which a spreadsheet prints in the US
// order ("10/24/26"); before, that read as month 24 and the review page crashed. Now the dates are the right days.
{
  const rows = csvRows(fs.readFileSync(path.join(here, "fixtures", "ni-mtr-link-24oct.csv"), "utf8"));
  const table = rows.findIndex((r) => r.includes("AUTH CODE"));
  const aoa = rows.map((r, i) => (i === table + 1 ? [new Date(Date.UTC(2026, 9, 24, 10, 15)), ...r.slice(1)] : r));
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "MTR");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const plain = XLSX.utils.sheet_to_json(XLSX.read(buf, { type: "buffer" }).Sheets.MTR, { header: 1, raw: false, defval: "" });
  check("an Excel date cell printed plainly is the US '10/24/26' (what used to reach the reader)", plain[table + 1][0] === "10/24/26", String(plain[table + 1][0]));
  const p = rep.parseReportRows(xlsxRows(buf), noTerminals);
  check("an Excel report with a real date cell: the line's day is 24 Oct 2026", p.lines.length === 1 && p.lines[0].date === "2026-10-24", JSON.stringify(p.lines[0] ?? {}));
  const us = rep.parseReportRows(rows.map((r, i) => (i === table + 1 ? ["10/24/26", ...r.slice(1)] : r)), noTerminals);
  check("and a US date typed as text is read as the same day (a month above 12 can only be the day)", us.lines[0]?.date === "2026-10-24", JSON.stringify(us.lines[0] ?? {}));
}

// An adjustment and a refund are flagged red, never dropped.
{
  const rows = csvRows(fs.readFileSync(path.join(here, "fixtures", "ni-mtr-pos-24oct.csv"), "utf8"));
  const table = rows.findIndex((r) => r.includes("AUTH CODE"));
  rows.splice(table + 2, 0, ["24/10/2026", "XXXX7702", "5XXXXXXXXXXX0009", "REFUND", "XXXX0009", "A1B2C3", "200.00", "0.00", "0.00", "0.00", "-200.00", "E/D/C/CN"]);
  const adj = rows.findIndex((r) => r[0] === "ADJUSTMENTS");
  rows[adj][2] = "-50.00";
  const p = rep.parseReportRows(rows, noTerminals);
  check("an adjustment of −50 is flagged red", p.flags.some((f) => f.tone === "red" && /Adjustments/.test(f.text)), JSON.stringify(p.flags));
  check("a refund line is flagged red", p.flags.some((f) => f.tone === "red" && /refund/i.test(f.text)));
  check("the lines no longer agree with the net payable: flagged", p.totals.agrees === false && p.flags.some((f) => /net payable/.test(f.text)));
}

// Matching by auth code + amount + date (±3 days).
{
  const p = rep.parseReportPdf(cells.readPdfCells(mupdf, fs.readFileSync(path.join(here, "fixtures", "ni-mtr-link-24oct.pdf"))).cellPages, noTerminals);
  const pays = [{ id: "a", number: "RCT-00036", method: "link", amount: 10000, receivedDay: "2026-10-24", authCode: "756117" }, { id: "b", number: "RCT-00040", method: "link", amount: 10000, receivedDay: "2026-10-20", authCode: "999999" }];
  const m = rep.matchLines(p.lines, pays);
  check("RCT-00036 matched by auth 756117 + amount + date", m[0]?.status === "matched" && m[0].paymentId === "a", JSON.stringify(m));
  const m2 = rep.matchLines(p.lines, [{ ...pays[0], receivedDay: "2026-10-10" }]);
  check("the same auth 14 days away is not matched by itself (picked by hand)", m2[0]?.status === "unmatched" && m2[0].candidates.includes("a"), JSON.stringify(m2));
  // 3 November 2026 (section 5): a payment saved with its code missing is SUGGESTED for the line, with the code to fill in.
  const m3 = rep.matchLines(p.lines, [{ ...pays[0], authCode: null, codeMissing: true }]);
  check("a payment whose auth code is missing: suggested, the bank's 756117 to fill in", m3[0]?.status === "suggested" && m3[0].paymentId === "a" && m3[0].fillCode === "756117" && /Suggested match: RCT-00036 · AED 10,000.00 · payment link · the same day · its auth code is missing/.test(m3[0].why), JSON.stringify(m3));
  const m4 = rep.matchLines(p.lines, [{ ...pays[0], authCode: null, codeMissing: true }, { ...pays[0], id: "c", number: "RCT-T2", authCode: null, codeMissing: true, receivedDay: "2026-10-23" }]);
  check("two payments without a code that fit: unmatched, both offered first, the words say so", m4[0]?.status === "unmatched" && m4[0].candidates[0] === "a" && m4[0].candidates.includes("c") && /2 payments without an auth code/.test(m4[0].why), JSON.stringify(m4));
  const m5 = rep.matchLines(p.lines, [{ ...pays[0], settledIn: "STL-00001" }]);
  check("the same code on a payment settled by hand: Already settled (never settled twice)", m5[0]?.status === "settled" && /Already settled in STL-00001/.test(m5[0].why), JSON.stringify(m5));
  const m6 = rep.matchLines(p.lines, [{ ...pays[0], authCode: null, codeMissing: false }]);
  check("a payment without the code and not flagged (old shape) is still offered to pick by hand", m6[0]?.status === "unmatched" && m6[0].candidates.includes("a") && /No payment in the ERP carries auth 756117/.test(m6[0].why), JSON.stringify(m6));
}
console.log(bad ? `${bad} failed` : "all passed");
process.exit(bad ? 1 : 0);
