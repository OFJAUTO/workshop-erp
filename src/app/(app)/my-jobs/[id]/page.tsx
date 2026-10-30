import { VinCopy } from "@/components/VinCopy";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Collapsible } from "@/components/Collapsible";
import { ElapsedTimer } from "@/components/ElapsedTimer";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PriorityBadge } from "@/components/JobBadges";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDate, formatDateTime, formatDayTime } from "@/lib/format";
import { INSPECTION_STATUS_LABELS, ITEM_STATUS_LABELS, formatMinutes, type ChecklistSection, type ItemStatus, inspectionLimitsOf, toItemState } from "@/lib/inspection";
import { hasLabourChargesLine, tasksFromInspection,inspectionLocked, inspectionWorkingMinutes, loadInspection, inspectionDangerous, tyreSizeSuggestionFor } from "@/lib/inspection-data";
import { wheelConditionLines } from "@/lib/wheels";
import { loadCatalogue } from "@/lib/parts-catalogue";
import { cleanPartsList } from "@/lib/parts-list";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { loadJobItems } from "@/lib/loose-items";
import { CONDITIONS, STATUS_LABELS, formatPromised, labelOf, workingTimeOf } from "@/lib/jobs";
import { jobPartsState } from "@/lib/parts-data";
import { ROAD_TEST_ITEMS, ROAD_TEST_SELECT, roadTestLine, roadTestWaiting, type RoadTestRow } from "@/lib/road-test";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { MediaGallery } from "@/app/(app)/jobs/[id]/MediaGallery";
import { createAdminClient } from "@/lib/supabase/admin";
import { noteInspectionEdit, startInspection, submitInspection } from "../../jobs/inspection-actions";
import { jobFinished, keepWorking, leaveJobAction, pauseWorkAction, reportAdditionalWork, startWork } from "../../jobs/work-actions";
import { breakOf } from "@/lib/breaks";
import { getCurrentDevice } from "@/lib/devices";
import { ScanStepCard } from "./ScanStepCard";
import { PartsForCar } from "./PartsForCar";
import { exchangePartAction, receiveMyParts } from "../../parts/handover-actions";
import { additionalWorkLabel, latestQc, loadWork, sessionMinutes } from "@/lib/work-data";
import { activeTechnicians } from "@/lib/work-flow";
import { reasonsFor } from "@/lib/reasons";
import { InspectionForm, type Suggestions } from "./InspectionForm";
import { canEditBody, isBodyshopStaff, loadBodyState } from "@/lib/bodyshop-findings";
import { WorkClock, WorkJobs, type PanelLine, type PanelPart, type RunningSession } from "./WorkPanel";
import { refuseRecord } from "@/lib/refusal";

export const dynamic = "force-dynamic";

const TONE: Record<ItemStatus, "green" | "amber" | "red" | "neutral"> = { good: "green", average: "amber", bad: "red", na: "neutral" };

/**
 * The technician's screen for one car. In Work: the big countdown with Working and Pause, the road
 * test remarks, the customer's requests, the read-only job list with the parts, "Additional work
 * found" and "Job finished". Before that: the requests and the inspection report.
 */
