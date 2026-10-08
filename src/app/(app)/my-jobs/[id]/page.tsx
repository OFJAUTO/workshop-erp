import Link from "next/link";
import { notFound } from "next/navigation";
import { ElapsedTimer } from "@/components/ElapsedTimer";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PriorityBadge } from "@/components/JobBadges";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { INSPECTION_STATUS_LABELS, formatMinutes, type ChecklistSection, type ItemStatus } from "@/lib/inspection";
import { inspectionLocked, inspectionWorkingMinutes, loadInspection } from "@/lib/inspection-data";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { STATUS_LABELS, workingTimeOf } from "@/lib/jobs";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { MediaGallery } from "@/app/(app)/jobs/[id]/MediaGallery";
import { noteInspectionEdit, startInspection, submitInspection } from "../../jobs/inspection-actions";
import { InspectionForm } from "./InspectionForm";

export const dynamic = "force-dynamic";

/** The technician's screen for one car: what the customer asked, warnings, gate-in photos, and the inspection report. */
export default async function TechnicianJobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; message?: string }> }) {
  const staff = await requirePermission("viewJobs");
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const { error, message } = await searchParams;
  const supabase = await createClient();
  const [card, bundle, settings] = await Promise.all([loadJobCard(supabase, id), loadInspection(id), getSettings()]);
  if (!card) notFound();
  const { job, vehicle, customer, vip, gateIn, requests, media } = card;
  const isVip = customer?.is_vip ?? vip?.is_vip ?? false;
  const vipNote = customer?.vip_note ?? vip?.vip_note ?? null;
  const mine = job.assigned_to === staff.id;
  const manager = can(role, "approveInspections");
  const insp = bundle?.inspection ?? null;
  const wt = workingTimeOf(settings);
  const workingMin = insp ? inspectionWorkingMinutes(insp, wt) : 0;
  const target = insp?.target_minutes ?? (Number(settings.inspection_target_minutes) || 90);
  const over = insp?.started_at && workingMin > target;
  const locked = insp ? inspectionLocked(insp) : false;
  const canFill = insp && ((mine && insp.technician_id === staff.id) || manager) && (insp.status === "in_progress" || insp.status === "returned" || (insp.status === "approved" && !locked));

  const formProps = insp && bundle
    ? {
        checklist: insp.checklist as ChecklistSection[],
        items: bundle.items.map((i) => ({ key: i.item_key, label: i.item_label, sectionKey: i.section_key, status: i.status as ItemStatus | null, remarks: i.remarks ?? "", parts_needed: i.parts_needed ?? "", labour_hours: i.labour_hours != null ? String(i.labour_hours) : "" })),
        findings: requests.map((r) => {
          const f = bundle.findings.find((x) => x.job_request_id === r.id);
          return { requestId: r.id, text: r.text, found: f?.found ?? "", needs: f?.needs ?? "", status: (f?.status as ItemStatus | null) ?? null };
        }),
        measurements: Object.fromEntries(Object.entries(insp.measurements ?? {}).map(([k, v]) => [k, String(v)])),
        files: bundle.media.map((m) => ({ id: m.id, kind: m.kind, url: bundle.mediaUrls[m.storage_path] ?? null, caption: m.caption, isPrescan: m.is_prescan, itemKey: m.item_key, requestId: m.job_request_id })),
        notes: insp.technician_notes ?? "",
      }
    : null;

  return (
    <>
      <LiveRefresh tables={["jobs", "inspections"]} jobId={id} pollMs={60000} />
      <PageHeader
        title={formatPlate(vehicle)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{vehicleTitle(vehicle)}</span>
            <span>· {job.job_number}</span>
            {isVip ? <Badge tone="ink">VIP</Badge> : null}
            <PriorityBadge priority={job.priority} />
            <Badge tone="outline">{STATUS_LABELS[job.status]}</Badge>
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="flex flex-col gap-3">
          <SectionLabel right={`${requests.length}`}>Customer requests</SectionLabel>
          {requests.length ? (
            <ol className="list-decimal pl-5 flex flex-col gap-1 text-[15px] font-medium">
              {requests.map((r) => (
                <li key={r.id}>{r.text}</li>
              ))}
            </ol>
          ) : (
            <p className="text-sm whitespace-pre-wrap">{gateIn?.customer_requests}</p>
          )}
        </Card>
        <Card className="xl:col-span-2 flex flex-col gap-3">
          <SectionLabel right={`${media.length}`}>Gate-in photos and videos</SectionLabel>
          <MediaGallery media={media} urls={Object.fromEntries(card.mediaUrls)} carPictureUrl={card.vehiclePhotoUrl} damageNote={gateIn?.damage_note} compact />
        </Card>
      </div>

      <Card className={`flex flex-col gap-4 ${over && insp?.status === "in_progress" ? "border-red-bar" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>Inspection</SectionLabel>
          {insp ? <Badge tone={insp.status === "approved" ? "green" : insp.status === "returned" ? "red" : insp.status === "submitted" ? "amber" : "outline"}>{INSPECTION_STATUS_LABELS[insp.status]}</Badge> : null}
        </div>
        {!insp ? (
          mine ? (
            <form action={startInspection.bind(null, id)} className="flex flex-col gap-2">
              <p className="text-sm text-muted">Press start when you begin. The time counts as labour on this job.</p>
              <Button type="submit" size="lg">
                Start inspection
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted">{job.assigned_to ? "The inspection has not started yet." : "Waiting for the workshop manager to assign a technician."}</p>
          )
        ) : insp.status === "not_started" || insp.status === "returned" ? (
          <>
            {insp.return_reason && insp.status === "returned" ? <Notice tone="error">Sent back by the workshop manager: {insp.return_reason}</Notice> : null}
            {insp.technician_id === staff.id || manager ? (
              <form action={startInspection.bind(null, id)} className="flex flex-col gap-2">
                <p className="text-sm text-muted">{insp.status === "returned" ? "Open the report again to make the changes, then submit it again." : "Press start when you begin. The time counts as labour on this job."}</p>
                <Button type="submit" size="lg">
                  {insp.status === "returned" ? "Open the report" : "Start inspection"}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted">Assigned to {bundle?.technician?.display_name ?? "a technician"}.</p>
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
        {insp?.status === "submitted" ? <Notice tone="info">Submitted. The workshop manager will approve it or send it back.</Notice> : null}
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

      {insp && formProps && (insp.status === "in_progress" || insp.status === "submitted" || insp.status === "approved") ? (
        <>
          <InspectionForm inspectionId={insp.id} {...formProps} returnReason={null} readOnly={!canFill} submitAction={submitInspection.bind(null, id)} />
          {insp.status === "approved" && !locked && canFill ? (
            <Card className="flex flex-col gap-3 border-ink">
              <SectionLabel>What did you change?</SectionLabel>
              <form action={noteInspectionEdit.bind(null, id)} className="flex flex-col gap-2">
                <textarea name="note" rows={2} required className="w-full rounded-control border border-line-strong px-3 py-2 text-sm" placeholder="Describe the change for the record" />
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
