import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, DescriptionList, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { INSPECTION_STATUS_LABELS, ITEM_STATUS_LABELS, MEASUREMENTS, ROAD_TEST_SECTION_KEY, TYRE_ACTIONS, TYRE_CONDITIONS, TYRE_POSITIONS, formatMinutes, sideOfDepartment, type ChecklistSection, type ItemStatus } from "@/lib/inspection";
import { inspectionLocked, inspectionWorkingMinutes, loadInspection, type InspectionMediaRow } from "@/lib/inspection-data";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { workingTimeOf } from "@/lib/jobs";
import { ROAD_TEST_ITEMS, ROAD_TEST_STATUS_LABELS, type RoadTestRow } from "@/lib/road-test";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { approveInspection, decideInspectionChange, requestInspectionChange, returnInspection } from "../../inspection-actions";
import { InspectionForm } from "@/app/(app)/my-jobs/[id]/InspectionForm";
import { ApproveForm, RequestChangeForm, ReturnForm } from "./forms";

export const dynamic = "force-dynamic";

const TONE: Record<ItemStatus, "green" | "amber" | "red"> = { good: "green", average: "amber", bad: "red" };

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
    supabase.from("road_tests").select("id, job_id, inspector_id, status, items, not_possible_reason, started_at, done_at, created_at, updated_at").eq("job_id", id).maybeSingle(),
  ]);
  if (!card) notFound();
  const { job, vehicle, requests } = card;
  const roadTest = (rt as RoadTestRow | null) ?? null;

  // Who may open this report.
  const isTech = role === "technician" && job.assigned_to === staff.id;
  const isManager = role === "workshop_manager" && (!job.department || job.department === "both" || sideOfDepartment(staff.department_id) === null || sideOfDepartment(staff.department_id) === job.department);
  const approvedForAdvisor = role === "service_advisor" && bundle?.inspection.status === "approved";
  const allowed = role === "owner" || isTech || isManager || approvedForAdvisor || role === "qc_inspector" || role === "accounts" || role === "parts";
  if (!allowed) redirect(role === "technician" ? "/my-jobs" : role === "service_advisor" ? `/jobs/${id}?error=${encodeURIComponent("The report opens for you once the workshop manager has approved it.")}` : "/home");

  if (!bundle) {
    return (
      <>
        <PageHeader title={`Inspection · ${formatPlate(vehicle)}`} subtitle={`${vehicleTitle(vehicle)} · ${job.job_number}`} actions={<LinkButton href={`/jobs/${id}`} tone="secondary">Job card</LinkButton>} />
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
  const sections = Array.from(new Map(items.map((i) => [i.section_key, i.section_title])).entries());
  const flagged = items.filter((i) => i.status === "average" || i.status === "bad");
  const prescans = bundle.media.filter((m) => m.is_prescan);
  const pendingChange = bundle.changeRequests.find((c) => c.status === "pending");
  const roadDone = !!roadTest && roadTest.status !== "not_started";
  const m = insp.measurements ?? {};
  const reviewing = canApprove && insp.status === "submitted";
  const unlockHours = Number(settings.inspection_unlock_hours) || 1;

  const formProps = {
    checklist: insp.checklist as ChecklistSection[],
    items: bundle.items.map((i) => ({ key: i.item_key, label: i.item_label, sectionKey: i.section_key, status: i.status as ItemStatus | null, remarks: i.remarks ?? "", parts_needed: i.parts_needed ?? "", editedBy: i.edited_by_name ?? null })),
    findings: requests.map((r) => {
      const f = bundle.findings.find((x) => x.job_request_id === r.id);
      return { requestId: r.id, text: r.text, found: f?.found ?? "", needs: f?.needs ?? "", status: (f?.status as ItemStatus | null) ?? null };
    }),
    measurements: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)])),
    files: bundle.media.filter((x) => !x.item_key?.startsWith("road.")).map((x) => ({ id: x.id, kind: x.kind, url: bundle.mediaUrls[x.storage_path] ?? null, caption: x.caption, isPrescan: x.is_prescan, itemKey: x.item_key, requestId: x.job_request_id })),
    notes: insp.technician_notes ?? "",
    prescanVisible: insp.show_prescan_to_customer,
  };

  return (
    <>
      <PageHeader
        title={`Inspection · ${formatPlate(vehicle)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{vehicleTitle(vehicle)}</span>
            <span>· {job.job_number}</span>
            <Badge tone={insp.status === "approved" ? "green" : insp.status === "returned" ? "red" : insp.status === "submitted" ? "amber" : "outline"}>{INSPECTION_STATUS_LABELS[insp.status]}</Badge>
            <Badge tone={roadDone ? "green" : "amber"}>{ROAD_TEST_STATUS_LABELS[roadTest?.status ?? "not_started"]}</Badge>
            {locked ? <Badge tone="ink">Locked</Badge> : null}
          </span>
        }
        actions={
          <>
            {role !== "technician" ? (
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

      {reviewing ? <Notice tone="info">You are reviewing. You can change any item, remark, parts list, number or photo before approving; each change is stamped with your name and the technician&apos;s original is kept.</Notice> : null}
      {reviewing && !roadDone ? <Notice tone="error">The QC road test is not done yet. Approval waits for it (or for &quot;road test not possible&quot;).</Notice> : null}

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
                { label: "Road test", value: roadTest ? `${ROAD_TEST_STATUS_LABELS[roadTest.status]}${roadTest.not_possible_reason ? `: ${roadTest.not_possible_reason}` : ""}${roadTest.done_at ? ` · ${formatDateTime(roadTest.done_at)}` : ""}` : "Not done yet" },
                ...(insp.approved_at ? [{ label: "Approved", value: `${formatDateTime(insp.approved_at)} by ${bundle.approver?.display_name ?? ""}` }] : []),
                ...(insp.manager_note ? [{ label: "Workshop manager's note", value: <span className="whitespace-pre-wrap">{insp.manager_note}</span> }] : []),
                ...(insp.return_reason && insp.status === "returned" ? [{ label: "Sent back because", value: insp.return_reason }] : []),
              ]}
            />
          </Card>

          {reviewing ? (
            <InspectionForm inspectionId={insp.id} {...formProps} readOnly={false} submitAction={null} />
          ) : (
            <>
              <Card className="flex flex-col gap-3">
                <SectionLabel right={`${requests.length}`}>Customer requests</SectionLabel>
                {requests.map((r, i) => {
                  const f = bundle.findings.find((x) => x.job_request_id === r.id);
                  return (
                    <div key={r.id} className="rounded-card border border-line p-3 flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">
                          {i + 1}. {r.text}
                        </span>
                        {f?.status ? <Badge tone={TONE[f.status]}>{ITEM_STATUS_LABELS[f.status]}</Badge> : <Badge tone="neutral">Not answered</Badge>}
                        {f?.edited_by_name ? <span className="text-xs text-muted">Edited by {f.edited_by_name}, {formatDateTime(f.edited_at)}</span> : null}
                      </div>
                      {f?.found ? <p className="text-sm"><span className="text-muted">Found:</span> {f.found}</p> : null}
                      {f?.needs ? <p className="text-sm"><span className="text-muted">Needs:</span> {f.needs}</p> : null}
                      <Original original={f?.original as Record<string, unknown> | null} />
                      <Files rows={bundle.media.filter((x) => x.job_request_id === r.id)} urls={bundle.mediaUrls} />
                    </div>
                  );
                })}
              </Card>

              {flagged.length ? (
                <Card className="flex flex-col gap-3 border-ink">
                  <SectionLabel right={`${flagged.length}`}>Suggested quote lines</SectionLabel>
                  <p className="text-xs text-muted">From every AVERAGE and BAD item: the parts the technician listed.</p>
                  <ul className="flex flex-col divide-y divide-line">
                    {flagged.map((i) => (
                      <li key={i.id} className="py-2 flex flex-wrap items-start gap-x-4 gap-y-1 text-sm">
                        <Badge tone={TONE[i.status as ItemStatus]}>{ITEM_STATUS_LABELS[i.status as ItemStatus]}</Badge>
                        <span className="font-semibold flex-1 min-w-48">{i.item_label}</span>
                        <span className="text-muted whitespace-pre-wrap">{i.parts_needed ?? "No parts listed"}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              {sections.map(([key, title]) => {
                const rows = items.filter((i) => i.section_key === key);
                return (
                  <Card key={key} className="flex flex-col gap-2">
                    <SectionLabel right={`${rows.filter((i) => i.status === "good").length} good · ${rows.filter((i) => i.status === "average").length} average · ${rows.filter((i) => i.status === "bad").length} bad`}>{title}</SectionLabel>
                    <ul className="flex flex-col divide-y divide-line">
                      {rows.map((i) => (
                        <li key={i.id} className="py-2 flex flex-col gap-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            {i.status ? <Badge tone={TONE[i.status]}>{ITEM_STATUS_LABELS[i.status]}</Badge> : <Badge tone="neutral">Not marked</Badge>}
                            <span className="text-sm font-semibold">{i.item_label}</span>
                            {i.edited_by_name ? <span className="text-xs text-muted">Edited by {i.edited_by_name}, {formatDateTime(i.edited_at)}</span> : null}
                          </div>
                          {i.remarks ? <p className="text-sm whitespace-pre-wrap">{i.remarks}</p> : null}
                          {i.parts_needed ? <p className="text-xs text-muted">Parts: {i.parts_needed}</p> : null}
                          <Original original={i.original as Record<string, unknown> | null} />
                          <Files rows={bundle.media.filter((x) => x.item_key === i.item_key)} urls={bundle.mediaUrls} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                );
              })}

              <Card className="flex flex-col gap-3">
                <SectionLabel>Tyres and numbers{insp.measurements_edited_by_name ? ` · edited by ${insp.measurements_edited_by_name}, ${formatDateTime(insp.measurements_edited_at)}` : ""}</SectionLabel>
                <ul className="divide-y divide-line text-sm">
                  {[...TYRE_POSITIONS, { key: "spare", label: "Spare" }]
                    .filter((p) => m[`tyre_${p.key}_tread`] || m[`tyre_${p.key}_action`])
                    .map((p) => (
                      <li key={p.key} className="py-1.5 flex flex-wrap gap-x-3">
                        <span className="font-semibold w-28">{p.label}</span>
                        <span>{m[`tyre_${p.key}_tread`] ? `${m[`tyre_${p.key}_tread`]} mm` : ""}{m[`tyre_${p.key}_year`] ? ` · ${m[`tyre_${p.key}_year`]}` : ""}</span>
                        <span className="text-muted">{String(m[`tyre_${p.key}_cond`] ?? "").split(",").filter(Boolean).map((c) => TYRE_CONDITIONS.find((x) => x.value === c)?.label ?? c).join(", ")}</span>
                        <span className="font-semibold">{TYRE_ACTIONS.find((a) => a.value === m[`tyre_${p.key}_action`])?.label ?? ""}</span>
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

          <Card className="flex flex-col gap-2">
            <SectionLabel>Road test (QC inspector)</SectionLabel>
            {!roadTest || roadTest.status === "not_started" ? (
              <p className="text-sm text-muted">Not done yet.</p>
            ) : roadTest.status === "not_possible" ? (
              <p className="text-sm">Not possible: {roadTest.not_possible_reason}</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {ROAD_TEST_ITEMS.map((it) => {
                  const v = roadTest.items[it.key];
                  return (
                    <li key={it.key} className="py-1.5 flex flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        {v?.status ? <Badge tone={TONE[v.status]}>{ITEM_STATUS_LABELS[v.status]}</Badge> : null}
                        <span className="font-semibold">{it.label}</span>
                        {v?.remarks ? <span className="text-muted">· {v.remarks}</span> : null}
                      </span>
                      <Files rows={bundle.media.filter((x) => x.item_key === `road.${it.key}`)} urls={bundle.mediaUrls} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {!reviewing ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel right={`${prescans.length}`}>Pre-scan (fault code report)</SectionLabel>
              <Files rows={prescans} urls={bundle.mediaUrls} />
              {!prescans.length ? <p className="text-sm text-muted">Not attached yet.</p> : null}
              <p className="text-xs text-muted">{insp.show_prescan_to_customer ? "Shown to the customer with the report." : "Hidden from the customer."}</p>
            </Card>
          ) : null}

          {canApprove && insp.status === "submitted" ? (
            <Card className="flex flex-col gap-4 border-ink">
              <SectionLabel>Workshop manager&apos;s decision</SectionLabel>
              {roadDone ? <ApproveForm action={approveInspection.bind(null, id)} /> : <p className="text-sm font-semibold text-amber">Approval waits for the QC road test.</p>}
              <ReturnForm action={returnInspection.bind(null, id)} />
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
      </div>
    </>
  );
}
