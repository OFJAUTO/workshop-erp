import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { buildXlsx, xlsxResponse, type XlsxSheet } from "@/lib/xlsx";
import { loadMonthlyClose, validMonth } from "@/lib/zoho-close";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The monthly close as Excel: the checklist, the per-method totals, and the two open lists. */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !can(staff.role_id as RoleId, "zohoSync")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!validMonth(month)) return NextResponse.json({ error: "Pick a month (yyyy-mm)." }, { status: 400 });
  const data = await loadMonthlyClose(month);
  const sheets: XlsxSheet[] = [
    {
      name: "Checklist",
      columns: [
        { header: "Item", key: "label", width: 48 },
        { header: "State", key: "state", width: 10 },
        { header: "Amount AED", key: "amount", width: 14, numFmt: "#,##0.00" },
        { header: "Detail", key: "detail", width: 90 },
      ],
      rows: data.lines.map((l) => ({ label: l.label, state: l.ok ? "OK" : "OPEN", amount: l.amount ?? "", detail: l.detail })),
    },
    {
      name: "Totals per method",
      columns: [
        { header: "Method", key: "mode", width: 16 },
        { header: "ERP AED", key: "erp", width: 16, numFmt: "#,##0.00" },
        { header: "Zoho AED", key: "zoho", width: 16, numFmt: "#,##0.00" },
        { header: "Match", key: "ok", width: 8 },
      ],
      rows: Object.entries(data.byMode).map(([mode, m]) => ({ mode, erp: m.erp, zoho: m.zoho, ok: m.ok ? "✓" : "✗" })),
    },
    {
      name: "Unpaid invoices",
      columns: [
        { header: "Invoice", key: "number", width: 14 },
        { header: "Total AED", key: "total", width: 14, numFmt: "#,##0.00" },
        { header: "Balance AED", key: "balance", width: 14, numFmt: "#,##0.00" },
      ],
      rows: data.unpaidInvoices,
      totals: { number: "TOTAL", balance: data.unpaidInvoices.reduce((a, i) => a + i.balance, 0) },
    },
    {
      name: "Unpaid supplier bills",
      columns: [
        { header: "LPO", key: "lpo", width: 16 },
        { header: "Supplier", key: "supplier", width: 28 },
        { header: "Invoice", key: "invoice", width: 20 },
        { header: "Amount AED", key: "amount", width: 14, numFmt: "#,##0.00" },
      ],
      rows: data.unpaidBills,
      totals: { lpo: "TOTAL", amount: data.unpaidBills.reduce((a, b) => a + b.amount, 0) },
    },
  ];
  return xlsxResponse(await buildXlsx(sheets), `OFJ Zoho close ${month}.xlsx`);
}
