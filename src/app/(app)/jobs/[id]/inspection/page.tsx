import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, DescriptionList, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { INSPECTION_STATUS_LABELS, ITEM_STATUS_LABELS, MEASUREMENTS, formatMinutes, type ItemStatus } from "@/lib/inspection";
import { inspectionLocked, inspectionWorkingMinutes, loadInspection, type InspectionMediaRow } from "@/lib/inspection-data";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { workingTimeOf } from "@/lib/jobs";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { approveInspection, decideInspectionChange, requestInspectionChange, returnInspection, setPrescanVisible } from "../../inspection-actions";
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

/** The inspection report: findings, every checklist item with its status, numbers, files, notes, and the manager's decision. */
export default async function InspectionReportPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("viewJobs");
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const supabase = await createClient();
  const [card, bundle, settings] = await Promise.all([loadJobCard(supabase, id), loadInspection(id), getSettings()]);
  if (!card) notFound();
  const { job, vehicle, requests } = card;
  if (!bundle) {
    return (
      <>
        <PageHeader title={`Inspection · ${formatPlate(vehicle)}`} subtitle={`${vehicleTitle(vehicle)} · ${job.job_number}`} actions={<LinkButton href={`/jobs/${id}`} tone="secondary">Job card</LinkButton>} />
        <Notice tone="info">No inspection yet. It starts once a technician is assigned.</Notice>
      </>
    );
  }
  const insp = bundle.inspection;
  const canApprove = can(role, "approveInspections");
  const canDecide = can(role, "decideInspectionChanges");
  const canRequest = role === "technician" || canApprove;
  const canTogglePrescan = canApprove || role === "service_advisor";
  const locked = inspectionLocked(insp);
  const wt = workingTimeOf(settings);
  const workingMin = inspectionWorkingMinutes(insp, wt);
  const target = insp.target_minutes ?? (Number(settings.inspection_target_minutes) || 90);
  const sections = Array.from(new Map(bundle.items.map((i) => [i.section_key, i.section_title])).entries());
  const flagged = bundle.items.filter((i) => i.status === "average" || i.status === "bad");
  const prescans = bundle.media.filter((m) => m.is_prescan);
  const whole = bundle.media.filter((m) => !m.is_prescan && !m.item_key && !m.job_request_id);
  const pendingChange = bundle.changeRequests.find((c) => c.status === "pending");

  return (
    <>
      <PageHeader
        title={`Inspection · ${formatPlate(vehicle)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{vehicleTitle(vehicle)}</span>
            <span>· {job.job_number}</span>
            <Badge tone={insp.status === "approved" ? "green" : insp.status === "returned" ? "red" : insp.status === "submitted" ? "amber" : "outline"}>{INSPECTION_STATUS_LABELS[insp.status]}</Badge>
            {locked ? <Badge tone="ink">Locked</Badge> : null}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/jobs/${id}`} tone="secondary" size="lg">
              Job card
            </LinkButton>
            {role === "technician" || canApprove ? (
              <LinkButton href={`/my-jobs/${id}`} tone="secondary" size="lg">
                Technician screen
              </LinkButton>
            ) : null}
          </>
        }
      />

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
                { label: "Items flagged", value: `${flagged.length} of ${bundle.items.length} (${bundle.items.filter((i) => i.status === "bad").length} bad, ${bundle.items.filter((i) => i.status === "average").length} average)` },
                ...(insp.approved_at ? [{ label: "Approved", value: `${formatDateTime(insp.approved_at)} by ${bundle.approver?.display_name ?? ""}` }] : []),
                ...(insp.manager_note ? [{ label: "Workshop manager's note", value: <span className="whitespace-pre-wrap">{insp.manager_note}</span> }] : []),
                ...(insp.return_reason && insp.status === "returned" ? [{ label: "Sent back because", value: insp.return_reason }] : []),
              ]}
            />
          </Card>

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
                  </div>
                  {f?.found ? <p className="text-sm"><span className="text-muted">Found:</span> {f.found}</p> : null}
                  {f?.needs ? <p className="text-sm"><span className="text-muted">Needs:</span> {f.needs}</p> : null}
                  <Files rows={bundle.media.filter((m) => m.job_request_id === r.id)} urls={bundle.mediaUrls} />
                </div>
              );
            })}
          </Card>

          {flagged.length ? (
            <Card className="flex flex-col gap-3 border-ink">
              <SectionLabel right={`${flagged.length}`}>Suggested quote lines</SectionLabel>
              <p className="text-xs text-muted">From every AVERAGE and BAD item: the parts the technician listed and the labour estimate.</p>
              <ul className="flex flex-col divide-y divide-line">
                {flagged.map((i) => (
                  <li key={i.id} className="py-2 flex flex-wrap items-start gap-x-4 gap-y-1 text-sm">
                    <Badge tone={TONE[i.status as ItemStatus]}>{ITEM_STATUS_LABELS[i.status as ItemStatus]}</Badge>
                    <span className="font-semibold flex-1 min-w-48">{i.item_label}</span>
                    <span className="text-muted whitespace-pre-wrap">{i.parts_needed ?? "No parts listed"}</span>
                    <span className="font-semibold">{i.labour_hours != null ? `${i.labour_hours} h` : "No labour estimate"}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {sections.map(([key, title]) => {
            const rows = bundle.items.filter((i) => i.section_key === key);
            return (
              <Card key={key} className="flex flex-col gap-2">
                <SectionLabel right={`${rows.filter((i) => i.status === "good").length} good · ${rows.filter((i) => i.status === "average").length} average · ${rows.filter((i) => i.status === "bad").length} bad`}>{title}</SectionLabel>
                <ul className="flex flex-col divide-y divide-line">
                  {rows.map((i) => (
                    <li key={i.id} className="py-2 flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {i.status ? <Badge tone={TONE[i.status]}>{ITEM_STATUS_LABELS[i.status]}</Badge> : <Badge tone="neutral">Not marked</Badge>}
                        <span className="text-sm font-semibold">{i.item_label}</span>
                      </div>
                      {i.remarks ? <p className="text-sm whitespace-pre-wrap">{i.remarks}</p> : null}
                      {i.parts_needed || i.labour_hours != null ? (
                        <p className="text-xs text-muted">
                          {i.parts_needed ? `Parts: ${i.parts_needed}` : ""}
                          {i.labour_hours != null ? ` · Labour ${i.labour_hours} h` : ""}
                        </p>
                      ) : null}
                      <Files rows={bundle.media.filter((m) => m.item_key === i.item_key)} urls={bundle.mediaUrls} />
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}

          <Card className="flex flex-col gap-3">
            <SectionLabel>Numbers</SectionLabel>
            <DescriptionList items={MEASUREMENTS.map((m) => ({ label: m.label, value: insp.measurements?.[m.key] != null && String(insp.measurements[m.key]) !== "" ? `${m.kind === "choice" ? (m.choices?.find((c) => c.value === String(insp.measurements[m.key]))?.label ?? insp.measurements[m.key]) : insp.measurements[m.key]}${m.unit ? ` ${m.unit}` : ""}` : null }))} />
          </Card>

          {whole.length ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Photos and videos of the whole car</SectionLabel>
              <Files rows={whole} urls={bundle.mediaUrls} />
            </Card>
          ) : null}

          {insp.technician_notes ? (
            <Card className="flex flex-col gap-2">
              <SectionLabel>Technician&apos;s notes</SectionLabel>
              <p className="text-sm whitespace-pre-wrap">{insp.technician_notes}</p>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3">
            <SectionLabel right={`${prescans.length}`}>Pre-scan (fault code report)</SectionLabel>
            <Files rows={prescans} urls={bundle.mediaUrls} />
            {!prescans.length ? <p className="text-sm text-muted">Not attached yet.</p> : null}
            {canTogglePrescan ? (
              <form action={setPrescanVisible.bind(null, id)} className="flex items-center gap-3">
                <input type="hidden" name="visible" value={insp.show_prescan_to_customer ? "0" : "1"} />
                <Button type="submit" tone="secondary" size="md">
                  {insp.show_prescan_to_customer ? "Hide from customer" : "Show to customer"}
                </Button>
                <span className="text-xs text-muted">{insp.show_prescan_to_customer ? "Will be included with the report." : "Internal only."}</span>
              </form>
            ) : null}
          </Card>

          {canApprove && insp.status === "submitted" ? (
            <Card className="flex flex-col gap-4 border-ink">
              <SectionLabel>Workshop manager&apos;s decision</SectionLabel>
              <ApproveForm action={approveInspection.bind(null, id)} />
              <ReturnForm action={returnInspection.bind(null, id)} />
            </Card>
          ) : null}

          {insp.status === "approved" ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Changes after approval</SectionLabel>
              <p className="text-xs text-muted">The approved report is locked. A change needs the owner&apos;s personal approval; every step is on the job&apos;s change log.</p>
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

          <p className="text-xs text-muted">
            <Link href={`/jobs/${id}`} className="underline underline-offset-4">
              Back to the job card
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
