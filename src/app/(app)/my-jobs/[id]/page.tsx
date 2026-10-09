import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Collapsible } from "@/components/Collapsible";
import { ElapsedTimer } from "@/components/ElapsedTimer";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PriorityBadge } from "@/components/JobBadges";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { INSPECTION_STATUS_LABELS, ITEM_STATUS_LABELS, formatMinutes, type ChecklistSection, type ItemStatus, inspectionLimitsOf, toItemState } from "@/lib/inspection";
import { inspectionLocked, inspectionWorkingMinutes, loadInspection, inspectionDangerous } from "@/lib/inspection-data";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { CONDITIONS, STATUS_LABELS, formatPromised, labelOf, workingTimeOf } from "@/lib/jobs";
import { ROAD_TEST_ITEMS, ROAD_TEST_SELECT, roadTestLine, roadTestWaiting, type RoadTestRow } from "@/lib/road-test";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { MediaGallery } from "@/app/(app)/jobs/[id]/MediaGallery";
import { createAdminClient } from "@/lib/supabase/admin";
import { noteInspectionEdit, startInspection, submitInspection } from "../../jobs/inspection-actions";
import { reportAdditionalWork, setLineDone, startWork, stopWork } from "../../jobs/work-actions";
import { PAUSE_REASONS, additionalWorkLabel, latestQc, loadWork } from "@/lib/work-data";
import { InspectionForm, type Suggestions } from "./InspectionForm";
import { WorkPanel, type PanelLine } from "./WorkPanel";

export const dynamic = "force-dynamic";

const TONE: Record<ItemStatus, "green" | "amber" | "red" | "neutral"> = { good: "green", average: "amber", bad: "red", na: "neutral" };

