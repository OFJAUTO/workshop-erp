import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { jobProfits } from "@/lib/profit";
import { getSettings } from "@/lib/settings";
import { buildXlsx, xlsxResponse } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

/** Profit per invoice as .xlsx, the owner only (1.8). */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role_id !== "owner") return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const from = request.nextUrl.searchParams.get("from") ?? new Date(Date.now() - 60 * 86400000).toISOString();
  const to = request.nextUrl.searchParams.get("to") ?? undefined;
  const settings = await getSettings();
  const rows = await jobProfits(settings, { from, to, limit: 1000 });
  const buffer = await buildXlsx([
    {
      name: "Profit per invoice",
      columns: [
        { header: "Invoice", key: "invoice", width: 12 },
        { header: "Date", key: "date", width: 14, numFmt: "dd mmm yyyy" },
        { header: "Job", key: "job", width: 10 },
        { header: "Plate", key: "plate", width: 14 },
        { header: "Revenue before VAT", key: "revenue", width: 16, numFmt: "#,##0.00" },
        { header: "Parts", key: "parts", width: 12, numFmt: "#,##0.00" },
        { header: "Labour AED", key: "labour", width: 12, numFmt: "#,##0.00" },
        { header: "Labour h", key: "hours", width: 10, numFmt: "0.0" },
        { header: "Other + stock + recovery + materials", key: "other", width: 16, numFmt: "#,##0.00" },
        { header: "Commission", key: "commission", width: 12, numFmt: "#,##0.00" },
        { header: "Bank", key: "bank", width: 10, numFmt: "#,##0.00" },
        { header: "Profit", key: "profit", width: 12, numFmt: "#,##0.00" },
        { header: "Margin %", key: "margin", width: 10, numFmt: "0.0" },
        { header: "Provisional", key: "provisional", width: 12 },
        { header: "Balance due", key: "balance", width: 12, numFmt: "#,##0.00" },
      ],
      rows: rows.map((r) => ({
        invoice: r.invoice.number,
        date: new Date(r.invoice.issued_at),
        job: r.jobNumber ?? "",
        plate: r.plate ?? "",
        revenue: r.revenue,
        parts: r.partsCost,
        labour: r.labourCost,
        hours: r.labourMinutes / 60,
        other: r.otherCost + r.stockCost + r.recoveryCost + r.materialsCost,
        commission: r.commission,
        bank: r.bankCharges,
        profit: r.profit,
        margin: r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0,
        provisional: r.provisional ? r.provisionalWhy.join(", ") : "",
        balance: r.balance,
      })),
    },
  ]);
  return xlsxResponse(buffer, `OFJ Profit per invoice.xlsx`);
}
