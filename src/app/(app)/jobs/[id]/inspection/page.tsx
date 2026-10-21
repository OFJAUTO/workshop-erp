import { VinCopy } from "@/components/VinCopy";
import Link from "next/link";
import { CarHeaderThumb } from "@/components/CarHeaderThumb";
import { LiveRefresh } from "@/components/LiveRefresh";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, DescriptionList, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { INSPECTION_STATUS_LABELS, MEASUREMENTS, TYRE_REPLACE_REASONS, itemStatusLabel, ROAD_TEST_SECTION_KEY, TYRE_ACTIONS, TYRE_CONDITIONS, TYRE_POSITIONS, formatMinutes, sideOfDepartment, type ChecklistSection, type ItemStatus, DISC_ACTIONS, DISC_CONDITIONS, LEAK_REPAIRS, LEAK_SEVERITIES, cleanPartsRows, inspectionLimitsOf, toItemState } from "@/lib/inspection";
import { inspectionLocked, inspectionWorkingMinutes, loadInspection, tyreSizeSuggestionFor, type InspectionMediaRow, inspectionDangerous, type InspectionItemRow } from "@/lib/inspection-data";
import { wheelConditionLines } from "@/lib/wheels";
import { loadCatalogue } from "@/lib/parts-catalogue";
import { cleanPartsList, mergePartsList } from "@/lib/parts-list";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { workingTimeOf } from "@/lib/jobs";
import { PrescanToggle } from "@/components/PrescanToggle";
import { ROAD_TEST_DECISION_LABELS, ROAD_TEST_SELECT, roadTestLine, roadTestSummary, type RoadTestRow } from "@/lib/road-test";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { reasonsFor } from "@/lib/reasons";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { approveInspection, approveScanNotPossible, confirmPartsList, decideInspectionChange, requestInspectionChange, returnInspection } from "../../inspection-actions";
import { InspectionForm, type Suggestions } from "@/app/(app)/my-jobs/[id]/InspectionForm";
import { ApproveFormLive, RequestChangeForm, ReturnForm, ReviewBar } from "./forms";
import { PartsListTick } from "@/components/PartsListTick";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const TONE: Record<ItemStatus, "green" | "amber" | "red" | "neutral"> = { good: "green", average: "amber", bad: "red", na: "neutral" };

function Files({ rows, urls }: { rows: InspectionMediaRow[]; urls: Record<string, string> }) {
  if (!rows.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((m) =>
        m.kind === "pdf" ? (
          <a key={m.id} href={urls[m.storage_path] ?? "#"} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-control border border-line bg-chip px-3 text-sm font-semibold">
            PDF · {m.caption ?? "scan report"}
          </a>
        ) : m.kind === "video" ? (
          <video key={m.id} src={urls[m.storage_path]} controls playsInline preload="metadata" className="h-28 w-44 rounded-control bg-black object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <a key={m.id} href={urls[m.storage_path] ?? "#"} target="_blank" rel="noreferrer"><img src={urls[m.storage_path] ?? ""} alt={m.caption ?? "Photo"} className="h-28 w-28 rounded-control object-cover bg-chip" /></a>
        ),
      )}
    </div>
  );
}


