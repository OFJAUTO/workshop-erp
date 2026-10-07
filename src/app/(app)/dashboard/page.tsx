import Link from "next/link";
import { PriorityBadge, TimingBadge } from "@/components/JobBadges";
import { StageTrack } from "@/components/StageTrack";
import { Badge, Card, Empty, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { PENDING_GROUPS, STATUS_LABELS, formatPromised, jobTiming, urgencyRank, type JobStatus } from "@/lib/jobs";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type JobRow } from "@/lib/types";
import { ProfitPanel } from "./ProfitPanel";

type Row = JobRow & {
  vehicle: { photo_path: string | null; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string; make: { name: string } | null; model: { name: string } | null } | null;
  customer: { full_name: string; company_name: string | null } | null;
  assignee: { display_name: string } | null;
  gate_in: { condition: string; dash_cam: boolean; is_complete: boolean } | null;
};

const CONDITION_SHORT: Record<string, string> = { runs_drives: "Runs and drives", needs_assistance: "Needs assistance", does_not_run: "Does not run" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ pending?: string }> }) {
  const staff = await requirePermission("viewDashboard");
  const { pending } = await searchParams;
  const role = staff.role_id as RoleId;
  const settings = await getSettings();

  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select(
      "id, job_number, vehicle_id, customer_id, stage, status, priority, promised_at, assigned_to, assigned_at, gated_in_at, gated_in_by, gated_out_at, gated_out_by, first_approval_at, is_open, created_at, updated_at, vehicle:vehicles(photo_path, plate_country, plate_emirate, plate_code, plate_number, make:vehicle_makes(name), model:vehicle_models(name)), customer:customers(full_name, company_name), assignee:staff!jobs_assigned_to_fkey(display_name), gate_in:gate_ins(condition, dash_cam, is_complete)",
    )
    .eq("is_open", true);
  const all = ((data ?? []) as unknown as Row[]).sort((a, b) => {
    const ra = urgencyRank(a);
    const rb = urgencyRank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
    return 0;
  });

  const { data: vip } = all.length
    ? await supabase.from("customer_vip_flags").select("id, is_vip").in("id", Array.from(new Set(all.map((j) => j.customer_id))))
    : { data: [] as { id: string; is_vip: boolean }[] };
  const vipIds = new Set((vip ?? []).filter((v) => v.is_vip).map((v) => v.id));

  const timings = new Map(all.map((j) => [j.id, jobTiming(j.promised_at, j.is_open)]));
  const dueToday = all.filter((j) => timings.get(j.id)?.tone === "amber").length;
  const overdue = all.filter((j) => timings.get(j.id)?.tone === "red").length;
  const ready = all.filter((j) => j.status === "ready" || j.status === "pending_payment").length;

  const group = PENDING_GROUPS.find((g) => g.key === pending);
  const rows = group ? all.filter((j) => group.statuses.includes(j.status as JobStatus)) : all;

  const seesCustomers = can(role, "viewCustomers");
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dubai" }).format(new Date());

  return (
    <>
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

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="In the workshop" value={all.length} tone="ink" href="/dashboard" />
        <Tile label="Due today" value={dueToday} tone="amber" />
        <Tile label="Overdue" value={overdue} tone="red" />
        <Tile label="Ready to collect" value={ready} tone="green" href="/dashboard?pending=payment" />
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Pending</SectionLabel>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard" className={`inline-flex min-h-11 items-center gap-2.5 rounded-full border px-4 text-sm font-semibold ${!group ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
            All
            <span className={`inline-flex min-w-6 h-6 items-center justify-center rounded-full px-1.5 text-xs font-bold ${!group ? "bg-white text-ink" : "bg-ink text-white"}`}>{all.length}</span>
          </Link>
          {PENDING_GROUPS.map((g) => {
            const n = all.filter((j) => g.statuses.includes(j.status as JobStatus)).length;
            const active = group?.key === g.key;
            return (
              <Link key={g.key} href={`/dashboard?pending=${g.key}`} className={`inline-flex min-h-11 items-center gap-2.5 rounded-full border px-4 text-sm font-semibold ${active ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                {g.label}
                <span className={`inline-flex min-w-6 h-6 items-center justify-center rounded-full px-1.5 text-xs font-bold ${active ? "bg-white text-ink" : "bg-ink text-white"}`}>{n}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel right="Most urgent first">Cars</SectionLabel>
        {rows.length === 0 ? (
          <Empty title={group ? `Nothing pending ${group.label.toLowerCase()}` : "No cars in the workshop"} />
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((j) => {
              const timing = timings.get(j.id)!;
              return (
                <Link key={j.id} href={`/jobs/${j.id}`} className="block">
                  <Card className="flex flex-wrap items-center gap-x-7 gap-y-4 hover:border-ink">
                    <div className="flex-1 basis-64 min-w-0 flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[17px] font-extrabold tracking-[0.03em]">{j.vehicle ? formatPlate(j.vehicle) : "?"}</span>
                        {vipIds.has(j.customer_id) ? <Badge tone="ink">VIP</Badge> : null}
                        <PriorityBadge priority={j.priority} />
                        <TimingBadge timing={timing} />
                      </div>
                      <span className="text-sm font-semibold">{[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")}</span>
                      <span className="text-xs text-muted">
                        {j.assignee?.display_name ?? (seesCustomers && j.customer ? (j.customer.company_name ?? j.customer.full_name) : "Not assigned")}
                        {j.promised_at ? ` · ${formatPromised(j.promised_at)}` : ""}
                        {j.gate_in ? ` · ${CONDITION_SHORT[j.gate_in.condition] ?? ""}` : ""}
                        {j.gate_in?.dash_cam ? " · Dash cam" : ""}
                      </span>
                    </div>
                    <div className="flex-[999] basis-[560px] min-w-0 flex flex-col gap-2.5">
                      <span className="text-sm font-bold">{STATUS_LABELS[j.status]}</span>
                      <StageTrack stage={j.stage} timing={timing} />
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>On the clock</SectionLabel>
        <Card className="border-dashed">
          <p className="text-sm text-muted">Starts with the time clock (Phase 6). Technicians and their current jobs will appear here.</p>
        </Card>
      </section>
    </>
  );
}

function Tile({ label, value, tone, href }: { label: string; value: number; tone: "ink" | "amber" | "red" | "green"; href?: string }) {
  const color = { ink: "text-ink", amber: "text-amber", red: "text-red", green: "text-green" }[tone];
  const inner = (
    <Card className="flex flex-col gap-1.5 h-full">
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span className={`text-4xl font-extrabold leading-none ${color}`}>{value}</span>
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}
