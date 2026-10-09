import Link from "next/link";
import { CarPicture } from "@/components/CarPicture";
import { PriorityBadge, TimingBadge } from "@/components/JobBadges";
import { LiveRefresh } from "@/components/LiveRefresh";
import { StageTrack } from "@/components/StageTrack";
import { Badge, Button, Card, Empty, Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { clockIn, clockOut } from "../jobs/work-actions";
import { signCarPictures } from "@/lib/car-pictures";
import type { InspectionStatus } from "@/lib/inspection";
import { STATUS_LABELS, clockOf, formatPromised, jobTiming, urgencyRank } from "@/lib/jobs";
import { roadTestWaiting, type RoadTestRow } from "@/lib/road-test";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
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
  if (j.status === "in_work" && j.work_done_at) return { text: "Job finished, waiting for the manager", tone: "green" };
  if (["approved", "waiting_parts", "in_work", "pending_qc", "pending_wash", "ready", "pending_payment", "in_delivery"].includes(j.status)) return { text: STATUS_LABELS[j.status], tone: j.status === "in_work" ? "ink" : "neutral" };
  if (insp?.status === "submitted") return { text: "Submitted, waiting for the workshop manager", tone: "amber" };
  if (insp?.status === "returned") return { text: "Sent back by the workshop manager: open it and fix", tone: "red" };
  if (insp?.status === "approved") return { text: "Report approved", tone: "green" };
  if (roadTestWaiting(j.road_test?.[0] ?? null)) return { text: "Waiting for road test", tone: "ink" };
  return { text: STATUS_LABELS[j.status], tone: "neutral" };
}

/** The technician's list: the cars assigned to them, or that the manager put them on, with the parts ticks. */
export default async function MyJobsPage({ searchParams }: { searchParams: Promise<{ submitted?: string; message?: string }> }) {
  const staff = await requirePermission("viewOwnJobs");
  const { submitted, message } = await searchParams;
  const settings = await getSettings();
  const supabase = await createClient();
  const admin = createAdminClient();
  const [{ data: shift }, { data: onCar }] = await Promise.all([
    supabase.from("shifts").select("id, clock_in").eq("staff_id", staff.id).is("clock_out", null).maybeSingle(),
    admin.from("job_technicians").select("job_id").eq("staff_id", staff.id).eq("is_active", true).is("left_at", null),
  ]);
  const carIds = (onCar ?? []).map((t) => t.job_id);
  const { data } = await supabase
    .from("jobs")
    .select(
      "id, job_number, vehicle_id, customer_id, stage, status, priority, promised_at, assigned_to, assigned_at, gated_in_at, gated_in_by, gated_out_at, gated_out_by, first_approval_at, stage_entered_at, is_open, department, work_done_at, plan_start_date, comeback_of, created_at, updated_at, vehicle:vehicles(photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), gate_in:gate_ins(dash_cam, customer_requests), requests:job_requests(id, position, text, is_active), inspection:inspections(status, is_active), road_test:road_tests(status, decision)",
    )
    .eq("is_open", true)
    .or(carIds.length ? `assigned_to.eq.${staff.id},id.in.(${carIds.join(",")})` : `assigned_to.eq.${staff.id}`);
  const clockFor = (j: Row) => clockOf(j, settings);
  const rows = ((data ?? []) as unknown as Row[]).sort((a, b) => {
    const ra = urgencyRank(a, clockFor(a));
    const rb = urgencyRank(b, clockFor(b));
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
    return 0;
  });
  const [pictures, { data: vip }, { data: partRows }] = await Promise.all([
    signCarPictures(rows.map((j) => j.vehicle?.photo_path)),
    rows.length ? supabase.from("customer_vip_flags").select("id, is_vip").in("id", Array.from(new Set(rows.map((j) => j.customer_id)))) : Promise.resolve({ data: [] as { id: string; is_vip: boolean }[] }),
    rows.length ? admin.from("part_items").select("job_id, description, issue_status, order_status, expected_date, delivery_date, return_status").in("job_id", rows.map((j) => j.id)).eq("is_active", true).neq("order_status", "none").neq("return_status", "returned") : Promise.resolve({ data: [] }),
  ]);
  const vipIds = new Set((vip ?? []).filter((v) => v.is_vip).map((v) => v.id));
  rows.sort((a, b) => {
    const ra = urgencyRank(a, clockFor(a), vipIds.has(a.customer_id));
    const rb = urgencyRank(b, clockFor(b), vipIds.has(b.customer_id));
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
    return 0;
  });
  const submittedJob = submitted ? rows.find((j) => j.id === submitted) : null;
  type P = { job_id: string; description: string; issue_status: string; order_status: string; expected_date: string | null; delivery_date: string | null };
  const partsOf = (jobId: string) => ((partRows ?? []) as P[]).filter((p) => p.job_id === jobId);

  return (
    <>
      {submitted ? <SubmittedOverlay jobNumber={submittedJob?.job_number ?? ""} /> : null}
      <LiveRefresh tables={["jobs", "inspections", "road_tests", "job_technicians", "part_items"]} pollMs={60000} />
      <PageHeader
        title="My jobs"
        subtitle={`${rows.length} car${rows.length === 1 ? "" : "s"} for you${shift ? ` · clocked in ${formatDateTime(shift.clock_in)}` : ""}`}
        actions={
          <form action={shift ? clockOut : clockIn}>
            <Button type="submit" size="lg" tone={shift ? "secondary" : "primary"}>{shift ? "Clock out" : "Clock in"}</Button>
          </form>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {rows.length === 0 ? (
        <Empty title="No cars for you right now" />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((j) => {
            const timing = jobTiming(j.promised_at, j.is_open, clockFor(j));
            const line = technicianLine(j);
            const parts = partsOf(j.id);
            const handed = parts.filter((p) => p.issue_status === "confirmed");
            const coming = parts.filter((p) => p.issue_status !== "confirmed" && p.order_status !== "received");
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
                        {j.comeback_of ? <Badge tone="red">Comeback</Badge> : null}
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
                      {parts.length ? (
                        <span className="text-sm">
                          <span className="font-semibold">Parts: </span>
                          <span className="text-green font-semibold">✓ {handed.length} of {parts.length} handed over</span>
                          {coming.length ? <span className="text-muted"> · {coming.map((p) => `${p.description} coming ${p.expected_date ?? p.delivery_date ? formatDate((p.expected_date ?? p.delivery_date) + "T12:00:00+04:00") : "soon"}`).join(", ")}</span> : null}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className="flex flex-wrap items-center gap-2 text-sm font-bold">
                    <Badge tone={line.tone}>{line.text}</Badge>
                    {j.plan_start_date && j.status === "in_work" ? <span className="text-muted font-semibold">start {formatDate(j.plan_start_date + "T12:00:00+04:00")}</span> : null}
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
