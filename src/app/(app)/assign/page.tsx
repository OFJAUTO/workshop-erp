import { LiveRefresh } from "@/components/LiveRefresh";
import { technicianLoads } from "@/lib/technician-load";
import { Button, Card, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { signCarPictures } from "@/lib/car-pictures";
import { formatDate } from "@/lib/format";
import { jobConcernsSide, sideOfDepartment, roadTestSuggested } from "@/lib/inspection";
import { clockOf, formatWait, jobTiming, workingMinutesSince, workingTimeOf, type JobStatus, type Stage } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { electricalTasks } from "@/lib/bodyshop";
import { electricalDoneAction } from "../bodyshop/actions";
import { AssignBoard, type BoardCar } from "./AssignBoard";

type Row = {
  id: string;
  job_number: string;
  status: JobStatus;
  stage: Stage;
  stage_entered_at: string;
  department: string | null;
  priority: "high" | "normal" | "low";
  promised_at: string | null;
  is_open: boolean;
  gated_in_at: string;
  first_approval_at: string | null;
  assigned_to: string | null;
  customer_id: string;
  assignment_note: string | null;
  assignment_note_at: string | null;
  vehicle: { photo_path: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
  customer: { full_name: string; company_name: string | null; is_vip: boolean } | null;
  gate_in: { is_complete: boolean; condition: string; customer_requests: string; notes: string | null } | null;
  note_by: { display_name: string } | null;
};

/** The workshop manager's "To assign" list for their department, with each technician's current load and the road test choice. */
export default async function AssignPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("assignJobs");
  const { message, error } = await searchParams;
  const side = staff.role_id === "owner" ? null : sideOfDepartment(staff.department_id);
  const settings = await getSettings();
  const supabase = await createClient();
  const [{ data: jobs }, { data: load }, { data: requestRows }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, job_number, status, stage, stage_entered_at, department, priority, promised_at, is_open, gated_in_at, first_approval_at, assigned_to, customer_id, assignment_note, assignment_note_at, vehicle:vehicles(kind, photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), gate_in:gate_ins(is_complete, condition, customer_requests, notes), note_by:staff!jobs_assignment_note_by_fkey(display_name)")
      .eq("is_open", true)
      .is("assigned_to", null)
      .in("status", ["gate_in_pending", "pending_approval", "pending_inspection"])
      .order("gated_in_at"),
    supabase.from("jobs").select("assigned_to").eq("is_open", true).not("assigned_to", "is", null),
    supabase.from("job_requests").select("job_id, position, text").eq("is_active", true).order("position"),
  ]);
  const loads = await technicianLoads(settings, side);
  const requestsOf = (jobId: string) => ((requestRows ?? []) as { job_id: string; text: string }[]).filter((r) => r.job_id === jobId).map((r) => r.text);
  const rows = ((jobs ?? []) as unknown as Row[]).filter((j) => jobConcernsSide(j.department, side));
  // The customer's name for the card (never the phone): a narrow server-side read.
  const { data: custNames } = rows.length ? await createAdminClient().from("customers").select("id, full_name, company_name, is_vip").eq("is_active", true).in("id", Array.from(new Set(rows.map((j) => j.customer_id)))) : { data: [] as { id: string; full_name: string; company_name: string | null; is_vip: boolean }[] };
  const custOf = new Map((custNames ?? []).map((c) => [c.id, c]));
  for (const j of rows) j.customer = custOf.get(j.customer_id) ?? null;
  void load;
  const pictures = await signCarPictures(rows.map((j) => j.vehicle?.photo_path));
  const ready = rows.filter((j) => j.status === "pending_inspection");
  const waiting = rows.filter((j) => j.status !== "pending_inspection");
  const wt = workingTimeOf(settings);
  const now = new Date();
  const boardCarOf = (j: Row, canAssign: boolean): BoardCar => {
    const timing = jobTiming(j.promised_at, j.is_open, clockOf(j, settings));
    const reqs = requestsOf(j.id);
    return {
      id: j.id,
      plate: j.vehicle ? formatPlate(j.vehicle) : j.job_number,
      car: [j.vehicle?.make?.name, j.vehicle?.model?.name, j.vehicle?.variant, j.vehicle?.model_year].filter(Boolean).join(" ") || "Car",
      customer: j.customer?.company_name ?? j.customer?.full_name ?? "Customer",
      jobNumber: j.job_number,
      department: j.department,
      pictureUrl: j.vehicle?.photo_path ? (pictures.get(j.vehicle.photo_path) ?? null) : null,
      need: j.department === "bodyshop" ? "Bodyshop work to assign" : "Inspection to assign",
      waited: formatWait(workingMinutesSince(j.first_approval_at ?? j.gated_in_at, wt, now), wt),
      tone: canAssign ? (timing.tone === "red" ? "red" : timing.tone === "amber" ? "amber" : "none") : "none",
      vip: !!j.customer?.is_vip,
      high: j.priority === "high",
      doesNotRun: j.gate_in?.condition === "does_not_run",
      requests: reqs.length ? reqs : j.gate_in?.customer_requests ? [j.gate_in.customer_requests] : [],
      gateInNotes: j.gate_in?.notes ?? null,
      advisorNote: j.assignment_note ? { by: j.note_by?.display_name ?? "the advisor", text: j.assignment_note } : null,
      canAssign,
      blockedWhy: canAssign ? null : j.status === "gate_in_pending" ? "Gate-in photos or video still missing." : "Waiting for the customer to approve the job card.",
      roadTestSuggested: j.department !== "bodyshop" && roadTestSuggested([...reqs, j.gate_in?.customer_requests ?? ""]),
      defaultRoadTest: j.gate_in?.condition === "does_not_run" ? "not_possible" : null,
    };
  };
  const boardCars = [...ready.map((j) => boardCarOf(j, true)), ...waiting.map((j) => boardCarOf(j, false))];

  const electrical = await electricalTasks();
  return (
    <>
      <LiveRefresh tables={["jobs", "gate_ins", "approval_requests"]} />
      <PageHeader title="To assign" subtitle={side ? `${side === "mechanical" ? "Mechanical" : "Bodyshop"} cars waiting for a technician` : "All cars waiting for a technician"} />
      {message ? <p className="rounded-control bg-green-soft px-4 py-3 text-sm font-semibold text-green">{message}</p> : null}
      {error ? <p className="rounded-control bg-red-soft px-4 py-3 text-sm font-semibold text-red">{error}</p> : null}
      {electrical.length ? (
        <Card className="flex flex-col gap-2 border-ink" data-electrical-tasks>
          <SectionLabel right={`${electrical.length}`}>Electrical resets from the bodyshop</SectionLabel>
          <ul className="divide-y divide-line">
            {electrical.map(({ stage, job }) => (
              <li key={stage.id} className="py-2 flex flex-wrap items-center gap-2">
                <span className="font-extrabold tracking-[0.03em]">{job.vehicle ? formatPlate(job.vehicle) : job.job_number}</span>
                <span className="text-sm text-muted">{[job.vehicle?.make?.name, job.vehicle?.model?.name].filter(Boolean).join(" ")} · {stage.status === "active" ? "ready for the electrician" : "coming after the refit"} · due {formatDate(stage.due_date)}</span>
                {stage.status === "active" ? <form action={electricalDoneAction.bind(null, job.id, stage.id)} className="ml-auto"><Button type="submit" size="md">Done</Button></form> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <p className="text-[13px] text-muted">Target: {Number(settings.assignment_target_minutes) || 30} working minutes from the customer&apos;s approval. Past it the card turns amber, then red, and the owner is told. Tap a car, tick the people, Assign.</p>
      <AssignBoard cars={boardCars} people={loads} />
    </>
  );
}
