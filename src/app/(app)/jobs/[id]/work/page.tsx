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
import { assignWorkLines, confirmWorkComplete, decideAdditionalWork } from "../../work-actions";

export const dynamic = "force-dynamic";

const fmt = (min: number) => `${Math.floor(min / 60)} h ${min % 60} min`;

/** The workshop manager's work order: the approved lines with hours and no prices, who does what, the clock against the quote, additional work, and "work complete". */
export default async function WorkOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("viewWorkOrders");
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const { message, error } = await searchParams;
  const supabase = await createClient();
  const [card, work, parts, settings, qc] = await Promise.all([loadJobCard(supabase, id), loadWork(id), jobPartsState(id), getSettings(), latestQc(id)]);
  if (!card) notFound();
  const qcFailed = qc && qc.status === "failed" ? qc : null;
  const { job, vehicle, gateIn } = card;
  const manages = role === "owner" || (role === "workshop_manager" && jobConcernsSide(job.department, sideOfDepartment(staff.department_id)));
  const canEdit = manages && can(role, "manageWork") && !staff.viewingAs && job.is_open;
  const { data: techs } = await createAdminClient().from("staff").select("id, display_name, department_id").eq("role_id", "technician").eq("is_active", true).order("display_name");
  const technicians = (techs ?? []).filter((t) => !sideOfDepartment(t.department_id) || jobConcernsSide(job.department, sideOfDepartment(t.department_id)));
  const seesCost = role === "owner" || role === "accounts";
  const rate = Number(settings.technician_cost_rate_aed) || 0;
  const pending = work.additional.filter((a) => a.status === "pending");
  const undone = work.lines.filter((l) => l.status !== "done");
  const running = work.sessions.filter((s) => !s.ended_at);
  const blockers = [
    ...(undone.length ? [`${undone.length} line${undone.length === 1 ? "" : "s"} not done`] : []),
    ...(parts.needed.some((p) => p.issue_status !== "confirmed") ? ["issued parts not confirmed by the technician"] : []),
    ...(pending.length ? ["additional work waiting for a decision"] : []),
  ];

  return (
    <>
      <LiveRefresh tables={["work_lines", "work_sessions", "additional_work", "jobs"]} jobId={id} pollMs={60000} />
      <PageHeader
        title={`Work order · ${formatPlate(vehicle)}`}
        subtitle={`${vehicleTitle(vehicle)} · ${job.job_number} · ${STATUS_LABELS[job.status]}`}
        actions={<><LinkButton href={`/jobs/${id}`} tone="secondary" size="lg">Job card</LinkButton>{job.status === "pending_qc" ? <LinkButton href={`/qc/${id}`} tone="secondary" size="lg">QC</LinkButton> : null}</>}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {gateIn?.dash_cam ? <Notice tone="error">Dash cam fitted: disconnect before work, reconnect before release.</Notice> : null}
      {gateIn?.old_parts_return ? <Notice tone="info">The customer asked for the old parts. Keep them.</Notice> : null}
      {qcFailed && job.status === "in_work" ? (
        <Card className="border-red-bar flex flex-col gap-2">
          <SectionLabel right={`round ${qcFailed.round} · rework ${job.rework_count}`}>QC failed: back in Work</SectionLabel>
          <ul className="flex flex-col gap-1 text-sm">
            {qcFailed.items.filter((i) => i.result === "fail").map((i) => (
              <li key={i.key}><span className="font-bold">{i.label}</span>{i.remark ? <span className="text-muted"> · {i.remark}</span> : null}</li>
            ))}
          </ul>
          <p className="text-xs text-muted">When the technician has fixed these, confirm work complete again: QC rechecks only the failed items.</p>
        </Card>
      ) : null}
      {job.status !== "in_work" && job.status !== "pending_qc" ? <Notice tone="info">The work order opens when the quotation is approved and the parts are issued (or none are needed). Now: {STATUS_LABELS[job.status]}{parts.needed.length ? ` · parts issued ${parts.confirmed.length} of ${parts.needed.length}` : ""}.</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <SectionLabel right={`${work.lines.filter((l) => l.status === "done").length} of ${work.lines.length} done · ${work.hoursQuoted.toFixed(1)} h quoted`}>Approved work</SectionLabel>
            {work.lines.length === 0 ? <p className="text-sm text-muted">No work lines yet.</p> : null}
            <form action={assignWorkLines.bind(null, id)} className="flex flex-col gap-2">
              <ul className="divide-y divide-line">
                {work.lines.map((l) => (
                  <li key={l.id} className="py-2 flex flex-wrap items-center gap-3">
                    <Badge tone={l.status === "done" ? "green" : l.status === "in_progress" ? "amber" : "neutral"}>{l.status === "done" ? "Done" : l.status === "in_progress" ? "In progress" : "To do"}</Badge>
                    <span className="flex-1 min-w-56">
                      <span className="font-semibold">{l.title}</span>
                      {l.details ? <span className="block text-xs text-muted">{l.details}</span> : null}
                      {l.notes ? <span className="block text-xs">Technician: {l.notes}</span> : null}
                      {l.source === "additional" ? <span className="block text-xs text-muted">Additional work</span> : null}
                    </span>
                    <span className="text-xs text-muted w-16 text-right">{l.hours_quoted !== null ? `${l.hours_quoted.toFixed(1)} h` : ""}</span>
                    {canEdit ? (
                      <Select name={`assign__${l.id}`} defaultValue={l.assigned_to ?? ""} className="w-44">
                        <option value="">Not assigned</option>
                        {technicians.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
                      </Select>
                    ) : (
                      <span className="text-sm font-semibold w-44">{l.assigned_to ? (work.names.get(l.assigned_to) ?? "") : "Not assigned"}</span>
                    )}
                    {l.done_at ? <span className="text-xs text-muted">done {formatDateTime(l.done_at)}{l.done_by ? ` by ${work.names.get(l.done_by) ?? ""}` : ""}</span> : null}
                  </li>
                ))}
              </ul>
              {canEdit && work.lines.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Select name="assign_all" defaultValue="" className="w-56">
                    <option value="">Assign all lines to…</option>
                    {technicians.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
                  </Select>
                  <Button type="submit" size="md">Save assignments</Button>
                </div>
              ) : null}
            </form>
            {work.files.length ? (
              <div className="flex flex-wrap gap-2">
                {work.files.filter((f) => f.kind === "work_photo").map((f) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={f.id} href={work.fileUrls[f.storage_path] ?? "#"} target="_blank" rel="noreferrer"><img src={work.fileUrls[f.storage_path] ?? ""} alt="Work photo" className="h-20 w-20 rounded-control object-cover bg-chip" /></a>
                ))}
              </div>
            ) : null}
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
                {a.quotation_id ? <LinkButton href={`/jobs/${id}/quote/${a.quotation_id}`} tone="secondary" size="md">Open the additional quotation</LinkButton> : null}
                {a.status === "pending" && canEdit ? (
                  <form action={decideAdditionalWork.bind(null, a.id)} className="flex flex-col gap-2">
                    <Textarea name="note" rows={2} placeholder="Note for the advisor or the technician (optional)" />
                    <div className="flex gap-2">
                      <Button type="submit" name="decision" value="approve" size="md">Approve: send to the advisor to quote</Button>
                      <Button type="submit" name="decision" value="refuse" tone="secondary" size="md">Refuse</Button>
                    </div>
                  </form>
                ) : null}
              </div>
            ))}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2">
            <SectionLabel>Clock against the quote</SectionLabel>
            <p className="text-2xl font-extrabold">{fmt(work.minutesTotal)} <span className="text-sm font-semibold text-muted">of {work.hoursQuoted.toFixed(1)} h quoted</span></p>
            {running.length ? <Badge tone="amber">Running: {running.map((s) => work.names.get(s.technician_id)).join(", ")}</Badge> : null}
            <ul className="text-sm divide-y divide-line">
              {Array.from(work.minutesByTechnician.entries()).map(([tid, min]) => (
                <li key={tid} className="py-1.5 flex justify-between"><span>{work.names.get(tid) ?? "Technician"}</span><span className="font-semibold">{fmt(min)}{seesCost ? ` · AED ${((min / 60) * rate).toFixed(0)}` : ""}</span></li>
              ))}
            </ul>
            {work.sessions.length ? (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer font-semibold">Sessions</summary>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {work.sessions.map((s) => (
                    <li key={s.id}>{formatDateTime(s.started_at)} · {work.names.get(s.technician_id)} · {sessionMinutes(s)} min{s.end_reason === "pause" ? ` · paused: ${s.pause_reason}` : s.ended_at ? "" : " · running"}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>
          <Card className="flex flex-col gap-2">
            <SectionLabel>Parts on this car</SectionLabel>
            {parts.needed.length === 0 ? <p className="text-sm text-muted">No parts needed.</p> : (
              <ul className="text-sm divide-y divide-line">
                {parts.needed.map((p) => (
                  <li key={p.id} className="py-1.5 flex flex-wrap items-center gap-2"><span className="font-semibold">{p.description}</span><Badge tone={p.issue_status === "confirmed" ? "green" : "amber"}>{p.issue_status === "confirmed" ? "Issued, confirmed" : "Not issued"}</Badge></li>
                ))}
              </ul>
            )}
          </Card>
          {job.status === "in_work" && canEdit ? (
            <Card className={`flex flex-col gap-2 ${blockers.length ? "" : "border-ink"}`}>
              <SectionLabel>Work complete</SectionLabel>
              {blockers.length ? <p className="text-sm text-red font-semibold">Not possible yet: {blockers.join("; ")}.</p> : <p className="text-sm text-muted">Every line is done and every part confirmed. The car goes to QC.</p>}
              <form action={confirmWorkComplete.bind(null, id)}>
                <Button type="submit" size="lg" className="w-full" disabled={blockers.length > 0}>Confirm work complete, send to QC</Button>
              </form>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
