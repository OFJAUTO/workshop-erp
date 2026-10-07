import Link from "next/link";
import { CarPicture } from "@/components/CarPicture";
import { PriorityBadge, TimingBadge } from "@/components/JobBadges";
import { StageTrack } from "@/components/StageTrack";
import { Badge, Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { signCarPictures } from "@/lib/car-pictures";
import { formatDate } from "@/lib/format";
import { STATUS_LABELS, jobTiming, urgencyRank } from "@/lib/jobs";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type JobRow } from "@/lib/types";

type Row = JobRow & {
  vehicle: { photo_path: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
  customer: { full_name: string; company_name: string | null } | null;
};

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const staff = await requirePermission("viewJobs");
  const { show } = await searchParams;
  const closed = show === "closed";
  const role = staff.role_id as RoleId;
  const settings = await getSettings();

  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select(
      "id, job_number, vehicle_id, customer_id, stage, status, priority, promised_at, assigned_to, assigned_at, gated_in_at, gated_in_by, gated_out_at, gated_out_by, first_approval_at, stage_entered_at, is_open, created_at, updated_at, vehicle:vehicles(photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), customer:customers(full_name, company_name)",
    )
    .eq("is_open", !closed)
    .order(closed ? "gated_out_at" : "gated_in_at", { ascending: false })
    .limit(200);
  const clockFor = (j: Row) => ({ stage: j.stage, enteredAt: j.stage_entered_at, targetHours: settings.stage_target_hours });
  const rows = ((data ?? []) as unknown as Row[]).sort((a, b) => {
    if (closed) return 0;
    const ra = urgencyRank(a, clockFor(a));
    const rb = urgencyRank(b, clockFor(b));
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
    return 0;
  });
  const pictures = await signCarPictures(rows.map((j) => j.vehicle?.photo_path));

  return (
    <>
      <PageHeader
        title={closed ? "Closed jobs" : "Open jobs"}
        subtitle={`${rows.length} job${rows.length === 1 ? "" : "s"}`}
        actions={
          <>
            <LinkButton href={closed ? "/jobs" : "/jobs?show=closed"} tone="secondary">
              {closed ? "Show open" : "Show closed"}
            </LinkButton>
            {can(role, "gateIn") ? <LinkButton href="/gate-in">Gate in a car</LinkButton> : null}
          </>
        }
      />
      {rows.length === 0 ? (
        <Empty title={closed ? "No closed jobs yet" : "No cars in the workshop"} />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((j) => {
            const timing = jobTiming(j.promised_at, j.is_open, clockFor(j));
            return (
              <Link key={j.id} href={`/jobs/${j.id}`} className="block">
                <Card className="flex flex-col md:flex-row md:items-center gap-5 hover:border-ink">
                  <CarPicture url={j.vehicle?.photo_path ? (pictures.get(j.vehicle.photo_path) ?? null) : null} alt={j.vehicle ? formatPlate(j.vehicle) : "Car"} className="w-full md:w-48" />
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[17px] font-extrabold tracking-[0.03em]">{j.vehicle ? formatPlate(j.vehicle) : "?"}</span>
                      <PriorityBadge priority={j.priority} />
                      <TimingBadge timing={timing} />
                      {!j.is_open ? <Badge>Closed</Badge> : null}
                    </div>
                    <span className="text-sm font-semibold">{[j.vehicle?.make?.name, j.vehicle?.model?.name, j.vehicle?.variant, j.vehicle?.model_year].filter(Boolean).join(" ")}</span>
                    <span className="text-xs text-muted">
                      {j.job_number} · {j.customer ? (j.customer.company_name ?? j.customer.full_name) + " · " : ""}
                      {closed ? `Out ${formatDate(j.gated_out_at)}` : `In ${formatDate(j.gated_in_at)}`}
                    </span>
                  </div>
                  <div className="md:flex-[2] min-w-0 flex flex-col gap-2.5">
                    <span className="text-sm font-bold">{STATUS_LABELS[j.status]}</span>
                    <StageTrack stage={j.stage} timing={timing} />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
