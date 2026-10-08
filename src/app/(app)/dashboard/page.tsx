import { LiveRefresh } from "@/components/LiveRefresh";
import { Card, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { signCarPictures } from "@/lib/car-pictures";
import { formatPromised, hoursInStage, jobTiming, urgencyRank, workingTimeOf, type JobStatus, type Priority, type Stage } from "@/lib/jobs";
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
  customer: { full_name: string; company_name: string | null } | null;
  assignee: { display_name: string } | null;
  gate_in: { condition: string; dash_cam: boolean; is_complete: boolean; major_damage: boolean } | null;
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
      "id, job_number, vehicle_id, customer_id, stage, status, priority, promised_at, assigned_to, assigned_at, gated_in_at, gated_in_by, gated_out_at, gated_out_by, first_approval_at, stage_entered_at, is_open, created_at, updated_at, vehicle:vehicles(photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), customer:customers(full_name, company_name), assignee:staff!jobs_assigned_to_fkey(display_name), gate_in:gate_ins(condition, dash_cam, is_complete, major_damage)",
    )
    .eq("is_open", true);
  const all = (data ?? []) as unknown as Row[];
  const clockFor = (j: Row) => ({ stage: j.stage, enteredAt: j.stage_entered_at, targetHours: settings.stage_target_hours, workingTime });

  const [{ data: vip }, pictures] = await Promise.all([
    all.length
      ? supabase.from("customer_vip_flags").select("id, is_vip").in("id", Array.from(new Set(all.map((j) => j.customer_id))))
      : Promise.resolve({ data: [] as { id: string; is_vip: boolean }[] }),
    signCarPictures(all.map((j) => j.vehicle?.photo_path)),
  ]);
  const vipIds = new Set((vip ?? []).filter((v) => v.is_vip).map((v) => v.id));
  const seesCustomers = can(role, "viewCustomers");
  const now = new Date();

  const rows: DashRow[] = all.map((j) => {
    const clock = clockFor(j);
    return {
      id: j.id,
      jobNumber: j.job_number,
      plate: j.vehicle ? formatPlate(j.vehicle) : "?",
      title: [j.vehicle?.make?.name, j.vehicle?.model?.name, j.vehicle?.variant, j.vehicle?.model_year].filter(Boolean).join(" "),
      customer: seesCustomers && j.customer ? (j.customer.company_name ?? j.customer.full_name) : null,
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
      timing: jobTiming(j.promised_at, j.is_open, clock, now),
      urgency: [...urgencyRank(j, clock, vipIds.has(j.customer_id))],
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
