import { NextResponse, type NextRequest } from "next/server";
import { loadInspection } from "@/lib/inspection-data";
import { loadJobCard } from "@/lib/job-data";
import { renderReportPdf } from "@/lib/pdf/report-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { ROAD_TEST_SELECT, type RoadTestRow } from "@/lib/road-test";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** The customer's inspection report as a PDF, from the same link token as the report page. */
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const admin = createAdminClient();
  const { data: link } = await admin.from("report_links").select("id, job_id").eq("token", token).maybeSingle();
  if (!link) return new NextResponse("This link is not valid. Please ask the workshop for a new one.", { status: 404 });
  const [card, bundle, { data: rt }, settings] = await Promise.all([loadJobCard(admin, link.job_id), loadInspection(link.job_id), admin.from("road_tests").select(ROAD_TEST_SELECT).eq("job_id", link.job_id).maybeSingle(), getSettings()]);
  if (!card || !bundle || bundle.inspection.status !== "approved") return new NextResponse("This report is not available yet.", { status: 404 });
  const pdf = await renderReportPdf(card, bundle, (rt as RoadTestRow | null) ?? null, settings);
  return pdfResponse(pdf, `OFJ Inspection Report ${card.job.job_number}.pdf`);
}
