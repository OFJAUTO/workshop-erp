// The settlement report reader on its own (no server): both Network International reports of 24 October 2026, each as
// PDF, CSV and Excel, must give the same header, line, fees and net payable; the method comes from the terminal ID
// (Settings) or the TRXN DESP hint; an adjustment or a refund is flagged red; matching by auth + amount + date.
//   node tests/settlement-report-check.mjs
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
const xlsxRows = (buf) => { const wb = XLSX.read(buf, { type: "buffer" }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" }); };

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
  const m3 = rep.matchLines(p.lines, [{ ...pays[0], authCode: null }]);
  check("a payment without the code is offered to pick by hand", m3[0]?.status === "unmatched" && m3[0].candidates.includes("a") && /No payment in the ERP carries auth 756117/.test(m3[0].why), JSON.stringify(m3));
}
console.log(bad ? `${bad} failed` : "all passed");
process.exit(bad ? 1 : 0);
