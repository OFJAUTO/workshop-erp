import { compJobChoices } from "@/lib/quote-data";
import { belowCostReady, partUnitsReady } from "@/lib/schema-ready";
import { damagedPanelsOf } from "@/lib/damage-data";
import Link from "next/link";
import { installerHistoryFor } from "@/lib/bodyshop";
import { packagesOf } from "@/lib/packages";
import { redirect } from "next/navigation";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { dubaiDate, workingTimeOf } from "@/lib/jobs";
import { labourRateFor, loadQuotation, loadServices, minMarkupFor, packageCostingOf, roundingByOwnerOf } from "@/lib/quote-data";
import { roundoffLimitsOf } from "@/lib/roundoff";
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
import { handbackOf, startersOf, staffNamesOf } from "@/lib/quote-lead";
import { HandbackBanner } from "@/components/HandbackBanner";
import { recoveryProviderList } from "@/lib/recovery-providers";
import { costLimitsOf } from "@/lib/part-cost-check";
import { estimateMoneyOf } from "@/lib/estimate-money";
import { billToFromCustomer, type BillTo } from "@/lib/estimate-money-rules";
import { estimateMoneyReady } from "@/lib/schema-ready";
import { OPEN_ESTIMATE_STATUSES } from "@/lib/quote-history";
import { EstimateMoneyCard, type MoneyCardFacts } from "./EstimateMoneyCard";
import { OrderPartsNow } from "./OrderPartsNow";

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
  // 1 November 2026 (E-00055): the advisor who STARTED it stays in charge, whoever made this version.
  const lead = (await startersOf([q.number])).get(q.number) ?? q.created_by;
  const mine = lead === staff.id;
  const [handback, leadNames] = await Promise.all([handbackOf(q.id), staffNamesOf([lead ?? "", ...bundle.versions.map((v) => (v as { created_by?: string | null }).created_by ?? "")])]);
  const leadName = lead ? (leadNames.get(lead) ?? null) : null;
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
  // Money from the estimate (4 November 2026): dormant until the migration is applied.
  const emReady = await estimateMoneyReady();
  const em = emReady && !attached ? await estimateMoneyOf(q.id) : null;
  // Part 3: accepted additional estimates of the same car that could join a COMBINED proforma.
  const emSiblings = em && accepted && (await (await import("@/lib/schema-ready")).estimateCombineReady())
    ? ((await createAdminClient().from("quotations").select("id, number, status, total_aed, rounded_total_aed, carried_job_id, job_id, cancelled_at, deleted_at, is_active").eq("kind", "estimate").eq("customer_id", q.customer_id).eq("vehicle_id", q.vehicle_id ?? "").eq("status", "approved").neq("number", q.number)).data ?? [])
        .filter((s) => s.is_active && !s.deleted_at && !s.cancelled_at && !s.carried_job_id && !s.job_id)
        .map((s) => ({ id: String(s.id), number: String(s.number), total: Number(s.rounded_total_aed ?? s.total_aed) || 0 }))
    : [];
  const emFacts: MoneyCardFacts | null = em
    ? {
        proforma: em.proforma ? { id: em.proforma.id, number: em.proforma.number, total: em.proforma.total_aed, validUntil: (em.proforma as { valid_until?: string | null }).valid_until ?? null, sentAt: (em.proforma as { sent_at?: string | null }).sent_at ?? null, complete: em.proformaComplete } : null,
        taxes: em.taxInvoices.filter((t) => !t.converted_to).map((t) => ({ id: t.id, number: t.number, total: t.total_aed, advance: !!t.deposit_for_quotation_id, token: t.token })),
        paid: em.paid,
        pendingCheque: em.pendingCheque,
        total: em.total,
        badgeWords: em.badge.words,
        badgeTone: em.badge.tone,
        paidWords: em.paidWords,
        fullyInvoiced: em.fullyInvoiced,
        over: em.over,
        combinedOn: em.combinedOn,
        combineChoices: emSiblings,
      }
    : null;
  const emBillTo: BillTo = emReady
    ? (((await createAdminClient().from("quotations").select("bill_to").eq("id", q.id).maybeSingle()).data?.bill_to as BillTo | null) ?? billToFromCustomer(customer))
    : billToFromCustomer(customer);
  const emShow = !!emFacts && (OPEN_ESTIMATE_STATUSES.includes(q.status as (typeof OPEN_ESTIMATE_STATUSES)[number]) || !!emFacts.proforma || emFacts.taxes.length > 0 || emFacts.paid > 0.005);
  // Part 4: priced part lines on an accepted estimate can be ordered before the car arrives.
  const emPricedParts = accepted && !attached
    ? (((await createAdminClient().from("quotation_lines").select("id, priced_at, unit_cost").eq("quotation_id", q.id).eq("is_active", true).eq("line_type", "part")).data ?? []) as { priced_at: string | null; unit_cost: number | string | null }[]).filter((l) => l.priced_at && l.unit_cost !== null).length
    : 0;
  const emCanCreate = mayManage || (!staff.viewingAs && role === "accounts");
  const emCanRecord = ["owner", "accounts"].includes(role) && !staff.viewingAs;
  const emRecordReadOnly = ["owner", "accounts"].includes(role) && !!staff.viewingAs;

  return (
    <>
      <PageHeader
        title={`${q.number} · Estimate`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{vehicle ? `${formatPlate(vehicle)} · ${[vehicle.make?.name, vehicle.model?.name].filter(Boolean).join(" ")}` : ""}</span>
            <span>· {customerName}</span>
            {leadName ? <span data-estimate-lead>· started by {leadName}</span> : null}
            <Badge tone={handback ? "green" : tone}>{handback ? "Ready to send" : QUOTE_STATUS_LABELS[q.status]}</Badge>
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
          <QuoteVersionSelect base="/estimates/" versions={bundle.versions.map((v) => { const by = (v as { created_by?: string | null }).created_by ?? null; return { id: v.id, version: v.version, status: v.status, by: by && by !== lead ? (leadNames.get(by) ?? null) : null }; })} selectedId={q.id} />
        </div>
      ) : null}
      <HandbackBanner handback={handback} leadName={leadName} />
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
                {/* Part 4 (4 November 2026): the priced parts can be ordered before the car arrives. */}
                {emPricedParts > 0 && ["owner", "service_advisor"].includes(role) && !staff.viewingAs ? <OrderPartsNow estimateId={q.id} pricedCount={emPricedParts} /> : null}
              </div>
            </>
          )}
        </Card>
      ) : null}
      {emShow && emFacts ? (
        <EstimateMoneyCard
          estimateId={q.id}
          number={q.number}
          approved={accepted}
          money={emFacts}
          billTo={emBillTo}
          canCreate={emCanCreate}
          canRecord={emCanRecord}
          recordReadOnly={emRecordReadOnly}
          canReport={role === "service_advisor" && !staff.viewingAs}
          isOwner={isOwner && !staff.viewingAs}
          customerId={q.customer_id}
          vehicleId={q.vehicle_id ?? null}
          phoneDigits={(customer?.phone ?? "").replace(/[^\d]/g, "")}
        />
      ) : null}
      <QuoteEditor
        comp={await compJobChoices(q, null)}
        damagePanels={await damagedPanelsOf(q.job_id)}
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
          partMarkupWarn: costLimitsOf(settings as unknown as Record<string, unknown>).markupWarnPercent,
          unitsReady: await partUnitsReady(),
          inspectionFee: Number(settings.inspection_fee_aed) || 0,
          discountLimit: Number(settings.discount_limit_percent) || 0,
          approvalAbove: Number(settings.quote_owner_approval_above_aed) || 0,
          technicianCostRate: Number(settings.technician_cost_rate_aed) || 0,
          bodyshopRate: Number(settings.bodyshop_cost_rate_aed) || 50,
    handcutSurcharge: Number(settings.ppf_handcut_surcharge_aed) || 0,
    // Section 7: the package cost estimate numbers (film, tint, ceramic, consumables, hours, rate).
    // The same car name the server costs a package with (make, model AND variant: "Range Rover LWB" is a big car).
    costing: await packageCostingOf(settings, [vehicle?.make?.name, vehicle?.model?.name, (vehicle as { variant?: string | null } | null)?.variant].filter(Boolean).join(" "), q.film_rolls_est, q.tint_spec, q.vehicle_id),
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
          belowCostReady: await belowCostReady(),
          roundDownMax: roundoffLimitsOf(settings).downMax,
          roundUpMax: roundoffLimitsOf(settings).upMax,
          roundingByOwner: await roundingByOwnerOf(q.id, q.rounded_total_aed !== null && q.rounded_total_aed !== undefined),
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
