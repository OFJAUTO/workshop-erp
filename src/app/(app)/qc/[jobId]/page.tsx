import { notFound } from "next/navigation";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { STATUS_LABELS } from "@/lib/jobs";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { QC_SELECT, loadWork, signJobFiles, type QcCheckRow } from "@/lib/work-data";
import { openQcRoundAction, saveQc } from "../actions";
import { QcForm } from "./QcForm";

export const dynamic = "force-dynamic";

/** One car's QC: the checklist built from the job, the mileage, the post-scan. Owner, managers and advisors can look. Never a dead end. */
export default async function QcPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const { jobId } = await params;
  const { message, error } = await searchParams;
  if (!(can(role, "doQc") || can(role, "viewWorkOrders"))) notFound();
  const supabase = await createClient();
  const [card, work, { data: checks }] = await Promise.all([loadJobCard(supabase, jobId), loadWork(jobId), createAdminClient().from("qc_checks").select(QC_SELECT).eq("job_id", jobId).eq("is_active", true).order("round")]);
  if (!card) notFound();
  const { job, vehicle, gateIn } = card;
  const rounds = (checks ?? []) as QcCheckRow[];
  const open = rounds.find((c) => c.status === "open") ?? null;
  const workedOnIt = work.sessions.some((s) => s.technician_id === staff.id) || job.assigned_to === staff.id;
  const canDo = can(role, "doQc") && !staff.viewingAs && !!open && job.status === "pending_qc" && !workedOnIt;
  const scanUrl = open?.postscan_path ? (await signJobFiles([open.postscan_path]))[open.postscan_path] : null;
  const canOpen = (can(role, "doQc") || can(role, "manageWork")) && !staff.viewingAs && job.is_open && job.status === "pending_qc" && !open;

  return (
    <>
      <PageHeader title={`QC · ${formatPlate(vehicle)}`} subtitle={`${vehicleTitle(vehicle)} · ${job.job_number} · ${STATUS_LABELS[job.status]}${open ? ` · round ${open.round}` : ""}`} actions={<><LinkButton href="/qc" tone="secondary" size="lg">Cars for QC</LinkButton>{can(role, "viewJobs") ? <LinkButton href={`/jobs/${jobId}`} tone="secondary" size="lg">Job card</LinkButton> : null}</>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {workedOnIt && can(role, "doQc") ? <Notice tone="error">You worked on this car. Someone else must do its QC.</Notice> : null}
      {gateIn?.dash_cam ? <Notice tone="info">Dash cam fitted: check it is reconnected.</Notice> : null}
      {gateIn?.old_parts_return ? <Notice tone="info">The customer asked for the old parts: check they are kept.</Notice> : null}
      {open && open.round > 1 ? <Notice tone="info">Recheck after rework: only the items that failed last time are listed.</Notice> : null}
      {open ? (
        <QcForm jobId={jobId} items={open.items} initialMileage={open.mileage ?? gateIn?.mileage ?? null} mileageUnit={open.mileage_unit ?? gateIn?.mileage_unit ?? "km"} postscan={open.postscan_path ? { id: open.id, path: open.postscan_path, url: scanUrl ?? null, caption: "post-scan.pdf", contentType: "application/pdf" } : null} waivedReason={open.postscan_waived_reason} notes={open.notes} readOnly={!canDo} action={saveQc.bind(null, jobId)} />
      ) : canOpen ? (
        <Card className="flex flex-col gap-3 border-ink">
          <SectionLabel>No QC round is open yet</SectionLabel>
          <p className="text-sm">The car is in Pending QC but its checklist was never opened (it was moved here by hand). Open the round and start the checks.</p>
          <form action={openQcRoundAction.bind(null, jobId)}><Button type="submit" size="lg">Open the QC round</Button></form>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3">
          <SectionLabel>Nothing to check right now</SectionLabel>
          <p className="text-sm">The car is at <span className="font-semibold">{STATUS_LABELS[job.status]}</span>.{job.status === "in_work" ? " The workshop manager confirms the finished work; the car comes here after that." : job.status === "pending_wash" ? " QC is passed; the advisor sends it to the wash." : ""}</p>
          <div className="flex flex-wrap gap-2">
            {job.status === "in_work" && can(role, "viewWorkOrders") ? <LinkButton href={`/jobs/${jobId}/work`} size="md">Open the work order</LinkButton> : null}
            {can(role, "viewJobs") ? <LinkButton href={`/jobs/${jobId}`} tone="secondary" size="md">Job card</LinkButton> : null}
            <LinkButton href="/qc" tone="secondary" size="md">Cars for QC</LinkButton>
          </div>
        </Card>
      )}
      {rounds.filter((c) => c.status !== "open").length ? (
        <Card className="flex flex-col gap-2">
          <SectionLabel>Earlier rounds</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {rounds.filter((c) => c.status !== "open").map((c) => (
              <li key={c.id} className="py-2 flex flex-wrap items-center gap-2">
                <Badge tone={c.status === "passed" ? "green" : "red"}>{c.status === "passed" ? "Passed" : "Failed"}</Badge>
                <span>round {c.round} · {formatDateTime(c.finished_at)}</span>
                {c.status === "failed" ? <span className="text-muted">{c.items.filter((i) => i.result === "fail").map((i) => `${i.label} (${i.remark})`).join("; ")}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
