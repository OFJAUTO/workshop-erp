import { LiveRefresh } from "@/components/LiveRefresh";
import { Card, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { signCarPictures } from "@/lib/car-pictures";
import { formatMinutes, jobConcernsSide, sideOfDepartment, type InspectionStatus } from "@/lib/inspection";
import { nextStepOf } from "@/lib/next-step";
import { inspectionOverTarget, inspectionWorkingMinutes } from "@/lib/inspection-data";
import { STATUS_LABELS, formatPromised, hoursInStage, jobTiming, urgencyRank, workingTimeOf, type JobStatus, type Priority, type Stage } from "@/lib/jobs";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type JobRow } from "@/lib/types";
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
  road_test: { status: "not_started" | "done" | "not_possible" }[] | null;
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
      "id, job_number, vehicle_id, customer_id, stage, status, priority, promised_at, assigned_to, assigned_at, gated_in_at, gated_in_by, gated_out_at, gated_out_by, first_approval_at, stage_entered_at, is_open, department, created_at, updated_at, vehicle:vehicles(photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), assignee:staff!jobs_assigned_to_fkey(display_name), gate_in:gate_ins(condition, dash_cam, is_complete, major_damage), inspection:inspections(status, technician_id, started_at, submitted_at, approved_at, elapsed_minutes, target_minutes), approval:approval_requests(sent_at, opened_at, approved_at, approver_name, created_at), road_test:road_tests(status)",
    )
    .eq("is_open", true);
  const all = (data ?? []) as unknown as Row[];
  const clockFor = (j: Row) => ({ stage: j.stage, enteredAt: j.stage_entered_at, targetHours: settings.stage_target_hours, workingTime });

  const customerIds = Array.from(new Set(all.map((j) => j.customer_id)));
  const [{ data: names }, pictures] = await Promise.all([
    all.length ? supabase.from("customer_public").select("id, full_name, company_name, is_vip").in("id", customerIds) : Promise.resolve({ data: [] as { id: string; full_name: string; company_name: string | null; is_vip: boolean }[] }),
    signCarPictures(all.map((j) => j.vehicle?.photo_path)),
  ]);
  const nameOf = new Map((names ?? []).map((n) => [n.id, n]));
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
    });
    return {
      statusLine: step.line || STATUS_LABELS[j.status as JobStatus],
      id: j.id,
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

      {can(role, "viewProfitPanel") ? (
        <ProfitPanel
          targetAed={Number(settings.daily_profit_target_aed) || 0}
          yellowPercent={Number(settings.profit_target_yellow_percent) || 80}
          invoicedAed={0}
          collectedAed={0}
          carryAed={0}
          live={false}
        />
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
                          <span className="text-muted font-normal"> · {r.assignee ?? ""} · {j.road_test?.[0]?.status && j.road_test[0].status !== "not_started" ? "road test done" : "road test pending"}</span>
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
        <SectionLabel>On the clock</SectionLabel>
        <Card className="border-dashed">
          <p className="text-sm text-muted">Starts with the time clock (Phase 6). Technicians and their current jobs will appear here.</p>
        </Card>
      </section>
    </>
  );
}
