import "server-only";
import * as XLSX from "xlsx";
import { logAppError, SAVE_FAILED } from "./app-errors";
import { recordSettlement } from "./card-settlements";
import { readPdfCells } from "./pdf-cells";
import { REPORT_SHEET_ROWS, REPORT_XLSX_READ, matchLines, parseReportPdf, parseReportRows, suggestionStands, type LineMatch, type MatchPayment, type ParsedReport, type ReportMethod } from "./settlement-report";
import { authCodeMissing, realAuthCode } from "./auth-code";
import { addAuthCode, type Actor } from "./payments";
import { bankFeesOf, getSettings } from "./settings";
import { createAdminClient } from "./supabase/admin";

/**
 * The settlement report upload (29 October 2026, section 5): the file goes to the private `settlement-reports`
 * bucket, its reading to the server-only `settlement_reports` table; the review screen matches the lines to the
 * unsettled card/link payments afresh each time it opens; Record makes one settlement per method with every payment's
 * EXACT MSF, transaction fee and VAT from its line.
 */
export const REPORT_BUCKET = "settlement-reports";
const MAX_BYTES = 10 * 1024 * 1024;

export type StoredReport = {
  id: string;
  fileName: string;
  parsed: ParsedReport;
  uploadedAt: string;
  uploadedBy: string | null;
  settlementIds: string[];
  recordedAt: string | null;
};

const dubaiDay = (iso: string) => new Date(Date.parse(iso) + 4 * 3600 * 1000).toISOString().slice(0, 10);

/** The file as rows (CSV, Excel) or positioned PDF cells, read with the ONE reader. */
export async function readReportFile(name: string, buf: Buffer): Promise<ParsedReport> {
  const fees = bankFeesOf(await getSettings());
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf") || buf.subarray(0, 4).toString("latin1") === "%PDF") {
    const mupdf = await import("mupdf");
    return parseReportPdf(readPdfCells(mupdf, new Uint8Array(buf)).cellPages, fees);
  }
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const wb = XLSX.read(buf.toString("utf8"), { type: "string", raw: true });
    return parseReportRows(XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" }), fees);
  }
  // Real Excel date cells are read as "2026-10-24" (never the US "10/24/26" a spreadsheet prints them in).
  const wb = XLSX.read(buf, { type: "buffer", ...REPORT_XLSX_READ });
  return parseReportRows(XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { ...REPORT_SHEET_ROWS }), fees);
}

/** Upload: keep the file, read it, store the reading. Plain words back when the file is not this report. */
export async function uploadSettlementReport(file: File, actorId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!file || !file.size) return { ok: false, error: "Choose the report file (PDF, CSV or Excel)." };
  if (file.size > MAX_BYTES) return { ok: false, error: "The file is larger than 10 MB. Ask the bank for the report of one day or one batch." };
  if (!/\.(pdf|csv|xlsx|xls|txt)$/i.test(file.name)) return { ok: false, error: "The report must be a PDF, a CSV or an Excel file." };
  const buf = Buffer.from(await file.arrayBuffer());
  let parsed: ParsedReport;
  try {
    parsed = await readReportFile(file.name, buf);
  } catch (e) {
    await logAppError("settlement report: read", e, { staffId: actorId, detail: { name: file.name } });
    return { ok: false, error: `${file.name} could not be opened. Save it again as PDF, CSV or Excel (.xlsx) and try once more.` };
  }
  if (parsed.problems.length) return { ok: false, error: parsed.problems.join(" ") };
  if (!parsed.lines.length) return { ok: false, error: "The report has no transactions in it." };
  const admin = createAdminClient();
  const id = crypto.randomUUID();
  const path = `${new Date().toISOString().slice(0, 10)}/${id}-${file.name.replace(/[^\w.-]+/g, "_").slice(-80)}`;
  const { error: upErr } = await admin.storage.from(REPORT_BUCKET).upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: false });
  if (upErr) {
    await logAppError("settlement report: store file", upErr, { staffId: actorId });
    return { ok: false, error: SAVE_FAILED };
  }
  const { error } = await admin.from("settlement_reports").insert({ id, file_name: file.name.slice(0, 200), storage_path: path, parsed, uploaded_by: actorId });
  if (error) {
    await logAppError("settlement report: insert", error, { staffId: actorId });
    return { ok: false, error: SAVE_FAILED };
  }
  return { ok: true, id };
}

