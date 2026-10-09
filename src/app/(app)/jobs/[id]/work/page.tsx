import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel, Select, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { jobConcernsSide, sideOfDepartment } from "@/lib/inspection";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { STATUS_LABELS } from "@/lib/jobs";
import { jobPartsState } from "@/lib/parts-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { additionalWorkLabel, latestQc, loadWork, sessionMinutes } from "@/lib/work-data";
import { activeTechnicians } from "@/lib/work-flow";
import { putTechnicianOnCar } from "../../planning-actions";
import { confirmWorkComplete, decideAdditionalWork, decidePause, sendWorkBack } from "../../work-actions";
import { BudgetTimer } from "@/app/(app)/my-jobs/[id]/WorkPanel";

export const dynamic = "force-dynamic";

const fmt = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")} min`;
type PauseRow = { id: string; technician_id: string; reason: string; started_at: string; ended_at: string | null; minutes: number | string | null; accepted: boolean; rejected_by: string | null; note: string | null };

/**
 * The workshop manager's work order: who is on the car and their hours, the time budget, the approved
 * lines (no prices), the parts, additional work found, the pause log, and "Confirmed, send to QC" or
 * "Not done, send back" once the technician presses Job finished.
 */
export default async function WorkOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("viewWorkOrders");
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const { message, error } = await searchParams;
  const supabase = await createClient();
  const admin = createAdminClient();
  const [card, work, parts, settings, qc, techs, { data: pauseRows }, { data: techRows }] = await Promise.all([
    loadJobCard(supabase, id),
    loadWork(id),
    jobPartsState(id),
    getSettings(),
    latestQc(id),
    activeTechnicians(id),
    admin.from("work_pauses").select("id, technician_id, reason, started_at, ended_at, minutes, accepted, rejected_by, note").eq("job_id", id).eq("is_active", true).order("started_at", { ascending: false }),
    admin.from("staff").select("id, display_name, department_id").eq("role_id", "technician").eq("is_active", true).order("display_name"),
  ]);
  if (!card) notFound();
  const { job, vehicle, gateIn } = card;
  const qcFailed = qc && qc.status === "failed" && job.status === "in_work" ? qc : null;
  const manages = role === "owner" || (role === "workshop_manager" && jobConcernsSide(job.department, sideOfDepartment(staff.department_id)));
  const canEdit = manages && can(role, "manageWork") && !staff.viewingAs && job.is_open;
  const technicians = (techRows ?? []).filter((t) => !sideOfDepartment(t.department_id) || jobConcernsSide(job.department, sideOfDepartment(t.department_id)));
  const nameOf = new Map((techRows ?? []).map((t) => [t.id, t.display_name]));
  const seesCost = role === "owner" || role === "accounts";
  const rate = Number(settings.technician_cost_rate_aed) || 0;
  const pending = work.additional.filter((a) => a.status === "pending");
  const running = work.sessions.filter((s) => !s.ended_at);
  const minutesUsed = work.sessions.filter((s) => s.ended_at).reduce((a, s) => a + sessionMinutes(s), 0);
  const pauses = (pauseRows ?? []) as PauseRow[];
  // eslint-disable-next-line react-hooks/purity -- a server page: rendered once per request, the clock is read once
  const nowMs = Date.now();
  const pauseMinutes = (p: PauseRow) => (p.minutes !== null ? Number(p.minutes) : p.ended_at ? 0 : Math.round((nowMs - Date.parse(p.started_at)) / 60000));
  const unhanded = parts.needed.filter((p) => p.issue_status !== "confirmed");
  const blockers = [...(unhanded.length ? [`${unhanded.length} part${unhanded.length === 1 ? "" : "s"} not handed to the technician`] : []), ...(pending.length ? ["additional work waiting for your decision"] : [])];
  const inPlanning = ["approved", "waiting_parts"].includes(job.status);

  return (
    <>
      <LiveRefresh tables={["work_lines", "work_sessions", "additional_work", "jobs", "job_technicians", "work_pauses"]} jobId={id} pollMs={60000} />
      <PageHeader
        title={`Work order · ${formatPlate(vehicle)}`}
        subtitle={`${vehicleTitle(vehicle)} · ${job.job_number} · ${STATUS_LABELS[job.status]}`}
        actions={<><LinkButton href={`/jobs/${id}`} tone="secondary" size="lg">Job card</LinkButton>{job.status === "pending_qc" ? <LinkButton href={`/qc/${id}`} tone="secondary" size="lg">QC</LinkButton> : null}</>}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {gateIn?.dash_cam ? <Notice tone="error">Dash cam fitted: disconnect before work, reconnect before release.</Notice> : null}
      {gateIn?.old_parts_return ? <Notice tone="info">The customer asked for the old parts. Keep them.</Notice> : null}
      {qcFailed ? (
        <Card className="border-red-bar flex flex-col gap-2">
          <SectionLabel right={`round ${qcFailed.round} · rework ${job.rework_count}`}>QC failed: back in Work</SectionLabel>
          <ul className="flex flex-col gap-1 text-sm">
            {qcFailed.items.filter((i) => i.result === "fail").map((i) => (
              <li key={i.key}><span className="font-bold">{i.label}</span>{i.remark ? <span className="text-muted"> · {i.remark}</span> : null}</li>
            ))}
          </ul>
          <p className="text-xs text-muted">The technician fixes these and presses Job finished again; you confirm; QC rechecks only the failed items.</p>
        </Card>
      ) : null}
      {inPlanning ? (
        <Card className="flex flex-col gap-3 border-ink">
          <SectionLabel>Not released yet</SectionLabel>
          <p className="text-sm">The car is in planning. The work order opens for the technicians when you release it from the Planning card on the job card: pick the start day and tick the technicians.</p>
          <div><LinkButton href={`/jobs/${id}#planning`} size="md">Go to planning</LinkButton></div>
        </Card>
      ) : null}
      {!inPlanning && job.status !== "in_work" && job.status !== "pending_qc" ? <Notice tone="info">Now: {STATUS_LABELS[job.status]}. {job.status === "pending_wash" ? "QC is passed; the advisor sends the car to the wash." : ""}</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          {job.status === "in_work" && canEdit ? (
            <Card className={`flex flex-col gap-3 ${job.work_done_at ? "border-green" : "border-line"}`}>
              <SectionLabel>{job.work_done_at ? `Job finished ${formatDateTime(job.work_done_at)}: confirm it` : "Work complete"}</SectionLabel>
              {job.work_done_at ? <p className="text-sm">The technician{techs.length > 1 ? "s say" : " says"} all work on this car is done. Check the car, then confirm, or send it back with a note the technician sees on top.</p> : <p className="text-sm text-muted">The technician presses Job finished on the tablet; you confirm here. You can also confirm now if you checked the car yourself.</p>}
              {blockers.length ? <p className="text-sm text-red font-semibold">Not possible yet: {blockers.join("; ")}.</p> : null}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <form action={confirmWorkComplete.bind(null, id)} className="sm:flex-1"><Button type="submit" size="lg" className="w-full" disabled={blockers.length > 0}>Confirmed, send to QC</Button></form>
                <form action={sendWorkBack.bind(null, id)} className="sm:flex-1 flex flex-col gap-2">
                  <Textarea name="note" rows={2} required placeholder="What is not done (the technician sees this on top)" />
                  <Button type="submit" tone="secondary" size="lg" className="w-full">Not done, send back</Button>
                </form>
              </div>
              {job.work_sendbacks ? <p className="text-xs text-muted">Sent back {job.work_sendbacks} time{job.work_sendbacks === 1 ? "" : "s"} on this car.</p> : null}
            </Card>
          ) : null}

          <Card className="flex flex-col gap-3">
            <SectionLabel right={`${work.hoursQuoted.toFixed(1)} h charged`}>Approved work</SectionLabel>
            {work.lines.length === 0 ? <p className="text-sm text-muted">No work lines yet.</p> : null}
            <ol className="divide-y divide-line">
              {work.lines.map((l, i) => (
                <li key={l.id} className="py-2 flex gap-3 items-start">
                  <span className="w-6 shrink-0 text-muted font-semibold">{i + 1}.</span>
                  <span className="flex-1 min-w-0">
                    <span className="font-semibold">{l.title}</span>
                    {l.details ? <span className="block text-xs text-muted">{l.details}</span> : null}
                    {l.source === "additional" ? <span className="block text-xs text-muted">Additional work</span> : null}
                  </span>
                  <span className="text-xs text-muted whitespace-nowrap">{l.hours_quoted !== null ? `${l.hours_quoted.toFixed(1)} h` : ""}</span>
                  <Badge tone={l.status === "done" ? "green" : l.status === "in_progress" ? "amber" : "neutral"}>{l.status === "done" ? "Done" : l.status === "in_progress" ? "In progress" : "To do"}</Badge>
                </li>
              ))}
            </ol>
          </Card>

          <Card className={`flex flex-col gap-3 ${pending.length ? "border-ink" : ""}`}>
            <SectionLabel right={`${pending.length} waiting`}>Additional work found</SectionLabel>
            {work.additional.length === 0 ? <p className="text-sm text-muted">Nothing flagged by the technician.</p> : null}
            {work.additional.map((a) => (
              <div key={a.id} className={`rounded-control border p-3 flex flex-col gap-2 ${a.status === "pending" ? "border-ink" : "border-line"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={a.status === "pending" ? "amber" : additionalWorkLabel(a).tone}>{a.status === "pending" ? "Waiting for your decision" : additionalWorkLabel(a).text}</Badge>
                  <span className="text-xs text-muted">{a.technician_id ? work.names.get(a.technician_id) : ""} · {formatDateTime(a.created_at)}</span>
                </div>
                <p className="text-sm font-semibold">{a.remark}</p>
                {a.parts_needed ? <p className="text-sm">Parts needed: {a.parts_needed}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {work.files.filter((f) => f.kind === "additional_work" && f.ref_id === a.id).map((f) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <a key={f.id} href={work.fileUrls[f.storage_path] ?? "#"} target="_blank" rel="noreferrer"><img src={work.fileUrls[f.storage_path] ?? ""} alt="Photo" className="h-20 w-20 rounded-control object-cover bg-chip" /></a>
                  ))}
                </div>
                {a.decision_note ? <p className="text-xs text-muted">Decision: {a.decision_note}</p> : null}
                {a.quotation_id && can(role, "viewQuotes") ? <LinkButton href={`/jobs/${id}/quote/${a.quotation_id}`} tone="secondary" size="md">Open the additional quotation</LinkButton> : null}
                {a.status === "pending" && canEdit ? (
                  <form action={decideAdditionalWork.bind(null, a.id)} className="flex flex-col gap-2">
                    <Textarea name="note" rows={1} placeholder="Note for the advisor or the technician (optional)" />
                    <div className="flex gap-2">
                      <Button type="submit" name="decision" value="approve" size="md">Send to the advisor to quote</Button>
                      <Button type="submit" name="decision" value="refuse" tone="secondary" size="md">Dismiss</Button>
                    </div>
                  </form>
                ) : null}
              </div>
            ))}
          </Card>

          <Card className="flex flex-col gap-2">
            <SectionLabel right={pauses.length ? `${pauses.length} · ${fmt(pauses.reduce((a, p) => a + pauseMinutes(p), 0))}` : undefined}>Pauses on this car</SectionLabel>
            {pauses.length === 0 ? <p className="text-sm text-muted">No pauses.</p> : null}
            <ul className="divide-y divide-line text-sm">
              {pauses.map((p) => (
                <li key={p.id} className={`py-2 flex flex-wrap items-center gap-3 ${p.accepted === false ? "text-red" : ""}`}>
                  <span className="font-semibold w-32">{nameOf.get(p.technician_id) ?? work.names.get(p.technician_id) ?? "Technician"}</span>
                  <span>{p.reason}</span>
                  <span className="text-muted">{formatDateTime(p.started_at)} · {p.ended_at ? fmt(pauseMinutes(p)) : "still paused"}</span>
                  {p.accepted === false ? <Badge tone="red">Not accepted</Badge> : null}
                  {canEdit ? (
                    <form action={decidePause.bind(null, p.id)} className="ml-auto">
                      <input type="hidden" name="return_to" value={`/jobs/${id}/work`} />
                      {p.accepted === false ? <Button type="submit" name="accepted" value="yes" tone="ghost" size="md">Accept after all</Button> : <Button type="submit" name="accepted" value="no" tone="ghost" size="md">Not accepted</Button>}
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
            {canEdit ? <p className="text-xs text-muted">Every technician&apos;s pauses by day: <a href="/pauses" className="underline underline-offset-4 font-semibold">Pause log</a>.</p> : null}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2">
            <SectionLabel>Time budget</SectionLabel>
            <BudgetTimer hoursCharged={work.hoursQuoted} minutesUsed={minutesUsed} running={running.map((s) => ({ since: s.started_at, name: work.names.get(s.technician_id) ?? "Technician", mine: false }))} locked={!!job.work_done_at} />
            <ul className="text-sm divide-y divide-line">
              {Array.from(work.minutesByTechnician.entries()).map(([tid, min]) => (
                <li key={tid} className="py-1.5 flex justify-between"><span>{work.names.get(tid) ?? "Technician"}</span><span className="font-semibold">{fmt(min)}{seesCost ? ` · AED ${((min / 60) * rate).toFixed(0)}` : ""}</span></li>
              ))}
            </ul>
          </Card>
          <Card className="flex flex-col gap-2">
            <SectionLabel right={`${techs.length}`}>On the car</SectionLabel>
            {techs.length === 0 ? <p className="text-sm text-muted">Nobody yet.</p> : null}
            <ul className="text-sm divide-y divide-line">
              {techs.map((t) => (
                <li key={t.id} className="py-1.5 flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{nameOf.get(t.staff_id) ?? work.names.get(t.staff_id) ?? "Technician"}</span>
                  {running.some((s) => s.technician_id === t.staff_id) ? <Badge tone="green">Working</Badge> : t.done_at ? <Badge tone="ink">Done</Badge> : <Badge tone="neutral">Paused</Badge>}
                </li>
              ))}
            </ul>
            {canEdit && job.is_open && (job.status === "in_work" || job.status === "pending_qc") ? (
              <form action={putTechnicianOnCar.bind(null, id)} className="flex items-center gap-2 border-t border-line pt-2">
                <Select name="technician" defaultValue="" required className="flex-1">
                  <option value="" disabled>Put a technician on the car…</option>
                  {technicians.filter((t) => !techs.some((x) => x.staff_id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
                </Select>
                <Button type="submit" tone="secondary" size="md">Add</Button>
              </form>
            ) : null}
          </Card>
          <Card className="flex flex-col gap-2">
            <SectionLabel>Parts on this car</SectionLabel>
            {parts.needed.length === 0 ? <p className="text-sm text-muted">No parts needed.</p> : (
              <ul className="text-sm divide-y divide-line">
                {parts.needed.map((p) => (
                  <li key={p.id} className="py-1.5 flex flex-wrap items-center gap-2"><span className="font-semibold">{p.description}</span><Badge tone={p.issue_status === "confirmed" ? "green" : p.order_status === "received" ? "amber" : "neutral"}>{p.issue_status === "confirmed" ? "Handed over" : p.order_status === "received" ? "Here, not handed over" : p.expected_date ?? p.delivery_date ? `Coming ${p.expected_date ?? p.delivery_date}` : "Not here yet"}</Badge></li>
                ))}
              </ul>
            )}
            {unhanded.length && can(role, "managePurchaseOrders") ? <LinkButton href={`/parts/handover/${id}`} tone="secondary" size="md">Hand over the parts</LinkButton> : null}
          </Card>
        </div>
      </div>
    </>
  );
}
