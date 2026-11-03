import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { loadPartsBase, partsAccountsView } from "@/lib/parts-accounts";
import { PART_ENDING_WORDS, PART_STEP_WORDS, PROBLEM_WORDS, RETURN_STATE_WORDS, dubaiDay, filterBalances, filterLines, filterLpos, filterProblems, filterReturns, type LpoRow, type PaFilter, type PartLineRow, type PartsProblem, type ReturnRow, type SupplierBalance } from "@/lib/parts-accounts-rules";
import { can, type RoleId } from "@/lib/roles";
import { filterInvoices, invoiceFilterOf } from "@/lib/supplier-invoice-rows";
import { supplierInvoiceSheet } from "@/lib/supplier-invoices";
import { buildXlsx, xlsxResponse, type XlsxSheet } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

const AED = "#,##0.00";
const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = <T,>(rows: T[], f: (r: T) => number | null | undefined) => r2(rows.reduce((a, r) => a + (f(r) ?? 0), 0));
/**
 * A day or a moment as a real Excel date: first its day in Dubai (a moment at 01:30 Dubai is still that day, not the UTC
 * day before), then noon of that day, so no time zone moves it to another day.
 */
const day = (v: string | null | undefined) => {
  const d = dubaiDay(v);
  return d ? new Date(`${d}T12:00:00Z`) : "";
};

function linesSheet(rows: PartLineRow[]): XlsxSheet {
  return {
    name: "Parts lines",
    columns: [
      { header: "Job", key: "job", width: 11 },
      { header: "Plate", key: "plate", width: 16 },
      { header: "Car", key: "car", width: 20 },
      { header: "Part", key: "part", width: 34 },
      { header: "Part no.", key: "pn", width: 18 },
      { header: "Supplier", key: "supplier", width: 26 },
      { header: "LPO", key: "lpo", width: 14 },
      { header: "Qty", key: "qty", width: 7 },
      { header: "Unit", key: "unit", width: 7 },
      { header: "Unit cost (AED)", key: "unitCost", width: 14, numFmt: AED },
      { header: "Cost (AED)", key: "cost", width: 13, numFmt: AED },
      { header: "Cost from", key: "costFrom", width: 15 },
      { header: "Selling (AED)", key: "selling", width: 13, numFmt: AED },
      { header: "Sold on", key: "doc", width: 16 },
      { header: "Margin (AED)", key: "margin", width: 13, numFmt: AED },
      { header: "Margin %", key: "pct", width: 9, numFmt: "0.0" },
      { header: "Status", key: "status", width: 28 },
      { header: "Ordered", key: "ordered", width: 9 },
      { header: "Received", key: "received", width: 9 },
      { header: "Fitted", key: "fitted", width: 8 },
      { header: "Invoiced", key: "invoiced", width: 9 },
      { header: "Date", key: "day", width: 12 },
    ],
    rows: rows.map((r) => ({
      job: r.jobNumber,
      plate: r.plate,
      car: r.car,
      part: r.part,
      pn: r.partNumber ?? "",
      supplier: r.supplier,
      lpo: r.poNumber ?? "",
      qty: r.qty,
      unit: r.unit && r.unit !== "pc" ? r.unit : "",
      unitCost: r.unitCost ?? "",
      cost: r.cost,
      costFrom: r.costFrom,
      selling: r.selling ?? "",
      doc: r.sellingDoc ? `${r.sellingFrom === "quotation" ? "Approved " : ""}${r.sellingDoc}${r.notCharged ? ` (${r.notCharged})` : ""}` : "",
      margin: r.margin ?? "",
      pct: r.marginPct ?? "",
      status: r.ending ? PART_ENDING_WORDS[r.ending] : r.stateWords || PART_STEP_WORDS[r.step],
      ordered: r.dots.ordered ? "Yes" : "",
      received: r.dots.received ? "Yes" : "",
      fitted: r.dots.fitted ? "Yes" : "",
      invoiced: r.dots.invoiced ? "Yes" : "",
      day: day(r.day),
    })),
    totals: { job: `${rows.length} lines`, cost: sum(rows, (r) => r.cost), selling: sum(rows, (r) => r.selling), margin: sum(rows, (r) => r.margin) },
  };
}