export async function loadReport(id: string): Promise<StoredReport | null> {
  const { data } = await createAdminClient().from("settlement_reports").select("id, file_name, parsed, created_at, uploaded_by, settlement_ids, recorded_at").eq("id", id).maybeSingle();
  if (!data) return null;
  const r = data as { id: string; file_name: string; parsed: ParsedReport; created_at: string; uploaded_by: string | null; settlement_ids: string[] | null; recorded_at: string | null };
  return { id: r.id, fileName: r.file_name, parsed: r.parsed, uploadedAt: r.created_at, uploadedBy: r.uploaded_by, settlementIds: r.settlement_ids ?? [], recordedAt: r.recorded_at };
}

export type ReviewPayment = MatchPayment & { plate: string };

/**
 * The payments a report is reviewed against: the unsettled card/link payments, plus (3 November 2026) the ones already
 * settled BY HAND around the report's days - a line paid out on a settlement typed in earlier shows "Already settled"
 * instead of "No payment carries it". Once the report is recorded (review, 3 November 2026): the payments its own
 * settlements took, plus the ones settled before it - so its "Already settled" lines still read so, never "Not ours" -
 * and never the open list again (a payment that arrived after the report is not one of its lines).
 */
export async function reviewPaymentsFor(report: StoredReport): Promise<ReviewPayment[]> {
  if (report.recordedAt) {
    const [own, settled] = await Promise.all([report.settlementIds.length ? matchablePayments(report.settlementIds) : Promise.resolve([] as ReviewPayment[]), settledAround(report)]);
    const ownIds = new Set(own.map((p) => p.id));
    return [...own, ...settled.filter((p) => !ownIds.has(p.id))];
  }
  const [open, settled] = await Promise.all([matchablePayments(), settledAround(report)]);
  return [...open, ...settled];
}

