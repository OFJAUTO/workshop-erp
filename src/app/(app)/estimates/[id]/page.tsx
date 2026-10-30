import { compJobChoices } from "@/lib/quote-data";
import Link from "next/link";
import { installerHistoryFor } from "@/lib/bodyshop";
import { packagesOf } from "@/lib/packages";
import { redirect } from "next/navigation";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { dubaiDate, workingTimeOf } from "@/lib/jobs";
import { labourRateFor, loadQuotation, loadServices, minMarkupFor, packageCostingOf } from "@/lib/quote-data";
import { QUOTE_STATUS_LABELS } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { getSettings, highestBankCharge } from "@/lib/settings";
import { reasonsFor } from "@/lib/reasons";
import { getSiteUrl, PRODUCTION_SITE_URL } from "@/lib/site";
import { shortFor } from "@/lib/short-links";
import { greetingNameOf } from "@/lib/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { reviseQuotation } from "@/app/(app)/quotes/actions";
import { QuoteEditor } from "@/app/(app)/jobs/[id]/quote/[qid]/QuoteEditor";
import { QuoteVersionSelect } from "@/components/QuoteVersionSelect";
import { TintSpecPanel } from "@/components/TintSpecPanel";
import { EstimateMenu } from "../EstimateMenu";
import { loadCatalogue } from "@/lib/parts-catalogue";
import { OwnerApprovalBox, discountByOf } from "@/app/(app)/quotes/OwnerApprovalBox";
import { refuseRecord } from "@/lib/refusal";
import { recoveryProviderList } from "@/lib/recovery-providers";

export const dynamic = "force-dynamic";