/** The tap-first details behind a checklist item: danger, leak, fluid, brake disc, the parts rows. */
/** One line per checklist item: status, name, section and the start of the remark; everything else opens on a tap. */
function ItemLine({ item: i, media, urls }: { item: InspectionItemRow; media: InspectionMediaRow[]; urls: Record<string, string> }) {
  const short = (i.remarks ?? "").replace(/\s+/g, " ").trim();
  return (
    <li>
      <details>
        <summary className="list-none cursor-pointer min-h-11 flex flex-wrap items-center gap-2 py-1.5 text-sm">
          {i.status ? <Badge tone={i.style === "job" && i.status === "bad" ? "ink" : TONE[i.status]}>{itemStatusLabel(i.status, i.style)}</Badge> : <Badge tone="neutral">Not marked</Badge>}
          <span className="font-semibold">{i.item_label}</span>
          <span className="text-xs text-muted">{i.section_title}</span>
          {i.dangerous ? <Badge tone="red">Dangerous</Badge> : null}
          {short ? <span className="text-muted truncate max-w-[22rem]">{short.length > 60 ? short.slice(0, 58) + "…" : short}</span> : null}
          {media.length ? <span className="text-xs text-muted">{media.length} file{media.length === 1 ? "" : "s"}</span> : null}
          {i.edited_by_name ? <span className="text-xs text-muted">edited by {i.edited_by_name}</span> : null}
        </summary>
        <div className="pb-3 pl-1 flex flex-col gap-1.5">
          {i.remarks ? <p className="text-sm whitespace-pre-wrap">{i.remarks}</p> : <p className="text-xs text-muted">No remark.</p>}
          <ItemExtras item={i} />
          <Original original={i.original as Record<string, unknown> | null} />
          <Files rows={media} urls={urls} />
        </div>
      </details>
    </li>
  );
}

function ItemExtras({ item }: { item: InspectionItemRow }) {
  const bits: string[] = [];
  if (item.leak_severity || item.leak_repair) bits.push(`Leak: ${[LEAK_SEVERITIES.find((x) => x.value === item.leak_severity)?.label, LEAK_REPAIRS.find((x) => x.value === item.leak_repair)?.label].filter(Boolean).join(", ")}`);
  if (item.fluid_qty !== null && item.fluid_qty !== undefined) bits.push(`Fluid: ${item.fluid_qty} ${item.fluid_unit === "g" ? "g" : "L"}${item.fluid_grade ? `, ${item.fluid_grade}` : ""}${item.fluid_spec ? `, spec ${item.fluid_spec}` : ""}`);
  else if (item.fluid_grade || item.fluid_spec) bits.push(`Fluid: ${[item.fluid_grade, item.fluid_spec ? `spec ${item.fluid_spec}` : ""].filter(Boolean).join(", ")}`);
  if (item.disc_condition || item.disc_action) bits.push(`Disc: ${[DISC_CONDITIONS.find((x) => x.value === item.disc_condition)?.label, DISC_ACTIONS.find((x) => x.value === item.disc_action)?.label].filter(Boolean).join(", ")}${item.disc_thickness !== null && item.disc_thickness !== undefined ? ` · ${item.disc_thickness} mm` : ""}${item.disc_minimum !== null && item.disc_minimum !== undefined ? ` (min ${item.disc_minimum} mm)` : ""}`);
  const rows = cleanPartsRows(item.parts_rows);
  return (
    <>
      {item.dangerous ? <p className="text-sm font-bold text-red">DANGEROUS TO DRIVE{item.dangerous_reason ? `: ${item.dangerous_reason}` : ""}</p> : null}
      {bits.length ? <p className="text-xs text-muted">{bits.join(" · ")}</p> : null}
      {rows.length ? <p className="text-xs text-muted">Parts: {rows.map((r) => `${r.part} × ${r.qty} ${r.unit}`).join("; ")}</p> : item.parts_needed ? <p className="text-xs text-muted">Parts: {item.parts_needed}</p> : null}
    </>
  );
}