/** A real calendar day ("2026-10-24"); a report stored with an impossible date ("2026-24-10") never reaches the maths. */
const isDay = (d: string | null | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
const addDay = (day: string, n: number) => new Date(Date.parse(day + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** The card/link payments already in a settlement, received within three days of the report's lines (its period). */
async function settledAround(report: StoredReport): Promise<ReviewPayment[]> {
  const days = [report.parsed.header.from, report.parsed.header.to, ...report.parsed.lines.map((l) => l.date)].filter(isDay).sort();
  if (!days.length) return [];
  const from = new Date(addDay(days[0], -4) + "T00:00:00+04:00").toISOString();
  const to = new Date(addDay(days[days.length - 1], 4) + "T00:00:00+04:00").toISOString();
  return matchablePayments(null, { from, to });
}

/**
 * The unsettled card/link payments to match against (with a plate for the pick list); or those of given settlements; or
 * (settledBetween) the ones already settled, received in that window, marked with their STL number. The code is read by
 * THE rule: a missing or made-up one is null with codeMissing (3 November 2026).
 */
export async function matchablePayments(settlementIds: string[] | null = null, settledBetween: { from: string; to: string } | null = null): Promise<ReviewPayment[]> {
  let q = createAdminClient()
    .from("payments")
    .select("id, number, method, amount_aed, received_at, auth_code, settlement:card_settlements!payments_settlement_id_fkey(number), job:jobs!payments_job_id_fkey(job_number, vehicle:vehicles(plate_emirate, plate_code, plate_number))")
    .eq("is_active", true)
    .eq("status", "recorded")
    .in("method", ["card", "link"]);
  if (settledBetween) q = q.not("settlement_id", "is", null).gte("received_at", settledBetween.from).lt("received_at", settledBetween.to);
  else q = settlementIds ? q.in("settlement_id", settlementIds) : q.is("settlement_id", null);
  const { data } = await q.order("received_at", { ascending: false }).limit(500);
  type Row = { id: string; number: string; method: string; amount_aed: number | string; received_at: string; auth_code: string | null; settlement: { number: string } | null; job: { job_number: string; vehicle: { plate_emirate: string | null; plate_code: string | null; plate_number: string | null } | null } | null };
  return ((data ?? []) as unknown as Row[]).map((p) => ({
    id: p.id,
    number: p.number,
    method: p.method,
    amount: Math.round((Number(p.amount_aed) || 0) * 100) / 100,
    receivedDay: dubaiDay(p.received_at),
    authCode: realAuthCode(p.auth_code),
    codeMissing: authCodeMissing(p),
    settledIn: settledBetween ? (p.settlement?.number ?? "a settlement") : null,
    plate: p.job?.vehicle ? [p.job.vehicle.plate_emirate, p.job.vehicle.plate_code, p.job.vehicle.plate_number].filter(Boolean).join(" ") : (p.job?.job_number ?? "No job"),
  }));
}

/**
 * Confirm a SUGGESTED match (3 November 2026, section 5): the bank's code on the report line is saved on the payment
 * whose code was missing - through THE "Add auth code" (logged with the report's file and line). The same rule as the
 * screen is checked again here - the WHOLE rule (review, 3 November 2026): the report is matched afresh and the line must
 * still be suggested to this very payment, one to one (a payment that fits two lines, or a line two payments fit, is
 * picked by hand). The line is then an exact match: "Matched ✓", or "Already settled" for a payment settled by hand.
 * Nothing else moves.
 */
export async function fillAuthFromReport(reportId: string, index: number, paymentId: string, actor: Actor): Promise<{ ok: true; number: string; code: string; settledIn: string | null } | { ok: false; error: string }> {
  const report = await loadReport(reportId);
  if (!report) return { ok: false, error: "The report was not found. Upload it again." };
  if (report.recordedAt) return { ok: false, error: "This report was already recorded." };
  const line = report.parsed.lines.find((l) => l.index === index);
  if (!line) return { ok: false, error: "That line is not on the report." };
  const payments = await reviewPaymentsFor(report);
  const pay = payments.find((p) => p.id === paymentId);
  if (!pay) return { ok: false, error: "That payment is not waiting for this report any more. Reload the page." };
  if (!suggestionStands(line, pay)) return { ok: false, error: pay.number + " does not fit line " + index + " (the same amount and method, a date within three days and its code missing). Pick the payment by hand." };
  const now = matchLines(report.parsed.lines, payments).find((m) => m.index === index);
  if (now?.status !== "suggested" || now.paymentId !== pay.id) return { ok: false, error: `${pay.number} is no longer the one payment for line ${index}: another line or payment fits as well. Reload the page and pick it by hand on the right line.` };
  const code = String(line.authCode);
  const r = await addAuthCode(pay.id, code, actor, { kind: "report", reportId, fileName: report.fileName, line: index });
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, number: pay.number, code, settledIn: pay.settledIn ?? null };
}

export function reviewMatches(report: StoredReport, payments: ReviewPayment[]): LineMatch[] {
  return matchLines(report.parsed.lines, payments);
}

export type RecordReportInput = {
  /**
   * Per line (index): the payment it is (auto-matched or picked by hand), "none" for a line that is not ours, or
   * "settled:<payment id>" for a line whose payment was already settled by hand (3 November 2026: handled, never twice).
   */
  picks: Record<number, string>;
  settledOn: string;
  statementRef: string | null;
  note: string | null;
  /** The accountant has read the red flags. */
  flagsSeen: boolean;
};

/**
 * Record: every sale line must be a payment or marked "not ours"; red flags must be acknowledged. One settlement per
 * method, each payment with its line's EXACT figures; the report remembers its settlements.
 */
export async function recordReport(reportId: string, input: RecordReportInput, actor: Actor): Promise<{ ok: true; numbers: string[]; settledBefore: string[]; codesSaved: string[] } | { ok: false; error: string }> {
  const actorId = String(actor.id);
  const report = await loadReport(reportId);
  if (!report) return { ok: false, error: "The report was not found. Upload it again." };
  if (report.recordedAt) return { ok: false, error: "This report was already recorded." };
  const p = report.parsed;
  if (p.flags.some((f) => f.tone === "red") && !input.flagsSeen) return { ok: false, error: "Tick that you have checked the red items first." };
  const payments = await matchablePayments();
  const byId = new Map(payments.map((x) => [x.id, x]));
  const groups = new Map<ReportMethod, { ids: string[]; exact: Record<string, { msf: number; txn: number; vat: number; net: number }> }>();
  const usedIds = new Set<string>();
  // Lines already settled by hand (handled, nothing new) and the codes the report fills in on payments missing theirs.
  const settledBefore: string[] = [];
  const fills: { paymentId: string; number: string; code: string; line: number }[] = [];
  const settledNow = new Map((await settledAround(report)).map((x) => [x.id, x]));
  // A bank code already on one of our payments (waiting or settled) is never written on a second one.
  const carried = (code: string) => payments.some((x) => x.authCode === code) || [...settledNow.values()].some((x) => x.authCode === code);
  for (const line of p.lines) {
    const pick = input.picks[line.index];
    if (line.kind !== "sale") {
      if (pick && pick !== "none") return { ok: false, error: `Line ${line.index} is a ${line.type.toLowerCase()}, not a sale: it cannot be a payment. Leave it as not ours and settle it with the bank by hand.` };
      continue;
    }
    if (!pick) return { ok: false, error: `Line ${line.index} (auth ${line.authCode ?? "none"}, AED ${line.amount.toFixed(2)}) is not matched: pick its payment or mark it not ours.` };
    if (pick === "none") continue;
    if (pick.startsWith("settled:")) {
      // Already in a settlement typed by hand: the same payment (amount and code), counted as handled - never settled twice.
      // Or (review, 3 November 2026) a settled payment with its code missing that fits the line, picked by hand: handled
      // too, and the bank's code is saved on it.
      const done = settledNow.get(pick.slice(8));
      const code = realAuthCode(line.authCode);
      const sameCode = !!done && !!code && done.authCode === code;
      const fillsIn = !!done && !sameCode && suggestionStands(line, done);
      if (!done || Math.abs(done.amount - line.amount) >= 0.005 || !(sameCode || fillsIn)) return { ok: false, error: `Line ${line.index}: the settled payment no longer agrees with it. Reload the page.` };
      if (usedIds.has(done.id)) return { ok: false, error: `${done.number} is picked for two lines.` };
      usedIds.add(done.id);
      settledBefore.push(`${done.number} (${done.settledIn})`);
      if (fillsIn && code && !carried(code)) fills.push({ paymentId: done.id, number: done.number, code, line: line.index });
      continue;
    }
    const pay = byId.get(pick);
    if (!pay) return { ok: false, error: `The payment picked for line ${line.index} is no longer waiting for a settlement. Reload the page.` };
    if (usedIds.has(pay.id)) return { ok: false, error: `${pay.number} is picked for two lines.` };
    usedIds.add(pay.id);
    if (Math.abs(pay.amount - line.amount) >= 0.005) return { ok: false, error: `Line ${line.index} is AED ${line.amount.toFixed(2)}, ${pay.number} is AED ${pay.amount.toFixed(2)}: a payment and its line must be the same amount.` };
    const method = (pay.method === "link" ? "link" : "card") as ReportMethod;
    if (line.method && line.method !== method) return { ok: false, error: `Line ${line.index} is a ${line.method === "link" ? "payment link" : "card machine"} transaction, ${pay.number} was recorded as ${method === "link" ? "payment link" : "card"}.` };
    const g = groups.get(method) ?? { ids: [], exact: {} };
    g.ids.push(pay.id);
    g.exact[pay.id] = { msf: line.msf, txn: line.txn, vat: line.vat, net: line.net };
    groups.set(method, g);
    // A payment picked by hand whose code is missing gets the bank's code once the settlement is written.
    const code = realAuthCode(line.authCode);
    if (pay.codeMissing && code && !carried(code)) fills.push({ paymentId: pay.id, number: pay.number, code, line: line.index });
  }
  // The codes the report fills in, once what it records is written (a refusal is logged, never a stop).
  const saveFills = async () => {
    const saved: string[] = [];
    for (const x of fills) {
      const r = await addAuthCode(x.paymentId, x.code, actor, { kind: "report", reportId, fileName: report.fileName, line: x.line });
      if (r.ok) saved.push(`${x.number} auth ${x.code}`);
      else await logAppError("settlement report: fill auth code", new Error(r.error ?? "not saved"), { staffId: actorId, detail: { paymentId: x.paymentId, code: x.code } });
    }
    return saved;
  };
  if (!groups.size && settledBefore.length) {
    // Every payment on the report was settled by hand before: nothing new to record, the report is done.
    await createAdminClient().from("settlement_reports").update({ settlement_ids: [], recorded_at: new Date().toISOString(), recorded_by: actorId }).eq("id", reportId);
    return { ok: true, numbers: [], settledBefore, codesSaved: await saveFills() };
  }
  if (!groups.size) return { ok: false, error: "No line of this report is one of our payments: nothing to record." };
  const numbers: string[] = [];
  const ids: string[] = [];
  for (const [method, g] of groups) {
    const sum = (k: "msf" | "txn" | "vat" | "net") => Math.round(g.ids.reduce((a, id) => a + g.exact[id][k], 0) * 100) / 100;
    const res = await recordSettlement({ method, settledOn: input.settledOn, paymentIds: g.ids, net: sum("net"), msf: sum("msf"), txn: sum("txn"), vat: sum("vat"), statementRef: input.statementRef, note: input.note, confirmed: true, override: false, exact: g.exact, reportId }, actorId);
    if (!res.ok) return { ok: false, error: numbers.length ? `${numbers.join(", ")} recorded; the ${method === "link" ? "payment link" : "card machine"} part was not: ${res.error}` : res.error };
    numbers.push(res.number);
    ids.push(res.id);
  }
  await createAdminClient().from("settlement_reports").update({ settlement_ids: ids, recorded_at: new Date().toISOString(), recorded_by: actorId }).eq("id", reportId);
  return { ok: true, numbers, settledBefore, codesSaved: await saveFills() };
}
