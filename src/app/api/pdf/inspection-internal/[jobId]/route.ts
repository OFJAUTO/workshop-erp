import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { loadInspection } from "@/lib/inspection-data";
import { loadJobCard } from "@/lib/job-data";
import { renderInspectionInternalPdf, type InternalPdfMode } from "@/lib/pdf/inspection-internal-pdf";
import { pdfResponse } from "@/lib/pdf/response";
import { ROAD_TEST_SELECT, type RoadTestRow } from "@/lib/road-test";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Fix 5 (4 November 2026): the inspection on paper, for the workshop's own use - owner, advisors, the
 * workshop and bodyshop managers, the parts desk and the gate-in person (read-only). Never for a customer:
 * no name, no phone, no prices. ?mode=full|findings|blank and ?photos=1 pick the layout.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) return new NextResponse("Please sign in.", { status: 401 });
  if (!["owner", "service_advisor", "workshop_manager", "parts", "gate_in"].includes(staff.role_id)) return new NextResponse("Not allowed.", { status: 403 });
  const { jobId } = await context.params;
  const url = new URL(request.url);
  const mode = (["full", "findings", "blank"].includes(url.searchParams.get("mode") ?? "") ? url.searchParams.get("mode") : "full") as InternalPdfMode;
  const photos = url.searchParams.get("photos") === "1";
  const admin = createAdminClient();
  const [card, bundle, { data: rt }, settings] = await Promise.all([
    loadJobCard(admin, jobId),
    loadInspection(jobId),
    admin.from("road_tests").select(ROAD_TEST_SELECT).eq("job_id", jobId).maybeSingle(),
    getSettings(),
  ]);
  if (!card) return new NextResponse("Not found.", { status: 404 });
  if (mode !== "blank" && !bundle) return new NextResponse("No inspection on this job yet: print the blank checklist instead.", { status: 404 });
  const printedAt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const pdf = await renderInspectionInternalPdf(card, mode === "blank" ? bundle : bundle!, (rt as RoadTestRow | null) ?? null, settings, { mode, photos, printedBy: staff.display_name, printedAt });
  const name = mode === "blank" ? `OFJ Inspection checklist ${card.job.job_number}.pdf` : `OFJ Inspection internal ${card.job.job_number}.pdf`;
  return pdfResponse(pdf, name);
}