export default async function TechnicianJobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; message?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const { error, message } = await searchParams;
  const supabase = await createClient();
  const [card, bundle, settings, { data: rt }] = await Promise.all([loadJobCard(supabase, id), loadInspection(id), getSettings(), supabase.from("road_tests").select(ROAD_TEST_SELECT).eq("job_id", id).maybeSingle()]);
  if (!card) {
    const { data: other } = await createAdminClient().from("jobs").select("job_number, assigned_to, assignee:staff!jobs_assigned_to_fkey(display_name)").eq("id", id).maybeSingle();
    if (!other) return refuseRecord("job", id);
    const who = (other as unknown as { assignee: { display_name: string } | null }).assignee?.display_name ?? null;
    return (
      <>
        <PageHeader title={other.job_number} subtitle="This car is not on your list." />
        <Card className="flex flex-col gap-3 max-w-xl">
          <p className="text-sm">{who ? `It is with ${who}. ` : "It is not assigned to anyone yet. "}Ask the workshop manager to put you on it.</p>
          <div><LinkButton href="/my-jobs" size="md">Back to my jobs</LinkButton></div>
        </Card>
      </>
    );
  }
  const { job, vehicle, customer, vip, gateIn, requests, media } = card;
  const roadTest = (rt as RoadTestRow | null) ?? null;
  const techs = await activeTechnicians(id);
  const onCar = techs.some((t) => t.staff_id === staff.id);
  const mine = job.assigned_to === staff.id || onCar;
  const manager = can(role, "approveInspections");
  if (role === "technician" && !mine) redirect("/my-jobs");
  if (role !== "technician" && !can(role, "viewJobs")) redirect("/home");
  const isVip = customer?.is_vip ?? vip?.is_vip ?? false;
  const vipNote = customer?.vip_note ?? vip?.vip_note ?? null;
  const insp = bundle?.inspection ?? null;
  const wt = workingTimeOf(settings);
  const workingMin = insp ? inspectionWorkingMinutes(insp, wt) : 0;
  const target = insp?.target_minutes ?? (Number(settings.inspection_target_minutes) || 90);
  const over = !!insp?.started_at && workingMin > target;
  const locked = insp ? inspectionLocked(insp) : false;
  const waitingRoadTest = (roadTestWaiting(roadTest) || job.status === "pending_road_test") && role !== "owner";
  const inWork = job.status === "in_work";
  const loose = job.job_kind === "loose";
  const looseItems = loose ? await loadJobItems(id) : [];
  const scanGateOn = settings.prescan_gate_enabled === true;
  // Section 3 (21 October): the OWNER edits the report directly at every stage - approved, locked,
  // even with the car in Work - no approval request, no one-hour window. Quietly logged by the save route.
  const ownerDirect = role === "owner" && !staff.viewingAs;
  const canFill = (!inWork && !!insp && ((mine && insp.technician_id === staff.id) || manager) && (insp.status === "in_progress" || insp.status === "returned" || (insp.status === "approved" && !locked))) || (ownerDirect && !!insp);
  const canAddPrescan = !!insp && mine && insp.technician_id === staff.id && insp.status === "submitted";
  // Section 7: the bodyshop findings at the bottom of the inspection.
  const bodyRow = insp ? (await createAdminClient().from("inspections").select("bodyshop_checked_at").eq("id", insp.id).maybeSingle()).data : null;
  const body = insp ? { initial: await loadBodyState(insp.id), canEdit: await canEditBody(staff, { job_id: id, status: insp.status, bodyshop_checked_at: (bodyRow?.bodyshop_checked_at as string | null) ?? null }), canCheck: isBodyshopStaff(staff) && !staff.viewingAs } : null;
  const condition = gateIn ? labelOf(CONDITIONS, gateIn.condition) : "";
  const statusText = insp?.status === "submitted" ? "Submitted, waiting for manager" : waitingRoadTest ? "Waiting for road test" : job.work_done_at && inWork ? "Job finished, waiting for the manager" : STATUS_LABELS[job.status];

  // The work order, once the car is in Work (or back from a failed QC).
  const work = inWork || job.status === "pending_qc" ? await loadWork(id) : null;
  // The parts list loads whatever the stage: receiving on the tablet starts before the car is released to Work.
  const parts = await jobPartsState(id);
  const [qc, { data: sendBackEvent }, { data: managers }] = work
    ? await Promise.all([
        latestQc(id),
        createAdminClient().from("job_events").select("note, created_at").eq("job_id", id).eq("event_type", "work_sendback").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        createAdminClient().from("staff").select("display_name, department_id").eq("role_id", "workshop_manager").eq("is_active", true).order("display_name"),
      ])
    : [null, { data: null }, { data: [] as { display_name: string; department_id: string | null }[] }];
  const qcFailed = qc && qc.status === "failed" && inWork ? { round: qc.round, items: qc.items.filter((i) => i.result === "fail").map((i) => ({ label: i.label, remark: i.remark })) } : null;
  const panelLines: PanelLine[] = work ? work.lines.map((l) => ({ id: l.id, title: l.title, details: l.details, positions: l.positions ?? null, hours_quoted: l.hours_quoted, status: l.status })) : [];
  // One "Labour charges" line: the inspection's findings are the tasks.
  const inspectionTasks = work && bundle && hasLabourChargesLine(work.lines) ? tasksFromInspection(bundle.items) : [];
  const confirmerIds = Array.from(new Set((parts?.needed ?? []).map((p) => p.issue_confirmed_by).filter((x): x is string => !!x)));
  const { data: confirmers } = confirmerIds.length ? await createAdminClient().from("staff").select("id, display_name").in("id", confirmerIds) : { data: [] as { id: string; display_name: string }[] };
  const confirmerOf = new Map((confirmers ?? []).map((c) => [c.id, c.display_name]));
  const panelParts: PanelPart[] = parts ? parts.needed.map((p) => ({ id: p.id, description: p.description, positions: p.positions ?? null, quantity: Number(p.confirmed_quantity ?? p.quantity) || 1, state: p.issue_status === "confirmed" ? "handed" : p.ready_for_handover_at ? "ready" : p.order_status === "received" || (p.availability === "in_stock" && p.received_qty > 0) ? "here" : "coming", when: p.expected_date ?? p.delivery_date ? formatDate((p.expected_date ?? p.delivery_date) + "T12:00:00+04:00") : null, receivedBy: p.issue_confirmed_by ? confirmerOf.get(p.issue_confirmed_by) ?? null : null, receivedAt: p.issue_confirmed_at ? formatDayTime(p.issue_confirmed_at) : null })) : [];
  const running: RunningSession[] = work ? work.sessions.filter((s) => !s.ended_at).map((s) => ({ since: s.started_at, name: work.names.get(s.technician_id) ?? "Technician", mine: s.technician_id === staff.id, throughBreak: !!s.through_break })) : [];
  const breakWindow = breakOf(settings, staff);
  const device = await getCurrentDevice();
  const minutesUsed = work ? work.sessions.filter((s) => s.ended_at).reduce((a, s) => a + sessionMinutes(s), 0) : 0;
  const mineThroughBreak = !!work?.sessions.some((s) => !s.ended_at && s.technician_id === staff.id && s.through_break);
  // The technician's own open pause on this car: the main button shows "Paused · reason" with Resume.
  const { data: myPause } = inWork ? await createAdminClient().from("work_pauses").select("reason, started_at").eq("job_id", id).eq("technician_id", staff.id).is("ended_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
  const reminders = [gateIn?.dash_cam ? "Disconnect the dash cam before you start." : "", gateIn?.old_parts_return ? "Keep the old parts: the customer asked for them." : ""].filter(Boolean);
  // The manager's send-back note stays on top until the job is finished again.
  const sendBack = inWork && !job.work_done_at && sendBackEvent && (!job.plan_released_at || sendBackEvent.created_at > job.plan_released_at) ? sendBackEvent.note.replace(/^Sent back by [^:]+: /, "") : null;
  const managerName = (managers ?? []).map((m) => m.display_name).join(" or ") || "the workshop manager";
  const myTech = techs.find((t) => t.staff_id === staff.id);
  const canWork = mine && (role === "technician" || role === "owner") && !staff.viewingAs;

  const [tyreSizeSuggestion, catalogue] = insp ? await Promise.all([tyreSizeSuggestionFor(vehicle.id), loadCatalogue()]) : [null, []];
  const formProps = insp && bundle
    ? {
        checklist: insp.checklist as ChecklistSection[],
        items: bundle.items.map(toItemState),
        requests: requests.map((r) => ({ id: r.id, text: r.text })),
        requestsNote: insp.requests_note ?? "",
        complaintKeywords: (settings.complaint_keywords ?? {}) as Record<string, string[]>,
        wheelConditions: wheelConditionLines(media),
        tyreSizeSuggestion,
        catalogue,
        partsList: cleanPartsList(insp.parts_list),
        noPartItems: Array.isArray(insp.no_part_items) ? (insp.no_part_items as string[]) : [],
        measurements: Object.fromEntries(Object.entries(insp.measurements ?? {}).map(([k, v]) => [k, String(v)])),
        files: bundle.media.filter((m) => !m.item_key?.startsWith("road.")).map((m) => ({ id: m.id, kind: m.kind, url: bundle.mediaUrls[m.storage_path] ?? null, caption: m.caption, isPrescan: m.is_prescan, itemKey: m.item_key, requestId: m.job_request_id })),
        notes: insp.technician_notes ?? "",
        prescanVisible: insp.show_prescan_to_customer,
      }
    : null;

  const roadTestCard = roadTest && job.department !== "bodyshop" ? (
    <Card className={`flex flex-col gap-3 ${roadTestWaiting(roadTest) ? "border-ink" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Road test (QC inspector)</SectionLabel>
        <Badge tone={roadTest.status === "done" ? "green" : roadTestWaiting(roadTest) ? "amber" : "neutral"}>{roadTestLine(roadTest)}</Badge>
      </div>
      {roadTestWaiting(roadTest) ? (
        <Notice tone="info">The workshop manager asked for a road test first. Your inspection opens as soon as the QC inspector submits it; you will be told.</Notice>
      ) : roadTest.status === "done" ? (
        <ul className="divide-y divide-line text-sm">
          {ROAD_TEST_ITEMS.filter((it) => roadTest.items[it.key]?.status && roadTest.items[it.key]?.status !== "good").map((it) => {
            const v = roadTest.items[it.key];
            return (
              <li key={it.key} className="py-1.5 flex flex-wrap items-center gap-2">
                {v?.status ? <Badge tone={TONE[v.status]}>{ITEM_STATUS_LABELS[v.status]}</Badge> : null}
                <span className="font-semibold">{it.label}</span>
                {v?.remarks ? <span className="text-muted">· {v.remarks}</span> : null}
              </li>
            );
          })}
          {ROAD_TEST_ITEMS.every((it) => !roadTest.items[it.key]?.status || roadTest.items[it.key]?.status === "good") ? <li className="py-1.5 text-sm text-green font-semibold">Nothing flagged on the road test.</li> : null}
          {!inWork ? (
            <li className="py-1.5">
              <details>
                <summary className="cursor-pointer text-xs font-semibold text-muted">GOOD items ({ROAD_TEST_ITEMS.filter((it) => roadTest.items[it.key]?.status === "good").length})</summary>
                <ul className="mt-1 flex flex-col gap-1">
                  {ROAD_TEST_ITEMS.filter((it) => roadTest.items[it.key]?.status === "good").map((it) => (
                    <li key={it.key} className="flex flex-wrap items-center gap-2"><Badge tone="green">GOOD</Badge><span>{it.label}</span>{roadTest.items[it.key]?.remarks ? <span className="text-muted">· {roadTest.items[it.key]?.remarks}</span> : null}</li>
                  ))}
                </ul>
              </details>
            </li>
          ) : null}
        </ul>
      ) : roadTest.status === "not_possible" ? (
        <p className="text-sm">Not possible: {roadTest.not_possible_reason ?? roadTest.decision_note}</p>
      ) : roadTest.decision === "not_needed" ? (
        <p className="text-sm">The workshop manager decided no road test is needed{roadTest.decision_note ? `: ${roadTest.decision_note}` : "."}</p>
      ) : (
        <p className="text-sm text-muted">Not done yet. It does not hold up your inspection.</p>
      )}
    </Card>
  ) : null;

  const requestsCard = (
    <section className="rounded-card bg-chip border border-line p-5 flex flex-col gap-3">
      <SectionLabel right={`${requests.length}`}>Customer requests</SectionLabel>
      {requests.length ? (
        <ol className="flex flex-col gap-2">
          {requests.map((r, i) => (
            <li key={r.id} className="flex gap-3 text-lg font-semibold leading-snug">
              <span className="w-7 shrink-0 text-muted">{i + 1}.</span>
              <span>{r.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-lg font-semibold whitespace-pre-wrap">{gateIn?.customer_requests}</p>
      )}
    </section>
  );

  return (
    <>
      {/* Section 10: inbound_scans is live and the net is 20 s, so an emailed scan report appears by itself. */}
      <LiveRefresh tables={["jobs", "inspections", "road_tests", "work_sessions", "job_technicians", "part_items", "inbound_scans"]} jobId={id} />
      <PageHeader
        title={formatPlate(vehicle)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{vehicleTitle(vehicle)}</span>
            <span>· {job.job_number}</span>
            <VinCopy vin={vehicle.vin} />
            {isVip ? <Badge tone="ink">VIP</Badge> : null}
            <PriorityBadge priority={job.priority} />
            {job.comeback_of ? <Badge tone="red">Comeback</Badge> : null}
            {gateIn?.dash_cam ? <Badge tone="red">Dash cam fitted</Badge> : null}
            {bundle && inspectionDangerous(bundle).length ? <Badge tone="red">DANGEROUS TO DRIVE</Badge> : null}
            {gateIn && gateIn.condition !== "runs_drives" ? <Badge tone="red">{condition}</Badge> : condition ? <Badge tone="green">{condition}</Badge> : null}
            {job.promised_at ? <Badge tone="outline">Promised {formatPromised(job.promised_at)}</Badge> : null}
            <Badge tone={insp?.status === "submitted" ? "amber" : "outline"}>{statusText}</Badge>
          </span>
        }
        actions={manager || role === "service_advisor" || role === "owner" ? <LinkButton href={`/jobs/${id}`} tone="secondary" size="lg">Job card</LinkButton> : undefined}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {gateIn?.dash_cam && !inWork ? <Notice tone="error">Dash cam fitted: disconnect before starting work.</Notice> : null}
      {isVip && vipNote ? (
        <Card className="border-ink flex flex-col gap-1">
          <SectionLabel>VIP handling note</SectionLabel>
          <p className="text-[15px] font-medium whitespace-pre-wrap">{vipNote}</p>
        </Card>
      ) : null}

      {!(work && inWork) && panelParts.length ? <PartsForCar jobId={id} parts={panelParts} canAct={!!canWork} receive={receiveMyParts.bind(null, id)} exchangeAction={exchangePartAction.bind(null, id)} /> : null}
      {work && inWork ? (
        <>
          <WorkClock
            hoursCharged={job.budget_hours !== null ? Number(job.budget_hours) : work.hoursQuoted}
            minutesUsed={minutesUsed}
            running={running}
            mineRunning={running.some((r) => r.mine)}
            reminders={reminders}
            pauseReasons={reasonsFor(settings, "pause")}
            leaveReasons={reasonsFor(settings, "leave_job")}
            canWork={canWork}
            workDone={!!job.work_done_at}
            waitingOnManager={managerName}
            sendBack={sendBack}
            qcFailed={qcFailed}
            breakWindow={breakWindow}
            mineThroughBreak={mineThroughBreak}
            minePause={myPause && !running.some((r) => r.mine) ? { reason: String(myPause.reason), since: String(myPause.started_at) } : null}
            keepWorkingAction={keepWorking.bind(null, id)}
            startAction={startWork.bind(null, id)}
            pauseAction={pauseWorkAction.bind(null, id)}
            leaveAction={leaveJobAction.bind(null, id)}
          />
          <PartsForCar jobId={id} parts={panelParts} canAct={!!canWork} receive={receiveMyParts.bind(null, id)} exchangeAction={exchangePartAction.bind(null, id)} />
          {roadTestCard}
          {requestsCard}
          {looseItems.length ? (
            <Card className="flex flex-col gap-2">
              <SectionLabel right={`${looseItems.length}`}>Items on the bench</SectionLabel>
              <ul className="divide-y divide-line">{looseItems.map((it) => <li key={it.id} className="py-2 font-semibold">{it.quantity > 1 ? `${it.quantity} × ` : ""}{it.item_type}{it.description ? ` · ${it.description}` : ""}</li>)}</ul>
            </Card>
          ) : null}
          <WorkJobs
            jobId={id}
            lines={panelLines}
            parts={[]}
            findings={work.additional.map((a) => ({ id: a.id, remark: a.remark, parts_needed: a.parts_needed, status: a.status, decision_note: a.decision_note, label: additionalWorkLabel(a).text, tone: additionalWorkLabel(a).tone }))}
            canWork={canWork}
            workDone={!!job.work_done_at}
            severalTechnicians={techs.length > 1}
            myPartDone={!!myTech?.done_at}
            finishNeedsPin={device?.kind === "personal" && role === "technician"}
            finishAction={jobFinished.bind(null, id)}
            reportAction={reportAdditionalWork.bind(null, id)}
          />
          {inspectionTasks.length ? (
            <Card className="flex flex-col gap-2" data-inspection-tasks>
              <SectionLabel right={`${inspectionTasks.length}`}>Tasks from the inspection</SectionLabel>
              <p className="text-xs text-muted">The quotation carries one Labour charges line: these are the findings the customer approved.</p>
              <ul className="divide-y divide-line text-sm">
                {inspectionTasks.map((t, i) => <li key={i} className="py-1.5"><span className="font-semibold">{t.label}</span><span className="text-muted"> · {t.status}</span>{t.note ? <span className="text-muted"> · {t.note}</span> : null}</li>)}
              </ul>
            </Card>
          ) : null}
          {insp ? (
            <p className="text-xs text-muted">
              Inspection: {formatMinutes(insp.elapsed_minutes ?? workingMin)}{insp.status === "approved" ? `, approved ${formatDate(insp.approved_at)}` : ""} · <Link href={`/jobs/${id}/inspection`} className="underline underline-offset-4 font-semibold">Open the report</Link>
            </p>
          ) : null}
        </>
      ) : (
        <>
          {scanGateOn && insp && insp.status !== "approved" && insp.status !== "submitted" ? (
            <ScanStepCard jobId={id} inspectionId={insp.id} files={(bundle?.media ?? []).filter((m) => m.is_prescan).map((m) => ({ id: m.id, kind: m.kind, url: bundle?.mediaUrls[m.storage_path] ?? null, caption: m.caption, isPrescan: true }))} receivedAt={(bundle?.media ?? []).filter((m) => m.is_prescan).map((m) => m.taken_at).sort().at(-1) ?? null} readAt={insp.scan_read_at} approvedAt={insp.scan_approved_at} notPossibleReason={insp.scan_not_possible_reason} canAct={mine && !staff.viewingAs} />
          ) : null}
          {roadTestCard}
          {requestsCard}
          {job.status === "pending_qc" ? <Notice tone="info">Work complete. The car is with QC; you will be told if anything comes back.</Notice> : null}
          {["approved", "waiting_parts"].includes(job.status) ? <Notice tone="info">The customer approved the work. Parts and the workshop manager are planning it; the car opens for you when it is released.</Notice> : null}

          {!loose ? (
          <Card className={`flex flex-col gap-4 ${over && insp?.status === "in_progress" ? "border-red-bar" : ""} ${waitingRoadTest ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionLabel>Inspection</SectionLabel>
              {insp ? <Badge tone={insp.status === "approved" ? "green" : insp.status === "returned" ? "red" : insp.status === "submitted" ? "amber" : "outline"}>{INSPECTION_STATUS_LABELS[insp.status]}</Badge> : null}
            </div>
            {!job.first_approval_at ? <Notice tone="info">The customer has not yet approved the job card. The inspection starts after that.</Notice> : null}
            {!insp ? (
              mine && job.first_approval_at && !waitingRoadTest ? (
                <form action={startInspection.bind(null, id)} className="flex flex-col gap-2">
                  <p className="text-sm text-muted">Press start when you begin. The time counts as labour on this job.</p>
                  <Button type="submit" size="lg">Start inspection</Button>
                </form>
              ) : (
                <p className="text-sm text-muted">{waitingRoadTest ? "Waiting for road test." : job.assigned_to ? "The inspection has not started yet." : "Waiting for the workshop manager to assign a technician."}</p>
              )
            ) : insp.status === "not_started" || insp.status === "returned" ? (
              <>
                {insp.return_reason && insp.status === "returned" ? <Notice tone="error">Sent back by the workshop manager: {insp.return_reason}</Notice> : null}
                {(insp.technician_id === staff.id || manager) && job.first_approval_at && !waitingRoadTest ? (
                  <form action={startInspection.bind(null, id)} className="flex flex-col gap-2">
                    <p className="text-sm text-muted">{insp.status === "returned" ? "Open the report again to make the changes, then submit it again." : "Press start when you begin. The time counts as labour on this job."}</p>
                    <Button type="submit" size="lg" disabled={scanGateOn && !insp.scan_read_at && !insp.scan_approved_at && insp.status !== "returned"}>{insp.status === "returned" ? "Open the report" : "Start inspection"}</Button>
                    {scanGateOn && !insp.scan_read_at && !insp.scan_approved_at && insp.status !== "returned" ? <p className="text-xs font-semibold text-amber">Step 1 first: the scan report above.</p> : null}
                  </form>
                ) : (
                  <p className="text-sm text-muted">{waitingRoadTest ? "Waiting for road test." : `Assigned to ${bundle?.technician?.display_name ?? "a technician"}.`}</p>
                )}
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                {insp.started_at ? (
                  <span>
                    Clock: <ElapsedTimer since={insp.started_at} stoppedAt={insp.submitted_at} className="text-lg font-extrabold" />
                  </span>
                ) : null}
                <span className={over ? "font-bold text-red" : "text-muted"}>
                  Working time {formatMinutes(workingMin)} of {formatMinutes(target)} target{over ? " · over target" : ""}
                </span>
                {insp.started_at ? <span className="text-muted">Started {formatDateTime(insp.started_at)}</span> : null}
                {insp.submitted_at ? <span className="text-muted">Submitted {formatDateTime(insp.submitted_at)}</span> : null}
              </div>
            )}
            {insp?.status === "submitted" ? <Notice tone="info">Submitted, waiting for the workshop manager. The report is read only unless it is sent back. You can still attach the pre-scan PDF below.</Notice> : null}
            {insp?.status === "approved" ? (
              <Notice tone="success">
                Approved by {bundle?.approver?.display_name ?? "the workshop manager"} on {formatDateTime(insp.approved_at)}.{" "}
                <Link href={`/jobs/${id}/inspection`} className="underline underline-offset-4 font-semibold">Open the report</Link>
                {ownerDirect ? " · You are the owner: edit anything below, any time; changes are logged." : locked ? " · Locked. A change needs the owner's approval; ask from the report page." : " · Open for changes until " + formatDateTime(insp.unlocked_until)}
              </Notice>
            ) : null}
          </Card>
          ) : null}
        </>
      )}

      {!loose ? <Collapsible title="Gate-in photos and videos" right={`${media.length}`}>
        <MediaGallery media={media} urls={Object.fromEntries(card.mediaUrls)} carPictureUrl={card.vehiclePhotoUrl} damageNote={gateIn?.damage_note} compact />
      </Collapsible> : null}

      {(!inWork || ownerDirect) && insp && formProps && (insp.status === "in_progress" || insp.status === "submitted" || insp.status === "approved" || ownerDirect) ? (
        <>
          <InspectionForm inspectionId={insp.id} jobId={id} {...formProps} body={body} readOnly={!canFill} quickRemarks={(settings.quick_remarks ?? []) as string[]} tyreBrands={(settings.tyre_brands ?? []) as string[]} canAddPrescan={canAddPrescan} submitAction={insp.status === "in_progress" ? submitInspection.bind(null, id) : null} limits={inspectionLimitsOf(settings)} suggestions={(settings.item_suggestions ?? {}) as Suggestions} fluidGrades={(settings.fluid_grades ?? []) as string[]} bigJobTags={(settings.big_job_tags ?? []) as string[]} initialTags={insp.big_job_tags ?? []} estimatedHours={insp.estimated_hours === null ? "" : String(insp.estimated_hours)} estimateReason={insp.estimate_reason ?? ""} scan={settings.prescan_gate_enabled ? { gate: insp.status !== "approved" && !ownerDirect, readAt: insp.scan_read_at, notPossibleReason: insp.scan_not_possible_reason, approvedAt: insp.scan_approved_at } : null} />
          {insp.status === "approved" && !locked && canFill ? (
            <Card className="flex flex-col gap-3 border-ink">
              <SectionLabel>What did you change?</SectionLabel>
              <form action={noteInspectionEdit.bind(null, id)} className="flex flex-col gap-2">
                <textarea name="note" rows={2} required spellCheck lang="en" className="w-full rounded-control border border-line-strong px-3 py-2 text-sm" placeholder="Describe the change for the record" />
                <Button type="submit" size="md">Record the change</Button>
              </form>
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}
