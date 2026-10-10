import { LiveRefresh } from "@/components/LiveRefresh";
import { Card, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { signCarPictures } from "@/lib/car-pictures";
import { formatMinutes, jobConcernsSide, sideOfDepartment, type InspectionStatus } from "@/lib/inspection";
import { nextStepOf } from "@/lib/next-step";
import { inspectionOverTarget, inspectionWorkingMinutes } from "@/lib/inspection-data";
import { STATUS_LABELS, clockOf, formatPromised, hoursInStage, jobTiming, urgencyRank, workingTimeOf, type JobStatus, type Priority, type Stage } from "@/lib/jobs";
import { roadTestWaiting, type RoadTestRow } from "@/lib/road-test";
import { loadQuoteSummaries } from "@/lib/quote-data";
import { quoteState } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type JobRow } from "@/lib/types";
import { dailyProfit } from "@/lib/profit";
import { createAdminClient } from "@/lib/supabase/admin";
import { ElapsedTimer } from "@/components/ElapsedTimer";
import { DashboardCars, type DashRow } from "./DashboardCars";
import { ProfitPanel } from "./ProfitPanel";

type Row = JobRow & {
  vehicle: {
    photo_path: string | null;
    has_plate: boolean;
    plate_country: string;
    plate_emirate: string | null;
    plate_code: string | null;
    plate_number: string | null;
    vin: string | null;
    variant: string | null;
    model_year: number | null;
    make: { name: string } | null;
    model: { name: string } | null;
  } | null;
  assignee: { display_name: string } | null;
  approval: { sent_at: string | null; opened_at: string | null; approved_at: string | null; approver_name: string | null; created_at: string }[] | null;
  road_test: Pick<RoadTestRow, "status" | "decision">[] | null;
  gate_in: { condition: string; dash_cam: boolean; is_complete: boolean; major_damage: boolean } | null;
  inspection: { status: InspectionStatus; technician_id: string | null; started_at: string | null; submitted_at: string | null; approved_at: string | null; elapsed_minutes: number | null; target_minutes: number | null }[] | null;
};