function lposSheet(rows: LpoRow[]): XlsxSheet {
  return {
    name: "LPOs",
    columns: [
      { header: "LPO", key: "lpo", width: 14 },
      { header: "Kind", key: "kind", width: 12 },
      { header: "Supplier", key: "supplier", width: 26 },
      { header: "Job", key: "job", width: 11 },
      { header: "Plate", key: "plate", width: 16 },
      { header: "Before VAT (AED)", key: "amount", width: 15, numFmt: AED },
      { header: "VAT (AED)", key: "vat", width: 11, numFmt: AED },
      { header: "Total (AED)", key: "total", width: 13, numFmt: AED },
      { header: "Approved by", key: "approvedBy", width: 16 },
      { header: "Approved", key: "approvedAt", width: 12 },
      { header: "Ordered", key: "orderedAt", width: 12 },
      { header: "Received", key: "receivedAt", width: 12 },
      { header: "Status", key: "status", width: 24 },
      { header: "Supplier invoice", key: "invoice", width: 16 },
      { header: "Match", key: "match", width: 24 },
      { header: "Paid", key: "paidAt", width: 12 },
      { header: "Method", key: "method", width: 10 },
      { header: "Reference", key: "ref", width: 16 },
    ],
    rows: rows.map((r) => ({
      lpo: r.number,
      kind: r.kind === "stock" ? "Stock order" : r.kind === "main" ? "Main LPO" : "Supplier",
      supplier: r.supplier,
      job: r.jobNumber,
      plate: r.plate,
      amount: r.amount,
      vat: r.vat,
      total: r.total,
      approvedBy: r.approvedBy ?? "",
      approvedAt: day(r.approvedAt),
      orderedAt: day(r.orderedAt),
      receivedAt: day(r.receivedAt),
      status: r.stepWords,
      invoice: r.invoice?.number ?? (r.invoiceMissing ? "Missing" : ""),
      match: [...(r.invoice?.matchWords ?? []), r.invoice?.duplicateOf ? `Possible duplicate of ${r.invoice.duplicateOf}` : ""].filter(Boolean).join(", "),
      paidAt: day(r.paidAt),
      method: r.paidMethod ?? "",
      ref: r.paidReference ?? "",
    })),
    totals: { lpo: `${rows.length} LPOs`, amount: sum(rows, (r) => r.amount), vat: sum(rows, (r) => r.vat), total: sum(rows, (r) => r.total) },
  };
}

function paymentsSheet(rows: SupplierBalance[]): XlsxSheet {
  return {
    name: "Payments to suppliers",
    columns: [
      { header: "Supplier", key: "supplier", width: 28 },
      { header: "TRN", key: "trn", width: 18 },
      { header: "Terms", key: "terms", width: 14 },
      { header: "Invoiced (AED)", key: "invoiced", width: 14, numFmt: AED },
      { header: "Paid (AED)", key: "paid", width: 13, numFmt: AED },
      { header: "Unpaid (AED)", key: "unpaid", width: 13, numFmt: AED },
      { header: "Unpaid invoices", key: "unpaidCount", width: 10 },
      { header: "Oldest unpaid", key: "oldest", width: 12 },
      { header: "Invoice to follow (AED)", key: "toFollow", width: 16, numFmt: AED },
      { header: "Credits due (AED)", key: "credits", width: 14, numFmt: AED },
    ],
    rows: rows.map((b) => ({ supplier: b.supplier, trn: b.trn ?? (b.needsTrn ? "MISSING" : ""), terms: b.terms ?? "", invoiced: b.invoiced, paid: b.paid, unpaid: b.unpaid, unpaidCount: b.unpaidCount, oldest: day(b.oldestUnpaid), toFollow: b.toFollow, credits: b.creditsDue })),
    totals: { supplier: `${rows.length} suppliers`, invoiced: sum(rows, (b) => b.invoiced), paid: sum(rows, (b) => b.paid), unpaid: sum(rows, (b) => b.unpaid), toFollow: sum(rows, (b) => b.toFollow), credits: sum(rows, (b) => b.creditsDue) },
  };
}

function returnsSheet(rows: ReturnRow[]): XlsxSheet {
  return {
    name: "Returns and credits",
    columns: [
      { header: "Job", key: "job", width: 11 },
      { header: "Plate", key: "plate", width: 16 },
      { header: "Part", key: "part", width: 32 },
      { header: "Supplier", key: "supplier", width: 26 },
      { header: "LPO", key: "lpo", width: 14 },
      { header: "Qty", key: "qty", width: 8 },
      { header: "Credit before VAT (AED)", key: "credit", width: 16, numFmt: AED },
      { header: "Credit with VAT (AED)", key: "creditVat", width: 16, numFmt: AED },
      { header: "Returned", key: "returned", width: 12 },
      { header: "Credit note no.", key: "cn", width: 16 },
      { header: "Credit note date", key: "cnDate", width: 13 },
      { header: "Credit note amount (AED)", key: "cnAmount", width: 16, numFmt: AED },
      { header: "Status", key: "status", width: 30 },
      { header: "Days waiting", key: "days", width: 10 },
    ],
    rows: rows.map((r) => ({ job: r.jobNumber, plate: r.plate, part: r.part, supplier: r.supplier, lpo: r.poNumber ?? "", qty: r.qtyWords, credit: r.credit, creditVat: r.creditWithVat, returned: day(r.returnedAt), cn: r.creditNote.number ?? (r.creditNote.scan ? "Scan on file" : ""), cnDate: day(r.creditNote.date), cnAmount: r.creditNote.amount ?? "", status: RETURN_STATE_WORDS[r.state], days: r.waitingDays ?? "" })),
    totals: { job: `${rows.length} parts`, credit: sum(rows, (r) => r.credit), creditVat: sum(rows, (r) => r.creditWithVat) },
  };
}

