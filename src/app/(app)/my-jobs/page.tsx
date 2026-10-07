import Link from "next/link";
import { CarPicture } from "@/components/CarPicture";
import { PriorityBadge, TimingBadge } from "@/components/JobBadges";
import { LiveRefresh } from "@/components/LiveRefresh";
import { StageTrack } from "@/components/StageTrack";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { signCarPictures } from "@/lib/car-pictures";
import { STATUS_LABELS, formatPromised, jobTiming, urgencyRank } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type JobRow } from "@/lib/types";

type Row = JobRow & {
  vehicle: { photo_path: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
  gate_in: { dash_cam: boolean; customer_requests: string } | null;
};

/** The technician's list: cars assigned to them. The full technician screen arrives in Phase 6. */
export default async function MyJobsPage() {
  const staff = await requireStaff();
  const settings = await getSettings();
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select(
      "id, job_number, vehicle_id, customer_id, stage, status, priority, promised_at, assigned_to, assigned_at, gated_in_at, gated_in_by, gated_out_at, gated_out_by, first_approval_at, stage_entered_at, is_open, created_at, updated_at, vehicle:vehicles(photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), gate_in:gate_ins(dash_cam, customer_requests)",
    )
    .eq("is_open", true)
    .eq("assigned_to", staff.id);
  const clockFor = (j: Row) => ({ stage: j.stage, enteredAt: j.stage_entered_at, targetHours: settings.stage_target_hours });
  const rows = ((data ?? []) as unknown as Row[]).sort((a, b) => {
    const ra = urgencyRank(a, clockFor(a));
    const rb = urgencyRank(b, clockFor(b));
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
    return 0;
  });
  const [pictures, { data: vip }] = await Promise.all([
    signCarPictures(rows.map((j) => j.vehicle?.photo_path)),
    rows.length
      ? supabase.from("customer_vip_flags").select("id, is_vip").in("id", Array.from(new Set(rows.map((j) => j.customer_id))))
      : Promise.resolve({ data: [] as { id: string; is_vip: boolean }[] }),
  ]);
  const vipIds = new Set((vip ?? []).filter((v) => v.is_vip).map((v) => v.id));

  return (
    <>
      <LiveRefresh tables={["jobs"]} pollMs={60000} />
      <PageHeader title="My jobs" subtitle={`${rows.length} car${rows.length === 1 ? "" : "s"} assigned to you`} />
      {rows.length === 0 ? (
        <Empty title="No cars assigned to you right now" />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((j) => {
            const timing = jobTiming(j.promised_at, j.is_open, clockFor(j));
            return (
              <Link key={j.id} href={`/jobs/${j.id}`} className="block">
                <Card className="flex flex-col gap-3 hover:border-ink">
                  <div className="flex flex-col sm:flex-row gap-4">
                    <CarPicture url={j.vehicle?.photo_path ? (pictures.get(j.vehicle.photo_path) ?? null) : null} alt={j.vehicle ? formatPlate(j.vehicle) : "Car"} className="w-full sm:w-44" />
                    <div className="flex flex-col gap-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xl font-extrabold tracking-[0.03em]">{j.vehicle ? formatPlate(j.vehicle) : "?"}</span>
                        {vipIds.has(j.customer_id) ? <Badge tone="ink">VIP</Badge> : null}
                        <PriorityBadge priority={j.priority} />
                        <TimingBadge timing={timing} />
                      </div>
                      <span className="font-semibold">{[j.vehicle?.make?.name, j.vehicle?.model?.name, j.vehicle?.variant, j.vehicle?.model_year].filter(Boolean).join(" ")}</span>
                      {j.gate_in?.dash_cam ? <Badge tone="red">Dash cam fitted: disconnect</Badge> : null}
                      <span className="text-sm">{j.gate_in?.customer_requests}</span>
                    </div>
                  </div>
                  <span className="text-sm font-bold">
                    {STATUS_LABELS[j.status]}
                    {j.promised_at ? ` · promised ${formatPromised(j.promised_at)}` : ""}
                  </span>
                  <StageTrack stage={j.stage} timing={timing} compact />
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