/** The estimate builder: the same lines and prices as a quotation, no promised date, sent to a page headed "Estimate". Owner and the advisor who made it only. */
export default async function EstimatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string; packages?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const { message, error, packages: openPackages } = await searchParams;
  const [bundle, settings, site] = await Promise.all([loadQuotation(id), getSettings(), getSiteUrl()]);
  if (!bundle || bundle.quotation.kind !== "estimate") return refuseRecord("estimate", id);
  const { quotation: q, vehicle, customer } = bundle;
  const mine = q.created_by === staff.id;
  const isOwner = role === "owner";
  // 30 October 2026: every advisor may OPEN an estimate (the open-estimate question and the car page link here, never a
  // dead end); only the advisor who made it, or the owner, changes or sends it.
  if (!(isOwner || can(role, "viewEstimates"))) redirect("/estimates");
  const mayManage = !staff.viewingAs && (isOwner || mine);
  const canEdit = mayManage && q.status === "draft";
  // eslint-disable-next-line react-hooks/purity -- a server page: rendered once per request, the clock is read once
  const lockFresh = !!q.editing_by && q.editing_by !== staff.id && !!q.editing_at && Date.now() - Date.parse(q.editing_at) < 90000;
  const { data: locker } = lockFresh ? await createAdminClient().from("staff").select("display_name").eq("id", q.editing_by!).maybeSingle() : { data: null };
  const lockedBy = lockFresh ? (locker?.display_name ?? "Someone") : null;
  const discountBy = await discountByOf(q);
  const services = await loadServices(staff.id);
  const customerName = customer?.company_name ?? customer?.full_name ?? "Customer";
  const template = settings.whatsapp_estimate_template
    .replaceAll("[name]", greetingNameOf(customer))
    .replaceAll("[make model]", [vehicle?.make?.name, vehicle?.model?.name].filter(Boolean).join(" "))
    .replaceAll("[plate]", vehicle ? formatPlate(vehicle) : "")
    .replaceAll("[advisor]", staff.display_name);
  const accepted = q.status === "approved";
  const { data: attachedRows } = await createAdminClient().from("jobs").select("id, job_number").or(q.carried_job_id ? `estimate_id.eq.${q.id},id.eq.${q.carried_job_id}` : `estimate_id.eq.${q.id}`).limit(1);
  const attached = attachedRows?.[0] ?? null;
  const addsTo = q.additional_to_id ? (await createAdminClient().from("quotations").select("id, number").eq("id", q.additional_to_id).maybeSingle()).data : null;
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
            {addsTo ? <Link href={`/estimates/${addsTo.id}`} className="rounded-full border border-ink px-2 py-0.5 text-[11px] font-extrabold tracking-[0.06em] whitespace-nowrap" data-estimate-adds-to={addsTo.number}>ADDITIONAL · in addition to {addsTo.number}</Link> : null}
            {attached ? <Link href={`/jobs/${attached.id}`} className="text-xs font-bold underline underline-offset-4 whitespace-nowrap" data-estimate-carried={attached.job_number}>Carried over to {attached.job_number}</Link> : null}
          </span>
        }
        actions={
          <>
            <LinkButton href="/estimates" tone="secondary" size="lg">Estimates</LinkButton>
            <EstimateMenu id={q.id} number={q.number} status={q.status} neverSent={!q.sent_at} canManage={mayManage} />
            <a href={`/api/pdf/quotation/${q.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-control font-bold whitespace-nowrap bg-white text-ink border border-line-strong hover:bg-canvas min-h-14 px-6 text-base">
              Preview PDF
            </a>
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {/* Section 1 (29 October 2026): an old version says so; every version is one pick away. */}
      {bundle.versions.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-quote-version-bar>
          {q.version < Math.max(...bundle.versions.map((v) => v.version)) ? <span className="rounded-card border border-line-strong bg-[#EDEDEF] px-3 py-2 font-bold text-[#3F3F46]" data-old-version-banner>OLD VERSION – v{q.version} of {bundle.versions.length}, kept for the record</span> : null}
          <span className="font-semibold text-muted">Versions of {q.number}:</span>
          <QuoteVersionSelect base="/estimates/" versions={bundle.versions.map((v) => ({ id: v.id, version: v.version, status: v.status }))} selectedId={q.id} />
        </div>
      ) : null}
      {q.status === "cancelled" ? <Notice tone="info">Cancelled{q.cancel_reason ? `: ${q.cancel_reason}` : ""}. Kept because the customer saw it; their link says it was withdrawn.</Notice> : null}
      {accepted ? (
        <Card className="flex flex-col gap-2 border-green">
          <SectionLabel>Accepted by {q.approver_name} · {formatDateTime(q.responded_at)}</SectionLabel>
          {attached ? (
            <p className="text-sm">
              Attached to job <Link href={`/jobs/${attached.id}`} className="font-bold underline underline-offset-4">{attached.job_number}</Link>.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">Book the car in. At gate-in every open estimate of the car carries over to the job and opens as its own quotation, pre-filled.</p>
              <div className="flex flex-wrap gap-2">
                <LinkButton href={`/calendar/new?customer=${q.customer_id}&vehicle=${q.vehicle_id ?? ""}`} size="md">Book the car into the calendar</LinkButton>
                {can(role, "gateIn") && q.vehicle_id ? <LinkButton href={`/gate-in/new?vehicle=${q.vehicle_id}`} tone="secondary" size="md">Gate in now</LinkButton> : null}
              </div>
            </>
          )}
        </Card>
      ) : null}
      <QuoteEditor
        comp={await compJobChoices(q, null)}
        ownerBox={<OwnerApprovalBox q={q} mayApprove={can(role, "approveQuotes") && !staff.viewingAs} discountBy={discountBy} />}
        discountBy={discountBy}
        viewerName={staff.display_name}
        autoOpenPackages={openPackages === "1"}
        tintBox={<TintSpecPanel quotation={q} settings={settings} isOwner={isOwner} viewOnly={!!staff.viewingAs} />}
        quotation={q}
        lines={bundle.lines}
        parts={[]}
        catalogue={await loadCatalogue()}
        categories={services.categories}
        services={services.services}
        usage={services.usage}
        packages={packagesOf(settings)} department={null}
        settings={{
          labourRate: labourRateFor(settings, null, vehicle?.make?.name ?? null),
          minMarkup: minMarkupFor(settings, vehicle?.make?.name ?? null),
          markupWarn: Number(settings.markup_warn_percent) || 50,
          markupConfirm: Number(settings.markup_confirm_percent) || 100,
          inspectionFee: Number(settings.inspection_fee_aed) || 0,
          discountLimit: Number(settings.discount_limit_percent) || 0,
          approvalAbove: Number(settings.quote_owner_approval_above_aed) || 0,
          technicianCostRate: Number(settings.technician_cost_rate_aed) || 0,
          bodyshopRate: Number(settings.bodyshop_cost_rate_aed) || 50,
    handcutSurcharge: Number(settings.ppf_handcut_surcharge_aed) || 0,
    // Section 7: the package cost estimate numbers (film, tint, ceramic, consumables, hours, rate).
    costing: await packageCostingOf(settings, [vehicle?.make?.name, vehicle?.model?.name].filter(Boolean).join(" "), q.film_rolls_est, q.tint_spec, q.vehicle_id),
          installerHistory: await installerHistoryFor(q.vehicle_id ?? null),
          goodMarginPercent: Number(settings.report_good_margin_percent) || 25,
          bankChargePercent: highestBankCharge(settings),
          bankRateCard: Number(settings.bank_charge_card_percent) || 0,
          bankRateLink: Number(settings.bank_charge_link_percent) || 0,
          bankFixedCard: Number(settings.bank_fee_card_txn_aed) || 0,
          bankFixedLink: Number(settings.bank_fee_link_txn_aed) || 0,
          advisorDiscount: settings.advisor_labour_discount === true,
          depositThreshold: Number(settings.deposit_threshold_aed) || 0,
          depositPercent: Number(settings.deposit_percent) || 50,
          today: dubaiDate(),
          workingTime: workingTimeOf(settings),
          reasons: { part_discount: reasonsFor(settings, "part_discount") },
        }}
        readOnly={!canEdit}
        lockedBy={lockedBy}
        showProfit
        canSend={mayManage}
        isOwner={isOwner}
        siteUrl={site}
        shortLink={q.token ? await shortFor(`${PRODUCTION_SITE_URL}/quote/${q.token}`) : null}
        messageTemplate={template}
        phoneDigits={(customer?.phone ?? "").replace(/[^\d]/g, "")}
        fromEstimate={false}
        completedAt={q.completed_at}
        recoveryProviders={await recoveryProviderList(settings)}
        recoveryTypes={(settings.recovery_types ?? []) as { key: string; label: string; cost: number; price: number }[]}
      />
      {mayManage && ["sent", "opened", "expired", "declined"].includes(q.status) ? (
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