function problemsSheet(rows: PartsProblem[]): XlsxSheet {
  return {
    name: "Problems",
    columns: [
      { header: "Problem", key: "rule", width: 26 },
      { header: "Red or amber", key: "severity", width: 10 },
      { header: "What", key: "title", width: 36 },
      { header: "Detail", key: "detail", width: 70 },
      { header: "Amount (AED)", key: "amount", width: 13, numFmt: AED },
      { header: "Job", key: "job", width: 11 },
      { header: "Plate", key: "plate", width: 16 },
      { header: "LPO", key: "lpo", width: 14 },
      { header: "Supplier", key: "supplier", width: 26 },
      { header: "Since", key: "since", width: 12 },
    ],
    rows: rows.map((p) => ({ rule: PROBLEM_WORDS[p.rule], severity: p.severity === "red" ? "Red" : "Amber", title: p.title, detail: p.detail, amount: p.amount ?? "", job: p.jobNumber, plate: p.plate, lpo: p.poNumber ?? "", supplier: p.supplier, since: day(p.since) })),
    totals: { rule: `${rows.length} problems` },
  };
}

/**
 * Parts accounts as a real Excel file (3 November 2026): the tab on the screen with the same filters, or tab=all for
 * one workbook with the six sheets. Accounts and the owner only (viewPartsAccounts), the same rows as the screen.
 */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !can(staff.role_id as RoleId, "viewPartsAccounts")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const p = request.nextUrl.searchParams;
  const tab = p.get("tab") ?? "lines";
  const f: PaFilter = { q: p.get("q") ?? undefined, supplier: p.get("supplier") ?? undefined, from: p.get("from") ?? undefined, to: p.get("to") ?? undefined, status: p.get("status") ?? undefined, quick: p.get("quick") ?? undefined };
  const all = tab === "all";
  // The tab's own status and quick chip only on that tab's sheet; the other sheets of "everything" keep the shared filters.
  const own = (t: string): PaFilter => (all || t !== tab ? { q: f.q, supplier: f.supplier, from: f.from, to: f.to } : f);
  // Strict reads: a file is never made from lists that could not be read.
  const base = await loadPartsBase().catch(() => null);
  if (!base) return NextResponse.json({ error: "Couldn't read the parts accounts just now. Try the export again." }, { status: 503 });
  const { shared } = partsAccountsView(base, f);
  const sup = base.suppliers;
  const sheets: XlsxSheet[] = [];
  if (all || tab === "lines") sheets.push(linesSheet(filterLines(shared.lines, own("lines"), sup)));
  if (all || tab === "lpos") sheets.push(lposSheet(filterLpos(shared.lpos, own("lpos"), sup)));
  // The Supplier invoices sheet: the same filters as that tab's own (THE invoiceFilterOf + filterInvoices of the shared
  // view; the page's link carries them through invoiceFilterParams).
  if (all || tab === "invoices") sheets.push(supplierInvoiceSheet(all ? shared.invoices : filterInvoices(base.invoices, invoiceFilterOf((k) => p.get(k)), base.invoicePartNames)));
  if (all || tab === "payments") sheets.push(paymentsSheet(filterBalances(shared.balances, all ? undefined : f.quick)));
  if (all || tab === "returns") sheets.push(returnsSheet(filterReturns(shared.returns, own("returns"), sup)));
  if (all || tab === "problems") sheets.push(problemsSheet(filterProblems(shared.problems, own("problems"), sup)));
  if (!sheets.length) return NextResponse.json({ error: "Unknown tab." }, { status: 400 });
  const buf = await buildXlsx(sheets);
  const label = all ? "everything" : (sheets[0]?.name ?? tab).toLowerCase();
  return xlsxResponse(buf, `OFJ parts accounts ${label} ${new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10)}.xlsx`);
}