const CONDITION_SHORT: Record<string, string> = { runs_drives: "Runs and drives", needs_assistance: "Needs assistance", does_not_run: "Does not run" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ pending?: string }> }) {
  const staff = await requirePermission("viewDashboard");
  const { pending } = await searchParams;
  const role = staff.role_id as RoleId;
  const settings = await getSettings();
  const workingTime = workingTimeOf(settings);

  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select(
      "id, job_number, job_kind, vehicle_id, customer_id, stage, status, priority, promised_at, assigned_to, assigned_at, gated_in_at, gated_in_by, gated_out_at, gated_out_by, first_approval_at, stage_entered_at, is_open, department, ready_sent_at, created_at, updated_at, vehicle:vehicles(kind, photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), assignee:staff!jobs_assigned_to_fkey(display_name), gate_in:gate_ins(condition, dash_cam, is_complete, major_damage), inspection:inspections(status, technician_id, started_at, submitted_at, approved_at, elapsed_minutes, target_minutes), approval:approval_requests(sent_at, opened_at, approved_at, approver_name, created_at), road_test:road_tests(status, decision)",
    )
    .eq("is_open", true);
  const all = (data ?? []) as unknown as Row[];
  const clockFor = (j: Row) => clockOf(j, settings);

  const customerIds = Array.from(new Set(all.map((j) => j.customer_id)));
  const quoteSummaries = await loadQuoteSummaries(all.filter((j) => ["pending_quote", "pending_customer_approval"].includes(j.status)).map((j) => j.id));
  const [{ data: names }, pictures] = await Promise.all([
    all.length ? supabase.from("customer_public").select("id, full_name, company_name, is_vip").in("id", customerIds) : Promise.resolve({ data: [] as { id: string; full_name: string; company_name: string | null; is_vip: boolean }[] }),
    signCarPictures(all.map((j) => j.vehicle?.photo_path)),
  ]);
  const nameOf = new Map((names ?? []).map((n) => [n.id, n]));
  const [profit, { data: clocked }, { data: invoiced }] = await Promise.all([
    can(role, "viewProfitPanel") ? dailyProfit(settings) : Promise.resolve(null),
    createAdminClient().from("invoices").select("job_id, number, total_aed, kind").in("kind", ["tax_invoice", "proforma"]).eq("status", "issued").eq("is_active", true).is("converted_to", null).in("job_id", all.map((j) => j.id)),
    createAdminClient().from("work_sessions").select("id, job_id, technician_id, started_at, technician:staff!work_sessions_technician_id_fkey(display_name), job:jobs(job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin))").is("ended_at", null).order("started_at"),
  ]);
  const invoicedJobs = new Map(((invoiced ?? []) as unknown as { job_id: string; number: string; total_aed: number | string }[]).map((i) => [i.job_id, i]));
  const toSend = all.filter((j) => invoicedJobs.has(j.id) && !(j as unknown as { ready_sent_at: string | null }).ready_sent_at);
  const awaitingPayment = all.filter((j) => j.status === "pending_payment");
  const onClock = (clocked ?? []) as unknown as { id: string; job_id: string; started_at: string; technician: { display_name: string } | null; job: { job_number: string; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null } | null } | null }[];
  const vipIds = new Set((names ?? []).filter((v) => v.is_vip).map((v) => v.id));
  const seesCustomers = can(role, "viewCustomers");
  const now = new Date();

  const showInspectionTime = role === "owner" || role === "workshop_manager" || role === "service_advisor";
  const rows: DashRow[] = all.map((j) => {
    const clock = clockFor(j);
    const insp = j.inspection?.find((i) => i.status === "in_progress" || i.status === "submitted" || i.status === "approved") ?? null;
    const inspMinutes = insp && insp.started_at ? inspectionWorkingMinutes(insp, workingTime, now) : 0;
    const inspOver = !!insp && insp.status === "in_progress" && inspectionOverTarget(insp, workingTime, now);
    const baseTiming = jobTiming(j.promised_at, j.is_open, clock, now);
    const latestApproval = (j.approval ?? []).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;
    const step = nextStepOf(j.id, {
      status: j.status as JobStatus,
      is_open: j.is_open,
      assigned_to: j.assigned_to,
      first_approval_at: j.first_approval_at,
      gated_in_at: j.gated_in_at,
      stage_entered_at: j.stage_entered_at,
      assigneeName: j.assignee?.display_name ?? null,
      advisorName: null,
      managerLabel: j.department === "bodyshop" ? "the bodyshop manager" : "the workshop manager",
      inspection: insp ? { status: insp.status, technician_id: insp.technician_id, submitted_at: insp.submitted_at, approved_at: insp.approved_at } : null,
      roadTest: j.road_test?.[0] ?? null,
      approval: latestApproval,
      gateInComplete: !!j.gate_in?.is_complete,
      loose: j.job_kind === "loose",
      quote: quoteSummaries.has(j.id) ? quoteState(quoteSummaries.get(j.id)!, !!insp && insp.status === "approved") : null,
    });
    return {
      statusLine: step.line || STATUS_LABELS[j.status as JobStatus],
      id: j.id,
      loose: j.job_kind === "loose",
      jobNumber: j.job_number,
      plate: j.vehicle ? formatPlate(j.vehicle) : "?",
      title: [j.vehicle?.make?.name, j.vehicle?.model?.name, j.vehicle?.variant, j.vehicle?.model_year].filter(Boolean).join(" "),
      customer: seesCustomers ? (nameOf.get(j.customer_id)?.company_name ?? nameOf.get(j.customer_id)?.full_name ?? null) : null,
      assignee: j.assignee?.display_name ?? null,
      vin: j.vehicle?.vin ?? null,
      pictureUrl: j.vehicle?.photo_path ? (pictures.get(j.vehicle.photo_path) ?? null) : null,
      vip: vipIds.has(j.customer_id),
      priority: j.priority as Priority,
      status: j.status as JobStatus,
      stage: j.stage as Stage,
      promisedAt: j.promised_at,
      promisedLabel: formatPromised(j.promised_at),
      gatedInAt: j.gated_in_at,
      hoursInStage: hoursInStage(clock, now),
      conditionShort: j.gate_in ? (CONDITION_SHORT[j.gate_in.condition] ?? "") : "",
      dashCam: !!j.gate_in?.dash_cam,
      majorDamage: !!j.gate_in?.major_damage,
      timing: inspOver ? { tone: "red" as const, label: `Inspection ${formatMinutes(inspMinutes)} · over target`, daysOver: baseTiming.daysOver } : baseTiming,
      inspectionLabel: insp && insp.started_at && showInspectionTime ? `Inspection ${insp.status === "in_progress" ? "running " : ""}${formatMinutes(inspMinutes)}` : null,
      urgency: inspOver ? [0, ...urgencyRank(j, clock, vipIds.has(j.customer_id)).slice(1)] : [...urgencyRank(j, clock, vipIds.has(j.customer_id))],
    };
  });

  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dubai" }).format(now);

  return (
    <>
      <LiveRefresh tables={["jobs", "gate_ins"]} pollMs={60000} />
      <PageHeader
        title="Dashboard"
        subtitle={today}
        actions={can(role, "gateIn") ? <LinkButton href="/gate-in" size="lg">Gate in a car</LinkButton> : undefined}
      />

      {can(role, "viewProfitPanel") && profit ? (
        <ProfitPanel
          targetAed={profit.target}
          yellowPercent={profit.yellowPercent}
          invoicedAed={profit.invoicedProfit}
          collectedAed={profit.collected}
          carryAed={profit.carry}
          live
          provisional={profit.provisional}
          count={profit.count}
          comebacksAed={profit.comebacks}
        />
      ) : null}

      {role === "service_advisor" || role === "owner" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card className={`flex flex-col gap-2 ${toSend.length ? "border-ink" : ""}`}>
            <SectionLabel right={`${toSend.length}`}>Proformas to send</SectionLabel>
            {toSend.length === 0 ? <p className="text-sm text-muted">Nothing to send.</p> : (
              <ul className="divide-y divide-line text-sm">
                {toSend.map((j) => { const r = rows.find((x) => x.id === j.id)!; return <li key={j.id} className="py-1.5 flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{r.plate} · {r.title}</span><LinkButton href={`/jobs/${j.id}`} size="md">Send the invoice</LinkButton></li>; })}
              </ul>
            )}
          </Card>
          <Card className={`flex flex-col gap-2 ${awaitingPayment.length ? "border-ink" : ""}`}>
            <SectionLabel right={`${awaitingPayment.length}`}>Awaiting payment</SectionLabel>
            {awaitingPayment.length === 0 ? <p className="text-sm text-muted">Nothing outstanding.</p> : (
              <ul className="divide-y divide-line text-sm">
                {awaitingPayment.map((j) => { const r = rows.find((x) => x.id === j.id)!; const inv = invoicedJobs.get(j.id); return <li key={j.id} className="py-1.5 flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{r.plate} · {r.title}{inv ? <span className="text-muted font-normal"> · {inv.number}</span> : null}</span><LinkButton href={`/jobs/${j.id}`} tone="secondary" size="md">Job card</LinkButton></li>; })}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {can(role, "approveInspections") ? (
        (() => {
          const side = role === "owner" ? null : sideOfDepartment(staff.department_id);
          const toApprove = all.filter((j) => jobConcernsSide(j.department, side) && j.inspection?.some((i) => i.status === "submitted"));
          return (
            <Card className={`flex flex-col gap-3 ${toApprove.length ? "border-ink" : ""}`}>
              <SectionLabel right={`${toApprove.length}`}>Inspections to approve</SectionLabel>
              {toApprove.length === 0 ? (
                <p className="text-sm text-muted">Nothing waiting for your review.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {toApprove.map((j) => {
                    const r = rows.find((x) => x.id === j.id)!;
                    return (
                      <li key={j.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">
                          {r.plate} · {r.title}
                          <span className="text-muted font-normal"> · {r.assignee ?? ""}{roadTestWaiting(j.road_test?.[0] ?? null) ? " · road test pending" : ""}</span>
                        </span>
                        <LinkButton href={`/jobs/${j.id}/inspection`} size="md">
                          Review
                        </LinkButton>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          );
        })()
      ) : null}

      <DashboardCars rows={rows} initialPending={pending} />

      <section className="flex flex-col gap-3">
        <SectionLabel right={`${onClock.length}`}>On the clock</SectionLabel>
        <Card className={onClock.length ? "" : "border-dashed"}>
          {onClock.length === 0 ? <p className="text-sm text-muted">No technician has a job clock running.</p> : (
            <ul className="divide-y divide-line text-sm">
              {onClock.map((s) => (
                <li key={s.id} className="py-2 flex flex-wrap items-center gap-3">
                  <span className="font-semibold w-40">{s.technician?.display_name ?? "Technician"}</span>
                  <span>{s.job?.vehicle ? formatPlate(s.job.vehicle) : ""} · {s.job?.job_number ?? ""}</span>
                  <span className="ml-auto font-mono"><ElapsedTimer since={s.started_at} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}
