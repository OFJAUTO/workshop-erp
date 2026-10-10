import type { Metadata } from "next";
import { CustomerDocument, DocSection } from "@/components/CustomerDocument";
import { Badge, Notice } from "@/components/ui";
import { companyFromSettings } from "@/lib/company";
import { formatDate, formatDateTime } from "@/lib/format";
import { ITEM_STATUS_LABELS, MEASUREMENTS, ROAD_TEST_SECTION_KEY, TYRE_ACTIONS, TYRE_CONDITIONS, TYRE_POSITIONS, type ItemStatus } from "@/lib/inspection";
import { loadInspection, type InspectionMediaRow } from "@/lib/inspection-data";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { notifyStaff } from "@/lib/notifications";
import { ROAD_TEST_ITEMS, ROAD_TEST_SELECT, type RoadTestRow } from "@/lib/road-test";
import { getSettings } from "@/lib/settings";
import { customerPageMetadata } from "@/lib/customer-pages";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { ToggleBlock } from "./ReportControls";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return customerPageMetadata("OFJ Automotive, Vehicle Inspection Report", "Your vehicle's inspection report with photos and findings");
}

const TONE: Record<ItemStatus, "green" | "amber" | "red" | "neutral"> = { good: "green", average: "amber", bad: "red", na: "neutral" };

function Photos({ rows, urls }: { rows: InspectionMediaRow[]; urls: Record<string, string> }) {
  const shown = rows.filter((m) => m.kind !== "pdf");
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap gap-2 py-1">
      {shown.map((m) =>
        m.kind === "video" ? (
          <video key={m.id} src={urls[m.storage_path]} controls playsInline preload="metadata" className="h-32 w-48 rounded-control bg-black object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <a key={m.id} href={urls[m.storage_path] ?? "#"} target="_blank" rel="noreferrer"><img src={urls[m.storage_path] ?? ""} alt="Photo" className="h-32 w-32 rounded-control object-cover bg-chip" /></a>
        ),
      )}
    </div>
  );
}

