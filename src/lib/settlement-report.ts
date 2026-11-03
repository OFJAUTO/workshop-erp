/**
 * Network International's "Merchant Transaction Report" (29 October 2026, section 5): ONE reader for the payment link
 * and the card machine, from PDF, CSV or Excel. Pure (no imports but types and the pure auth-code rule), so the tests run it
 * straight on a file (through tests/unit/register.mjs).
 *
 *   header   – the report period (FROM … TO …), merchant no., chain ID, report date
 *   lines    – TRANSACTION DETAILS: DTOF TRN, TRMNL ID, CARD NUMBER, TRXN TYPE, ACQ_REF_NBR, AUTH CODE, TRAN AMT,
 *              MSF AMT, TXN FEE, VAT AMT, NET AMT, TRXN DESP (the bank prints the fees as minus figures)
 *   summary  – POS transactions (count / value), commission, VAT, fee transactions, adjustments, chargebacks,
 *              suspended, rebates, BNPL / instalment fees, net payable / receivable
 *
 * The method of a line: its terminal ID from Settings, else the TRXN DESP hint ("E/…" = the card machine, "M/…" = the
 * payment link). Anything that is not a plain sale - a refund, an adjustment, a chargeback, a suspended amount - is
 * flagged for the accountant, never quietly dropped. A line is matched to our payments by auth code + amount + the
 * date within three days; a line whose code is on no payment is SUGGESTED for a payment saved with its code missing
 * (3 November 2026), and accounts confirm it in one tap.
 */
import type { BankFees } from "./bank-fees";
import type { PosCell } from "./price-import";
import { realAuthCode } from "./auth-code";

