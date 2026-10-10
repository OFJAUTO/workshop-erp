import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { monthLabel, monthlySummary, monthKey } from "@/lib/owner-report";
import { renderMonthlyPdf } from "@/lib/pdf/monthly-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The owner's monthly summary as a PDF: /api/pdf/monthly?month=2026-10 */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) return new NextResponse("Please sign in.", { status: 401 });
  if (staff.role_id !== "owner") return new NextResponse("Not allowed.", { status: 403 });
  const m = request.nextUrl.searchParams.get("month") ?? "";
  const month = /^\d{4}-\d{2}$/.test(m) ? m : monthKey();
  const settings = await getSettings();
  const pdf = await renderMonthlyPdf(await monthlySummary(settings, month), settings);
  return pdfResponse(pdf, `OFJ Monthly summary ${monthLabel(month)}.pdf`);
}