/** The technician's screen for one car: requests first, the road test result, the inspection report; gate-in photos folded away. */
export default async function TechnicianJobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; message?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const { error, message } = await searchParams;
  const supabase = await createClient();
  const [card, bundle, settings, { data: rt }] = await Promise.all([loadJobCard(supabase, id), loadInspection(id), getSettings(), supabase.from("road_tests").select(ROAD_TEST_SELECT).eq("job_id", id).maybeSingle()]);
  if (!card) {
    // The car exists but is not this technician's: say so in plain words instead of a "page not found".
    const { data: other } = await createAdminClient().from("jobs").select("job_number, assigned_to, assignee:staff!jobs_assigned_to_fkey(display_name)").eq("id", id).maybeSingle();
    if (!other) notFound();
    const who = (other as unknown as { assignee: { display_name: string } | null }).assignee?.display_name ?? null;
    return (
      <>
        <PageHeader title={other.job_number} subtitle="This car is not on your list." />
        <Card className="flex flex-col gap-3 max-w-xl">
          <p className="text-sm">{who ? `It is assigned to ${who}. ` : "It is not assigned to anyone yet. "}Ask the workshop manager if it should be yours.</p>
          <div><LinkButton href="/my-jobs" size="md">Back to my jobs</LinkButton></div>
        </Card>
      </>
    );
  }
  const { job, vehicle, customer, vip, gateIn, requests, media } = card;
  const roadTest = (rt as RoadTestRow | null) ?? null;
  const mine = job.assigned_to === staff.id;
  const manager = can(role, "approveInspections");
  // Technicians open only their own cars; office roles may look.
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
  const waitingRoadTest = roadTestWaiting(roadTest) && role !== "owner";
  const canFill = !!insp && ((mine && insp.technician_id === staff.id) || manager) && (insp.status === "in_progress" || insp.status === "returned" || (insp.status === "approved" && !locked));
  const canAddPrescan = !!insp && mine && insp.technician_id === staff.id && insp.status === "submitted";
  const condition = gateIn ? labelOf(CONDITIONS, gateIn.condition) : "";
  const statusText = insp?.status === "submitted" ? "Submitted, waiting for manager" : waitingRoadTest ? "Waiting for road test" : STATUS_LABELS[job.status];
  // The work order, once the car is in Work (or back from a failed QC).
  const work = job.status === "in_work" || job.status === "pending_qc" ? await loadWork(id) : null;
  const qc = work ? await latestQc(id) : null;
  const qcFailed = qc && qc.status === "failed" && job.status === "in_work" ? { round: qc.round, items: qc.items.filter((i) => i.result === "fail").map((i) => ({ label: i.label, remark: i.remark })) } : null;
  const panelLines: PanelLine[] = work ? work.lines.map((l) => ({ id: l.id, title: l.title, details: l.details, hours_quoted: l.hours_quoted, status: l.status, notes: l.notes, mine: l.assigned_to === staff.id || (!l.assigned_to && mine), assignedName: l.assigned_to ? (work.names.get(l.assigned_to) ?? null) : null, photos: work.files.filter((f) => f.kind === "work_photo" && f.ref_id === l.id).map((f) => ({ id: f.id, path: f.storage_path, url: work.fileUrls[f.storage_path] ?? null })) })) : [];
  const runningSession = work?.sessions.find((s) => s.technician_id === staff.id && !s.ended_at) ?? null;
  const myMinutes = work?.minutesByTechnician.get(staff.id) ?? 0;
  const reminders = [gateIn?.dash_cam ? "Disconnect the dash cam before you start." : "", gateIn?.old_parts_return ? "Keep the old parts: the customer asked for them." : ""].filter(Boolean);

  const formProps = insp && bundle
    ? {
        checklist: insp.checklist as ChecklistSection[],
        items: bundle.items.map(toItemState),
        findings: requests.map((r) => {
          const f = bundle.findings.find((x) => x.job_request_id === r.id);
          return { requestId: r.id, text: r.text, found: f?.found ?? "", needs: f?.needs ?? "", status: (f?.status as ItemStatus | null) ?? null };
        }),
        measurements: Object.fromEntries(Object.entries(insp.measurements ?? {}).map(([k, v]) => [k, String(v)])),
        files: bundle.media.filter((m) => !m.item_key?.startsWith("road.")).map((m) => ({ id: m.id, kind: m.kind, url: bundle.mediaUrls[m.storage_path] ?? null, caption: m.caption, isPrescan: m.is_prescan, itemKey: m.item_key, requestId: m.job_request_id })),
        notes: insp.technician_notes ?? "",
        prescanVisible: insp.show_prescan_to_customer,
      }
    : null;

  return (
    <>
      <LiveRefresh tables={["jobs", "inspections", "road_tests"]} jobId={id} pollMs={60000} />
      <PageHeader
        title={formatPlate(vehicle)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{vehicleTitle(vehicle)}</span>
            <span>· {job.job_number}</span>
            {isVip ? <Badge tone="ink">VIP</Badge> : null}
            <PriorityBadge priority={job.priority} />
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
      {gateIn?.dash_cam ? <Notice tone="error">Dash cam fitted: disconnect before starting work.</Notice> : null}
      {isVip && vipNote ? (
        <Card className="border-ink flex flex-col gap-1">
          <SectionLabel>VIP handling note</SectionLabel>
          <p className="text-[15px] font-medium whitespace-pre-wrap">{vipNote}</p>
        </Card>
      ) : null}

      {roadTest && job.department !== "bodyshop" ? (
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
            </ul>
          ) : roadTest.status === "not_possible" ? (
            <p className="text-sm">Not possible: {roadTest.not_possible_reason ?? roadTest.decision_note}</p>
          ) : roadTest.decision === "not_needed" ? (
            <p className="text-sm">The workshop manager decided no road test is needed{roadTest.decision_note ? `: ${roadTest.decision_note}` : "."}</p>
          ) : (
            <p className="text-sm text-muted">Not done yet. It does not hold up your inspection.</p>
          )}
        </Card>
      ) : null}

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

      {work && job.status === "in_work" ? (
        <WorkPanel
          jobId={id}
          lines={panelLines}
          findings={work.additional.map((a) => ({ id: a.id, remark: a.remark, parts_needed: a.parts_needed, status: a.status, decision_note: a.decision_note, label: additionalWorkLabel(a).text, tone: additionalWorkLabel(a).tone }))}
          running={runningSession ? { since: runningSession.started_at } : null}
          myMinutes={myMinutes}
          reminders={reminders}
          pauseReasons={PAUSE_REASONS}
          canWork={mine && role === "technician" && !staff.viewingAs}
          qcFailed={qcFailed}
          startAction={startWork.bind(null, id)}
          stopAction={stopWork.bind(null, id)}
          doneAction={setLineDone}
          reportAction={reportAdditionalWork.bind(null, id)}
        />
      ) : null}
      {job.status === "pending_qc" ? <Notice tone="info">Work complete. The car is with QC; you will be told if anything comes back.</Notice> : null}

      <Card className={`flex flex-col gap-4 ${over && insp?.status === "in_progress" ? "border-red-bar" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>Inspection</SectionLabel>
          {insp ? <Badge tone={insp.status === "approved" ? "green" : insp.status === "returned" ? "red" : insp.status === "submitted" ? "amber" : "outline"}>{INSPECTION_STATUS_LABELS[insp.status]}</Badge> : null}
        </div>
        {!job.first_approval_at ? <Notice tone="info">The customer has not yet approved the job card. The inspection starts after that.</Notice> : null}
        {!insp ? (
          mine && job.first_approval_at && !waitingRoadTest ? (
            <form action={startInspection.bind(null, id)} className="flex flex-col gap-2">
              <p className="text-sm text-muted">Press start when you begin. The time counts as labour on this job.</p>
              <Button type="submit" size="lg">
                Start inspection
              </Button>
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
                <Button type="submit" size="lg">
                  {insp.status === "returned" ? "Open the report" : "Start inspection"}
                </Button>
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
            <Link href={`/jobs/${id}/inspection`} className="underline underline-offset-4 font-semibold">
              Open the report
            </Link>
            {locked ? " · Locked. A change needs the owner's approval; ask from the report page." : " · Open for changes until " + formatDateTime(insp.unlocked_until)}
          </Notice>
        ) : null}
      </Card>

      <Collapsible title="Gate-in photos and videos" right={`${media.length}`}>
        <MediaGallery media={media} urls={Object.fromEntries(card.mediaUrls)} carPictureUrl={card.vehiclePhotoUrl} damageNote={gateIn?.damage_note} compact />
      </Collapsible>

      {insp && formProps && (insp.status === "in_progress" || insp.status === "submitted" || insp.status === "approved") ? (
        <>
          <InspectionForm inspectionId={insp.id} jobId={id} {...formProps} readOnly={!canFill} canAddPrescan={canAddPrescan} submitAction={insp.status === "in_progress" ? submitInspection.bind(null, id) : null} limits={inspectionLimitsOf(settings)} suggestions={(settings.item_suggestions ?? {}) as Suggestions} fluidGrades={(settings.fluid_grades ?? []) as string[]} bigJobTags={(settings.big_job_tags ?? []) as string[]} initialTags={insp.big_job_tags ?? []} estimatedHours={insp.estimated_hours === null ? "" : String(insp.estimated_hours)} estimateReason={insp.estimate_reason ?? ""} scan={settings.prescan_gate_enabled ? { gate: true, readAt: insp.scan_read_at, notPossibleReason: insp.scan_not_possible_reason, approvedAt: insp.scan_approved_at } : null} />
          {insp.status === "approved" && !locked && canFill ? (
            <Card className="flex flex-col gap-3 border-ink">
              <SectionLabel>What did you change?</SectionLabel>
              <form action={noteInspectionEdit.bind(null, id)} className="flex flex-col gap-2">
                <textarea name="note" rows={2} required spellCheck lang="en" className="w-full rounded-control border border-line-strong px-3 py-2 text-sm" placeholder="Describe the change for the record" />
                <Button type="submit" size="md">
                  Record the change
                </Button>
              </form>
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}