export type ReportMethod = "card" | "link";
export type ReportLine = {
  /** Position in the report (1 = first transaction). */
  index: number;
  date: string | null;
  terminal: string | null;
  card: string | null;
  type: string;
  kind: "sale" | "refund" | "other";
  acqRef: string | null;
  authCode: string | null;
  amount: number;
  msf: number;
  txn: number;
  vat: number;
  net: number;
  desp: string | null;
  method: ReportMethod | null;
  methodBy: "terminal" | "description" | null;
  /** amount − MSF − fee − VAT = net, to the fils. */
  adds: boolean;
};
export type ReportHeader = { from: string | null; to: string | null; merchantNo: string | null; chainId: string | null; date: string | null };
export type ReportSummary = {
  posCount: number | null;
  posValue: number | null;
  commission: number | null;
  vat: number | null;
  feeTransactions: number | null;
  adjustments: number | null;
  chargebacks: number | null;
  suspended: number | null;
  rebates: number | null;
  instalmentFees: number | null;
  netPayable: number | null;
};
export type ReportFlag = { tone: "red" | "amber"; text: string };
export type ParsedReport = {
  header: ReportHeader;
  lines: ReportLine[];
  summary: ReportSummary;
  flags: ReportFlag[];
  /** The lines' net added up, against the report's net payable. */
  totals: { gross: number; msf: number; txn: number; vat: number; net: number; netPayable: number | null; agrees: boolean | null };
  /** Plain sentences when the file could not be read as this report at all. */
  problems: string[];
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** "1,470.00", "-175.00", "175.00-", "(175.00)", "AED 9,815.20" → number (null when not a number). */
export function reportNumber(raw: unknown): number | null {
  let t = String(raw ?? "").replace(/−/g, "-").replace(/aed|dhs?/gi, "").replace(/\s+/g, "").trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.endsWith("-")) { neg = true; t = t.slice(0, -1); }
  if (t.startsWith("-")) { neg = !neg; t = t.slice(1); }
  if (t.startsWith("+")) t = t.slice(1);
  if (!/^\d[\d,]*(\.\d+)?$/.test(t)) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const MONTHS: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** "24/10/2026", "24-10-26", "24-OCT-2026", "2026-10-24" (a time after it is ignored) → "2026-10-24". */
export function reportDate(raw: unknown): string | null {
  const t = String(raw ?? "").trim().toUpperCase();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return dayOf(m[1], m[2], m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t);
  // Day first, as the bank prints it; a "month" above 12 can only be a day (10/24/26, the US order a spreadsheet may
  // print), and a date that is not on the calendar is no date at all (review, 3 November 2026: "2026-24-10" crashed).
  if (m) return dayOf(m[3], m[2], m[1]) ?? (Number(m[2]) > 12 ? dayOf(m[3], m[1], m[2]) : null);
  m = /^(\d{1,2})[\s/.-]?([A-Z]{3})[A-Z]*[\s/.-]?(\d{2,4})/.exec(t);
  if (m && MONTHS[m[2]]) return dayOf(m[3], MONTHS[m[2]], m[1]);
  return null;
}

/** "YYYY-MM-DD" when the year, month and day make a real calendar date, else null (two-digit years are 20xx). */
function dayOf(year: string, month: string, day: string): string | null {
  const y = Number(year.length === 2 ? `20${year}` : year);
  const mo = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d) || mo < 1 || mo > 12 || d < 1) return null;
  const at = new Date(Date.UTC(y, mo - 1, d));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== mo - 1 || at.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * How an Excel report is read (one rule, used by the server and the reader's own test): real date cells come out as
 * "2026-10-24" instead of the US "10/24/26" a spreadsheet prints them in (review, 3 November 2026).
 */
export const REPORT_XLSX_READ = { cellDates: true, dateNF: "yyyy-mm-dd" } as const;
export const REPORT_SHEET_ROWS = { header: 1, raw: false, defval: "", dateNF: "yyyy-mm-dd" } as const;

/** The report's column headings, as the bank prints them (and the few ways a spreadsheet export may write them). */
const COLUMNS: { key: keyof ColumnIdx; names: string[] }[] = [
  { key: "date", names: ["DTOFTRN", "DTOFTXN", "DATEOFTRN", "TRANDATE", "TRXNDATE", "TRANSACTIONDATE"] },
  { key: "terminal", names: ["TRMNLID", "TERMINALID", "TID"] },
  { key: "card", names: ["CARDNUMBER", "CARDNO", "CARD"] },
  { key: "type", names: ["TRXNTYPE", "TRANTYPE", "TRANSACTIONTYPE", "TXNTYPE"] },
  { key: "acqRef", names: ["ACQREFNBR", "ACQREFNO", "ACQREF", "ARN"] },
  { key: "authCode", names: ["AUTHCODE", "AUTHNO", "APPROVALCODE", "AUTH"] },
  { key: "amount", names: ["TRANAMT", "TRANAMOUNT", "TRXNAMT", "TRANSACTIONAMOUNT", "AMOUNT"] },
  { key: "msf", names: ["MSFAMT", "MSF", "MSFAMOUNT", "COMMISSION"] },
  { key: "txn", names: ["TXNFEE", "TRANFEE", "TRANSACTIONFEE", "FEE"] },
  { key: "vat", names: ["VATAMT", "VAT", "VATAMOUNT"] },
  { key: "net", names: ["NETAMT", "NET", "NETAMOUNT"] },
  { key: "desp", names: ["TRXNDESP", "TRXNDESC", "DESCRIPTION", "DESP"] },
];
type ColumnIdx = { date: number; terminal: number; card: number; type: number; acqRef: number; authCode: number; amount: number; msf: number; txn: number; vat: number; net: number; desp: number };
const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The heading row's columns (-1 for a heading not found); null when the row is not the heading row. */
export function headingColumns(row: string[]): ColumnIdx | null {
  const idx = { date: -1, terminal: -1, card: -1, type: -1, acqRef: -1, authCode: -1, amount: -1, msf: -1, txn: -1, vat: -1, net: -1, desp: -1 } as ColumnIdx;
  const cells = row.map(norm);
  for (const col of COLUMNS) idx[col.key] = cells.findIndex((c) => c && col.names.includes(c));
  return idx.authCode >= 0 && idx.amount >= 0 && idx.net >= 0 ? idx : null;
}

/** A PDF page's positioned cells as rows lined up under the heading row's columns (null when the page has no heading row). */
export function rowsUnderHeadings(cellRows: PosCell[][]): { before: string[][]; headings: string[]; table: string[][]; after: string[][] } | null {
  // A heading printed on two lines ("TRXN" over "TYPE", "AUTH" over "CODE"): the second line joins the first.
  const joined = cellRows.map((row, i) => {
    const next = cellRows[i + 1];
    if (!next || next.some((c) => reportNumber(c.text) !== null || !!reportDate(c.text))) return row;
    const merged = row.map((h) => ({ ...h }));
    for (const c of next) {
      const under = merged.find((h) => Math.min(c.x2, h.x2) - Math.max(c.x, h.x) > 0);
      if (!under) return row;
      under.text = `${under.text} ${c.text}`;
    }
    return merged;
  });
  const isHeading = (r: PosCell[]) => !!headingColumns(r.map((c) => c.text));
  const headAt = joined.findIndex(isHeading);
  if (headAt < 0) return null;
  const heads = joined[headAt];
  // The data starts after the heading (and after its second line, when it had one).
  const twoLines = heads.some((h, k) => h.text !== cellRows[headAt][k]?.text);
  const hi = twoLines ? headAt + 1 : headAt;
  const centre = (c: { x: number; x2: number }) => (c.x + c.x2) / 2;
  const place = (row: PosCell[]) => {
    const out = heads.map(() => "");
    for (const cell of row) {
      // The heading the cell sits under: the most overlap, else the nearest centre.
      let best = -1;
      let bestScore = -Infinity;
      heads.forEach((h, i) => {
        const overlap = Math.min(cell.x2, h.x2) - Math.max(cell.x, h.x);
        const score = overlap > 0 ? overlap + 1000 : -Math.abs(centre(cell) - centre(h));
        if (score > bestScore) { bestScore = score; best = i; }
      });
      out[best] = out[best] ? `${out[best]} ${cell.text}` : cell.text;
    }
    return out;
  };
  const idx = headingColumns(heads.map((h) => h.text)) as ColumnIdx;
  const table: string[][] = [];
  let i = hi + 1;
  for (; i < cellRows.length; i++) {
    const placed = place(cellRows[i]);
    // The table ends at the first row without a transaction amount, or (when the report has a date column) without a
    // date: the totals row and the summary below it.
    const noAmount = reportNumber(placed[idx.amount]) === null;
    const noDate = idx.date >= 0 && !reportDate(placed[idx.date]);
    if (noAmount || noDate) break;
    table.push(placed);
  }
  return { before: cellRows.slice(0, headAt).map((r) => r.map((c) => c.text)), headings: heads.map((h) => h.text), table, after: cellRows.slice(i).map((r) => r.map((c) => c.text)) };
}

const SUMMARY: { key: keyof ReportSummary; test: RegExp; count?: boolean }[] = [
  { key: "netPayable", test: /NET\s*(PAYABLE|RECEIVABLE|AMOUNT\s*PAYABLE)/i },
  { key: "posValue", test: /^POS\s*TRANSACTIONS?\b/i, count: true },
  { key: "feeTransactions", test: /FEE\s*TRANSACTIONS?/i },
  { key: "commission", test: /^(TOTAL\s*)?COMMISSION/i },
  { key: "adjustments", test: /ADJUSTMENTS?/i },
  { key: "chargebacks", test: /CHARGE\s*BACKS?/i },
  { key: "suspended", test: /SUSPEND/i },
  { key: "rebates", test: /REBATES?/i },
  { key: "instalmentFees", test: /BNPL|INSTAL+MENT/i },
  { key: "vat", test: /^(TOTAL\s*)?VAT(\s*AMOUNT|\s*ON\s*FEES?)?\s*:?$/i },
];

/** The summary block: each label followed by its figure(s) on the same row. */
function readSummary(rows: string[][]): ReportSummary {
  const out: ReportSummary = { posCount: null, posValue: null, commission: null, vat: null, feeTransactions: null, adjustments: null, chargebacks: null, suspended: null, rebates: null, instalmentFees: null, netPayable: null };
  for (const row of rows) {
    const cells = row.map((c) => String(c ?? "").trim()).filter(Boolean);
    if (!cells.length) continue;
    const label = cells.filter((c) => reportNumber(c) === null).join(" ").trim();
    const nums = cells.map(reportNumber).filter((n): n is number => n !== null);
    if (!label || !nums.length) continue;
    for (const s of SUMMARY) {
      if (!s.test.test(label) || out[s.key] !== null) continue;
      if (s.count && nums.length >= 2) {
        out.posCount = nums[0];
        out.posValue = nums[nums.length - 1];
      } else out[s.key] = nums[nums.length - 1];
      break;
    }
  }
  return out;
}

/** FROM … TO …, MERCHANT NO, CHAIN ID and the report date, from the lines above the table. */
function readHeader(text: string): ReportHeader {
  const t = text.replace(/\s+/g, " ");
  const date = (re: RegExp) => { const m = re.exec(t); return m ? reportDate(m[1]) : null; };
  const word = (re: RegExp) => { const m = re.exec(t); return m ? m[1].trim() : null; };
  return {
    from: date(/FROM\s*:?\s*([0-9A-Z/.-]{6,11})/i),
    to: date(/\bTO\s*:?\s*([0-9A-Z/.-]{6,11})/i),
    merchantNo: word(/MERCHANT\s*(?:NO\.?|NUMBER|ID)\s*:?\s*([A-Z0-9*Xx]{4,20})/i),
    chainId: word(/CHAIN\s*(?:ID|NO\.?)\s*:?\s*([A-Z0-9*Xx]{2,20})/i),
    date: date(/(?:REPORT\s*DATE|PRINT(?:ED)?\s*DATE|\bDATE)\s*:?\s*([0-9A-Z/.-]{6,11})/i),
  };
}

/** The method of a line: its terminal from Settings, else the description hint ("E/…" card machine, "M/…" payment link). */
export function methodOfLine(terminal: string | null, desp: string | null, fees: BankFees): { method: ReportMethod | null; by: "terminal" | "description" | null } {
  const t = norm(terminal);
  if (t) for (const m of ["card", "link"] as const) if (fees[m]?.terminals.map(norm).includes(t)) return { method: m, by: "terminal" };
  const d = String(desp ?? "").trim().toUpperCase();
  if (/^E\b|^E\//.test(d)) return { method: "card", by: "description" };
  if (/^M\b|^M\//.test(d)) return { method: "link", by: "description" };
  return { method: null, by: null };
}

function linesFrom(table: string[][], idx: ColumnIdx, fees: BankFees, start: number): ReportLine[] {
  const cell = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
  const out: ReportLine[] = [];
  for (const r of table) {
    const amount = reportNumber(cell(r, idx.amount));
    if (amount === null) continue;
    const type = cell(r, idx.type) || "SALES";
    const kind: ReportLine["kind"] = /REFUND|REVERSAL|RETURN|CREDIT/i.test(type) ? "refund" : /SALE|PURCHASE|PURCH|CAPTURE/i.test(type) ? "sale" : "other";
    const msf = Math.abs(reportNumber(cell(r, idx.msf)) ?? 0);
    const txn = Math.abs(reportNumber(cell(r, idx.txn)) ?? 0);
    const vat = Math.abs(reportNumber(cell(r, idx.vat)) ?? 0);
    const net = reportNumber(cell(r, idx.net)) ?? r2(amount - msf - txn - vat);
    const terminal = cell(r, idx.terminal) || null;
    const desp = cell(r, idx.desp) || null;
    const auth = norm(cell(r, idx.authCode));
    const { method, by } = methodOfLine(terminal, desp, fees);
    const gross = Math.abs(amount);
    out.push({
      index: start + out.length + 1,
      date: reportDate(cell(r, idx.date)),
      terminal,
      card: cell(r, idx.card) || null,
      type,
      kind,
      acqRef: cell(r, idx.acqRef) || null,
      authCode: /^[A-Z0-9]{6}$/.test(auth) ? auth : auth || null,
      amount: kind === "refund" ? -gross : amount,
      msf,
      txn,
      vat,
      net,
      desp,
      method,
      methodBy: by,
      adds: Math.abs(r2(Math.abs(amount) - msf - txn - vat) - Math.abs(net)) < 0.005,
    });
  }
  return out;
}

function finish(header: ReportHeader, lines: ReportLine[], summary: ReportSummary, problems: string[]): ParsedReport {
  const sum = (f: (l: ReportLine) => number) => r2(lines.reduce((a, l) => a + f(l), 0));
  const totals = { gross: sum((l) => l.amount), msf: sum((l) => l.msf), txn: sum((l) => l.txn), vat: sum((l) => l.vat), net: sum((l) => l.net), netPayable: summary.netPayable, agrees: summary.netPayable === null ? null : Math.abs(sum((l) => l.net) - summary.netPayable) < 0.01 };
  const flags: ReportFlag[] = [];
  const money = (n: number) => `AED ${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  for (const [key, words] of [["adjustments", "Adjustments"], ["chargebacks", "Chargebacks"], ["suspended", "Suspended"]] as const) {
    const v = summary[key];
    if (v !== null && Math.abs(v) >= 0.005) flags.push({ tone: "red", text: `${words} ${v < 0 ? "−" : ""}${money(v)} on this report: check with the bank before recording.` });
  }
  for (const l of lines.filter((x) => x.kind !== "sale")) flags.push({ tone: "red", text: `Line ${l.index} is a ${l.type.toLowerCase()} of ${money(l.amount)}${l.authCode ? ` (auth ${l.authCode})` : ""}: not a plain sale.` });
  for (const l of lines.filter((x) => !x.adds)) flags.push({ tone: "red", text: `Line ${l.index}: ${money(l.amount)} − MSF ${money(l.msf)} − fee ${money(l.txn)} − VAT ${money(l.vat)} does not make the net ${money(l.net)}.` });
  if (summary.rebates !== null && Math.abs(summary.rebates) >= 0.005) flags.push({ tone: "amber", text: `Rebates ${money(summary.rebates)} on this report.` });
  if (summary.instalmentFees !== null && Math.abs(summary.instalmentFees) >= 0.005) flags.push({ tone: "amber", text: `BNPL / instalment fees ${money(summary.instalmentFees)} on this report.` });
  if (totals.agrees === false) flags.push({ tone: "red", text: `The lines add up to a net of ${money(totals.net)}, the report's net payable is ${money(totals.netPayable ?? 0)}.` });
  if (totals.agrees === null && lines.length) flags.push({ tone: "amber", text: "The report's net payable could not be read: check the total by eye." });
  for (const l of lines.filter((x) => !x.method)) flags.push({ tone: "amber", text: `Line ${l.index}: the method is unknown (terminal ${l.terminal ?? "none"}). Add the terminal ID under Bank fees.` });
  return { header, lines, summary, flags, totals, problems };
}

/** A spreadsheet (CSV or Excel) as rows of cells. */
export function parseReportRows(rows: string[][], fees: BankFees): ParsedReport {
  const clean = rows.map((r) => r.map((c) => String(c ?? "").replace(/ /g, " ").trim()));
  const hi = clean.findIndex((r) => !!headingColumns(r));
  if (hi < 0) return finish({ from: null, to: null, merchantNo: null, chainId: null, date: null }, [], readSummary(clean), ["This does not look like a Network International Merchant Transaction Report: the TRANSACTION DETAILS headings (AUTH CODE, TRAN AMT, NET AMT …) were not found."]);
  const idx = headingColumns(clean[hi]) as ColumnIdx;
  let end = hi + 1;
  while (end < clean.length && reportNumber(clean[end][idx.amount]) !== null && (idx.date < 0 || !!reportDate(clean[end][idx.date]))) end++;
  const header = readHeader(clean.slice(0, hi).map((r) => r.join(" ")).join(" "));
  return finish(header, linesFrom(clean.slice(hi + 1, end), idx, fees, 0), readSummary(clean.slice(end)), []);
}

/** A text PDF's positioned cells, page by page (the table may continue on later pages under repeated headings). */
export function parseReportPdf(cellPages: PosCell[][][], fees: BankFees): ParsedReport {
  let header: ReportHeader | null = null;
  const lines: ReportLine[] = [];
  const tail: string[][] = [];
  for (const page of cellPages) {
    const placed = rowsUnderHeadings(page);
    if (!placed) {
      tail.push(...page.map((r) => r.map((c) => c.text)));
      continue;
    }
    if (!header) header = readHeader(placed.before.map((r) => r.join(" ")).join(" "));
    const idx = headingColumns(placed.headings) as ColumnIdx;
    lines.push(...linesFrom(placed.table, idx, fees, lines.length));
    tail.push(...placed.after);
  }
  if (!header) return finish({ from: null, to: null, merchantNo: null, chainId: null, date: null }, [], readSummary(tail), ["This PDF does not look like a Network International Merchant Transaction Report (no TRANSACTION DETAILS headings). A scanned picture cannot be read: ask the bank for the PDF or the Excel file."]);
  return finish(header, lines, readSummary(tail), []);
}

/* ------------------------------------------------------------------ matching ------------------------------------------------------------------ */

export type MatchPayment = {
  id: string;
  number: string;
  method: string;
  amount: number;
  receivedDay: string;
  /** The payment's REAL auth code (a missing or made-up one is null). */
  authCode: string | null;
  /** "Auth code missing" (3 November 2026): the report's line may fill it in. */
  codeMissing?: boolean;
  /** Already in a settlement recorded by hand: its STL number. Shown as "Already settled", never settled twice. */
  settledIn?: string | null;
};
export type LineMatch = {
  index: number;
  /**
   * matched   - auth code + amount + date: the line's payment, waiting for a settlement;
   * settled   - the same, but the payment was already settled by hand ("Already settled in STL-… ✓"): handled;
   * suggested - the line's code is on no payment, and exactly ONE payment with its code missing has the same amount,
   *             method and a date within three days: accounts confirm in one tap and the bank's code is saved on it;
   * unmatched - picked by hand (the likely payments first) or marked not ours.
   */
  status: "matched" | "settled" | "suggested" | "unmatched";
  paymentId: string | null;
  why: string;
  candidates: string[];
  /** A suggested match: the bank's code to save on the payment. */
  fillCode?: string | null;
  /** A suggested match: days between the payment and the line. */
  daysApart?: number;
};

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000;
const METHOD_WORDS: Record<string, string> = { card: "card machine", link: "payment link" };
const aedWords = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const daysWords = (n: number) => (n === 0 ? "the same day" : `${n} day${n === 1 ? "" : "s"} apart`);

/**
 * THE rule of a suggested match, the same on the review screen and on the server when accounts confirm it: a sale line
 * whose code is a real one, against a payment with its code missing, the same amount to the fils, the same method (or
 * the line's method unknown) and the line's date within three days of the day the payment was recorded.
 */
export function suggestionStands(l: ReportLine, p: MatchPayment): boolean {
  return l.kind === "sale" && !!realAuthCode(l.authCode) && !!p.codeMissing && Math.abs(p.amount - l.amount) < 0.005 && (!l.method || p.method === l.method) && !!l.date && dayDiff(p.receivedDay, l.date) <= 3;
}

/** The words of a suggested match: "Suggested match: RCT-00040 · AED 30,000.00 · payment link · 1 day apart · its auth code is missing". */
export function suggestionWords(l: ReportLine, p: MatchPayment): string {
  const days = l.date ? Math.round(dayDiff(p.receivedDay, l.date)) : 0;
  return [`Suggested match: ${p.number}`, aedWords(p.amount), METHOD_WORDS[p.method] ?? p.method, daysWords(days), "its auth code is missing", p.settledIn ? `settled in ${p.settledIn}` : null].filter(Boolean).join(" · ") + (l.method ? "" : " (the method is not on the report line)");
}

/**
 * Each sale line against our card/link payments, in line order (a payment answers one line only):
 *  1. auth code + amount (to the fils) + the date within three days = matched (or "settled" when it was settled by hand);
 *  2. a real code no payment carries, and a payment with its code missing that fits = suggested - ONE TO ONE only: the
 *     line fits exactly one such payment AND that payment fits no other line of the report (review, 3 November 2026: the
 *     first line in the file must never win a coin toss and put another payment's bank code on a receipt for good);
 *     otherwise unmatched, every fitting payment first to pick from - a payment settled by hand included, picked as
 *     "already settled" (never settled twice);
 *  3. otherwise unmatched, with the likely payments to pick by hand (same method and amount first).
 * Payments already settled are offered only as exact, suggested or fitting matches, never to settle again.
 */
export function matchLines(lines: ReportLine[], payments: MatchPayment[]): LineMatch[] {
  // Which payments with their code missing fit which lines whose real code no payment carries (decided before the loop,
  // so the answer never depends on the order of the lines).
  const carries = (l: ReportLine) => payments.some((p) => !!l.authCode && p.authCode === l.authCode);
  const fitsOf = new Map<number, MatchPayment[]>();
  const linesOf = new Map<string, number[]>();
  for (const l of lines) {
    if (l.kind !== "sale" || carries(l)) continue;
    const fits = payments.filter((p) => suggestionStands(l, p));
    fitsOf.set(l.index, fits);
    for (const p of fits) linesOf.set(p.id, [...(linesOf.get(p.id) ?? []), l.index]);
  }
  const used = new Set<string>();
  const out: LineMatch[] = [];
  for (const l of lines) {
    if (l.kind !== "sale") {
      out.push({ index: l.index, status: "unmatched", paymentId: null, why: `${l.type}: not a sale, never matched by itself.`, candidates: [] });
      continue;
    }
    const nearest = (a: MatchPayment, b: MatchPayment) => (l.date ? dayDiff(a.receivedDay, l.date) - dayDiff(b.receivedDay, l.date) : 0);
    const carrying = payments.filter((p) => !!l.authCode && p.authCode === l.authCode);
    const sameAuth = carrying.filter((p) => !used.has(p.id));
    const exact = sameAuth.find((p) => Math.abs(p.amount - l.amount) < 0.005 && (!l.date || dayDiff(p.receivedDay, l.date) <= 3) && (!l.method || p.method === l.method));
    if (exact) {
      used.add(exact.id);
      out.push(exact.settledIn
        ? { index: l.index, status: "settled", paymentId: exact.id, why: `Already settled in ${exact.settledIn} ✓ ${exact.number} (auth ${l.authCode})`, candidates: [] }
        : { index: l.index, status: "matched", paymentId: exact.id, why: `Auth ${l.authCode}, ${exact.number}`, candidates: [] });
      continue;
    }
    // The bank's code is on no payment: a payment saved with its code missing may be this one.
    const missing = (fitsOf.get(l.index) ?? []).filter((p) => !used.has(p.id)).sort(nearest);
    const otherLines = missing.length === 1 ? (linesOf.get(missing[0].id) ?? []).filter((i) => i !== l.index) : [];
    if (missing.length === 1 && !otherLines.length) {
      const p = missing[0];
      used.add(p.id);
      out.push({ index: l.index, status: "suggested", paymentId: p.id, why: suggestionWords(l, p), candidates: [p.id], fillCode: l.authCode, daysApart: l.date ? Math.round(dayDiff(p.receivedDay, l.date)) : 0 });
      continue;
    }
    const named = (p: MatchPayment) => (p.settledIn ? `${p.number} (already settled in ${p.settledIn})` : p.number);
    const near = payments.filter((p) => !used.has(p.id) && !p.settledIn && (!l.method || p.method === l.method) && Math.abs(p.amount - l.amount) < 0.005).sort(nearest);
    const why = missing.length > 1
      ? `${missing.length} payments without an auth code could be this one (${missing.map(named).join(", ")}): pick the right one.`
      : missing.length === 1
        ? `${named(missing[0])} has its auth code missing and fits this line and line ${otherLines.join(", line ")} alike (the same amount, method and days): pick it by hand on the right line.`
        : sameAuth.length
        ? `Auth ${l.authCode} is on ${sameAuth.map((p) => p.number).join(", ")}, but the amount or the date does not agree.`
        : carrying.length
          ? `Auth ${l.authCode} is on ${carrying.map((p) => p.number).join(", ")}, already matched to another line.`
          : l.authCode
            ? `No payment in the ERP carries auth ${l.authCode}.`
            : "The report line has no auth code.";
    // Every fitting payment first (a settled one too: the screen offers it as "already settled", never to settle again).
    out.push({ index: l.index, status: "unmatched", paymentId: null, why, candidates: [...missing, ...sameAuth.filter((p) => !p.settledIn), ...near].map((p) => p.id).filter((id, i, a) => a.indexOf(id) === i).slice(0, 8) });
  }
  return out;
}
