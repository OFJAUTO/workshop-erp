import Link from "next/link";
import { CarPicture } from "@/components/CarPicture";
import { PriorityBadge, TimingBadge } from "@/components/JobBadges";
import { LiveRefresh } from "@/components/LiveRefresh";
import { StageTrack } from "@/components/StageTrack";
import { Badge, Button, Card, Empty, Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { clockIn, clockOut } from "../jobs/work-actions";
import { signCarPictures } from "@/lib/car-pictures";
import type { InspectionStatus } from "@/lib/inspection";
import { STATUS_LABELS, clockOf, formatPromised, jobTiming, urgencyRank } from "@/lib/jobs";
import { roadTestWaiting, type RoadTestRow } from "@/lib/road-test";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type JobRow } from "@/lib/types";
import { SubmittedOverlay } from "./SubmittedOverlay";

type Row = JobRow & {
  vehicle: { photo_path: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
  gate_in: { dash_cam: boolean; customer_requests: string } | null;
  requests: { id: string; position: number; text: string; is_active: boolean }[] | null;
  inspection: { status: InspectionStatus; is_active: boolean }[] | null;
  road_test: Pick<RoadTestRow, "status" | "decision">[] | null;
};

/** What the technician sees on each card: where the car is from their point of view. */
function technicianLine(j: Row): { text: string; tone: "neutral" | "amber" | "green" | "red" | "ink" } {
  const insp = j.inspection?.find((i) => i.is_active) ?? j.inspection?.[0] ?? null;
  // Past the quotation the car's own status is what matters (in work, QC, wash, ready), not the old report.
  if (["approved", "waiting_parts", "in_work", "pending_qc", "pending_wash", "ready", "pending_payment", "in_delivery"].includes(j.status)) return { text: STATUS_LABELS[j.status], tone: j.status === "in_work" ? "ink" : "neutral" };
  if (insp?.status === "submitted") return { text: "Submitted, waiting for the workshop manager", tone: "amber" };
  if (insp?.status === "returned") return { text: "Sent back by the workshop manager: open it and fix", tone: "red" };
  if (insp?.status === "approved") return { text: "Report approved", tone: "green" };
  if (roadTestWaiting(j.road_test?.[0] ?? null)) return { text: "Waiting for road test", tone: "ink" };
  return { text: STATUS_LABELS[j.status], tone: "neutral" };
}

/** The technician's list: cars assigned to them. */
export default async function MyJobsPage({ searchParams }: { searchParams: Promise<{ submitted?: string; message?: string }> }) {
  const staff = await requirePermission("viewOwnJobs");
  const { submitted, message } = await searchParams;
  const settings = await getSettings();
  const supabase = await createClient();
  const { data: shift } = await supabase.from("shifts").select("id, clock_in").eq("staff_id", staff.id).is("clock_out", null).maybeSingle();
  const { data } = await supabase
    .from("jobs")
    .select(
      "id, job_number, vehicle_id, customer_id, stage, status, priority, promised_at, assigned_to, assigned_at, gated_in_at, gated_in_by, gated_out_at, gated_out_by, first_approval_at, stage_entered_at, is_open, department, created_at, updated_at, vehicle:vehicles(photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), gate_in:gate_ins(dash_cam, customer_requests), requests:job_requests(id, position, text, is_active), inspection:inspections(status, is_active), road_test:road_tests(status, decision)",
    )
    .eq("is_open", true)
    .eq("assigned_to", staff.id);
  const clockFor = (j: Row) => clockOf(j, settings);
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
  rows.sort((a, b) => {
    const ra = urgencyRank(a, clockFor(a), vipIds.has(a.customer_id));
    const rb = urgencyRank(b, clockFor(b), vipIds.has(b.customer_id));
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
    return 0;
  });
  const submittedJob = submitted ? rows.find((j) => j.id === submitted) : null;

  return (
    <>
      {submitted ? <SubmittedOverlay jobNumber={submittedJob?.job_number ?? ""} /> : null}
      <LiveRefresh tables={["jobs", "inspections", "road_tests"]} pollMs={60000} />
      <PageHeader
        title="My jobs"
        subtitle={`${rows.length} car${rows.length === 1 ? "" : "s"} assigned to you${shift ? ` · clocked in ${formatDateTime(shift.clock_in)}` : ""}`}
        actions={
          <form action={shift ? clockOut : clockIn}>
            <Button type="submit" size="lg" tone={shift ? "secondary" : "primary"}>{shift ? "Clock out" : "Clock in"}</Button>
          </form>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {rows.length === 0 ? (
        <Empty title="No cars assigned to you right now" />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((j) => {
            const timing = jobTiming(j.promised_at, j.is_open, clockFor(j));
            const line = technicianLine(j);
            return (
              <Link key={j.id} href={`/my-jobs/${j.id}`} className="block">
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
                      {j.requests?.filter((r) => r.is_active).length ? (
                        <ol className="list-decimal pl-5 text-sm flex flex-col gap-0.5">
                          {j.requests.filter((r) => r.is_active).sort((a, b) => a.position - b.position).map((r) => (
                            <li key={r.id}>{r.text}</li>
                          ))}
                        </ol>
                      ) : (
                        <span className="text-sm">{j.gate_in?.customer_requests}</span>
                      )}
                    </div>
                  </div>
                  <span className="flex flex-wrap items-center gap-2 text-sm font-bold">
                    <Badge tone={line.tone}>{line.text}</Badge>
                    {j.promised_at ? <span className="text-muted font-semibold">promised {formatPromised(j.promised_at)}</span> : null}
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
