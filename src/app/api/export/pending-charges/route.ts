import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { pendingDays } from "@/lib/charge-rules";
import { loadChargeEntries } from "@/lib/charges";
import { buildXlsx, xlsxResponse } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

/** Pending charges for accounts as a real Excel file, with the list's filters (status, search, provider, dates). */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "accounts", "service_advisor"].includes(staff.role_id)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const p = request.nextUrl.searchParams;
  const status = p.get("status") ?? "pending";
  const needle = (p.get("q") ?? "").trim().toLowerCase();
  const rows = (await loadChargeEntries()).filter((e) => (status === "all" ? e.status !== "cancelled" : e.status === status) && (!needle || [e.customer, e.phone ?? "", e.plate ?? "", e.what].join(" ").toLowerCase().includes(needle)) && (!p.get("provider") || (e.provider ?? "").toLowerCase() === String(p.get("provider")).toLowerCase()) && (!p.get("from") || e.service_date >= String(p.get("from"))) && (!p.get("to") || e.service_date <= String(p.get("to"))));
  const buf = await buildXlsx([{
    name: "Pending charges",
    columns: [
      { header: "Service date", key: "date", width: 12 },
      { header: "Customer", key: "customer", width: 28 },
      { header: "Car", key: "car", width: 26 },
      { header: "Charges", key: "what", width: 40 },
      { header: "Provider", key: "provider", width: 24 },
      { header: "Proforma", key: "proforma", width: 12 },
      { header: "Tax invoice", key: "tax", width: 12 },
      { header: "Cost (AED)", key: "cost", width: 12, numFmt: "#,##0.00" },
      { header: "Total with VAT (AED)", key: "total", width: 16, numFmt: "#,##0.00" },
      { header: "Paid (AED)", key: "paid", width: 12, numFmt: "#,##0.00" },
      { header: "Balance (AED)", key: "balance", width: 13, numFmt: "#,##0.00" },
      { header: "Status", key: "status", width: 16 },
    ],
    rows: rows.map((e) => ({ date: new Date(`${e.service_date}T12:00:00Z`), customer: e.customer, car: [e.plate, e.car].filter(Boolean).join(" · ") || "No car on record", what: e.what, provider: e.provider ?? "", proforma: e.proformaNumber ?? "", tax: e.taxNumber ?? "", cost: e.cost, total: e.total, paid: e.paid, balance: e.balance, status: e.status === "pending" ? `Pending ${pendingDays(e.created_at)} days` : e.status === "paid" ? "Paid" : "Cancelled" })),
    totals: { customer: `${rows.length} pending charges`, cost: Math.round(rows.reduce((a, e) => a + e.cost, 0) * 100) / 100, total: Math.round(rows.reduce((a, e) => a + e.total, 0) * 100) / 100, paid: Math.round(rows.reduce((a, e) => a + e.paid, 0) * 100) / 100, balance: Math.round(rows.reduce((a, e) => a + e.balance, 0) * 100) / 100 },
  }]);
  return xlsxResponse(buf, `OFJ pending charges ${new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10)}.xlsx`);
}
