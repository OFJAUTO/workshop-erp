import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { jobConcernsSide, sideOfDepartment } from "@/lib/inspection";
import { dubaiDate, workingTimeOf } from "@/lib/jobs";
import { labourRateFor, loadQuotation, minMarkupFor } from "@/lib/quote-data";
import { QUOTE_STATUS_LABELS, aed } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { getSiteUrl } from "@/lib/site";
import { formatPlate } from "@/lib/types";
import { confirmEstimateUnchanged, decideQuoteApproval, reviseQuotation } from "@/app/(app)/quotes/actions";
import { QuoteEditor } from "./QuoteEditor";

export const dynamic = "force-dynamic";

/** The quotation builder for a job. Advisors see part costs and the parts margin; the owner and accounts also see labour cost and profit. */
export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string; qid: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const { id, qid } = await params;
  const { message, error } = await searchParams;
  const [bundle, settings, site] = await Promise.all([loadQuotation(qid), getSettings(), getSiteUrl()]);
  if (!bundle || bundle.quotation.job_id !== id) notFound();
  const { quotation: q, job, vehicle, customer } = bundle;

  // Who may open it: owner and accounts; the job's advisor; managers of the department (work lines only, no prices).
  const isAdvisor = role === "service_advisor" && (q.created_by === staff.id || job?.gated_in_by === staff.id);
  const isManager = role === "workshop_manager" && jobConcernsSide(job?.department ?? null, sideOfDepartment(staff.department_id));
  if (!(role === "owner" || role === "accounts" || isAdvisor || isManager)) redirect(role === "technician" ? "/my-jobs" : `/jobs/${id}?error=${encodeURIComponent("Only the job's advisor, the owner and accounts can open the quotation.")}`);
  const canEdit = (role === "owner" || isAdvisor) && !staff.viewingAs && (q.status === "draft" || q.status === "pending_owner");
  const canSend = role === "owner" || isAdvisor;
  const showPrices = role !== "workshop_manager";

  const customerName = customer?.company_name ?? customer?.full_name ?? "Customer";
  const template = settings.whatsapp_quote_template
    .replaceAll("[name]", customerName)
    .replaceAll("[make model]", [vehicle?.make?.name, vehicle?.model?.name].filter(Boolean).join(" "))
    .replaceAll("[plate]", vehicle ? formatPlate(vehicle) : "")
    .replaceAll("[advisor]", staff.display_name);
  const editorSettings = {
    labourRate: labourRateFor(settings, job?.department ?? null),
    minMarkup: minMarkupFor(settings, vehicle?.make?.name ?? null),
    discountLimit: Number(settings.discount_limit_percent) || 0,
    approvalAbove: Number(settings.quote_owner_approval_above_aed) || 0,
    technicianCostRate: role === "owner" || role === "accounts" ? Number(settings.technician_cost_rate_aed) || 0 : null,
    depositThreshold: Number(settings.deposit_threshold_aed) || 0,
    depositPercent: Number(settings.deposit_percent) || 50,
    today: dubaiDate(),
    workingTime: workingTimeOf(settings),
  };
  const tone = q.status === "approved" || q.status === "partly_approved" ? "green" : q.status === "declined" || q.status === "expired" ? "red" : q.status === "draft" ? "outline" : "amber";

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

      {showPrices ? (
        <QuoteEditor
          quotation={q}
          lines={bundle.lines}
          parts={bundle.parts}
          packages={bundle.packages.filter((p) => p.department === "both" || !job?.department || job.department === "both" || p.department === job.department)}
          settings={editorSettings}
          readOnly={!canEdit}
          showMargin={role === "owner" || role === "accounts" || role === "service_advisor"}
          showProfit={role === "owner" || role === "accounts"}
          canSend={canSend && !staff.viewingAs}
          isOwner={role === "owner"}
          siteUrl={site}
          messageTemplate={template}
          phoneDigits={(customer?.phone ?? "").replace(/[^\d]/g, "")}
          fromEstimate={!!q.estimate_id}
        />
      ) : (
        <Card className="flex flex-col gap-3">
          <SectionLabel>Work lines</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {bundle.lines.filter((l) => l.line_type !== "part" && l.line_type !== "fee").map((l) => (
              <li key={l.id} className="py-2 flex flex-wrap gap-x-3">
                <span className="font-semibold">{l.title}</span>
                {l.hours ? <span className="text-muted">{l.hours} h</span> : null}
                {l.group_label ? <span className="text-muted">· {l.group_label}</span> : null}
                {l.customer_approved === true ? <Badge tone="green">Approved</Badge> : l.customer_approved === false ? <Badge tone="red">Declined</Badge> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

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
          {q.estimate_id && q.status === "draft" && canSend && !staff.viewingAs ? (
            <Card className="flex flex-col gap-2">
              <SectionLabel>From the accepted estimate</SectionLabel>
              <p className="text-sm text-muted">If nothing changed since the customer accepted the estimate, confirm it here and the earlier acceptance counts as approval. If anything changed, send the revised quotation instead.</p>
              <form action={confirmEstimateUnchanged.bind(null, q.id)}>
                <Button type="submit" tone="secondary" size="md">Confirm: nothing changed, treat as approved</Button>
              </form>
            </Card>
          ) : null}
          {canSend && !staff.viewingAs && ["sent", "opened", "expired", "declined", "partly_approved", "approved", "pending_owner"].includes(q.status) ? (
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
          {showPrices && (q.status === "approved" || q.status === "partly_approved") ? <p className="text-sm font-semibold">Approved total {aed(q.approved_total_aed)}</p> : null}
          <p className="text-xs text-muted">Prepared by {bundle.creatorName ?? "—"} · {formatDateTime(q.created_at)}</p>
        </Card>
      </div>
    </>
  );
}
