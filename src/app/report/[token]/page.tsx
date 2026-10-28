import type { Metadata } from "next";
import { ContactButtons, CustomerFront } from "@/components/CustomerFront";
import { InspectionReport, reportBoxes } from "@/components/InspectionReport";
import { Notice } from "@/components/ui";
import { companyFromSettings } from "@/lib/company";
import { loadInspection } from "@/lib/inspection-data";
import { loadJobCard } from "@/lib/job-data";
import { notifyStaff } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { customerPageMetadata } from "@/lib/customer-pages";
import { loadReportData } from "@/lib/report-data";
import { ROAD_TEST_SELECT, type RoadTestRow } from "@/lib/road-test";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return customerPageMetadata("OFJ Automotive, Vehicle Inspection Report", "Your vehicle's inspection report with photos and findings");
}

/**
 * The customer's inspection report (29 October 2026, section 8): the whole report on the page, grouped by part, from
 * the ONE layout the PDF and the staff preview use (`InspectionReport`): needs attention first, the workshop's note,
 * brakes, tyres, battery and every other part with its numbers, photos and videos together, checked and passed last.
 * Photos open THE viewer. No inspection fee line (it stays on the gate-in approval page), no staff names, no parts,
 * no prices.
 */
export default async function CustomerReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const settings = await getSettings();
  const company = companyFromSettings(settings);
  const plain = (children: React.ReactNode) => <div className="min-h-screen bg-canvas"><main className="mx-auto max-w-2xl px-4 py-8">{children}</main></div>;
  const { data: link } = await admin.from("report_links").select("id, job_id, inspection_id, status, opened_at, created_by").eq("token", token).maybeSingle();
  if (!link) return plain(<Notice tone="error">This link is not valid. Please ask the workshop for a new one.</Notice>);
  const [card, bundle, { data: rt }] = await Promise.all([loadJobCard(admin, link.job_id), loadInspection(link.job_id), admin.from("road_tests").select(ROAD_TEST_SELECT).eq("job_id", link.job_id).maybeSingle()]);
  if (!card || !bundle || bundle.inspection.status !== "approved") return plain(<Notice tone="error">This report is not available yet.</Notice>);
  if (!link.opened_at) {
    await admin.from("report_links").update({ opened_at: new Date().toISOString(), status: "opened" }).eq("id", link.id);
    await notifyStaff([link.created_by, card.job.gated_in_by].filter((x): x is string => !!x), { type: "report_opened", title: `Customer opened the inspection report · ${card.job.job_number}`, body: formatPlate(card.vehicle), jobId: card.job.id, href: `/jobs/${card.job.id}` });
  }
  const data = await loadReportData(card, bundle, (rt as RoadTestRow | null) ?? null, settings, { thumbs: true });
  // eslint-disable-next-line react-hooks/purity -- a server page: rendered once per request, the clock is read once
  const signedAt = Date.now();
  return (
    <CustomerFront
      company={company}
      header="plain"
      title="Inspection report"
      meta={[]}
      boxes={reportBoxes(data.head)}
      view={{ href: `/api/pdf/report/${token}`, label: "View report (PDF)", fileName: `OFJ Inspection report ${card.job.job_number}.pdf` }}
      contact={<ContactButtons phone={company.phone} />}
    >
      <InspectionReport data={data} refreshUrl={`/api/customer/videos?t=${encodeURIComponent(token)}`} signedAt={signedAt} />
    </CustomerFront>
  );
}
