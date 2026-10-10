import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { dubaiDate, workingTimeOf } from "@/lib/jobs";
import { labourRateFor, loadPartsWait, loadQuotation, loadQuoteChecks, loadServices, minMarkupFor, loadQuoteFindings } from "@/lib/quote-data";
import { checklistItems, type ChecklistSection } from "@/lib/inspection";
import { QUOTE_STATUS_LABELS, aed, isHidden, estimatedDaysAfterApproval } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { getSettings, highestBankCharge } from "@/lib/settings";
import { getSiteUrl } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { confirmEstimateUnchanged, decideQuoteApproval, reviseQuotation, urgentOnlyVersion } from "@/app/(app)/quotes/actions";
import { QuoteEditor, type PartsWait } from "./QuoteEditor";

export const dynamic = "force-dynamic";

/** The quotation builder for a job. Only the owner and the job's advisor can open it; everyone else goes back to the job card. */
export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string; qid: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const { id, qid } = await params;
  const { message, error } = await searchParams;
  const [bundle, settings, site] = await Promise.all([loadQuotation(qid), getSettings(), getSiteUrl()]);
  if (!bundle || bundle.quotation.job_id !== id) notFound();
  const { quotation: q, job, vehicle, customer } = bundle;

  const { data: sentApprovals } = role === "service_advisor" ? await createAdminClient().from("approval_requests").select("id").eq("job_id", id).eq("sent_by", staff.id).limit(1) : { data: [] as { id: string }[] };
  const isAdvisor = role === "service_advisor" && (q.created_by === staff.id || job?.gated_in_by === staff.id || (sentApprovals ?? []).length > 0);
  if (!(role === "owner" || isAdvisor)) redirect(role === "technician" ? "/my-jobs" : role === "gate_in" ? "/gate-in" : `/jobs/${id}`);
  const isOwner = role === "owner";
  const canEdit = !staff.viewingAs && (q.status === "draft" || q.status === "pending_owner");
  const canSend = !staff.viewingAs;
  const services = await loadServices(staff.id);
  const [checks, partsWait, findings] = await Promise.all([loadQuoteChecks(id), loadPartsWait(id), loadQuoteFindings(id)]);
  const candidateMap = (settings.labour_job_candidates ?? {}) as Record<string, number>;
  const candidates = Object.entries(candidateMap).filter(([, n]) => Number(n) >= 2).map(([t]) => t);
  const estimatedDays = estimatedDaysAfterApproval(bundle.lines, bundle.parts, dubaiDate(), workingTimeOf(settings));
  const countedParts = bundle.parts.filter((p) => p.confirm_status !== "rejected");
  const { data: unavailableRows } = await createAdminClient().from("part_requests").select("label, closed_reason").eq("job_id", id).eq("status", "unavailable").eq("is_active", true);
  const wait: PartsWait = {
    unavailable: (unavailableRows ?? []).map((u) => ({ label: u.label as string, note: (u.closed_reason as string | null) ?? null })),
    openRequests: checks.openRequests,
    partsTotal: countedParts.length,
    partsPriced: countedParts.filter((p) => p.cost_aed !== null).length,
    waitingMinutes: partsWait.minutes,
    partsNames: partsWait.names.join(", "),
    remindAfter: Number(settings.parts_remind_minutes) || 30,
    escalateAfter: Number(settings.parts_escalate_minutes) || 60,
    remindedAt: q.parts_reminded_at,
    escalatedAt: q.parts_escalated_at,
  };
  // Hours remembered from earlier quotations: the same car model first, then any car.
  const memory = (settings.labour_hours_memory ?? {}) as Record<string, number>;
  const modelKey = [vehicle?.make?.name, vehicle?.model?.name].filter(Boolean).join(" ").toLowerCase();
  const hoursMemory: Record<string, number> = {};
  for (const [k, v] of Object.entries(memory)) if (!k.includes("|")) hoursMemory[k] = Number(v);
  for (const [k, v] of Object.entries(memory)) if (modelKey && k.startsWith(modelKey + "|")) hoursMemory[k.slice(modelKey.length + 1)] = Number(v);
  const components = Array.from(new Set(checklistItems((settings.inspection_checklist ?? []) as ChecklistSection[]).map((i) => i.label)));

  const customerName = customer?.company_name ?? customer?.full_name ?? "Customer";
  const template = settings.whatsapp_quote_template
    .replaceAll("[name]", customerName)
    .replaceAll("[make model]", [vehicle?.make?.name, vehicle?.model?.name].filter(Boolean).join(" "))
    .replaceAll("[plate]", vehicle ? formatPlate(vehicle) : "")
    .replaceAll("[advisor]", staff.display_name);
  const editorSettings = {
    labourRate: labourRateFor(settings, job?.department ?? null, vehicle?.make?.name ?? null),
    minMarkup: minMarkupFor(settings, vehicle?.make?.name ?? null),
    markupWarn: Number(settings.markup_warn_percent) || 50,
    markupConfirm: Number(settings.markup_confirm_percent) || 100,
    inspectionFee: Number(settings.inspection_fee_aed) || 0,
    discountLimit: Number(settings.discount_limit_percent) || 0,
    approvalAbove: Number(settings.quote_owner_approval_above_aed) || 0,
    technicianCostRate: isOwner ? Number(settings.technician_cost_rate_aed) || 0 : null,
    // The estimate uses the higher of the two bank charge rates; the real charge is taken at payment.
    bankChargePercent: highestBankCharge(settings),
    advisorDiscount: settings.advisor_labour_discount === true,
    depositThreshold: Number(settings.deposit_threshold_aed) || 0,
    depositPercent: Number(settings.deposit_percent) || 50,
    today: dubaiDate(),
    workingTime: workingTimeOf(settings),
  };
  const tone = q.status === "approved" ? "green" : q.status === "declined" || q.status === "expired" ? "red" : q.status === "draft" ? "outline" : "amber";
  const urgentCount = bundle.lines.filter((l) => l.urgency === "urgent" && !isHidden(l)).length;
  const leftOutCount = bundle.lines.filter((l) => l.urgency !== "urgent" && !isHidden(l)).length;

  return (
    <>
      <PageHeader
        title={`${q.number} · version ${q.version}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{vehicle ? `${formatPlate(vehicle)} · ${[vehicle.make?.name, vehicle.model?.name].filter(Boolean).join(" ")}` : ""}</span>
            <span>· {job?.job_number}</span>
            <span>· {customerName}</span>
            <Badge tone={tone}>{QUOTE_STATUS_LABELS[q.status]}</Badge>
            {q.estimate_id ? <Badge tone="neutral">From an estimate</Badge> : null}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/jobs/${id}`} tone="secondary" size="lg">Job card</LinkButton>
            {bundle.inspection ? <LinkButton href={`/jobs/${id}/inspection`} tone="secondary" size="lg">Inspection report</LinkButton> : null}
            <a href={`/api/pdf/quotation/${q.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-control font-bold whitespace-nowrap bg-white text-ink border border-line-strong hover:bg-canvas min-h-14 px-6 text-base">
              Preview PDF
            </a>
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {q.status === "pending_owner" ? <Notice tone="info">Waiting for the owner&apos;s approval: {q.owner_approval_reason}</Notice> : null}
      {q.owner_approved_at && q.status === "draft" ? <Notice tone="success">Approved by the owner {formatDateTime(q.owner_approved_at)}. It can be sent.</Notice> : null}
      {bundle.versions.length > 1 ? (
        <p className="text-xs text-muted">
          Versions:{" "}
          {bundle.versions.map((v) => (
            <Link key={v.id} href={`/jobs/${id}/quote/${v.id}`} className={`underline underline-offset-4 mr-2 ${v.id === q.id ? "font-bold text-ink" : ""}`}>
              v{v.version} ({QUOTE_STATUS_LABELS[v.status as keyof typeof QUOTE_STATUS_LABELS] ?? v.status})
            </Link>
          ))}
        </p>
      ) : null}

      {q.status === "urgent_requested" && canSend ? (
        <Card className="flex flex-col gap-2 border-amber-bar">
          <SectionLabel>Customer asked for the urgent work only</SectionLabel>
          <p className="text-sm">
            {q.approver_name} asked on {formatDateTime(q.responded_at)} for a quotation with the Urgent lines only.{q.customer_request_note ? ` Note: "${q.customer_request_note}"` : ""}
          </p>
          <p className="text-xs text-muted">
            Version {q.version + 1} carries the {urgentCount} Urgent line{urgentCount === 1 ? "" : "s"}; the {leftOutCount} left out {leftOutCount === 1 ? "is" : "are"} saved against the car as declined work. Review it, add anything the urgent work depends on, and send it. This version stays on record as replaced.
          </p>
          <form action={urgentOnlyVersion.bind(null, q.id)}>
            <Button type="submit" size="md">Create urgent-only version</Button>
          </form>
        </Card>
      ) : null}

      <QuoteEditor
        quotation={q}
        lines={bundle.lines}
        parts={bundle.parts}
        categories={services.categories}
        services={services.services}
        usage={services.usage}
        department={job?.department ?? null}
        settings={editorSettings}
        readOnly={!canEdit}
        showProfit={isOwner}
        canSend={canSend}
        isOwner={isOwner}
        siteUrl={site}
        messageTemplate={template}
        phoneDigits={(customer?.phone ?? "").replace(/[^\d]/g, "")}
        fromEstimate={!!q.estimate_id}
        labourActions={(settings.labour_actions ?? []) as string[]}
        labourPositions={(settings.labour_positions ?? []) as string[]}
        components={components}
        hoursMemory={hoursMemory}
        wait={wait}
        workshopEstimate={checks.workshopEstimate}
        completedAt={q.completed_at}
        findings={findings}
        labourJobs={(settings.labour_jobs ?? {}) as Record<string, string[]>}
        candidates={candidates}
        recoveryProviders={(settings.recovery_providers ?? []) as string[]}
        estimatedDays={estimatedDays}
        isRevision={q.version > 1}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          {q.status === "pending_owner" && can(role, "approveQuotes") ? (
            <Card className="flex flex-col gap-3 border-ink">
              <SectionLabel>Owner&apos;s approval</SectionLabel>
              <p className="text-sm">{q.owner_approval_reason}</p>
              <form action={decideQuoteApproval.bind(null, q.id)} className="flex flex-col gap-2">
                <Textarea name="note" rows={2} placeholder="Note to the advisor (optional)" />
                <div className="flex gap-2">
                  <Button type="submit" name="decision" value="approve" size="md">Approve</Button>
                  <Button type="submit" name="decision" value="refuse" tone="secondary" size="md">Ask for changes</Button>
                </div>
              </form>
            </Card>
          ) : null}
          {q.estimate_id && q.status === "draft" && canSend ? (
            <Card className="flex flex-col gap-2">
              <SectionLabel>From the accepted estimate</SectionLabel>
              <p className="text-sm text-muted">If nothing changed since the customer accepted the estimate, confirm it here and the earlier acceptance counts as approval. If anything changed, send the revised quotation instead.</p>
              <form action={confirmEstimateUnchanged.bind(null, q.id)}>
                <Button type="submit" tone="secondary" size="md">Confirm: nothing changed, treat as approved</Button>
              </form>
            </Card>
          ) : null}
          {canSend && ["sent", "opened", "expired", "declined", "approved", "pending_owner", "urgent_requested"].includes(q.status) ? (
            <Card className="flex flex-col gap-2">
              <SectionLabel>Revise</SectionLabel>
              <p className="text-sm text-muted">A new version of {q.number} with the same lines, ready to change and send again. This version stays on record.</p>
              <form action={reviseQuotation.bind(null, q.id)}>
                <Button type="submit" tone="secondary" size="md">Start version {q.version + 1}</Button>
              </form>
            </Card>
          ) : null}
        </div>
        <Card className="flex flex-col gap-2">
          <SectionLabel right={`${bundle.events.length}`}>History</SectionLabel>
          <ul className="flex flex-col divide-y divide-line text-xs">
            {bundle.events.map((e) => (
              <li key={e.id} className="py-1.5">
                <span className="text-muted">{formatDateTime(e.created_at)}</span> · <span className="font-semibold">{e.by_name ?? "Customer"}</span> · {e.note}
              </li>
            ))}
          </ul>
          {q.status === "approved" ? <p className="text-sm font-semibold">Approved total {aed(q.approved_total_aed)}</p> : null}
          <p className="text-xs text-muted">Prepared by {bundle.creatorName ?? "—"} · {formatDateTime(q.created_at)}</p>
        </Card>
      </div>
    </>
  );
}
