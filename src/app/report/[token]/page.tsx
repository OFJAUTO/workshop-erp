import type { Metadata } from "next";
import { CustomerDocument, DocSection } from "@/components/CustomerDocument";
import { CustomerMedia, type CustomerMediaItem } from "@/components/CustomerMedia";
import { ContactButtons, CustomerFront, customerBoxes } from "@/components/CustomerFront";
import { Badge, Notice } from "@/components/ui";
import { companyFromSettings } from "@/lib/company";
import { formatDate } from "@/lib/format";
import { ITEM_STATUS_LABELS, MEASUREMENTS, ROAD_TEST_SECTION_KEY, TYRE_ACTIONS, TYRE_CONDITIONS, TYRE_POSITIONS, TYRE_REPLACE_REASONS, itemStatusLabel, type ItemStatus } from "@/lib/inspection";
import { loadInspection, type InspectionMediaRow } from "@/lib/inspection-data";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { feeNotice } from "@/lib/jobs";
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

/**
 * The customer's inspection report: the car, anything dangerous in red, what needs attention (Bad, then
 * Average), what passed folded away, the workshop's note, the inspection fee note and the advisor's Call and
 * WhatsApp buttons. No staff names besides the advisor's first name on the buttons, no parts, no prices.
 */
export default async function CustomerReportPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ view?: string }> }) {
  const { token } = await params;
  const { view } = await searchParams;
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
  // The advisor's buttons: whoever sent the link, else whoever gated the car in.
  const advisorId = link.created_by ?? card.job.gated_in_by ?? null;
  let advisor: { name: string; phone: string | null } | null = null;
  if (advisorId) {
    const [{ data: s }, { data: p }] = await Promise.all([admin.from("staff").select("display_name").eq("id", advisorId).maybeSingle(), admin.from("staff_private").select("phone").eq("staff_id", advisorId).maybeSingle()]);
    if (s) advisor = { name: s.display_name, phone: p?.phone ?? null };
  }
  const waDigits = advisor?.phone ? advisor.phone.replace(/[^\d]/g, "") : "";

  const insp = bundle.inspection;
  const roadTest = (rt as RoadTestRow | null) ?? null;
  const items = bundle.items.filter((i) => i.section_key !== ROAD_TEST_SECTION_KEY && i.status !== "na");
  const attention = items.filter((i) => i.status === "bad" || (i.status === "average" && i.style !== "job")).sort((a, b) => (a.status === "bad" ? 0 : 1) - (b.status === "bad" ? 0 : 1));
  const passed = items.filter((i) => i.status === "good");
  const sections = Array.from(new Map(items.map((i) => [i.section_key, i.section_title])).entries());
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
  const prescans = insp.show_prescan_to_customer ? bundle.media.filter((x) => x.is_prescan) : [];
  const { vehicle } = card;
  const car = [vehicle.make?.name, vehicle.model?.name, vehicle.model_year].filter(Boolean).join(" ");
  const customerName = card.customer?.full_name ?? "Customer";
  const mediaOf = (rows: InspectionMediaRow[]): CustomerMediaItem[] => rows.filter((x) => !x.is_prescan).map((x) => ({ id: x.id, kind: x.kind, url: bundle.mediaUrls[x.storage_path] ?? null, label: x.caption }));
  const fee = feeNotice(settings.inspection_fee_notice, settings.inspection_fee_aed);
  const feeAr = feeNotice(settings.inspection_fee_notice_ar, settings.inspection_fee_aed);
  const measures = MEASUREMENTS.filter((x) => !x.key.startsWith("tyre_") && m[x.key] != null && String(m[x.key]) !== "");
  const tyreRows = [...TYRE_POSITIONS, { key: "spare", label: "Spare" }].filter((p) => m[`tyre_${p.key}_tread`] || m[`tyre_${p.key}_action`]);
  const roadFlagged = roadTest?.status === "done" ? ROAD_TEST_ITEMS.filter((it) => roadTest.items[it.key]?.status && roadTest.items[it.key]?.status !== "good") : [];

  const contact =
    advisor && (advisor.phone || waDigits) ? (
      <div className="grid grid-cols-2 gap-3">
        {advisor.phone ? <a href={`tel:${advisor.phone}`} className="flex min-h-14 items-center justify-center rounded-lg bg-[#111113] px-4 text-base font-extrabold text-white">Call {advisor.name.split(" ")[0]}</a> : null}
        {waDigits ? <a href={`https://wa.me/${waDigits}`} className="flex min-h-14 items-center justify-center rounded-lg border-2 border-[#111113] bg-white px-4 text-base font-extrabold">WhatsApp</a> : null}
      </div>
    ) : null;

  const frontBoxes = customerBoxes({ full_name: customerName, company_name: card.customer?.company_name ?? null, phone: card.customer?.phone ?? null }, { kind: vehicle.kind ?? null, variant: vehicle.variant ?? null, vin: vehicle.vin ?? null, plate: formatPlate(vehicle), title: car || vehicleTitle(vehicle) });
  if (view !== "1") {
    return (
      <CustomerFront
        company={company}
        header="plain"
        title="Inspection report"
        meta={[{ label: "Job card", value: card.job.job_number }, { label: "Inspected", value: formatDate(insp.submitted_at) }, { label: "Approved", value: formatDate(insp.approved_at) }]}
        boxes={[frontBoxes[1], frontBoxes[0]].filter(Boolean)}
        view={{ href: `/report/${token}?view=1`, label: "View report" }}
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

  return (
    <CustomerDocument
      header="plain"
      backHref={`/report/${token}`}
      company={company}
      title="Inspection report"
      meta={[{ label: "Job card", value: card.job.job_number }, { label: "Inspected", value: formatDate(insp.submitted_at) }, { label: "Approved", value: formatDate(insp.approved_at) }]}
      boxes={[
        { title: "Vehicle", strong: car || vehicleTitle(vehicle), rows: [["Variant", vehicle.variant], ["Plate", formatPlate(vehicle)], ["VIN", vehicle.vin]] },
        { title: "Customer", strong: card.customer?.company_name ?? customerName, rows: [["Name", card.customer?.company_name ? customerName : null], ["Mobile", card.customer?.phone ?? null]] },
      ]}
      pdfHref={`/api/pdf/report/${token}`}
    >
      {dangers.length ? (
        <div className="rounded-lg border-2 border-red-bar bg-red-soft p-4 flex flex-col gap-2">
          <span className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-red">Dangerous to drive</span>
          <ul className="flex flex-col gap-1 text-sm font-semibold">
            {dangers.map((d) => (
              <li key={d.key}>{d.label}{d.reason ? <span className="font-normal">: {d.reason}</span> : null}</li>
            ))}
          </ul>
          <p className="text-sm whitespace-pre-wrap">{settings.dangerous_customer_text}</p>
          {settings.dangerous_customer_text_ar ? <p className="text-sm whitespace-pre-wrap" dir="rtl" lang="ar">{settings.dangerous_customer_text_ar}</p> : null}
        </div>
      ) : null}

      <DocSection title={`Needs attention · ${attentionCount}`}>
        {attentionCount === 0 ? <p className="text-sm text-muted py-1">Nothing needs attention. The items checked are listed below.</p> : null}
        <div className="flex flex-col gap-2 py-1">
          {attention.map((i) => (
            <div key={i.id} className={`rounded-lg border p-3 flex flex-col gap-1.5 ${i.status === "bad" ? "border-red-bar" : "border-amber-bar"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={i.style === "job" ? "ink" : TONE[i.status as ItemStatus]}>{itemStatusLabel(i.status, i.style)}</Badge>
                <span className="font-semibold text-sm">{i.item_label}</span>
                <span className="text-xs text-muted">· {i.section_title}</span>
                {i.dangerous ? <Badge tone="red">Dangerous</Badge> : null}
              </div>
              {i.remarks ? <p className="text-sm whitespace-pre-wrap">{i.remarks}</p> : null}
              <CustomerMedia items={mediaOf(bundle.media.filter((x) => x.item_key === i.item_key))} />
            </div>
          ))}
          {tyres.map((t) => (
            <div key={t.key} className={`rounded-lg border p-3 flex flex-col gap-1 ${t.now ? "border-red-bar" : "border-amber-bar"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={t.now ? "red" : "amber"}>{t.now ? "Replace now" : "Replace soon"}</Badge>
                <span className="font-semibold text-sm">{t.label} tyre</span>
                <span className="text-xs text-muted">· Tyres</span>
                {t.danger ? <Badge tone="red">Dangerous</Badge> : null}
              </div>
              <p className="text-sm">{[t.tread ? `${t.tread} mm tread` : "", t.year ? `year ${t.year}` : "", t.cond, t.reason ? `reason: ${t.reason.toLowerCase()}` : ""].filter(Boolean).join(" · ")}</p>
            </div>
          ))}
          {batteryReplace ? (
            <div className="rounded-lg border border-red-bar p-3 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="red">Replace</Badge>
                <span className="font-semibold text-sm">Battery</span>
                <span className="text-xs text-muted">· Battery test</span>
              </div>
              {m.battery_voltage ? <p className="text-sm">{text(m.battery_voltage)} V measured.</p> : null}
              <CustomerMedia items={mediaOf(bundle.media.filter((x) => x.item_key === "measure.battery"))} />
            </div>
          ) : null}
          {roadFlagged.length && roadTest ? (
            <div className="rounded-lg border border-amber-bar p-3 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="amber">Road test</Badge>
                <span className="font-semibold text-sm">Noted on the road test</span>
              </div>
              <ul className="text-sm flex flex-col gap-0.5">
                {roadFlagged.map((it) => {
                  const v = roadTest.items[it.key];
                  return <li key={it.key}><span className="font-semibold">{it.label}</span>{v?.status ? ` · ${ITEM_STATUS_LABELS[v.status]}` : ""}{v?.remarks ? ` · ${v.remarks}` : ""}</li>;
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </DocSection>

      <ToggleBlock title={`Checked and passed · ${passed.length}`} defaultOpen={false}>
        <div className="flex flex-col gap-3">
          {sections.map(([key, title]) => {
            const ok = passed.filter((i) => i.section_key === key);
            if (!ok.length) return null;
            return (
              <div key={key} className="flex flex-col gap-1">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{title}</span>
                <p className="text-sm">{ok.map((i) => i.item_label).join(" · ")}</p>
              </div>
            );
          })}
          {roadTest?.status === "done" && !roadFlagged.length ? <p className="text-sm"><span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Road test</span><br />Nothing noted on the road test.</p> : null}
        </div>
      </ToggleBlock>

      {tyreRows.length || measures.length ? (
        <ToggleBlock title="Measurements" defaultOpen={false}>
          <ul className="divide-y divide-line text-sm">
            {m.tyre_size_front || m.tyre_size_rear ? <li className="py-1.5 flex flex-wrap gap-x-3"><span className="font-semibold w-28">Tyre size</span><span>Front {text(m.tyre_size_front) || "—"} · Rear {text(m.tyre_size_rear) || "—"}</span></li> : null}
            {tyreRows.map((p) => (
              <li key={p.key} className="py-1.5 flex flex-wrap gap-x-3">
                <span className="font-semibold w-28">{p.label}</span>
                <span>{m[`tyre_${p.key}_tread`] ? `${text(m[`tyre_${p.key}_tread`])} mm` : ""}{m[`tyre_${p.key}_year`] ? ` · ${text(m[`tyre_${p.key}_year`])}` : ""}</span>
                <span className="text-muted">{text(m[`tyre_${p.key}_cond`]).split(",").filter(Boolean).map((c) => TYRE_CONDITIONS.find((x) => x.value === c)?.label ?? c).join(", ")}</span>
                <span className="font-semibold">{TYRE_ACTIONS.find((a) => a.value === text(m[`tyre_${p.key}_action`]))?.label ?? ""}</span>
              </li>
            ))}
            {measures.map((x) => (
              <li key={x.key} className="py-1.5 flex gap-3">
                <span className="font-semibold w-44">{x.label}</span>
                <span>{x.kind === "choice" ? (x.choices?.find((c) => c.value === text(m[x.key]))?.label ?? text(m[x.key])) : text(m[x.key])}{x.unit ? ` ${x.unit}` : ""}</span>
              </li>
            ))}
          </ul>
        </ToggleBlock>
      ) : null}

      {insp.manager_note ? (
        <DocSection title="Workshop note">
          <p className="text-sm whitespace-pre-wrap py-1">{insp.manager_note}</p>
        </DocSection>
      ) : null}

      {fee ? (
        <div className="rounded-lg bg-[#F4F4F5] px-4 py-3 flex flex-col gap-1">
          <span className="text-sm font-bold">{fee}</span>
          {feeAr ? <span className="text-sm font-bold" dir="rtl" lang="ar">{feeAr}</span> : null}
        </div>
      ) : null}

      {contact}

      {prescans.length ? (
        <ToggleBlock title="Fault code scan report" defaultOpen={false}>
          <CustomerMedia items={prescans.map((p) => ({ id: p.id, kind: "pdf" as const, url: bundle.mediaUrls[p.storage_path] ?? null, label: p.caption ?? "scan report" }))} />
        </ToggleBlock>
      ) : null}
    </CustomerDocument>
  );
}
