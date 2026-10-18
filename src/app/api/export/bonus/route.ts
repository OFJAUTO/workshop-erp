import { NextResponse, type NextRequest } from "next/server";
import { bonusPeriodOf, bonusRowsOf } from "@/lib/advisor-bonus";
import { getCurrentStaff } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { buildXlsx, xlsxResponse } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

/** The period's advisor bonuses for the accountant: one row per invoice, totals per advisor. Owner only. */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role_id !== "owner") return NextResponse.json({ error: "Owner only." }, { status: 403 });
  const periodParam = request.nextUrl.searchParams.get("period") ?? bonusPeriodOf().key;
  if (!/^\d{4}-\d{2}$/.test(periodParam)) return NextResponse.json({ error: "Bad period." }, { status: 400 });
  const settings = await getSettings();
  const view = await bonusRowsOf(settings, periodParam);
  const money = "#,##0.00";
  const rows: Record<string, unknown>[] = [];
  const names = Array.from(new Set(view.rows.map((r) => r.advisorName)));
  for (const name of names) {
    const mine = view.rows.filter((r) => r.advisorName === name);
    for (const r of mine) rows.push({ advisor: name, invoice: r.invoiceNumber, date: new Date(`${r.date}T12:00:00Z`), plate: r.plate ?? r.jobNumber ?? "", profit: r.profit, rate: r.clawback ? "" : r.ratePercent, bonus: r.bonus, note: r.overrideReason ?? "" });
    rows.push({ advisor: `${name} TOTAL`, bonus: Math.round(mine.reduce((a, r) => a + r.bonus, 0) * 100) / 100 });
  }
  const buffer = await buildXlsx([
    {
      name: `Bonus ${view.period.key}`,
      columns: [
        { header: "Advisor", key: "advisor", width: 24 },
        { header: "Invoice", key: "invoice", width: 12 },
        { header: "Date", key: "date", width: 12 },
        { header: "Car", key: "plate", width: 18 },
        { header: "Profit (AED)", key: "profit", width: 14, numFmt: money },
        { header: "Rate %", key: "rate", width: 8 },
        { header: "Bonus (AED)", key: "bonus", width: 13, numFmt: money },
        { header: "Note", key: "note", width: 36 },
      ],
      rows,
      totals: { advisor: "TOTAL TO PAY", bonus: view.total },
    },
  ]);
  return xlsxResponse(buffer, `OFJ advisor bonus ${view.period.key}.xlsx`);
}
