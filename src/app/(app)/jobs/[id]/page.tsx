import Link from "next/link";
import { notFound } from "next/navigation";
import { Collapsible } from "@/components/Collapsible";
import { PriorityBadge, TimingBadge } from "@/components/JobBadges";
import { LiveRefresh } from "@/components/LiveRefresh";
import { StageTrack } from "@/components/StageTrack";
import { Badge, Button, Card, ChoiceButtons, DescriptionList, Input, LinkButton, Notice, PageHeader, SectionLabel, Select, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { INSPECTION_STATUS_LABELS, JOB_DEPARTMENTS, ROAD_TEST_SECTION_KEY, formatMinutes, jobConcernsSide, sideOfDepartment } from "@/lib/inspection";
import { inspectionOverTarget, inspectionWorkingMinutes, loadInspection, inspectionDangerous } from "@/lib/inspection-data";
import { formatDate, formatDateTime, formatDayTime } from "@/lib/format";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { ARRIVED_BY, CLEANLINESS, CONDITIONS, FUEL_LEVELS, MANUAL_STATUS_OPTIONS, STATUS_LABELS, clockOf, formatPromised, jobTiming, labelOf, workingMinutesSince, workingTimeOf } from "@/lib/jobs";
import { mediaChecklist } from "@/lib/media";
import { describeMileage } from "@/lib/mileage";
import { nextStepOf, waitedText } from "@/lib/next-step";
import { PART_SELECT, loadQuoteSummary, toPart } from "@/lib/quote-data";
import { jobBalance } from "@/lib/invoice-data";
import { jobPartsState } from "@/lib/parts-data";
import { latestQc, loadWash, loadWork } from "@/lib/work-data";
import { markReadyToInvoice } from "../../invoices/actions";
import { followUpDone } from "../gate-out-actions";
import { ReadySendControl } from "./ReadySendControl";
import { aed, quoteState } from "@/lib/quotes";
import { ROAD_TEST_CHOICES, ROAD_TEST_DECISION_LABELS, ROAD_TEST_SELECT, roadTestLine, type RoadTestRow } from "@/lib/road-test";
import { newQuotation, startQuotation } from "../../quotes/actions";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { getSiteUrl } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { assignJob, moveJob, setJobPriority, setPromisedDate } from "../actions";
import { decideRoadTest, remindManager, setAssignmentNote } from "../assignment-actions";
import { decideMove, requestMove } from "../move-actions";
import { remindManagerToConfirm } from "../work-actions";
import { loadPlanning } from "@/lib/planning";
import { sendToWash, skipWash, washDone } from "../../wash/actions";
import { WashForms } from "../../wash/WashForms";
import { MediaGallery } from "./MediaGallery";
import { DecideMoveForm, RequestMoveForm } from "./MoveForms";
import { PlanningCard } from "./PlanningCard";
import { TechniciansCard } from "./TechniciansCard";
import { TechnicianChecks } from "@/components/TechnicianChecks";
import { loadJobTechnicians } from "@/lib/job-technicians";
import { JobSummaryCard } from "./JobSummaryCard";
import { ComebackCard } from "./ComebackCard";
import { ApprovalSendControl, ReportSendControl, type ReportLinkRow } from "./SendControls";

export const dynamic = "force-dynamic";

/** Money never reaches the workshop floor: these history lines show only to the owner, accounts and advisors. */
const MONEY_EVENTS = new Set(["payment", "invoice_issued", "proforma_issued", "ready_sent", "invoice_sent", "ready_to_invoice"]);

type MoveRequestRow = { id: string; reason: string; status: "pending" | "approved" | "refused"; to_status: string | null; decision_reason: string | null; decided_at: string | null; created_at: string; requester: { display_name: string } | null; decider: { display_name: string } | null };

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string; link?: string; req?: string }> }) {
  const staff = await requirePermission("viewJobs");
  const { id } = await params;
  const { message, error, link, req } = await searchParams;
  const role = staff.role_id as RoleId;

  const supabase = await createClient();
  const admin = createAdminClient();
  const [card, settings, site] = await Promise.all([loadJobCard(supabase, id), getSettings(), getSiteUrl()]);
  if (!card) notFound();
  const { job, vehicle, customer, customerPublic, vip, gateIn, requests, media, events, approvals, gateOut } = card;
  const [inspection, { data: rt }, { data: moves }, { data: reportLinkRow }, { data: managers }, { data: noteBy }, quoteSummary, { data: partRows }, { data: scanRows }] = await Promise.all([
    job.department !== "bodyshop" ? loadInspection(id) : Promise.resolve(null),
    admin.from("road_tests").select(ROAD_TEST_SELECT).eq("job_id", id).maybeSingle(),
    admin.from("move_requests").select("id, reason, status, to_status, decision_reason, decided_at, created_at, requester:staff!move_requests_requested_by_fkey(display_name), decider:staff!move_requests_decided_by_fkey(display_name)").eq("job_id", id).order("created_at", { ascending: false }),
    admin.from("report_links").select("id, token, status, sent_at, opened_at, created_at").eq("job_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("staff").select("display_name, department_id").eq("role_id", "workshop_manager").eq("is_active", true).order("display_name"),
    job.assignment_note_by ? admin.from("staff").select("display_name").eq("id", job.assignment_note_by).maybeSingle() : Promise.resolve({ data: null }),
    loadQuoteSummary(id),
    admin.from("part_items").select(PART_SELECT).eq("job_id", id).eq("is_active", true).order("created_at"),
    admin.from("inbound_scans").select("id, kind, file_name, received_at").eq("job_id", id).eq("is_active", true).neq("status", "ignored").order("received_at", { ascending: false }),
  ]);
  const roadTest = (rt as RoadTestRow | null) ?? null;
  const partItems = ((partRows ?? []) as Record<string, unknown>[]).map(toPart);
  const qState = quoteState(quoteSummary, inspection?.inspection.status === "approved");
  const latestQuote = quoteSummary.quotation;
  const moveRequests = (moves ?? []) as unknown as MoveRequestRow[];
  const reportLink = (reportLinkRow as ReportLinkRow | null) ?? null;
  const laterStage = ["approved", "waiting_parts", "in_work", "pending_qc", "pending_wash", "ready", "pending_payment", "in_delivery", "closed"].includes(job.status);
  const [partsState, work, qc, wash, bal, plan, { data: comebackRows }] = await Promise.all([jobPartsState(id), laterStage ? loadWork(id) : Promise.resolve(null), laterStage ? latestQc(id) : Promise.resolve(null), laterStage ? loadWash(id) : Promise.resolve(null), laterStage ? jobBalance(id) : Promise.resolve(null), laterStage ? loadPlanning(job, settings) : Promise.resolve(null), admin.from("jobs").select("id, job_number, comeback_cause, comeback_free, gated_in_at").or(`comeback_of.eq.${id},id.eq.${job.comeback_of ?? id}`).neq("id", id)]);
  const comebackOriginal = job.comeback_of ? ((comebackRows ?? []).find((r) => r.id === job.comeback_of) ?? null) : null;
  const comebacksOfThis = (comebackRows ?? []).filter((r) => r.id !== job.comeback_of);

  const check = mediaChecklist(media, { majorDamage: gateIn?.major_damage ?? false, wheelsRequired: gateIn?.wheels_required ?? false, damageNote: gateIn?.damage_note ?? "", hasCarPicture: !!vehicle.photo_path });
  const wt = workingTimeOf(settings);
  const timing = jobTiming(job.promised_at, job.is_open, clockOf(job, settings));
  const isVip = customer?.is_vip ?? customerPublic?.is_vip ?? vip?.is_vip ?? false;
  const vipNote = customer?.vip_note ?? customerPublic?.vip_note ?? vip?.vip_note ?? null;
  const customerName = customer?.company_name ?? customer?.full_name ?? customerPublic?.company_name ?? customerPublic?.full_name ?? "Customer";

  // The department's workshop manager(s), by name, for "Waiting on …".
  const deptManagers = (managers ?? []).filter((m) => jobConcernsSide(job.department, sideOfDepartment(m.department_id))).map((m) => m.display_name);
  const managerLabel = deptManagers.length ? deptManagers.join(" or ") : job.department === "bodyshop" ? "the bodyshop manager" : "the workshop manager";
  const managesThisJob = role === "owner" || (role === "workshop_manager" && jobConcernsSide(job.department, sideOfDepartment(staff.department_id)));

  const canAssign = can(role, "assignJobs") && managesThisJob && job.is_open;
  const canMove = can(role, "moveJobs") && job.is_open && job.status !== "gate_in_pending";
  const canRequestMove = !can(role, "moveJobs") && can(role, "requestMove") && job.is_open;
  const canEditGateIn = can(role, "editGateIn") && job.is_open;
  const canSend = can(role, "sendApproval") && job.is_open;
  // Gate-out belongs after QC, the wash and the invoice. Earlier it is greyed out with the reason; the owner may still go through (logged as an override).
  const gateOutReached = ["ready", "pending_payment", "in_delivery"].includes(job.status);
  const canGateOut = can(role, "gateOut") && job.is_open && job.status !== "gate_in_pending" && (gateOutReached || role === "owner");
  const gateOutReason = !gateOutReached && job.is_open ? "After QC, the wash and the invoice" : null;
  const canPlan = can(role, "setPriority") && job.is_open;
  const canSendReport = can(role, "sendReport") && job.is_open && inspection?.inspection.status === "approved";
  const canNote = can(role, "noteToManager") && job.is_open;
  const seesCustomerDetails = can(role, "viewCustomers");

  const { data: technicians } = canAssign
    ? await supabase.from("staff").select("id, display_name, department_id").eq("is_active", true).eq("role_id", "technician").order("display_name")
    : { data: [] as { id: string; display_name: string; department_id: string | null }[] };
  const onCar = canAssign || job.assigned_to ? await loadJobTechnicians(id) : [];
  const techniciansCanChange = canAssign && !staff.viewingAs && !["pending_qc", "pending_wash", "ready", "pending_payment", "in_delivery", "closed"].includes(job.status);

  const latestApproval = approvals[0] ?? null;
  void link;
  void req;
  // The WhatsApp messages: car details filled here; the recipient's name and the link are filled in the centre window.
  const fillCar = (t: string) => t.replaceAll("[make model]", [vehicle.make?.name, vehicle.model?.name].filter(Boolean).join(" ")).replaceAll("[plate]", formatPlate(vehicle)).replaceAll("[advisor]", staff.display_name);
  const approvalTemplate = fillCar(settings.whatsapp_approval_template);
  const reportTemplate = fillCar(settings.whatsapp_report_template).replaceAll("[name]", customerName);
  // The proforma message carries the bank details (the page has them too, with Pay now); the tax invoice has its own message.
  const bankLines = [settings.bank_name ? `Bank transfer: ${settings.bank_account_name}, ${settings.bank_name}` : "", settings.bank_iban ? `IBAN ${settings.bank_iban}` : ""].filter(Boolean).join("\n");
  const readyRaw = fillCar(settings.whatsapp_ready_template).replaceAll("[name]", customerName);
  const readyTemplate = readyRaw.includes("[bank]") ? readyRaw.replaceAll("[bank]", bankLines) : bankLines ? `${readyRaw}\n${bankLines}` : readyRaw;
  const invoiceTemplate = fillCar(String(settings.whatsapp_invoice_template ?? "")).replaceAll("[name]", customerName);
  const approverContacts = seesCustomerDetails && customer ? await loadApproverContacts(customer.id) : [];

  const insp = inspection?.inspection ?? null;
  const inspectionMinutes = insp ? inspectionWorkingMinutes(insp, wt) : 0;
  const inspectionOver = !!insp && insp.status === "in_progress" && inspectionOverTarget(insp, wt);
  const showInspectionTime = role === "owner" || role === "workshop_manager" || role === "service_advisor";
  const inspItems = (inspection?.items ?? []).filter((i) => i.section_key !== ROAD_TEST_SECTION_KEY);
  const badCount = inspItems.filter((i) => i.status === "bad").length;
  const avgCount = inspItems.filter((i) => i.status === "average").length;

  const stageIndex = ["gate_in", "inspection", "quote", "approval", "parts", "work", "qc", "wash", "ready"].indexOf(job.stage);
  const advisorName = card.gatedInBy ?? null;
  const step = nextStepOf(id, {
    status: job.status,
    is_open: job.is_open,
    assigned_to: job.assigned_to,
    first_approval_at: job.first_approval_at,
    gated_in_at: job.gated_in_at,
    stage_entered_at: job.stage_entered_at,
    assigneeName: card.assignee?.display_name ?? null,
    advisorName,
    managerLabel,
    inspection: insp ? { status: insp.status, technician_id: insp.technician_id, submitted_at: insp.submitted_at, approved_at: insp.approved_at } : null,
    roadTest,
    approval: latestApproval ? { sent_at: latestApproval.sent_at, opened_at: latestApproval.opened_at, approved_at: latestApproval.approved_at, approver_name: latestApproval.approver_name } : null,
    gateInComplete: check.complete,
    quote: qState,
    extra: { partsState: job.parts_state, partsLate: partsState.late.length, workDone: work?.lines.filter((l) => l.status === "done").length ?? 0, workTotal: work?.lines.length ?? 0, qcRound: job.qc_round, readyToInvoice: !!job.ready_to_invoice_at, invoiced: !!bal?.invoice, invoiceKind: bal?.invoice?.kind ?? null, invoiceSent: !!job.invoice_sent_at, balanceDue: bal?.balance ?? 0, readySent: !!job.ready_sent_at, deliveryAddress: (gateOut as unknown as { delivery_address?: string | null } | null)?.delivery_address ?? null, planningOn: plan?.waitingOn ?? null, workFinishedAt: job.work_done_at, washSentAt: job.wash_sent_at, technicianNames: plan?.technicians.filter((t) => !t.left_at).map((t) => t.display_name) ?? [] },
  });
  const canQuote = (role === "owner" || (role === "service_advisor" && (job.gated_in_by === staff.id || approvals.some((a) => a.sent_by === staff.id)))) && job.is_open && !staff.viewingAs;
  const seesPrices = role === "owner" || role === "accounts" || role === "service_advisor";
  // The quotation exists only for the owner and the job's advisor; nobody else sees the card or a link to it.
  const seesQuote = role === "owner" || (role === "service_advisor" && (job.gated_in_by === staff.id || approvals.some((a) => a.sent_by === staff.id)));
  const quoteOpenStatuses = ["draft", "pending_owner", "sent", "opened"];
  const myMove = role === "owner" || step.actorRole === role || (step.actorRole === "gate_in" && can(role, "editGateIn"));

  // Waiting for a technician: how long, against the assignment target.
  const waitingForAssignment = job.is_open && job.status === "pending_inspection" && !job.assigned_to;
  const assignmentTarget = Number(settings.assignment_target_minutes) || 30;
  const waitedMinutes = waitingForAssignment ? workingMinutesSince(job.first_approval_at ?? job.stage_entered_at, wt) : 0;
  const canRemind = canNote && waitingForAssignment && (waitedMinutes >= assignmentTarget || role === "owner");

  const inspectionState = (() => {
    if (job.department === "bodyshop") return { text: "Bodyshop path (later phase)", tone: "neutral" as const };
    if (!insp) return stageIndex > 1 ? { text: "Skipped (moved manually)", tone: "neutral" as const } : { text: job.assigned_to ? "Assigned, not started" : "Not started", tone: "neutral" as const };
    if (insp.status === "approved") return { text: `Approved by ${inspection?.approver?.display_name ?? "the manager"}, ${formatDate(insp.approved_at)}, ${formatMinutes(insp.elapsed_minutes ?? inspectionMinutes)}, ${badCount} bad, ${avgCount} average`, tone: "green" as const };
    if (insp.status === "submitted") return { text: `Submitted by ${inspection?.technician?.display_name ?? "the technician"}, ${formatDate(insp.submitted_at)}, ${formatMinutes(insp.elapsed_minutes ?? inspectionMinutes)}, ${badCount} bad, ${avgCount} average${can(role, "approveInspections") ? " · waiting for you" : ""}`, tone: "amber" as const };
    if (insp.status === "returned") return { text: `Sent back to ${inspection?.technician?.display_name ?? "the technician"}: ${insp.return_reason ?? ""}`, tone: "red" as const };
    if (insp.status === "in_progress") return { text: `In progress · ${inspection?.technician?.display_name ?? ""}${showInspectionTime ? ` · ${formatMinutes(inspectionMinutes)} running` : ""}${inspectionOver ? " · over target" : ""}`, tone: inspectionOver ? ("red" as const) : ("amber" as const) };
    return { text: `${INSPECTION_STATUS_LABELS[insp.status]}${inspection?.technician ? ` · ${inspection.technician.display_name}` : ""}`, tone: "neutral" as const };
  })();
  const approvalState = latestApproval?.approved_at || job.first_approval_at ? { text: `Approved${latestApproval?.approver_name ? ` by ${latestApproval.approver_name}` : ""}, ${formatDate(latestApproval?.approved_at ?? job.first_approval_at)}`, tone: "green" as const } : latestApproval?.opened_at ? { text: "Opened by the customer, not yet approved", tone: "amber" as const } : latestApproval?.sent_at ? { text: `Sent ${formatDate(latestApproval.sent_at)}, not yet opened`, tone: "amber" as const } : latestApproval ? { text: "Link created, not sent yet", tone: "neutral" as const } : { text: check.complete ? "Not sent yet" : "Gate-in photos and video pending", tone: "neutral" as const };
  const toneCls = { green: "border-green", amber: "border-amber-bar", red: "border-red-bar", neutral: "border-line" };
  const mapHref = gateIn?.location_lat != null && gateIn.location_lng != null ? `https://maps.google.com/?q=${gateIn.location_lat},${gateIn.location_lng}` : null;
  const overrides = events.filter((e) => e.event_type === "override");
  const pendingMove = moveRequests.find((m) => m.status === "pending");
  const defaultRoadTest = roadTest?.decision ?? (gateIn?.condition === "does_not_run" ? "not_possible" : null);

  return (
    <>
      <LiveRefresh tables={["jobs", "gate_in_media", "gate_ins", "approval_requests", "inspections", "road_tests", "move_requests"]} jobId={id} />
      <PageHeader
        title={formatPlate(vehicle)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{vehicleTitle(vehicle)}</span>
            <span>· {job.job_number}</span>
            <PriorityBadge priority={job.priority} />
            {inspection && inspectionDangerous(inspection).length ? <Badge tone="red">DANGEROUS TO DRIVE</Badge> : null}
            {isVip ? <Badge tone="ink">VIP</Badge> : null}
            {gateIn?.dash_cam ? <Badge tone="red">Dash cam fitted</Badge> : null}
            {gateIn && gateIn.condition !== "runs_drives" ? <Badge tone="red">{labelOf(CONDITIONS, gateIn.condition)}</Badge> : null}
            {job.department ? <Badge tone="outline">{JOB_DEPARTMENTS.find((d) => d.value === job.department)?.label}</Badge> : null}
            {job.inspection_fee_due ? <Badge tone="red">{can(role, "viewInvoices") ? `Inspection fee due · AED ${Number(settings.inspection_fee_aed).toLocaleString("en-GB")}` : "Inspection fee due"}</Badge> : null}
            {job.comeback_of ? <Badge tone={job.comeback_cause === "unrelated" || job.comeback_cause === "customer_caused" ? "outline" : "red"}>{job.comeback_cause === "unrelated" || job.comeback_cause === "customer_caused" ? "Return visit" : "Comeback"}{comebackOriginal ? ` of ${comebackOriginal.job_number}` : ""}{job.comeback_free ? " · free of charge" : ""}</Badge> : null}
            {comebacksOfThis.length ? <Badge tone="red">Came back: {comebacksOfThis.map((c) => c.job_number).join(", ")}</Badge> : null}
            <TimingBadge timing={timing} />
            {!job.is_open ? <Badge tone="neutral">Closed</Badge> : null}
          </span>
        }
        actions={
          <>
            {canEditGateIn && !check.complete ? (
              <LinkButton href={`/jobs/${id}/media`} size="lg">
                Add video and photos
              </LinkButton>
            ) : null}
            {canGateOut ? (
              <span className="flex flex-col items-end gap-1">
                <LinkButton href={`/jobs/${id}/gate-out`} tone="secondary" size="lg">
                  Gate out
                </LinkButton>
                {gateOutReason ? <span className="text-xs font-semibold text-amber-bar">Owner override: {gateOutReason.toLowerCase()} (logged)</span> : null}
              </span>
            ) : can(role, "gateOut") && job.is_open && gateOutReason ? (
              <span className="flex flex-col items-end gap-1">
                <span className="inline-flex min-h-14 items-center rounded-control border border-line bg-chip px-6 text-base font-bold text-muted" aria-disabled="true">Gate out</span>
                <span className="text-xs text-muted">{gateOutReason}</span>
              </span>
            ) : null}
          </>
        }
      />

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {isVip && vipNote ? (
        <Card className="border-ink flex flex-col gap-1">
          <SectionLabel>VIP handling note</SectionLabel>
          <p className="text-[15px] font-medium whitespace-pre-wrap">{vipNote}</p>
        </Card>
      ) : null}
      {job.assignment_note && (managesThisJob || canNote) ? (
        <Notice tone="info">
          Note to the workshop manager from {(noteBy as { display_name: string } | null)?.display_name ?? "the advisor"}
          {job.assignment_note_at ? `, ${formatDateTime(job.assignment_note_at)}` : ""}: {job.assignment_note}
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-lg font-extrabold">{STATUS_LABELS[job.status]}</span>
              <span className="text-sm text-muted">
                {job.promised_at ? `Promised ${formatPromised(job.promised_at)}` : "No promised date yet"}
                {card.assignee ? ` · ${card.assignee.display_name}` : " · Not assigned"}
              </span>
            </div>
            <StageTrack stage={job.stage} timing={timing} />
          </Card>
          <section className="rounded-card bg-chip border border-line p-5 flex flex-col gap-2">
            <SectionLabel right={`${requests.length}`}>Customer requests</SectionLabel>
            {requests.length ? (
              <ol className="flex flex-col gap-1.5">
                {requests.map((r, i) => (
                  <li key={r.id} className="flex gap-3 text-[16px] font-semibold leading-snug">
                    <span className="w-6 shrink-0 text-muted">{i + 1}.</span>
                    <span>{r.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[16px] font-semibold whitespace-pre-wrap">{gateIn?.customer_requests}</p>
            )}
          </section>
        </div>

        <section className="rounded-card bg-track border border-ink p-5 flex flex-col gap-3">
          <SectionLabel>Next step</SectionLabel>
          {step.done ? (
            <p className="text-sm">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green text-white text-xs font-bold mr-2">✓</span>
              <span className="font-semibold">{step.done.label}</span>
              {step.done.by ? <span className="text-muted"> · {step.done.by}</span> : null}
            </p>
          ) : null}
          <p className="text-[15px] font-semibold">{!can(role, "viewInvoices") && ["ready", "pending_payment", "in_delivery"].includes(job.status) ? "QC passed and the car is ready. The advisor and accounts take it from here." : step.next}</p>
          <p className="text-sm text-muted">
            Waiting on <span className="font-semibold text-ink">{step.waitingOn}</span> · {waitedText(step.since, wt)}
          </p>
          {step.action && myMove && job.is_open && step.action.href !== `/jobs/${id}#approval` ? (
            <LinkButton href={step.action.href} size="lg" className="w-full">
              {step.action.label}
            </LinkButton>
          ) : null}
          {job.status === "in_work" && job.work_done_at && job.is_open && (role === "owner" || role === "service_advisor") && !staff.viewingAs ? (
            <form action={remindManagerToConfirm.bind(null, id)}><Button type="submit" tone="secondary" size="md" className="w-full">Remind {managerLabel}</Button></form>
          ) : null}
          {job.promised_at ? (
            <div className="flex flex-col gap-2 border-t border-ink/20 pt-3">
              <p className="text-sm">
                Promised date <span className="font-semibold">{formatPromised(job.promised_at)}</span>
              </p>
              {can(role, "sendApproval") && job.is_open ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-xs font-semibold text-muted underline underline-offset-4">Change the promised date (with a reason)</summary>
                  <form action={setPromisedDate.bind(null, id)} className="mt-2 flex flex-col gap-2">
                    <Input name="promised_at" type="date" defaultValue={job.promised_at} required />
                    <Textarea name="reason" rows={2} required placeholder="Why the date changes (logged)" />
                    <Button type="submit" tone="secondary" size="md">
                      Change promised date
                    </Button>
                  </form>
                </details>
              ) : null}
            </div>
          ) : null}
          {waitingForAssignment && canNote ? (
            <div className="flex flex-col gap-2 border-t border-ink/20 pt-3">
              {job.assignment_reminded_at ? <p className="text-xs text-muted">Manager reminded {formatDateTime(job.assignment_reminded_at)}.</p> : null}
              {canRemind ? (
                <form action={remindManager.bind(null, id)}>
                  <Button type="submit" tone="secondary" size="md" className="w-full">
                    Remind manager
                  </Button>
                </form>
              ) : (
                <p className="text-xs text-muted">Remind manager opens after {assignmentTarget} working minutes.</p>
              )}
            </div>
          ) : null}
        </section>
      </div>

      {plan && (plan.active || ["approved", "waiting_parts"].includes(job.status)) ? (
        <PlanningCard jobId={id} status={job.status} plan={plan} role={role} viewingAs={!!staff.viewingAs} wt={wt} technicians={(technicians ?? []).length ? (technicians ?? []) : await loadTechnicians()} customer={customer ? { name: customer.company_name ?? customer.full_name, phoneDigits: (customer.phone ?? "").replace(/[^\d]/g, "") } : null} carText={vehicleTitle(vehicle)} advisorName={staff.display_name} whatsapp={can(role, "sendApproval")} />
      ) : null}
      {job.comeback_of || comebacksOfThis.length ? (
        <ComebackCard jobId={id} job={job} role={role} viewingAs={!!staff.viewingAs} original={comebackOriginal} comebacks={comebacksOfThis} inspectionApproved={inspection?.inspection.status === "approved"} />
      ) : null}
      {job.summary ? <JobSummaryCard jobId={id} job={job} role={role} viewingAs={!!staff.viewingAs} /> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className={`flex flex-col gap-2 ${toneCls[approvalState.tone]} ${job.stage === "gate_in" ? "ring-2 ring-ink" : ""}`}>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Job card approval</span>
          {!latestApproval && !job.first_approval_at ? <span className="text-sm font-semibold">{approvalState.text}</span> : null}
          <ApprovalSendControl jobId={id} canSend={canSend} complete={check.complete} latest={latestApproval} approvedAt={job.first_approval_at} siteUrl={site} messageTemplate={approvalTemplate} customer={customer ? { name: customer.company_name ?? customer.full_name, phone: customer.phone } : null} contacts={approverContacts.map((c) => ({ name: c.name, phone: c.phone }))} hidePhone={!seesCustomerDetails} />
        </Card>
        <Card className={`flex flex-col gap-2 ${toneCls[inspectionState.tone]} ${job.stage === "inspection" || job.stage === "quote" ? "ring-2 ring-ink" : ""}`}>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Inspection report</span>
          <span className="text-sm font-semibold">{inspectionState.text}</span>
          {roadTest ? <Badge tone={roadTest.status === "done" ? "green" : roadTest.status === "not_started" && roadTest.decision === "needed" ? "amber" : "neutral"}>{roadTestLine(roadTest)}</Badge> : null}
          {inspection && inspectionDangerous(inspection).length ? <Badge tone="red">DANGEROUS TO DRIVE</Badge> : null}
          {(scanRows ?? []).length ? <span className="text-xs text-muted">Scan reports: {(scanRows ?? []).filter((s) => s.kind === "pre").length} pre, {(scanRows ?? []).filter((s) => s.kind === "post").length} post · <a href="/scans" className="underline underline-offset-4">list</a></span> : null}
          <div className="flex flex-wrap gap-2 mt-auto">
            {insp ? (
              <LinkButton href={`/jobs/${id}/inspection`} tone={insp.status === "submitted" && can(role, "approveInspections") ? "primary" : "secondary"} size="md">
                {insp.status === "submitted" && can(role, "approveInspections") ? "Review" : "Open report"}
              </LinkButton>
            ) : null}
          </div>
          {canSendReport || reportLink ? <ReportSendControl jobId={id} link={reportLink} messageTemplate={reportTemplate} siteUrl={site} phoneDigits={(customer?.phone ?? "").replace(/[^\d]/g, "")} canSend={!!canSendReport} /> : null}
        </Card>
        {seesQuote ? (
        <Card id="quotation" className={`flex flex-col gap-2 ${qState.tone === "green" ? "border-green" : qState.tone === "amber" ? "border-amber-bar" : qState.tone === "red" ? "border-red-bar" : "border-line"} ${job.stage === "quote" || job.stage === "approval" ? "ring-2 ring-ink" : ""}`}>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Quotation</span>
          <span className="text-sm font-semibold">{qState.text}</span>
          {latestQuote ? (
            <span className="text-xs text-muted">
              {latestQuote.number} v{latestQuote.version}
              {` · ${aed(latestQuote.status === "approved" ? latestQuote.approved_total_aed : latestQuote.total_aed)}`}
              {latestQuote.sent_at ? ` · sent ${formatDayTime(latestQuote.sent_at)}` : ""}
              {latestQuote.opened_at ? ` · opened ${formatDayTime(latestQuote.opened_at)}` : ""}
              {latestQuote.responded_at ? ` · ${latestQuote.approver_name} ${formatDayTime(latestQuote.responded_at)}` : ""}
            </span>
          ) : null}
          <div className="flex flex-wrap gap-2 mt-auto">
            {!latestQuote && canQuote && (inspection?.inspection.status === "approved" || role === "owner") ? (
              <form action={startQuotation.bind(null, id)} className="flex flex-col gap-1">
                <Button type="submit" size="md">Start quotation</Button>
                {inspection?.inspection.status !== "approved" ? <span className="text-xs font-semibold text-amber-bar">Owner override: the inspection report is not approved yet (logged)</span> : null}
              </form>
            ) : !latestQuote && canQuote ? (
              <span className="flex flex-col gap-1">
                <span className="inline-flex min-h-11 items-center rounded-control border border-line bg-chip px-4 text-sm font-bold text-muted" aria-disabled="true">Start quotation</span>
                <span className="text-xs text-muted">{inspection ? "After the workshop manager approves the inspection report" : "After the inspection"}</span>
              </span>
            ) : null}
            {latestQuote ? (
              <LinkButton href={`/jobs/${id}/quote/${latestQuote.id}`} tone={quoteOpenStatuses.includes(latestQuote.status) && canQuote ? "primary" : "secondary"} size="md">
                {quoteOpenStatuses.includes(latestQuote.status) && canQuote ? (qState.key === "ready" ? "Send quotation" : qState.key === "finish" || qState.key === "pending_parts" ? "Finish the quotation" : "Open quotation") : "Open quotation"}
              </LinkButton>
            ) : null}
            {latestQuote && !quoteOpenStatuses.includes(latestQuote.status) && canQuote ? (
              <form action={newQuotation.bind(null, id)}>
                <Button type="submit" tone="secondary" size="md">New quotation</Button>
              </form>
            ) : null}
          </div>
        </Card>
        ) : null}
        <Card className={`flex flex-col gap-2 ${partItems.length ? "" : "bg-canvas opacity-70"} ${job.stage === "parts" ? "ring-2 ring-ink" : ""}`}>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Parts</span>
          <span className="text-sm font-semibold">
            {partItems.length === 0 ? (quoteSummary.openRequests ? `${quoteSummary.openRequests} request${quoteSummary.openRequests === 1 ? "" : "s"} to price` : "Not started") : `${partItems.length} part${partItems.length === 1 ? "" : "s"}`}
          </span>
          {partItems.length ? (
            <span className="text-xs text-muted">
              {[
                quoteSummary.waitingConfirm ? `${quoteSummary.waitingConfirm} waiting for the technician` : "",
                quoteSummary.waitingPrices ? `${quoteSummary.waitingPrices} waiting for a price` : "",
                partItems.filter((p) => p.order_status === "to_order").length ? `${partItems.filter((p) => p.order_status === "to_order").length} to order` : "",
                partItems.filter((p) => p.order_status === "ordered").length ? `${partItems.filter((p) => p.order_status === "ordered").length} ordered` : "",
                partItems.filter((p) => p.order_status === "received").length ? `${partItems.filter((p) => p.order_status === "received").length} received` : "",
              ].filter(Boolean).join(" · ")}
            </span>
          ) : null}
          <div className="mt-auto flex flex-wrap gap-2">
            {(can(role, "priceParts") || seesPrices) && (partItems.length || quoteSummary.openRequests || role === "owner") ? <LinkButton href={`/parts/${id}`} tone="secondary" size="md">Parts desk</LinkButton> : can(role, "priceParts") || seesPrices ? (
              <span className="flex flex-col gap-1">
                <span className="inline-flex min-h-11 items-center rounded-control border border-line bg-chip px-4 text-sm font-bold text-muted" aria-disabled="true">Parts desk</span>
                <span className="text-xs text-muted">Opens when the approved report lists parts</span>
              </span>
            ) : null}
            {can(role, "managePurchaseOrders") && partsState.received.length && partsState.needed.some((p) => p.issue_status !== "confirmed") ? <LinkButton href={`/parts/handover/${id}`} size="md">Hand over</LinkButton> : null}
            {can(role, "viewPurchaseOrders") && partsState.received.length ? <LinkButton href={`/parts/labels/${id}`} tone="secondary" size="md">Labels</LinkButton> : null}
            {(can(role, "viewPurchaseOrders") || can(role, "manageWork")) && partsState.needed.length ? <LinkButton href={`/parts/trail/${id}`} tone="ghost" size="md">Parts trail</LinkButton> : null}
          </div>
          {partsState.late.length ? <span className="text-xs font-bold text-red">{partsState.late.length} part{partsState.late.length === 1 ? "" : "s"} late</span> : null}
          {partsState.needed.length ? <span className="text-xs text-muted">Handed over {partsState.confirmed.length} of {partsState.needed.length}</span> : null}
        </Card>
        <Card className={`flex flex-col gap-2 ${work ? "" : "bg-canvas opacity-70"} ${job.stage === "work" ? "ring-2 ring-ink" : ""}`}>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Work</span>
          <span className="text-sm font-semibold">{job.status === "in_work" && job.work_done_at ? `Job finished, waiting on ${managerLabel} to confirm` : work && job.plan_released_at ? `${work.lines.filter((l) => l.status === "done").length} of ${work.lines.length} jobs done` : work ? "Planned, not released" : "Not started"}</span>
          {work ? <span className="text-xs text-muted">{Math.floor(work.minutesTotal / 60)} h {work.minutesTotal % 60} min used of {work.hoursQuoted.toFixed(1)} h charged{plan?.technicians.length ? ` · ${plan.technicians.filter((t) => !t.left_at).map((t) => t.display_name).join(", ")}` : ""}{work.additional.some((a) => a.status === "pending") ? " · additional work waiting" : ""}</span> : null}
          {can(role, "viewWorkOrders") && (work || role === "owner") ? <div className="mt-auto"><LinkButton href={`/jobs/${id}/work`} tone={job.status === "in_work" && managesThisJob ? "primary" : "secondary"} size="md">Work order</LinkButton></div> : can(role, "viewWorkOrders") ? (
            <div className="mt-auto flex flex-col gap-1">
              <span className="inline-flex min-h-11 items-center rounded-control border border-line bg-chip px-4 text-sm font-bold text-muted" aria-disabled="true">Work order</span>
              <span className="text-xs text-muted">Opens when the workshop manager releases the car from planning</span>
            </div>
          ) : null}
        </Card>
        <Card className={`flex flex-col gap-2 ${qc ? "" : "bg-canvas opacity-70"} ${job.stage === "qc" ? "ring-2 ring-ink" : ""}`}>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">QC</span>
          <span className="text-sm font-semibold">{qc ? (qc.status === "open" ? `Round ${qc.round} in progress` : qc.status === "passed" ? `Passed, round ${qc.round}` : `Failed, round ${qc.round}`) : "Not started"}</span>
          {job.rework_count ? <span className="text-xs text-red font-bold">Rework {job.rework_count}×</span> : null}
          {(qc || job.status === "pending_qc") && (can(role, "doQc") || can(role, "viewWorkOrders")) ? <div className="mt-auto"><LinkButton href={`/qc/${id}`} tone={job.status === "pending_qc" && can(role, "doQc") ? "primary" : "secondary"} size="md">{job.status === "pending_qc" && can(role, "doQc") ? "Start QC" : "QC"}</LinkButton></div> : null}
        </Card>
        <Card className={`flex flex-col gap-2 ${wash ? "" : "bg-canvas opacity-70"} ${job.stage === "wash" ? "ring-2 ring-ink" : ""}`}>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Wash</span>
          <span className="text-sm font-semibold">{wash ? (wash.skipped ? `Skipped: ${wash.skip_reason}` : `Done ${formatDayTime(wash.done_at)}`) : job.status === "pending_wash" ? (job.wash_sent_at ? `At the wash since ${formatDayTime(job.wash_sent_at)}` : "Ready for wash") : "Not started"}</span>
          {job.status === "pending_wash" && can(role, "washCars") ? <div className="mt-auto"><WashForms jobId={id} atWash={!!job.wash_sent_at} canAct={(role === "owner" || role === "service_advisor") && !staff.viewingAs} from="job" sendAction={sendToWash.bind(null, id)} doneAction={washDone.bind(null, id)} skipAction={skipWash.bind(null, id)} /></div> : null}
        </Card>
        {can(role, "viewInvoices") ? (
        <Card id="invoice" className={`flex flex-col gap-2 ${bal?.invoice?.kind === "tax_invoice" && bal.state === "paid" ? "border-green" : bal?.invoice || job.status === "ready" || job.status === "pending_payment" ? "border-ink" : "bg-canvas opacity-70"} ${job.stage === "ready" ? "ring-2 ring-ink" : ""}`}>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{bal?.invoice?.kind === "tax_invoice" ? "Tax invoice" : "Proforma"}</span>
          <span className="text-sm font-semibold">{bal?.invoice ? `${bal.invoice.number} · ${bal.state === "paid" ? (bal.invoice.kind === "tax_invoice" ? "paid in full" : "paid, tax invoice on its way") : bal.state === "part_paid" ? `part paid, AED ${bal.balance.toFixed(0)} due` : bal.state === "cheque_pending" ? "cheque pending" : `awaiting payment, AED ${bal.balance.toFixed(0)}`}` : job.status === "ready" || job.status === "pending_payment" ? (bal?.needsInvoice ? "Proforma to prepare" : "Nothing to invoice") : job.inspection_fee_due ? "Inspection fee to invoice" : "After QC and the wash"}</span>
          {job.ready_sent_at ? <span className="text-xs text-muted">Proforma sent {formatDayTime(job.ready_sent_at)}</span> : null}
          {job.invoice_sent_at ? <span className="text-xs text-muted">Tax invoice sent {formatDayTime(job.invoice_sent_at)}</span> : null}
          <div className="mt-auto flex flex-wrap gap-2">
            {!bal?.invoice && bal?.needsInvoice && ["ready", "pending_wash", "pending_qc", "pending_payment"].includes(job.status) && can(role, "markReadyToInvoice") && !staff.viewingAs ? <form action={markReadyToInvoice.bind(null, id)}><Button type="submit" size="md">Prepare the proforma</Button></form> : null}
            {can(role, "issueInvoices") && laterStage && job.is_open ? <LinkButton href={`/jobs/${id}/invoice`} tone="secondary" size="md">Payments and invoice</LinkButton> : null}
            {bal?.invoice && can(role, "viewInvoices") ? <LinkButton href={`/invoices/${bal.invoice.id}`} tone="secondary" size="md">Open {bal.invoice.kind === "tax_invoice" ? "tax invoice" : "proforma"}</LinkButton> : null}
          </div>
          {bal?.invoice && can(role, "sendApproval") && !staff.viewingAs && job.is_open ? <ReadySendControl jobId={id} token={bal.invoice.token} kind={bal.invoice.kind === "tax_invoice" ? "tax_invoice" : "proforma"} siteUrl={site} messageTemplate={bal.invoice.kind === "tax_invoice" ? invoiceTemplate : readyTemplate} phoneDigits={(customer?.phone ?? "").replace(/[^\d]/g, "")} sentAt={bal.invoice.kind === "tax_invoice" ? job.invoice_sent_at : job.ready_sent_at} /> : null}
        </Card>
        ) : null}
      </div>
      {!job.is_open && job.followup_due_at && !job.followup_done_at && can(role, "sendApproval") ? (
        <Card className="flex flex-wrap items-center gap-3 border-ink">
          <span className="text-sm font-semibold">Follow-up due {formatPromised(job.followup_due_at)}: call or message the customer and ask how the car is.</span>
          <form action={followUpDone.bind(null, id)} className="ml-auto"><Button type="submit" size="md">Follow-up done</Button></form>
        </Card>
      ) : null}


      {overrides.length ? (
        <Card className="flex flex-col gap-2 border-red-bar">
          <SectionLabel right={`${overrides.length}`}>Overrides on this job</SectionLabel>
          <ul className="flex flex-col divide-y divide-line text-sm">
            {overrides.map((e) => (
              <li key={e.id} className="py-2">
                <span className="text-xs text-muted">{formatDateTime(e.created_at)}</span> · <span className="font-semibold">{e.by_name}</span> · {e.note}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <Collapsible title="Gate-in details" right={gateIn ? `${formatDateTime(job.gated_in_at)}` : undefined}>
            {canEditGateIn ? (
              <div>
                <LinkButton href={`/jobs/${id}/gate-in/edit`} tone="ghost" size="md">
                  Amend
                </LinkButton>
              </div>
            ) : null}
            {gateIn ? (
              <DescriptionList
                items={[
                  { label: "Gated in", value: `${formatDateTime(job.gated_in_at)} by ${card.gatedInBy ?? "unknown"}` },
                  { label: "Department", value: JOB_DEPARTMENTS.find((d) => d.value === job.department)?.label ?? "Not set" },
                  {
                    label: "Location",
                    value: (
                      <span>
                        {gateIn.location_name ?? ""}
                        {gateIn.location_type !== "branch" && gateIn.location_address ? ` · ${gateIn.location_address}` : ""}
                        {mapHref ? (
                          <>
                            {" · "}
                            <a href={mapHref} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                              Map
                            </a>
                          </>
                        ) : null}
                      </span>
                    ),
                  },
                  { label: "Arrived by", value: labelOf(ARRIVED_BY, gateIn.arrived_by) },
                  { label: "Condition", value: labelOf(CONDITIONS, gateIn.condition) },
                  { label: vehicle.fuel_type === "electric" ? "Battery" : "Fuel level", value: vehicle.fuel_type === "electric" ? (gateIn.battery_percent != null ? `${gateIn.battery_percent}%` : null) : labelOf(FUEL_LEVELS, gateIn.fuel_level) },
                  { label: "Cleanliness", value: labelOf(CLEANLINESS, gateIn.cleanliness) },
                  { label: "Dash cam", value: gateIn.dash_cam ? "Fitted, to be disconnected" : "Not fitted" },
                  { label: "Major damage", value: gateIn.major_damage ? "Yes" : "No" },
                  { label: "Mileage", value: describeMileage(gateIn.mileage, gateIn.mileage_unit ?? "km") },
                  { label: "Keys", value: `${gateIn.keys_count} key${gateIn.keys_count === 1 ? "" : "s"}, ${gateIn.keys_keychain ? "with keychain" : "no keychain"}` },
                  { label: "Old parts returned to customer", value: gateIn.old_parts_return ? "Yes" : "No" },
                  { label: "Notes", value: gateIn.notes ? <span className="whitespace-pre-wrap">{gateIn.notes}</span> : null },
                ]}
              />
            ) : (
              <p className="text-sm text-muted">No gate-in record.</p>
            )}
            {gateOut ? (
              <DescriptionList
                items={[
                  { label: "Gated out", value: `${formatDateTime(job.gated_out_at)} by ${card.gatedOutBy ?? "unknown"}` },
                  { label: "Keys returned", value: `${gateOut.keys_returned}, ${gateOut.keychain_returned ? "with keychain" : "no keychain"}${gateOut.keys_match ? "" : " (did not match gate-in)"}` },
                  { label: "Keys override", value: gateOut.keys_override_reason },
                  { label: "Dash cam reconnected", value: gateOut.dash_cam_reconnected == null ? "Not fitted" : gateOut.dash_cam_reconnected ? "Yes" : "No" },
                  { label: "Gate-out notes", value: gateOut.notes },
                ]}
              />
            ) : null}
          </Collapsible>

          <Collapsible title="Vehicle and customer details">
            <DescriptionList
              items={[
                { label: "Customer", value: seesCustomerDetails && customer ? <Link href={`/customers/${customer.id}`} className="font-semibold underline underline-offset-4">{customerName}</Link> : customerName },
                ...(seesCustomerDetails && customer ? [{ label: "Phone", value: customer.phone }, { label: "Customer number", value: customer.customer_number }] : []),
                { label: "Car", value: <Link href={`/vehicles/${vehicle.id}`} className="font-semibold underline underline-offset-4">{vehicleTitle(vehicle)}</Link> },
                { label: "Plate", value: formatPlate(vehicle) },
                { label: "VIN", value: vehicle.vin ? <span className="font-mono">{vehicle.vin}</span> : null },
                { label: "Colour", value: vehicle.colour },
              ]}
            />
          </Collapsible>

          <Collapsible title="Gate-in photos and videos" right={`${media.length}`}>
            {canEditGateIn && job.is_open ? (
              <div>
                <LinkButton href={`/jobs/${id}/media`} tone="ghost" size="md">
                  Add more
                </LinkButton>
              </div>
            ) : null}
            <MediaGallery media={media} urls={Object.fromEntries(card.mediaUrls)} carPictureUrl={card.vehiclePhotoUrl} damageNote={gateIn?.damage_note} />
          </Collapsible>

          <Collapsible title="History" right={`${events.length}`}>
            <ul className="flex flex-col divide-y divide-line">
              {events.filter((e) => can(role, "viewInvoices") || !MONEY_EVENTS.has(e.event_type)).map((e) => (
                <li key={e.id} className={`py-2.5 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 ${e.event_type === "override" ? "text-red" : ""}`}>
                  <span className="text-xs text-muted sm:w-36 shrink-0">{formatDateTime(e.created_at)}</span>
                  <span className="text-sm">
                    <span className="font-semibold">{e.by_name ?? "System"}</span>
                    {" · "}
                    {e.note ?? (e.to_status ? `${e.from_status ? STATUS_LABELS[e.from_status as keyof typeof STATUS_LABELS] + " → " : ""}${STATUS_LABELS[e.to_status as keyof typeof STATUS_LABELS]}` : e.event_type)}
                  </span>
                </li>
              ))}
            </ul>
          </Collapsible>
        </div>

        <div className="flex flex-col gap-6">

          {canAssign && onCar.length ? (
            <TechniciansCard jobId={id} technicians={onCar} available={technicians ?? []} canEdit={techniciansCanChange} canChangeLead={techniciansCanChange && inspection?.inspection.status !== "approved"} />
          ) : null}
          {canAssign && !onCar.length ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Assign technician</SectionLabel>
              <form action={assignJob.bind(null, id)} className="flex flex-col gap-3">
                <TechnicianChecks technicians={technicians ?? []} checked={job.assigned_to ? [job.assigned_to] : []} hint="Tick one or more. The first ticked is the lead and does the inspection." />
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">Road test</span>
                  <ChoiceButtons name="road_test" columns={3} defaultValue={defaultRoadTest} options={ROAD_TEST_CHOICES} />
                </div>
                <Textarea name="road_test_note" rows={1} placeholder="Note (required when the road test is not possible)" defaultValue={roadTest?.decision_note ?? ""} />
                <Button type="submit" disabled={!check.complete || (!job.first_approval_at && role !== "owner")}>
                  {job.assigned_to ? "Reassign" : "Assign"}
                </Button>
                {!check.complete ? <p className="text-xs text-amber font-semibold">Blocked until the gate-in media is complete.</p> : null}
                {check.complete && !job.first_approval_at ? <p className="text-xs text-amber font-semibold">Blocked until the customer approves the job card.</p> : null}
              </form>
            </Card>
          ) : waitingForAssignment ? (
            <Card className="flex flex-col gap-2">
              <SectionLabel>Assign technician</SectionLabel>
              <p className="text-sm">
                Waiting on <span className="font-semibold">{managerLabel}</span> to assign a technician · {waitedText(job.first_approval_at ?? job.stage_entered_at, wt)}
              </p>
            </Card>
          ) : null}

          {canAssign && job.assigned_to && roadTest && job.department !== "bodyshop" ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Road test choice</SectionLabel>
              <p className="text-sm">
                {roadTest.decision ? ROAD_TEST_DECISION_LABELS[roadTest.decision] : "Not chosen yet"}
                {roadTest.decision_note ? <span className="text-muted"> · {roadTest.decision_note}</span> : null}
                <span className="text-muted"> · {roadTestLine(roadTest)}</span>
              </p>
              <form action={decideRoadTest.bind(null, id)} className="flex flex-col gap-3">
                <ChoiceButtons name="road_test" columns={3} defaultValue={roadTest.decision ?? defaultRoadTest} options={ROAD_TEST_CHOICES} />
                <Textarea name="road_test_note" rows={1} required placeholder="Why the change (required)" />
                <Button type="submit" tone="secondary" size="md">
                  Save road test choice
                </Button>
                <p className="text-xs text-muted">Choosing No road test or Not possible opens the inspection for the technician at once.</p>
              </form>
            </Card>
          ) : null}

          {canNote && job.is_open && !job.assigned_to ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Note to the workshop manager</SectionLabel>
              <form action={setAssignmentNote.bind(null, id)} className="flex flex-col gap-3">
                <Textarea name="assignment_note" rows={2} maxLength={500} defaultValue={job.assignment_note ?? ""} placeholder="Short note about this car for whoever assigns it" />
                <Button type="submit" tone="secondary" size="md">
                  {job.assignment_note ? "Update note" : "Send note"}
                </Button>
              </form>
            </Card>
          ) : null}

          <div id="moves" className="flex flex-col gap-6">
            {pendingMove ? (
              <Card className="flex flex-col gap-3 border-amber-bar">
                <SectionLabel>Special move requested</SectionLabel>
                <p className="text-sm">
                  <span className="font-semibold">{pendingMove.requester?.display_name}</span> · {formatDateTime(pendingMove.created_at)}: {pendingMove.reason}
                </p>
                {can(role, "moveJobs") ? <DecideMoveForm action={decideMove.bind(null, id, pendingMove.id)} currentStatus={job.status} /> : <p className="text-xs text-muted">Waiting for the owner.</p>}
              </Card>
            ) : null}
            {canRequestMove && !pendingMove ? (
              <Card className="flex flex-col gap-3">
                <SectionLabel>Request special move</SectionLabel>
                <p className="text-xs text-muted">Only the owner can move a job past a gate. Ask with a reason; the owner is notified.</p>
                <RequestMoveForm action={requestMove.bind(null, id)} />
              </Card>
            ) : null}
            {canMove ? (
              <Card className="flex flex-col gap-3">
                <SectionLabel>Move to step (owner)</SectionLabel>
                <form action={moveJob.bind(null, id)} className="flex flex-col gap-3">
                  <Select name="status" defaultValue={job.status}>
                    {MANUAL_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                  <Textarea name="reason" rows={1} required placeholder="Reason (stays on the job card)" />
                  <Button type="submit" tone="secondary">
                    Move
                  </Button>
                  <p className="text-xs text-muted">Owner only. The step opens properly: to QC opens the round, to Work builds the work order.</p>
                </form>
              </Card>
            ) : null}
          </div>

          {canPlan ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Priority</SectionLabel>
              <form action={setJobPriority.bind(null, id)} className="flex gap-2">
                {(["high", "normal", "low"] as const).map((p) => (
                  <Button key={p} type="submit" name="priority" value={p} tone={job.priority === p ? "primary" : "secondary"} size="md" className="flex-1">
                    {p[0].toUpperCase() + p.slice(1)}
                  </Button>
                ))}
              </form>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

async function loadTechnicians() {
  const { data } = await createAdminClient().from("staff").select("id, display_name, department_id").eq("is_active", true).eq("role_id", "technician").order("display_name");
  return (data ?? []) as { id: string; display_name: string; department_id: string | null }[];
}

async function loadApproverContacts(customerId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("customer_contacts").select("id, name, phone, can_approve").eq("customer_id", customerId).eq("is_active", true).eq("can_approve", true).order("name");
  return (data ?? []) as { id: string; name: string; phone: string; can_approve: boolean }[];
}
