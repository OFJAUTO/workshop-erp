import type { Metadata } from "next";
import { ContactButtons, CustomerFront, customerBoxes } from "@/components/CustomerFront";
import { Notice } from "@/components/ui";
import { companyFromSettings } from "@/lib/company";
import { formatDate } from "@/lib/format";
import { ROAD_TEST_SECTION_KEY, TYRE_CONDITIONS, TYRE_POSITIONS, TYRE_REPLACE_REASONS } from "@/lib/inspection";
import { loadInspection } from "@/lib/inspection-data";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { notifyStaff } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { customerPageMetadata } from "@/lib/customer-pages";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return customerPageMetadata("OFJ Automotive, Vehicle Inspection Report", "Your vehicle's inspection report with photos and findings");
}

/**
 * The customer's inspection report: the car, anything dangerous in red, what needs attention (Bad, then
 * Average), what passed folded away, the workshop's note, the inspection fee note and the advisor's Call and
 * WhatsApp buttons. No staff names besides the advisor's first name on the buttons, no parts, no prices.
 */
export default async function CustomerReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const settings = await getSettings();
  const company = companyFromSettings(settings);
  const plain = (children: React.ReactNode) => <div className="min-h-screen bg-canvas"><main className="mx-auto max-w-2xl px-4 py-8">{children}</main></div>;
  const { data: link } = await admin.from("report_links").select("id, job_id, inspection_id, status, opened_at, created_by").eq("token", token).maybeSingle();
  if (!link) return plain(<Notice tone="error">This link is not valid. Please ask the workshop for a new one.</Notice>);
  const [card, bundle] = await Promise.all([loadJobCard(admin, link.job_id), loadInspection(link.job_id)]);
  if (!card || !bundle || bundle.inspection.status !== "approved") return plain(<Notice tone="error">This report is not available yet.</Notice>);
  if (!link.opened_at) {
    await admin.from("report_links").update({ opened_at: new Date().toISOString(), status: "opened" }).eq("id", link.id);
    await notifyStaff([link.created_by, card.job.gated_in_by].filter((x): x is string => !!x), { type: "report_opened", title: `Customer opened the inspection report · ${card.job.job_number}`, body: formatPlate(card.vehicle), jobId: card.job.id, href: `/jobs/${card.job.id}` });
  }
  // The advisor's buttons: whoever sent the link, else whoever gated the car in.
  const advisorId = link.created_by ?? card.job.gated_in_by ?? null;
  let advisor: { name: string; phone: string | null } | null = null;
  if (advisorId) {
    const [{ data: s }, { data: p }] = await Promise.all([admin.from("staff").select("display_name").eq("id", advisorId).maybeSingle(), admin.from("staff_private").select("phone").eq("staff_id", advisorId).maybeSingle()]);
    if (s) advisor = { name: s.display_name, phone: p?.phone ?? null };
  }

  const insp = bundle.inspection;
  const items = bundle.items.filter((i) => i.section_key !== ROAD_TEST_SECTION_KEY && i.status !== "na");
  const attention = items.filter((i) => i.status === "bad" || (i.status === "average" && i.style !== "job")).sort((a, b) => (a.status === "bad" ? 0 : 1) - (b.status === "bad" ? 0 : 1));
  const m = (insp.measurements ?? {}) as Record<string, string | number>;
  const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const tyres = TYRE_POSITIONS.filter((p) => ["replace_now", "replace_soon"].includes(text(m[`tyre_${p.key}_action`]))).map((p) => ({
    ...p,
    now: text(m[`tyre_${p.key}_action`]) === "replace_now",
    tread: text(m[`tyre_${p.key}_tread`]),
    year: text(m[`tyre_${p.key}_year`]),
    reason: TYRE_REPLACE_REASONS.find((r) => r.value === text(m[`tyre_${p.key}_reason`]))?.label ?? null,
    danger: text(m[`tyre_${p.key}_danger`]) === "1",
    dangerReason: text(m[`tyre_${p.key}_danger_reason`]),
    cond: text(m[`tyre_${p.key}_cond`]).split(",").filter(Boolean).map((c) => TYRE_CONDITIONS.find((x) => x.value === c)?.label ?? c).join(", "),
  }));
  const batteryReplace = text(m.battery_health) === "replace";
  const dangers = [
    ...attention.filter((i) => i.dangerous).map((i) => ({ key: i.id, label: i.item_label, reason: i.dangerous_reason })),
    ...tyres.filter((t) => t.danger).map((t) => ({ key: `tyre-${t.key}`, label: `${t.label} tyre`, reason: t.dangerReason || null })),
  ];
  const attentionCount = attention.length + tyres.length + (batteryReplace ? 1 : 0);
  const { vehicle } = card;
  const car = [vehicle.make?.name, vehicle.model?.name, vehicle.model_year].filter(Boolean).join(" ");
  const customerName = card.customer?.full_name ?? "Customer";


  const frontBoxes = customerBoxes({ full_name: customerName, company_name: card.customer?.company_name ?? null, phone: card.customer?.phone ?? null }, { kind: vehicle.kind ?? null, variant: vehicle.variant ?? null, vin: vehicle.vin ?? null, plate: formatPlate(vehicle), title: car || vehicleTitle(vehicle) });
  {
    return (
      <CustomerFront
        company={company}
        header="plain"
        title="Inspection report"
        meta={[{ label: "Job card", value: card.job.job_number }, { label: "Inspected", value: formatDate(insp.submitted_at) }, { label: "Approved", value: formatDate(insp.approved_at) }]}
        boxes={[frontBoxes[1], frontBoxes[0]].filter(Boolean)}
        view={{ href: `/api/pdf/report/${token}`, label: "View report (PDF)", fileName: `OFJ Inspection report ${card.job.job_number}.pdf` }}
        contact={<ContactButtons name={advisor?.name ?? null} phone={advisor?.phone ?? null} />}
      >
        {insp.manager_note ? (
          <div className="rounded-lg bg-[#F4F4F5] px-4 py-3 flex flex-col gap-1">
            <span className="text-[9.5px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">Workshop note</span>
            <p className="text-sm whitespace-pre-wrap">{insp.manager_note}</p>
          </div>
        ) : null}
        <p className={`text-base font-bold ${dangers.length ? "text-red" : ""}`}>
          {dangers.length ? `${dangers.length} item${dangers.length === 1 ? "" : "s"} dangerous to drive · ` : ""}
          {attentionCount === 0 ? "Nothing needs attention." : `${attentionCount} item${attentionCount === 1 ? "" : "s"} need${attentionCount === 1 ? "s" : ""} attention`}
        </p>
      </CustomerFront>
    );
  }
}
