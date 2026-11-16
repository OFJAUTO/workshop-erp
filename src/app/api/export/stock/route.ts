import { type NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { listStockSnapshots, stockAsOfDay, stockMovementsBetween, stockReportSheets } from "@/lib/stock-report";
import { buildXlsx, xlsxResponse } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

const isDay = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The stock report as Excel (owner and accounts): the stock as of a day and the movements, or a saved month-end snapshot. */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "accounts"].includes(staff.role_id)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const p = request.nextUrl.searchParams;
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const snap = p.get("snapshot");
  if (isDay(snap)) {
    const s = (await listStockSnapshots()).find((x) => x.asOf === snap);
    if (!s) return NextResponse.json({ error: "No snapshot for that day." }, { status: 404 });
    const sheets = stockReportSheets(s.asOf, { rows: s.rows, totalQuantity: Math.round(s.rows.reduce((a, r) => a + r.quantity, 0) * 100) / 100, totalValue: s.totalValue }, []);
    return xlsxResponse(await buildXlsx([sheets[0]]), `OFJ stock snapshot ${s.asOf}.xlsx`);
  }
  const day = isDay(p.get("asof")) ? (p.get("asof") as string) : today;
  const from = isDay(p.get("from")) ? (p.get("from") as string) : `${day.slice(0, 7)}-01`;
  const to = isDay(p.get("to")) ? (p.get("to") as string) : day;
  const [stock, moves] = await Promise.all([stockAsOfDay(day), stockMovementsBetween(from, to)]);
  return xlsxResponse(await buildXlsx(stockReportSheets(day, stock, moves)), `OFJ stock ${day}.xlsx`);
}
