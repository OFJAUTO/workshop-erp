import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { dubaiDate, workingTimeOf } from "@/lib/jobs";
import { labourRateFor, loadQuotation, loadServices, minMarkupFor } from "@/lib/quote-data";
import { QUOTE_STATUS_LABELS } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { getSettings, highestBankCharge } from "@/lib/settings";
import { getSiteUrl } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { reviseQuotation } from "@/app/(app)/quotes/actions";
import { QuoteEditor } from "@/app/(app)/jobs/[id]/quote/[qid]/QuoteEditor";

export const dynamic = "force-dynamic";

/** The estimate builder: the same lines and prices as a quotation, no promised date, sent to a page headed "Estimate". Owner and the advisor who made it only. */
export default async function EstimatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const { message, error } = await searchParams;
  const [bundle, settings, site] = await Promise.all([loadQuotation(id), getSettings(), getSiteUrl()]);
  if (!bundle || bundle.quotation.kind !== "estimate") notFound();
  const { quotation: q, vehicle, customer } = bundle;
  const mine = q.created_by === staff.id;
  const isOwner = role === "owner";
  if (!(isOwner || (can(role, "viewEstimates") && mine))) redirect("/estimates");
  const canEdit = !staff.viewingAs && q.status === "draft";
  const services = await loadServices(staff.id);
  const customerName = customer?.company_name ?? customer?.full_name ?? "Customer";
  const template = settings.whatsapp_estimate_template
    .replaceAll("[name]", customerName)
    .replaceAll("[make model]", [vehicle?.make?.name, vehicle?.model?.name].filter(Boolean).join(" "))
    .replaceAll("[plate]", vehicle ? formatPlate(vehicle) : "")
    .replaceAll("[advisor]", staff.display_name);
  const accepted = q.status === "approved";
  const { data: attached } = await createAdminClient().from("jobs").select("id, job_number").eq("estimate_id", q.id).maybeSingle();
  const tone = accepted ? "green" : q.status === "declined" || q.status === "expired" ? "red" : q.status === "draft" ? "outline" : "amber";

  return (
    <>
      <PageHeader
        title={`${q.number} · Estimate`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{vehicle ? `${formatPlate(vehicle)} · ${[vehicle.make?.name, vehicle.model?.name].filter(Boolean).join(" ")}` : ""}</span>
            <span>· {customerName}</span>
            <Badge tone={tone}>{QUOTE_STATUS_LABELS[q.status]}</Badge>
          </span>
        }
        actions={
          <>
            <LinkButton href="/estimates" tone="secondary" size="lg">Estimates</LinkButton>
            <a href={`/api/pdf/quotation/${q.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-control font-bold whitespace-nowrap bg-white text-ink border border-line-strong hover:bg-canvas min-h-14 px-6 text-base">
              Preview PDF
            </a>
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {accepted ? (
        <Card className="flex flex-col gap-2 border-green">
          <SectionLabel>Accepted by {q.approver_name} · {formatDateTime(q.responded_at)}</SectionLabel>
          {attached ? (
            <p className="text-sm">
              Attached to job <Link href={`/jobs/${attached.id}`} className="font-bold underline underline-offset-4">{attached.job_number}</Link>.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">Book the car in. At gate-in, attach this estimate and it opens as the quotation, pre-filled.</p>
              <div className="flex flex-wrap gap-2">
                <LinkButton href={`/calendar/new?customer=${q.customer_id}&vehicle=${q.vehicle_id ?? ""}`} size="md">Book the car into the calendar</LinkButton>
                {can(role, "gateIn") && q.vehicle_id ? <LinkButton href={`/gate-in/new?vehicle=${q.vehicle_id}`} tone="secondary" size="md">Gate in now</LinkButton> : null}
              </div>
            </>
          )}
        </Card>
      ) : null}
      <QuoteEditor
        quotation={q}
        lines={bundle.lines}
        parts={[]}
        categories={services.categories}
        services={services.services}
        usage={services.usage}
        department={null}
        settings={{
          labourRate: labourRateFor(settings, null, vehicle?.make?.name ?? null),
          minMarkup: minMarkupFor(settings, vehicle?.make?.name ?? null),
          markupWarn: Number(settings.markup_warn_percent) || 50,
          markupConfirm: Number(settings.markup_confirm_percent) || 100,
          inspectionFee: Number(settings.inspection_fee_aed) || 0,
          discountLimit: Number(settings.discount_limit_percent) || 0,
          approvalAbove: Number(settings.quote_owner_approval_above_aed) || 0,
          technicianCostRate: isOwner ? Number(settings.technician_cost_rate_aed) || 0 : null,
          bankChargePercent: highestBankCharge(settings),
          advisorDiscount: settings.advisor_labour_discount === true,
          depositThreshold: Number(settings.deposit_threshold_aed) || 0,
          depositPercent: Number(settings.deposit_percent) || 50,
          today: dubaiDate(),
          workingTime: workingTimeOf(settings),
        }}
        readOnly={!canEdit}
        showProfit={isOwner}
        canSend={!staff.viewingAs}
        isOwner={isOwner}
        siteUrl={site}
        messageTemplate={template}
        phoneDigits={(customer?.phone ?? "").replace(/[^\d]/g, "")}
        fromEstimate={false}
        labourActions={(settings.labour_actions ?? []) as string[]}
        labourPositions={(settings.labour_positions ?? []) as string[]}
        completedAt={q.completed_at}
        labourJobs={(settings.labour_jobs ?? {}) as Record<string, string[]>}
        recoveryProviders={(settings.recovery_providers ?? []) as string[]}
      />
      {!staff.viewingAs && ["sent", "opened", "expired", "declined"].includes(q.status) ? (
        <Card className="flex flex-col gap-2 max-w-xl">
          <SectionLabel>Revise</SectionLabel>
          <form action={reviseQuotation.bind(null, q.id)}>
            <Button type="submit" tone="secondary" size="md">Start version {q.version + 1}</Button>
          </form>
        </Card>
      ) : null}
      <Card className="flex flex-col gap-2 max-w-xl">
        <SectionLabel right={`${bundle.events.length}`}>History</SectionLabel>
        <ul className="flex flex-col divide-y divide-line text-xs">
          {bundle.events.map((e) => (
            <li key={e.id} className="py-1.5"><span className="text-muted">{formatDateTime(e.created_at)}</span> · <span className="font-semibold">{e.by_name ?? "Customer"}</span> · {e.note}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}
