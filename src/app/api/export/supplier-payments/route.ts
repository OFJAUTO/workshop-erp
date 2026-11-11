import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { METHOD_WORDS, loadPaymentsTab } from "@/lib/supplier-payments-tab";
import { buildXlsx, xlsxResponse } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

/** The Supplier payments tab as an Excel file (10 November 2026, Section 5): owner and accounts only. */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !can(staff.role_id as RoleId, "supplierPayments")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const p = request.nextUrl.searchParams;
  const tab = await loadPaymentsTab({ from: p.get("from"), to: p.get("to") });
  if (!tab.read) return NextResponse.json({ error: "Couldn't read the supplier invoices just now. Try the export again." }, { status: 503 });
  const aed = "#,##0.00";
  const buf = await buildXlsx([
    {
      name: "Due by supplier",
      columns: [
        { header: "Supplier", key: "supplier", width: 34 },
        { header: "Invoices", key: "count", width: 10 },
        { header: "Oldest", key: "oldest", width: 14 },
        { header: "Before VAT (AED)", key: "net", numFmt: aed },
        { header: "VAT (AED)", key: "vat", numFmt: aed },
        { header: "Due incl. VAT (AED)", key: "total", numFmt: aed },
        { header: "Advance held (AED)", key: "advance", numFmt: aed },
      ],
      rows: tab.due.map((d) => ({ supplier: d.supplier, count: d.count, oldest: d.oldest ?? "", net: d.net, vat: d.vat, total: d.total, advance: tab.advances.get(d.supplierId ?? "") ?? tab.advances.get(d.supplier.toUpperCase()) ?? 0 })),
      totals: { supplier: "Total", total: Math.round(tab.due.reduce((a, d) => a + d.total, 0) * 100) / 100 },
    },
    {
      name: "Payment history",
      columns: [
        { header: "Number", key: "number", width: 14 },
        { header: "Supplier", key: "supplier", width: 34 },
        { header: "Paid on", key: "paidOn", width: 12 },
        { header: "Method", key: "method", width: 14 },
        { header: "Reference", key: "reference", width: 20 },
        { header: "LPOs", key: "lpos", width: 30 },
        { header: "Amount (AED)", key: "amount", numFmt: aed },
        { header: "Fee (AED)", key: "fee", numFmt: aed },
        { header: "Advance", key: "advance", width: 10 },
        { header: "Proof", key: "proof", width: 8 },
        { header: "Status", key: "status", width: 10 },
        { header: "By", key: "by", width: 18 },
      ],
      rows: tab.history.map((h) => ({ number: h.number, supplier: h.supplier, paidOn: h.paidOn, method: METHOD_WORDS[h.method] ?? h.method, reference: h.reference ?? "", lpos: h.lpos.join(", "), amount: h.amount, fee: h.fee, advance: h.excessKind === "advance" ? "Yes" : "", proof: h.hasProof ? "Yes" : "No", status: h.status === "void" ? `Void${h.voidReason ? `: ${h.voidReason}` : ""}` : "Recorded", by: h.by ?? "" })),
    },
  ]);
  return xlsxResponse(buf, `OFJ supplier payments ${new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10)}.xlsx`);
}
