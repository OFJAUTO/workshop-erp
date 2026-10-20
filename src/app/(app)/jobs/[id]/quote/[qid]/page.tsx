import { invoicesForLock } from "@/lib/quote-lock-server";
import { packagesOf } from "@/lib/packages";
import { quoteLockOf } from "@/lib/quote-lock";
import { VinCopy } from "@/components/VinCopy";
import Link from "next/link";
import { CarHeaderThumb } from "@/components/CarHeaderThumb";
import { notFound, redirect } from "next/navigation";
import { Input,Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { dubaiDate, workingTimeOf } from "@/lib/jobs";
import { labourRateFor, loadPartsWait, loadQuotation, loadQuoteChecks, loadServices, minMarkupFor } from "@/lib/quote-data";
import { QUOTE_STATUS_LABELS, aed, isHidden, estimatedDaysAfterApproval } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { getSettings, highestBankCharge } from "@/lib/settings";
import { getSiteUrl, PRODUCTION_SITE_URL } from "@/lib/site";
import { shortFor } from "@/lib/short-links";
import { greetingNameOf } from "@/lib/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { confirmEstimateUnchanged, decideQuoteApproval, decideRevision, declineQuotation, declineToGateOut, requestRevision, reviseQuotation, urgentOnlyVersion } from "@/app/(app)/quotes/actions";
import { QuoteEditor, type PartsWait } from "./QuoteEditor";
import { loadCatalogue } from "@/lib/parts-catalogue";
import { loadPricingRows } from "@/lib/parts-pricing";
import { reasonsFor } from "@/lib/reasons";
import { quoteReferenceOf } from "@/lib/quote-reference";
import { ROAD_TEST_SELECT, type RoadTestRow } from "@/lib/road-test";

export const dynamic = "force-dynamic";

/** The quotation builder for a job. Only the owner and the job's advisor can open it; everyone else goes back to the job card. */
export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string; qid: string }>; searchParams: Promise<{ message?: string; error?: string; send?: string; approve?: string; revise?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const { id, qid } = await params;
  const { message, error, send, approve } = await searchParams;
  const { data: declinedRow } = await createAdminClient().from("jobs").select("declined_out_at, is_open").eq("id", id).maybeSingle();
  const declinedOut = !!declinedRow?.declined_out_at;
  const jobOpen = declinedRow?.is_open !== false;
  const [bundle, settings, site] = await Promise.all([loadQuotation(qid), getSettings(), getSiteUrl()]);
  if (!bundle || bundle.quotation.job_id !== id) notFound();
  const { quotation: q, job, vehicle, customer } = bundle;

  // Any advisor can open, edit and send any quotation; the car keeps its own advisor.
  const isAdvisor = role === "service_advisor";
  if (!(role === "owner" || isAdvisor)) redirect(role === "technician" ? "/my-jobs" : role === "gate_in" ? "/gate-in" : `/jobs/${id}`);
  const isOwner = role === "owner";
  const canEdit = !staff.viewingAs && (q.status === "draft" || q.status === "pending_owner");
  // Approved by the customer: locked for everyone (the database refuses too). Who may make a new version depends on the documents out.
  const lock = quoteLockOf(q, await invoicesForLock(q.job_id), { isOwner });
  const mayRevise = !staff.viewingAs && (lock.locked ? (lock.reviseBy === "owner_or_allowed" ? isOwner || !!q.revision_allowed_at : lock.reviseBy === "owner" ? isOwner : false) : ["sent", "opened", "expired", "declined", "urgent_requested"].includes(q.status));
  const mayAskRevise = !staff.viewingAs && lock.locked && lock.reviseBy === "owner_or_allowed" && !isOwner && !q.revision_allowed_at;
  // Someone else holding the editing lock (a heartbeat within the last minute and a half): read only for this person.
  // eslint-disable-next-line react-hooks/purity -- a server page: rendered once per request, the clock is read once
  const lockFresh = !!q.editing_by && q.editing_by !== staff.id && !!q.editing_at && Date.now() - Date.parse(q.editing_at) < 90000;
  const { data: locker } = lockFresh ? await createAdminClient().from("staff").select("display_name").eq("id", q.editing_by!).maybeSingle() : { data: null };
  const lockedBy = lockFresh ? (locker?.display_name ?? "Someone") : null;
  const canSend = !staff.viewingAs;
  const services = await loadServices(staff.id);
  const [checks, partsWait] = await Promise.all([loadQuoteChecks(id), loadPartsWait(id)]);
  const candidateMap = (settings.custom_jobs_used ?? {}) as Record<string, number>;
  const candidates = Object.entries(candidateMap).filter(([, n]) => Number(n) >= 2).map(([t]) => t);
  const estimatedDays = estimatedDaysAfterApproval(bundle.lines, bundle.parts, dubaiDate(), workingTimeOf(settings));
  // The same rows and state as the Parts table: "4 of 5 parts priced" means the same thing on both screens.
  const pricing = await loadPricingRows(id);
  const { data: unavailableRows } = await createAdminClient().from("part_requests").select("label, closed_reason").eq("job_id", id).eq("status", "unavailable").eq("is_active", true);
  const wait: PartsWait = {
    unavailable: (unavailableRows ?? []).map((u) => ({ label: u.label as string, note: (u.closed_reason as string | null) ?? null })),
    openRequests: checks.openRequests,
    partsTotal: pricing.summary.total,
    partsPriced: pricing.summary.counts.priced,
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
  const [catalogue, { data: jobRequests }, { data: sessions }, { data: jobRow }, { data: roadRow }] = await Promise.all([
    loadCatalogue(),
    createAdminClient().from("job_requests").select("text").eq("job_id", id).eq("is_active", true).order("position"),
    // The hours the technicians clocked on the car: once the work is done, labour at cost uses them instead of the estimate.
    createAdminClient().from("work_sessions").select("minutes").eq("job_id", id).eq("is_active", true),
    createAdminClient().from("jobs").select("status, is_open").eq("id", id).maybeSingle(),
    createAdminClient().from("road_tests").select(ROAD_TEST_SELECT).eq("job_id", id).maybeSingle(),
  ]);
  const workDone = !!jobRow && (!jobRow.is_open || ["pending_qc", "pending_wash", "ready", "in_delivery", "closed"].includes(String(jobRow.status)));
  const clockedHours = workDone ? Math.round(((sessions ?? []).reduce((a, s) => a + (Number(s.minutes) || 0), 0) / 60) * 100) / 100 : null;
  // Bodyshop packages: the last price typed for each (a hint only).
  const { data: lastRows } = await createAdminClient().from("quotation_lines").select("service_id, unit_price").eq("line_type", "package").not("service_id", "is", null).not("unit_price", "is", null).gt("unit_price", 0).order("created_at", { ascending: false }).limit(600);
  const packageCost: Record<string, number> = Object.fromEntries(Object.entries((settings.package_cost_history ?? {}) as Record<string, { n: number; avg_cost: number }>).map(([k, v]) => [k, Number(v?.avg_cost) || 0]).filter(([, v]) => (v as number) > 0));
  const lastPrices: Record<string, number> = {};
  for (const r of lastRows ?? []) if (r.service_id && lastPrices[r.service_id] === undefined) lastPrices[r.service_id] = Number(r.unit_price);
  const reference = bundle.inspection ? quoteReferenceOf(bundle.inspection, (jobRequests ?? []).map((r) => r.text as string), (roadRow as RoadTestRow | null) ?? null) : null;

  // Who approved (for "Approved by Omar, 11:45") and who asked for a revision.
  const nameIds = [q.owner_approved_by, q.revision_requested_by].filter((x): x is string => !!x);
  const { data: nameRows } = nameIds.length ? await createAdminClient().from("staff").select("id, display_name").in("id", nameIds) : { data: [] as { id: string; display_name: string }[] };
  const nameOf = (id: string | null | undefined) => (nameRows ?? []).find((r) => r.id === id)?.display_name ?? null;
  const approverName = nameOf(q.owner_approved_by);
  const requesterName = nameOf(q.revision_requested_by);
  const revisionPending = !!q.revision_requested_at && !q.revision_allowed_at && !q.revision_declined_at;
  // The owner's box sits in the right column under "Before sending": the approval above the limit, or a revision request.
  const ownerBox = can(role, "approveQuotes") && (q.status === "pending_owner" || revisionPending) ? (
    <Card className="flex flex-col gap-3 border-ink" data-owner-box>
      {q.status === "pending_owner" ? (
        <>
          <SectionLabel>Owner&apos;s approval</SectionLabel>
          <p className="text-sm">{q.owner_approval_reason}</p>
          <form action={decideQuoteApproval.bind(null, q.id)} className="flex flex-col gap-2">
            <Textarea name="note" rows={2} placeholder="Note to the advisor (optional)" />
            <div className="flex gap-2">
              <Button type="submit" name="decision" value="approve" size="md" autoFocus={approve === "1"} data-owner-approve>Approve</Button>
              <Button type="submit" name="decision" value="refuse" tone="secondary" size="md">Ask for changes</Button>
            </div>
          </form>
        </>
      ) : null}
      {revisionPending ? (
        <>
          <SectionLabel>Revision requested</SectionLabel>
          <p className="text-sm"><span className="font-semibold">{requesterName ?? (q.revision_request_kind === "parts" ? "Parts" : "The advisor")}</span>: {q.revision_request_reason}</p>
          <p className="text-xs text-muted">The customer approved this quotation. Allow one revision, or decline.</p>
          <form action={decideRevision.bind(null, q.id)} className="flex flex-col gap-2">
            <Textarea name="note" rows={2} placeholder="Note (optional)" />
            <div className="flex gap-2">
              <Button type="submit" name="decision" value="allow" size="md" data-revision-allow>Allow one revision</Button>
              <Button type="submit" name="decision" value="decline" tone="secondary" size="md" data-revision-decline>Decline</Button>
            </div>
          </form>
        </>
      ) : null}
    </Card>
  ) : null;
  const customerName = customer?.company_name ?? customer?.full_name ?? "Customer";
  // A revised quotation goes out with its own message ("has been updated").
  const template = (q.version > 1 ? settings.whatsapp_quote_revised_template : settings.whatsapp_quote_template)
    .replaceAll("[name]", greetingNameOf(customer))
    .replaceAll("[make model]", [vehicle?.make?.name, vehicle?.model?.name].filter(Boolean).join(" "))
    .replaceAll("[plate]", vehicle ? formatPlate(vehicle) : "")
    .replaceAll("[advisor]", staff.display_name);
  const editorSettings = {
    labourRate: labourRateFor(settings, job?.department ?? null, vehicle?.make?.name ?? null),
    minMarkup: minMarkupFor(settings, vehicle?.make?.name ?? null),
    markupWarn: Number(settings.markup_warn_percent) || 50,
    markupConfirm: Number(settings.markup_confirm_percent) || 100,
    inspectionFee: Number(settings.inspection_fee_aed) || 0,
    consumablesDefault: Number(settings.consumables_default_aed) || 0,
    discountLimit: Number(settings.discount_limit_percent) || 0,
    approvalAbove: Number(settings.quote_owner_approval_above_aed) || 0,
    batteryWarrantyMonths: Number(settings.battery_warranty_months) || 12,
    technicianCostRate: Number(settings.technician_cost_rate_aed) || 0,
    goodMarginPercent: Number(settings.report_good_margin_percent) || 25,
    // The estimate uses the higher of the two bank charge rates; the real charge is taken at payment.
    bankChargePercent: highestBankCharge(settings),
    bankRateCard: Number(settings.bank_charge_card_percent) || 0,
    bankRateLink: Number(settings.bank_charge_link_percent) || 0,
    advisorDiscount: settings.advisor_labour_discount === true,
    depositThreshold: Number(settings.deposit_threshold_aed) || 0,
    depositPercent: Number(settings.deposit_percent) || 50,
    today: dubaiDate(),
    workingTime: workingTimeOf(settings),
    reasons: { part_discount: reasonsFor(settings, "part_discount") },
    commissionPeople: ((settings.commission_people ?? []) as string[]).map(String),
    marginYellow: Number(settings.quote_margin_yellow_percent) || 30,
    marginRed: Number(settings.quote_margin_red_percent) || 20,
    clockedHours,
    lastPrices,
          packageCost,
  };
  const tone = q.status === "approved" ? "green" : q.status === "declined" || q.status === "expired" ? "red" : q.status === "draft" ? "outline" : "amber";
  const urgentCount = bundle.lines.filter((l) => l.urgency === "urgent" && !isHidden(l)).length;
  const leftOutCount = bundle.lines.filter((l) => l.urgency !== "urgent" && !isHidden(l)).length;

  return (
    <>
      <PageHeader
        picture={<CarHeaderThumb vehicleId={q.vehicle_id} />}
        title={`${q.number} · version ${q.version}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2 uppercase">
            <span>{vehicle ? `${formatPlate(vehicle)} · ${[vehicle.make?.name, vehicle.model?.name].filter(Boolean).join(" ")}` : ""}</span>
            <span>· {job?.job_number}</span>
            <span>· {customerName}</span>
            <VinCopy vin={vehicle?.vin ?? null} />
            <Badge tone={tone}>{QUOTE_STATUS_LABELS[q.status]}</Badge>
            {q.estimate_id ? <Badge tone="neutral">From an estimate</Badge> : null}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/jobs/${id}`} tone="secondary" size="lg">Job card</LinkButton>
            {bundle.inspection ? <LinkButton href={`/jobs/${id}/inspection`} tone="secondary" size="lg">Inspection report</LinkButton> : null}
            {mayRevise ? (
              <form action={reviseQuotation.bind(null, q.id)}>
                <Button type="submit" size="lg" data-revise>Revise quotation</Button>
              </form>
            ) : null}
            <a href={`/api/pdf/quotation/${q.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-control font-bold whitespace-nowrap bg-white text-ink border border-line-strong hover:bg-canvas min-h-14 px-6 text-base">
              Preview PDF
            </a>
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {q.status === "pending_owner" ? <div data-owner-waiting><Notice tone="info">Waiting for owner approval ({q.owner_approval_reason}).</Notice></div> : null}
      {q.owner_approved_at && q.status === "draft" ? <div data-owner-approved><Notice tone="success">Approved by {approverName ?? "the owner"}, {formatDateTime(q.owner_approved_at)}. It can be sent.</Notice></div> : null}
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
        packages={packagesOf(settings)} department={job?.department ?? null}
        settings={editorSettings}
        readOnly={!canEdit}
        lock={lock}
        lockedBy={lockedBy}
        showProfit
        canSend={canSend}
        isOwner={isOwner}
        siteUrl={site}
        shortLink={q.token ? await shortFor(`${PRODUCTION_SITE_URL}/quote/${q.token}`) : null}
        messageTemplate={template}
        phoneDigits={(customer?.phone ?? "").replace(/[^\d]/g, "")}
        fromEstimate={!!q.estimate_id}
        hoursMemory={hoursMemory}
        wait={wait}
        workshopEstimate={checks.workshopEstimate}
        completedAt={q.completed_at}
        candidates={candidates}
        reference={reference}
        catalogue={catalogue}
        canEditList={can(role, "manageServices")}
        recoveryProviders={(settings.recovery_providers ?? []) as string[]}
        recoveryTypes={(settings.recovery_types ?? []) as { key: string; label: string; cost: number; price: number }[]}
        estimatedDays={estimatedDays}
        isRevision={q.version > 1}
        onRevise={mayRevise ? reviseQuotation.bind(null, q.id) : null}
        onAskRevise={mayAskRevise ? requestRevision.bind(null, q.id) : null}
        revision={{ requestedAt: q.revision_requested_at ?? null, requestedBy: requesterName, reason: q.revision_request_reason ?? null, allowedAt: q.revision_allowed_at ?? null, declinedAt: q.revision_declined_at ?? null, declinedNote: q.revision_decision_note ?? null }}
        reviseReasons={reasonsFor(settings, "revise_after_approval")}
        ownerBox={ownerBox}
        autoSend={send === "1"}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          {q.estimate_id && q.status === "draft" && canSend ? (
            <Card className="flex flex-col gap-2">
              <SectionLabel>From the accepted estimate</SectionLabel>
              <p className="text-sm text-muted">If nothing changed since the customer accepted the estimate, confirm it here and the earlier acceptance counts as approval. If anything changed, send the revised quotation instead.</p>
              <form action={confirmEstimateUnchanged.bind(null, q.id)}>
                <Button type="submit" tone="secondary" size="md">Confirm: nothing changed, treat as approved</Button>
              </form>
            </Card>
          ) : null}
          {canSend && ["sent", "opened", "expired"].includes(q.status) ? (
            <details className="text-sm" data-mark-declined>
              <summary className="cursor-pointer font-semibold underline underline-offset-4 min-h-11 flex items-center">Mark as declined</summary>
              <form action={declineQuotation.bind(null, q.id)} className="mt-2 flex flex-col gap-2">
                <p className="text-xs text-muted">The customer&apos;s page has no Declined button: after talking to the customer, mark it here.</p>
                <Textarea name="reason" rows={1} placeholder="Reason (optional)" />
                <div><Button type="submit" tone="secondary" size="md">Mark as declined</Button></div>
              </form>
            </details>
          ) : null}
          {q.status === "declined" && canSend && jobOpen && !declinedOut ? (
            <Card className="flex flex-col gap-3 border-ink" data-declined-next>
              <SectionLabel>Declined: what next?</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <form action={reviseQuotation.bind(null, q.id)} className="flex flex-col gap-1">
                  <Button type="submit" size="lg" className="w-full" data-declined-revise>Revise quotation</Button>
                  <span className="text-xs text-muted">Opens version {q.version + 1} to change and send again.</span>
                </form>
                <form action={declineToGateOut.bind(null, q.id)} className="flex flex-col gap-2">
                  <Button type="submit" size="lg" tone="secondary" className="w-full" data-declined-gateout>Proceed to gate-out</Button>
                  <details className="text-sm" data-add-charge>
                    <summary className="cursor-pointer font-semibold min-h-11 flex items-center">Add a charge (optional)</summary>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input name="charge_description" placeholder="For example DIAGNOSIS" className="min-w-48 flex-1" textCase="upper" aria-label="Charge" data-charge-description />
                      <Input name="charge_amount" inputMode="decimal" placeholder="AED" className="w-28 text-right" aria-label="Amount" data-charge-amount />
                    </div>
                    <p className="mt-1 text-xs text-muted">A small tax invoice is made and must be paid before the car leaves. Without a charge the car goes out free.</p>
                  </details>
                </form>
              </div>
              <p className="text-xs text-muted">Proceed to gate-out: open parts requests are cancelled, the workshop manager is told to put the car back together, and the car appears in gate-out as normal.</p>
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
