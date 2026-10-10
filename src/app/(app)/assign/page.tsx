import Link from "next/link";
import { CarPicture } from "@/components/CarPicture";
import { TimingBadge } from "@/components/JobBadges";
import { LiveRefresh } from "@/components/LiveRefresh";
import { TechnicianPicker } from "@/components/TechnicianPicker";
import { technicianLoads } from "@/lib/technician-load";
import { Badge, Button, Card, ChoiceButtons, Empty, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { signCarPictures } from "@/lib/car-pictures";
import { formatDateTime } from "@/lib/format";
import { JOB_DEPARTMENTS, jobConcernsSide, sideOfDepartment, roadTestSuggested } from "@/lib/inspection";
import { STATUS_LABELS, clockOf, jobTiming, type JobStatus, type Stage } from "@/lib/jobs";
import { ROAD_TEST_CHOICES } from "@/lib/road-test";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { assignJob } from "../jobs/actions";

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
  const [{ data: jobs }, , { data: load }, { data: requestRows }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, job_number, status, stage, stage_entered_at, department, priority, promised_at, is_open, gated_in_at, first_approval_at, assigned_to, assignment_note, assignment_note_at, vehicle:vehicles(kind, photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), customer:customer_public(full_name, company_name, is_vip), gate_in:gate_ins(is_complete, condition, customer_requests, notes), note_by:staff!jobs_assignment_note_by_fkey(display_name)")
      .eq("is_open", true)
      .is("assigned_to", null)
      .in("status", ["gate_in_pending", "pending_approval", "pending_inspection"])
      .order("gated_in_at"),
    supabase.from("staff").select("id, display_name, department_id").eq("is_active", true).eq("role_id", "technician").order("display_name"),
    supabase.from("jobs").select("assigned_to").eq("is_open", true).not("assigned_to", "is", null),
    supabase.from("job_requests").select("job_id, position, text").eq("is_active", true).order("position"),
  ]);
  const loads = await technicianLoads(settings, side);
  const requestsOf = (jobId: string) => ((requestRows ?? []) as { job_id: string; text: string }[]).filter((r) => r.job_id === jobId).map((r) => r.text);
  const rows = ((jobs ?? []) as unknown as Row[]).filter((j) => jobConcernsSide(j.department, side));
  void load;
  const pictures = await signCarPictures(rows.map((j) => j.vehicle?.photo_path));
  const ready = rows.filter((j) => j.status === "pending_inspection");
  const waiting = rows.filter((j) => j.status !== "pending_inspection");
  const deptLabel = (d: string | null) => JOB_DEPARTMENTS.find((x) => x.value === d)?.label ?? "Not set";

  const renderList = (items: Row[], canAssign: boolean) => (
    <div className="flex flex-col gap-3">
      {items.map((j) => {
        const timing = jobTiming(j.promised_at, j.is_open, clockOf(j, settings));
        const defaultRoadTest = j.gate_in?.condition === "does_not_run" ? "not_possible" : null;
        const reqs = requestsOf(j.id);
        const suggested = roadTestSuggested([...reqs, j.gate_in?.customer_requests ?? ""]);
        return (
          <Card key={j.id} className={`flex flex-col gap-4 ${timing.tone === "red" ? "border-red-bar" : timing.tone === "amber" ? "border-amber-bar" : ""}`}>
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <CarPicture url={j.vehicle?.photo_path ? (pictures.get(j.vehicle.photo_path) ?? null) : null} alt={j.vehicle ? formatPlate(j.vehicle) : "Car"} className="w-full md:w-44" />
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/jobs/${j.id}`} className="text-[17px] font-extrabold tracking-[0.03em] hover:underline underline-offset-4">
                    {j.vehicle ? formatPlate(j.vehicle) : j.job_number}
                  </Link>
                  {j.customer?.is_vip ? <Badge tone="ink">VIP</Badge> : null}
                  {j.priority === "high" ? <Badge tone="outline">High priority</Badge> : null}
                  <Badge tone="neutral">{deptLabel(j.department)}</Badge>
                  {j.status === "pending_inspection" ? <TimingBadge timing={timing} /> : null}
                  {j.gate_in?.condition === "does_not_run" ? <Badge tone="red">Does not run</Badge> : null}
                </div>
                <span className="text-sm font-semibold">{[j.vehicle?.make?.name, j.vehicle?.model?.name, j.vehicle?.variant, j.vehicle?.model_year].filter(Boolean).join(" ")}</span>
                <span className="text-xs text-muted">
                  {j.customer?.company_name ?? j.customer?.full_name} · {j.job_number} · gated in {formatDateTime(j.gated_in_at)} · {STATUS_LABELS[j.status]}
                </span>
                {reqs.length ? (
                  <ol className="flex flex-col gap-1 rounded-control bg-chip px-3 py-2 text-sm">
                    {reqs.map((t, i) => (
                      <li key={i} className="flex gap-2"><span className="w-5 shrink-0 text-muted">{i + 1}.</span><span className="font-semibold">{t}</span></li>
                    ))}
                  </ol>
                ) : j.gate_in?.customer_requests ? <p className="text-sm rounded-control bg-chip px-3 py-2 whitespace-pre-wrap"><span className="font-bold">Customer asked:</span> {j.gate_in.customer_requests}</p> : null}
                {j.gate_in?.notes ? <p className="text-sm"><span className="font-bold">Gate-in notes:</span> {j.gate_in.notes}</p> : null}
                {j.assignment_note ? (
                  <p className="text-sm rounded-control bg-chip px-3 py-2">
                    <span className="font-bold">Note from {j.note_by?.display_name ?? "the advisor"}:</span> {j.assignment_note}
                  </p>
                ) : null}
              </div>
            </div>
            {canAssign ? (
              <form action={assignJob.bind(null, j.id)} className="flex flex-col gap-3 border-t border-line pt-4">
                <input type="hidden" name="back" value="/assign" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1" data-field>
                    <span className="text-sm font-semibold" data-field-label>Technicians (tick one or more)</span>
                    <TechnicianPicker technicians={loads} hint="Freest first. The first ticked technician is the lead: he does the inspection. A busy technician can still be ticked; it asks once." />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold">Road test{suggested ? <span className="ml-2 rounded-control bg-amber-soft px-2 py-0.5 text-xs font-bold text-amber">Road test suggested: the requests mention noise, vibration, steering, turning or braking</span> : null}</span>
                    <ChoiceButtons name="road_test" columns={3} defaultValue={defaultRoadTest} options={ROAD_TEST_CHOICES} />
                  </div>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">Note <span className="font-medium text-muted">(required when the road test is not possible)</span></span>
                  <Textarea name="road_test_note" rows={1} placeholder="For example: does not start, or no plates" />
                </label>
                <div>
                  <Button type="submit" size="md">
                    Assign
                  </Button>
                </div>
              </form>
            ) : (
              <span className="text-xs text-muted">{j.status === "gate_in_pending" ? "Gate-in photos or video still missing." : "Waiting for the customer to approve the job card."}</span>
            )}
          </Card>
        );
      })}
    </div>
  );

  return (
    <>
      <LiveRefresh tables={["jobs", "gate_ins", "approval_requests"]} pollMs={60000} />
      <PageHeader title="To assign" subtitle={side ? `${side === "mechanical" ? "Mechanical" : "Bodyshop"} cars waiting for a technician` : "All cars waiting for a technician"} />
      {message ? <p className="rounded-control bg-green-soft px-4 py-3 text-sm font-semibold text-green">{message}</p> : null}
      {error ? <p className="rounded-control bg-red-soft px-4 py-3 text-sm font-semibold text-red">{error}</p> : null}
      <Card className="flex flex-col gap-2">
        <SectionLabel right={`${loads.filter((l) => l.status === "free").length} free`}>Technicians, freest first</SectionLabel>
        <TechnicianPicker technicians={loads} pick={false} />
      </Card>
      <section className="flex flex-col gap-3">
        <SectionLabel right={`${ready.length}`}>Ready to assign (customer approved)</SectionLabel>
        <p className="text-xs text-muted">Target: {Number(settings.assignment_target_minutes) || 30} working minutes from the customer&apos;s approval. Past it the card turns amber, then red, and the owner is told.</p>
        {ready.length ? renderList(ready, true) : <Empty title="Nothing waiting to be assigned" />}
      </section>
      <section className="flex flex-col gap-3">
        <SectionLabel right={`${waiting.length}`}>Gated in, not yet approved</SectionLabel>
        {waiting.length ? renderList(waiting, false) : <p className="text-sm text-muted">None.</p>}
      </section>
    </>
  );
}