function Original({ original }: { original: Record<string, unknown> | null | undefined }) {
  if (!original) return null;
  const parts = Object.entries(original).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!parts.length) return null;
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer font-semibold">Technician&apos;s original</summary>
      <ul className="mt-1 pl-4 list-disc">
        {parts.map(([k, v]) => (
          <li key={k}>
            {k.replace("_", " ")}: {typeof v === "string" ? v : JSON.stringify(v)}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The inspection report: findings, every checklist item with its status, numbers, the road test, files, notes, and the manager's decision. */
export default async function InspectionReportPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const supabase = await createClient();
  const [card, bundle, settings, { data: rt }] = await Promise.all([
    loadJobCard(supabase, id),
    loadInspection(id),
    getSettings(),
    supabase.from("road_tests").select(ROAD_TEST_SELECT).eq("job_id", id).maybeSingle(),
  ]);
  if (!card) notFound();
  const { job, vehicle, requests } = card;
  const roadTest = (rt as RoadTestRow | null) ?? null;
  const road = roadTestSummary(roadTest);

  // Who may open this report.
  const isTech = role === "technician" && job.assigned_to === staff.id;
  const isManager = role === "workshop_manager" && (!job.department || job.department === "both" || sideOfDepartment(staff.department_id) === null || sideOfDepartment(staff.department_id) === job.department);
  const approvedForAdvisor = role === "service_advisor" && bundle?.inspection.status === "approved";
  // The QC inspector reads approved reports only.
  const approvedForQc = role === "qc_inspector" && bundle?.inspection.status === "approved";
  const allowed = role === "owner" || isTech || isManager || approvedForAdvisor || approvedForQc || role === "accounts" || role === "parts";
  if (!allowed) redirect(role === "technician" ? "/my-jobs" : role === "service_advisor" ? `/jobs/${id}?error=${encodeURIComponent("The report opens for you once the workshop manager has approved it.")}` : role === "qc_inspector" ? "/road-tests" : "/home");

  if (!bundle) {
    return (
      <>
        <PageHeader picture={<CarHeaderThumb vehicleId={job.vehicle_id} />} title={`Inspection · ${formatPlate(vehicle)}`} subtitle={<span className="flex flex-wrap items-center gap-2"><span>{vehicleTitle(vehicle)} · {job.job_number}</span><VinCopy vin={vehicle.vin} /></span>} actions={<LinkButton href={`/jobs/${id}`} tone="secondary">Job card</LinkButton>} />
        <Notice tone="info">No inspection yet. It starts once a technician is assigned.</Notice>
      </>
    );
  }
  const insp = bundle.inspection;
  const canApprove = can(role, "approveInspections") && (role !== "workshop_manager" || isManager);
  const canDecide = can(role, "decideInspectionChanges");
  const canRequest = role === "technician" || can(role, "approveInspections");
  const locked = inspectionLocked(insp);
  const wt = workingTimeOf(settings);
  const workingMin = inspectionWorkingMinutes(insp, wt);
  const target = insp.target_minutes ?? (Number(settings.inspection_target_minutes) || 90);
  const items = bundle.items.filter((i) => i.section_key !== ROAD_TEST_SECTION_KEY);
  const flagged = items.filter((i) => i.status === "average" || i.status === "bad");
  const prescans = bundle.media.filter((m) => m.is_prescan);
  const pendingChange = bundle.changeRequests.find((c) => c.status === "pending");
  const m = insp.measurements ?? {};
  const reviewing = canApprove && insp.status === "submitted";
  const unlockHours = Number(settings.inspection_unlock_hours) || 1;
  const dangers = inspectionDangerous(bundle);
  const scanGate = !!settings.prescan_gate_enabled;
  const noteUsage = (settings.manager_note_usage ?? {}) as Record<string, number>;
  const noteGroupsRaw = (settings.manager_note_groups ?? {}) as Record<string, string[]>;
  const noteGroups = Object.keys(noteGroupsRaw).length ? noteGroupsRaw : { Notes: (settings.manager_note_presets ?? []) as string[] };
  const tickName = insp.parts_list_confirmed_by ? ((await createAdminClient().from("staff").select("display_name").eq("id", insp.parts_list_confirmed_by).maybeSingle()).data?.display_name ?? null) : null;
  const [tyreSizeSuggestion, catalogue] = await Promise.all([tyreSizeSuggestionFor(vehicle.id), loadCatalogue()]);
  const partsList = cleanPartsList(insp.parts_list);
  const partLines = mergePartsList(partsList);

  const formProps = {
    checklist: insp.checklist as ChecklistSection[],
    items: bundle.items.map(toItemState),
    requests: requests.map((r) => ({ id: r.id, text: r.text })),
    requestsNote: insp.requests_note ?? "",
    complaintKeywords: (settings.complaint_keywords ?? {}) as Record<string, string[]>,
    wheelConditions: wheelConditionLines(card.media),
    tyreSizeSuggestion,
    catalogue,
    partsList,
    noPartItems: Array.isArray(insp.no_part_items) ? (insp.no_part_items as string[]) : [],
    measurements: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)])),
    files: bundle.media.filter((x) => !x.item_key?.startsWith("road.")).map((x) => ({ id: x.id, kind: x.kind, url: bundle.mediaUrls[x.storage_path] ?? null, caption: x.caption, isPrescan: x.is_prescan, itemKey: x.item_key, requestId: x.job_request_id })),
    notes: insp.technician_notes ?? "",
    prescanVisible: insp.show_prescan_to_customer,
  };

  return (
    <>
      {/* Section 10: the manager's view hears a new scan report (and the report itself) without a reload. */}
      <LiveRefresh tables={["jobs", "inspections", "inbound_scans"]} jobId={id} pollMs={20000} />
      <PageHeader
        picture={<CarHeaderThumb vehicleId={job.vehicle_id} />}
        title={`Inspection · ${formatPlate(vehicle)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{vehicleTitle(vehicle)}</span>
            <span>· {job.job_number}</span>
            <VinCopy vin={vehicle.vin} />
            <Badge tone={insp.status === "approved" ? "green" : insp.status === "returned" ? "red" : insp.status === "submitted" ? "amber" : "outline"}>{INSPECTION_STATUS_LABELS[insp.status]}</Badge>
            {roadTest ? <Badge tone={roadTest.status === "done" ? "green" : roadTest.status === "not_started" && roadTest.decision === "needed" ? "amber" : "neutral"}>{roadTestLine(roadTest)}</Badge> : null}
            {locked ? <Badge tone="ink">Locked</Badge> : null}
            {dangers.length ? <Badge tone="red">DANGEROUS TO DRIVE</Badge> : null}
          </span>
        }
        actions={
          <>
            {can(role, "viewJobs") ? (
              <LinkButton href={`/jobs/${id}`} tone="secondary" size="lg">
                Job card
              </LinkButton>
            ) : null}
            {role === "technician" || canApprove ? (
              <LinkButton href={`/my-jobs/${id}`} tone="secondary" size="lg">
                Technician screen
              </LinkButton>
            ) : null}
            {can(role, "roadTest") || canApprove ? (
              <LinkButton href={`/road-tests/${id}`} tone="secondary" size="lg">
                Road test
              </LinkButton>
            ) : null}
          </>
        }
      />

      {dangers.length ? <Notice tone="error">Dangerous to drive: {dangers.join("; ")}. The quotation line is Urgent and the customer sees a safety warning.</Notice> : null}
      {reviewing ? <Notice tone="info">You are reviewing. You can change any item, remark, parts list, number or photo before approving; each change is stamped with your name and the technician&apos;s original is kept.</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-6">
          <Card className="flex flex-col gap-3">
            <SectionLabel>Summary</SectionLabel>
            <DescriptionList
              items={[
                { label: "Technician", value: bundle.technician?.display_name ?? null },
                { label: "Started", value: insp.started_at ? formatDateTime(insp.started_at) : null },
                { label: "Submitted", value: insp.submitted_at ? formatDateTime(insp.submitted_at) : null },
                { label: "Inspection time (working)", value: insp.started_at ? `${formatMinutes(workingMin)} of ${formatMinutes(target)} target${(insp.overrun_minutes ?? 0) > 0 ? ` · ${formatMinutes(insp.overrun_minutes!)} over` : workingMin > target ? " · over target" : ""}` : null },
                { label: "Items flagged", value: `${flagged.length} of ${items.length} (${items.filter((i) => i.status === "bad").length} bad, ${items.filter((i) => i.status === "average").length} average)` },
                { label: "Road test", value: roadTest ? `${roadTestLine(roadTest)}${roadTest.done_at && roadTest.status === "done" ? ` · ${formatDateTime(roadTest.done_at)}` : ""}${roadTest.decision ? ` · manager: ${ROAD_TEST_DECISION_LABELS[roadTest.decision]}${roadTest.decision_note ? `, ${roadTest.decision_note}` : ""}` : ""}` : "No road test record" },
                ...(insp.estimated_hours === null ? [] : [{ label: "Estimated hours", value: insp.estimated_hours !== null ? `${insp.estimated_hours} h by the technician${insp.estimated_hours_manager !== null ? ` · ${insp.estimated_hours_manager} h agreed by the manager` : " · not yet agreed"}${insp.estimate_reason ? ` · ${insp.estimate_reason}` : ""}` : null }]),
                ...(insp.big_job_tags?.length ? [{ label: "Big job", value: insp.big_job_tags.join(", ") }] : []),
                ...(scanGate ? [{ label: "Scan report", value: (insp.scan_read_at ? `Read by the technician ${formatDateTime(insp.scan_read_at)}` : insp.scan_approved_at ? `Scan not possible, approved ${formatDateTime(insp.scan_approved_at)}` : insp.scan_not_possible_reason ? `Scan not possible: ${insp.scan_not_possible_reason} (waiting for approval)` : "Not read yet") }] : []),
                ...(insp.approved_at ? [{ label: "Approved", value: `${formatDateTime(insp.approved_at)} by ${bundle.approver?.display_name ?? ""}` }] : []),
                ...(insp.manager_note ? [{ label: "Workshop manager's note", value: <span className="whitespace-pre-wrap">{insp.manager_note}</span> }] : []),
                ...(insp.manager_note_internal && role !== "technician" ? [{ label: "Note for the advisor (internal)", value: <span className="whitespace-pre-wrap">{insp.manager_note_internal}</span> }] : []),
                ...(insp.requests_note ? [{ label: "Technician on the requests", value: <span className="whitespace-pre-wrap">{insp.requests_note}</span> }] : []),
                ...(String(m.battery_health ?? "") === "replace" ? [{ label: "Battery", value: <span className="font-bold text-red">Replace</span> }] : []),
                ...(insp.return_reason && insp.status === "returned" ? [{ label: "Sent back because", value: insp.return_reason }] : []),
              ]}
            />
          </Card>

          {reviewing ? (
            <InspectionForm inspectionId={insp.id} jobId={id} {...formProps} readOnly={false} quickRemarks={(settings.quick_remarks ?? []) as string[]} tyreBrands={(settings.tyre_brands ?? []) as string[]} submitAction={null} showPrescanToggle={can(role, "sendReport")} limits={inspectionLimitsOf(settings)} suggestions={(settings.item_suggestions ?? {}) as Suggestions} fluidGrades={(settings.fluid_grades ?? []) as string[]} bigJobTags={(settings.big_job_tags ?? []) as string[]} initialTags={insp.big_job_tags ?? []} estimatedHours={insp.estimated_hours === null ? "" : String(insp.estimated_hours)} estimateReason={insp.estimate_reason ?? ""} scan={null} partsListFooter={<PartsListTick action={confirmPartsList.bind(null, id)} confirmedAt={insp.parts_list_confirmed_at} confirmedByName={tickName} count={partLines.length} canTick={canApprove && insp.status === "submitted"} />} />
          ) : (
            <>
              <Card className="flex flex-col gap-2">
                <SectionLabel right={partLines.length ? `${partLines.length} line${partLines.length === 1 ? "" : "s"}` : "none"}>Parts list</SectionLabel>
                {partLines.length ? (
                  <ul className="divide-y divide-line text-sm">
                    {partLines.map((l) => (
                      <li key={l.key} className="py-1.5 flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{l.name}</span>
                        <span className="text-muted">× {l.qty}</span>
                        {l.positions.length ? <span className="text-muted">{l.positions.join(", ")}</span> : null}
                        {l.note ? <span className="text-xs text-muted">{l.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No parts on this report.</p>
                )}
                {insp.parts_list_confirmed_at ? <p className="text-xs text-green font-semibold">✓ Checked by {tickName ?? "the workshop manager"}, {formatDateTime(insp.parts_list_confirmed_at)}.{insp.status === "approved" ? " Sent to Parts for pricing." : ""}</p> : <p className="text-xs text-muted">The workshop manager ticks the list under it when approving the report.</p>}
              </Card>


              <Card className="flex flex-col gap-2">
                <SectionLabel right={`${items.filter((i) => i.status === "bad" && i.style !== "job").length} bad · ${items.filter((i) => i.status === "bad" && i.style === "job").length} required · ${items.filter((i) => i.status === "average").length} average · ${items.filter((i) => i.status === "good").length} good${items.some((i) => i.status === "na") ? ` · ${items.filter((i) => i.status === "na").length} n/a` : ""}${items.some((i) => !i.status) ? ` · ${items.filter((i) => !i.status).length} not marked` : ""}`}>Checklist</SectionLabel>
                <p className="text-xs text-muted">One line per item, Bad and Required first. Tap a line to open it.</p>
                <ul className="divide-y divide-line">
                  {[...items.filter((i) => i.status === "bad"), ...items.filter((i) => i.status === "average"), ...items.filter((i) => !i.status)].map((i) => (
                    <ItemLine key={i.id} item={i} media={bundle.media.filter((x) => x.item_key === i.item_key)} urls={bundle.mediaUrls} />
                  ))}
                </ul>
                {items.some((i) => i.status === "good" || i.status === "na") ? (
                  <details className="border-t border-line pt-2">
                    <summary className="cursor-pointer min-h-11 flex items-center text-sm font-semibold text-muted">{items.filter((i) => i.status === "good").length} good{items.some((i) => i.status === "na") ? ` and ${items.filter((i) => i.status === "na").length} not applicable` : ""}: tap to see them</summary>
                    <ul className="divide-y divide-line">
                      {[...items.filter((i) => i.status === "good"), ...items.filter((i) => i.status === "na")].map((i) => (
                        <ItemLine key={i.id} item={i} media={bundle.media.filter((x) => x.item_key === i.item_key)} urls={bundle.mediaUrls} />
                      ))}
                    </ul>
                  </details>
                ) : null}
              </Card>

              <Card className="flex flex-col gap-3">
                <SectionLabel>Tyres and numbers{insp.measurements_edited_by_name ? ` · edited by ${insp.measurements_edited_by_name}, ${formatDateTime(insp.measurements_edited_at)}` : ""}</SectionLabel>
                <ul className="divide-y divide-line text-sm">
                  {m.tyre_size_front || m.tyre_size_rear ? <li className="py-1.5 flex flex-wrap gap-x-3"><span className="font-semibold w-28">Tyre size</span><span>Front {String(m.tyre_size_front ?? "") || "—"} · Rear {String(m.tyre_size_rear ?? "") || "—"}</span></li> : null}
                  {[...TYRE_POSITIONS, { key: "spare", label: "Spare" }]
                    .filter((p) => m[`tyre_${p.key}_tread`] || m[`tyre_${p.key}_action`])
                    .map((p) => (
                      <li key={p.key} className="py-1.5 flex flex-wrap gap-x-3">
                        <span className="font-semibold w-28">{p.label}</span>
                        <span>{m[`tyre_${p.key}_tread`] ? `${m[`tyre_${p.key}_tread`]} mm` : ""}{m[`tyre_${p.key}_year`] ? ` · ${m[`tyre_${p.key}_year`]}` : ""}</span>
                        <span className="text-muted">{String(m[`tyre_${p.key}_cond`] ?? "").split(",").filter(Boolean).map((c) => TYRE_CONDITIONS.find((x) => x.value === c)?.label ?? c).join(", ")}</span>
                        <span className="font-semibold">{TYRE_ACTIONS.find((a) => a.value === m[`tyre_${p.key}_action`])?.label ?? ""}{m[`tyre_${p.key}_reason`] ? ` (${TYRE_REPLACE_REASONS.find((r) => r.value === m[`tyre_${p.key}_reason`])?.label ?? ""})` : ""}</span>
                      </li>
                    ))}
                </ul>
                <DescriptionList items={MEASUREMENTS.filter((x) => !x.key.startsWith("tyre_")).map((x) => ({ label: x.label, value: m[x.key] != null && String(m[x.key]) !== "" ? `${x.kind === "choice" ? (x.choices?.find((c) => c.value === String(m[x.key]))?.label ?? m[x.key]) : m[x.key]}${x.unit ? ` ${x.unit}` : ""}` : null }))} />
                <Original original={insp.measurements_original as Record<string, unknown> | null} />
              </Card>

              {insp.technician_notes ? (
                <Card className="flex flex-col gap-2">
                  <SectionLabel>Technician&apos;s notes</SectionLabel>
                  <p className="text-sm whitespace-pre-wrap">{insp.technician_notes}</p>
                </Card>
              ) : null}
            </>
          )}

        </div>

        <div className="flex flex-col gap-6">
          {/* Top right: what the customer asked for, and the road test right under it (Bad and Average first, Good as one line). */}
          {!reviewing ? (
            <Card className="flex flex-col gap-2" data-customer-says>
              <SectionLabel right={`${requests.length}`}>The customer says</SectionLabel>
              <ol className="flex flex-col gap-1.5">
                {requests.map((r, i) => (
                  <li key={r.id} className="flex gap-3 text-base font-semibold leading-snug">
                    <span className="w-6 shrink-0 text-muted">{i + 1}.</span>
                    <span>{r.text}</span>
                  </li>
                ))}
              </ol>
              {insp.requests_note ? <p className="text-sm"><span className="text-muted">Technician to the advisor:</span> {insp.requests_note}</p> : null}
              <Files rows={bundle.media.filter((x) => x.job_request_id)} urls={bundle.mediaUrls} />
            </Card>
          ) : null}
          <Card className="flex flex-col gap-2" data-road-test>
            <SectionLabel right={road.state === "done" ? `${road.flagged.length} noted` : undefined}>Road test</SectionLabel>
            {roadTest?.decision ? <p className="text-xs text-muted">Workshop manager: {ROAD_TEST_DECISION_LABELS[roadTest.decision]}{roadTest.decision_note ? ` · ${roadTest.decision_note}` : ""}</p> : null}
            {road.state !== "done" ? (
              <p className="text-sm text-muted">{road.state === "not_possible" ? `Not possible: ${roadTest?.not_possible_reason ?? ""}` : road.state === "not_needed" ? "No road test for this car." : "Not done yet."}</p>
            ) : (
              <>
                {road.flagged.length ? (
                  <ul className="divide-y divide-line text-sm">
                    {road.flagged.map((f) => (
                      <li key={f.key} className="py-1.5 flex flex-col gap-1" data-road-item={f.status}>
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={TONE[f.status]}>{f.statusLabel}</Badge>
                          <span className="font-semibold">{f.label}</span>
                          {f.remarks ? <span className="text-muted">· {f.remarks}</span> : null}
                        </span>
                        <Files rows={bundle.media.filter((x) => x.item_key === `road.${f.key}`)} urls={bundle.mediaUrls} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm">Nothing noted on the road test.</p>
                )}
                {road.good.length ? (
                  <p className="text-xs text-muted" data-road-good>
                    <span className="font-semibold text-green">Good:</span> {road.good.join(", ")}
                  </p>
                ) : null}
              </>
            )}
          </Card>
          {!reviewing ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel right={`${prescans.length}`}>Pre-scan (fault code report)</SectionLabel>
              <Files rows={prescans} urls={bundle.mediaUrls} />
              {!prescans.length ? <p className="text-sm text-muted">Not attached yet.</p> : null}
              {can(role, "sendReport") && prescans.length ? <PrescanToggle inspectionId={insp.id} initial={insp.show_prescan_to_customer} /> : <p className="text-xs text-muted">{insp.show_prescan_to_customer ? "Shown to the customer with the report." : "Hidden from the customer."}</p>}
            </Card>
          ) : null}

          {scanGate && canApprove && insp.scan_not_possible_reason && !insp.scan_approved_at && !insp.scan_read_at ? (
            <Card className="flex flex-col gap-3 border-amber-bar">
              <SectionLabel>Scan not possible: approve?</SectionLabel>
              <p className="text-sm">{bundle.technician?.display_name ?? "The technician"} says: {insp.scan_not_possible_reason}</p>
              <form action={approveScanNotPossible.bind(null, id)}><Button type="submit" size="md">Approve, open the checklist</Button></form>
            </Card>
          ) : null}
          {canApprove && insp.status === "submitted" ? (
            <Card className="flex flex-col gap-4 border-ink">
              <SectionLabel>Workshop manager&apos;s decision</SectionLabel>
              <ApproveFormLive action={approveInspection.bind(null, id)} hasPrescan={prescans.length > 0} techHours={insp.estimated_hours} groups={noteGroups} usage={noteUsage} reasons={{ raise: reasonsFor(settings, "hours_raise"), lower: reasonsFor(settings, "hours_lower") }} />
              <ReturnForm action={returnInspection.bind(null, id)} reasons={reasonsFor(settings, "send_back")} />
            </Card>
          ) : null}

          {insp.status === "approved" ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Changes after approval</SectionLabel>
              <p className="text-xs text-muted">The approved report is locked. A change needs the owner&apos;s personal approval and opens the report for {unlockHours} hour{unlockHours === 1 ? "" : "s"}; every step is on the job&apos;s change log.</p>
              {!locked ? <Notice tone="info">Open for changes until {formatDateTime(insp.unlocked_until)}. Make them on the technician screen.</Notice> : null}
              {pendingChange ? (
                <div className="rounded-control border border-amber-bar bg-amber-soft p-3 flex flex-col gap-2 text-sm">
                  <span className="font-semibold">Waiting for the owner</span>
                  <span>{pendingChange.requester?.display_name}: {pendingChange.reason}</span>
                  {canDecide ? (
                    <form action={decideInspectionChange.bind(null, id, pendingChange.id)} className="flex flex-col gap-2">
                      <Textarea name="decision_note" rows={2} placeholder="Note (optional)" />
                      <div className="flex gap-2">
                        <Button type="submit" name="decision" value="approved" size="md">
                          Approve change
                        </Button>
                        <Button type="submit" name="decision" value="refused" tone="secondary" size="md">
                          Refuse
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </div>
              ) : canRequest && locked ? (
                <RequestChangeForm action={requestInspectionChange.bind(null, id)} />
              ) : null}
              {bundle.changeRequests.filter((c) => c.status !== "pending").length ? (
                <ul className="flex flex-col divide-y divide-line text-xs">
                  {bundle.changeRequests
                    .filter((c) => c.status !== "pending")
                    .map((c) => (
                      <li key={c.id} className="py-2">
                        <span className="font-semibold">{c.status === "approved" ? "Approved" : "Refused"}</span> {c.decided_at ? formatDateTime(c.decided_at) : ""} by {c.decider?.display_name ?? ""} · {c.requester?.display_name}: {c.reason}
                        {c.decision_note ? ` · ${c.decision_note}` : ""}
                      </li>
                    ))}
                </ul>
              ) : null}
            </Card>
          ) : null}

          {role !== "technician" ? (
            <p className="text-xs text-muted">
              <Link href={`/jobs/${id}`} className="underline underline-offset-4">
                Back to the job card
              </Link>
            </p>
          ) : null}
        </div>
        {canApprove && insp.status === "submitted" ? <><div className="h-20" /><ReviewBar /></> : null}
      </div>
    </>
  );
}