/** The customer's inspection report in the same document look as the quotation and the invoice. Parts and anything about cost are never shown. */
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
  const insp = bundle.inspection;
  const roadTest = (rt as RoadTestRow | null) ?? null;
  const items = bundle.items.filter((i) => i.section_key !== ROAD_TEST_SECTION_KEY && i.status !== "na");
  const flagged = items.filter((i) => i.status === "bad" || i.status === "average").sort((a, b) => (a.status === "bad" ? 0 : 1) - (b.status === "bad" ? 0 : 1));
  const sections = Array.from(new Map(items.map((i) => [i.section_key, i.section_title])).entries());
  const m = insp.measurements ?? {};
  const customerName = card.customer?.full_name ?? "Customer";
  const prescans = insp.show_prescan_to_customer ? bundle.media.filter((x) => x.is_prescan) : [];
  const { vehicle } = card;
  const car = [vehicle.make?.name, vehicle.model?.name, vehicle.model_year].filter(Boolean).join(" ");

  return (
    <CustomerDocument
      uppercase={settings.customer_documents_uppercase === true}
      company={company}
      title="Inspection report"
      meta={[{ label: "Job card", value: card.job.job_number }, { label: "Inspected", value: formatDate(insp.submitted_at) }, { label: "Approved", value: formatDate(insp.approved_at) }]}
      boxes={[
        { title: "Customer", strong: card.customer?.company_name ?? customerName, rows: [["Name", card.customer?.company_name ? customerName : null], ["Mobile", card.customer?.phone ?? null]] },
        { title: "Vehicle", strong: car || vehicleTitle(vehicle), rows: [["Variant", vehicle.variant], ["Plate", formatPlate(vehicle)], ["VIN", vehicle.vin]] },
      ]}
      pdfHref={`/api/pdf/report/${token}`}
      footer={<>{company.legalName} · TRN {company.trn}. This report describes the condition found at inspection. A quotation follows separately.</>}
    >
      <p className="text-sm leading-relaxed">Dear {customerName}, here is the inspection report for your {vehicleTitle(vehicle)} ({formatPlate(vehicle)}), inspected on {formatDateTime(insp.submitted_at)} and approved by our workshop manager on {formatDateTime(insp.approved_at)}.</p>

      <DocSection title="Your requests">
        <div className="flex flex-col gap-2 py-1">
          {card.requests.map((r, i) => {
            const f = bundle.findings.find((x) => x.job_request_id === r.id);
            return (
              <div key={r.id} className="rounded-control border border-line p-3 flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-sm">{i + 1}. {r.text}</span>
                  {f?.status ? <Badge tone={TONE[f.status]}>{ITEM_STATUS_LABELS[f.status]}</Badge> : null}
                </div>
                {f?.found ? <p className="text-sm"><span className="text-muted">Found:</span> {f.found}</p> : null}
                <Photos rows={bundle.media.filter((x) => x.job_request_id === r.id)} urls={bundle.mediaUrls} />
              </div>
            );
          })}
        </div>
      </DocSection>

      <DocSection title={`Items needing attention · ${flagged.length}`}>
        {flagged.length === 0 ? <p className="text-sm text-muted py-1">Nothing was marked average or bad.</p> : null}
        <div className="flex flex-col gap-2 py-1">
          {flagged.map((i) => (
            <div key={i.id} className={`rounded-control border p-3 flex flex-col gap-1.5 ${i.status === "bad" ? "border-red-bar" : "border-amber-bar"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[i.status as ItemStatus]}>{ITEM_STATUS_LABELS[i.status as ItemStatus]}</Badge>
                <span className="font-semibold text-sm">{i.item_label}</span>
                <span className="text-xs text-muted">· {i.section_title}</span>
              </div>
              {i.remarks ? <p className="text-sm whitespace-pre-wrap">{i.remarks}</p> : null}
              <Photos rows={bundle.media.filter((x) => x.item_key === i.item_key)} urls={bundle.mediaUrls} />
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection title="Full checklist">
        <div className="flex flex-col gap-3 py-1">
          {sections.map(([key, title]) => (
            <div key={key} className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{title}</span>
              <ul className="divide-y divide-line">
                {items.filter((i) => i.section_key === key).map((i) => (
                  <li key={i.id} className="py-1.5 flex items-center gap-2 text-sm">
                    {i.status ? <Badge tone={TONE[i.status]}>{ITEM_STATUS_LABELS[i.status]}</Badge> : null}
                    <span>{i.item_label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection title="Tyres and brakes">
        <ul className="divide-y divide-line text-sm">
          {m.tyre_size_front || m.tyre_size_rear ? <li className="py-1.5 flex flex-wrap gap-x-3"><span className="font-semibold w-28">Tyre size</span><span>Front {String(m.tyre_size_front ?? "") || "—"} · Rear {String(m.tyre_size_rear ?? "") || "—"}</span></li> : null}
          {[...TYRE_POSITIONS, { key: "spare", label: "Spare" }].filter((p) => m[`tyre_${p.key}_tread`] || m[`tyre_${p.key}_action`]).map((p) => (
            <li key={p.key} className="py-1.5 flex flex-wrap gap-x-3">
              <span className="font-semibold w-28">{p.label}</span>
              <span>{m[`tyre_${p.key}_tread`] ? `${m[`tyre_${p.key}_tread`]} mm` : ""}{m[`tyre_${p.key}_year`] ? ` · ${m[`tyre_${p.key}_year`]}` : ""}</span>
              <span className="text-muted">{String(m[`tyre_${p.key}_cond`] ?? "").split(",").filter(Boolean).map((c) => TYRE_CONDITIONS.find((x) => x.value === c)?.label ?? c).join(", ")}</span>
              <span className="font-semibold">{TYRE_ACTIONS.find((a) => a.value === m[`tyre_${p.key}_action`])?.label ?? ""}</span>
            </li>
          ))}
          {MEASUREMENTS.filter((x) => !x.key.startsWith("tyre_") && m[x.key] != null && String(m[x.key]) !== "").map((x) => (
            <li key={x.key} className="py-1.5 flex gap-3">
              <span className="font-semibold w-44">{x.label}</span>
              <span>{x.kind === "choice" ? (x.choices?.find((c) => c.value === String(m[x.key]))?.label ?? m[x.key]) : m[x.key]}{x.unit ? ` ${x.unit}` : ""}</span>
            </li>
          ))}
        </ul>
      </DocSection>

      {roadTest && roadTest.status !== "not_started" && roadTest.decision !== "not_needed" ? (
        <DocSection title="Road test">
          {roadTest.status === "not_possible" ? (
            <p className="text-sm py-1">Road test not possible: {roadTest.not_possible_reason}</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {ROAD_TEST_ITEMS.map((it) => {
                const v = roadTest.items[it.key];
                return (
                  <li key={it.key} className="py-1.5 flex flex-wrap items-center gap-2">
                    {v?.status ? <Badge tone={TONE[v.status]}>{ITEM_STATUS_LABELS[v.status]}</Badge> : null}
                    <span className="font-semibold">{it.label}</span>
                    {v?.remarks ? <span className="text-muted">· {v.remarks}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </DocSection>
      ) : null}

      {insp.manager_note ? (
        <ToggleBlock title="Workshop manager's note">
          <p className="text-sm whitespace-pre-wrap">{insp.manager_note}</p>
        </ToggleBlock>
      ) : null}
      {insp.technician_notes ? (
        <ToggleBlock title="Workshop notes">
          <p className="text-sm whitespace-pre-wrap">{insp.technician_notes}</p>
        </ToggleBlock>
      ) : null}
      {prescans.length ? (
        <ToggleBlock title="Fault code scan report" defaultOpen={false}>
          <div className="flex flex-wrap gap-2">
            {prescans.map((p) => (
              <a key={p.id} href={bundle.mediaUrls[p.storage_path] ?? "#"} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control border border-line bg-chip px-3 text-sm font-semibold">PDF · {p.caption ?? "scan report"}</a>
            ))}
          </div>
        </ToggleBlock>
      ) : null}
    </CustomerDocument>
  );
}
