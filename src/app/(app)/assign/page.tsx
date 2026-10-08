import Link from "next/link";
import { CarPicture } from "@/components/CarPicture";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Button, Card, Empty, PageHeader, SectionLabel, Select } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { signCarPictures } from "@/lib/car-pictures";
import { formatDateTime } from "@/lib/format";
import { JOB_DEPARTMENTS, jobConcernsSide, sideOfDepartment } from "@/lib/inspection";
import { STATUS_LABELS, type JobStatus } from "@/lib/jobs";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { assignJob } from "../jobs/actions";

type Row = {
  id: string;
  job_number: string;
  status: JobStatus;
  department: string | null;
  priority: "high" | "normal" | "low";
  gated_in_at: string;
  first_approval_at: string | null;
  assigned_to: string | null;
  vehicle: { photo_path: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
  customer: { full_name: string; company_name: string | null; is_vip: boolean } | null;
  gate_in: { is_complete: boolean } | null;
};

/** The workshop manager's "To assign" list for their department, with each technician's current load. */
export default async function AssignPage() {
  const staff = await requirePermission("assignJobs");
  const side = staff.role_id === "owner" ? null : sideOfDepartment(staff.department_id);
  const supabase = await createClient();
  const [{ data: jobs }, { data: techs }, { data: load }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, job_number, status, department, priority, gated_in_at, first_approval_at, assigned_to, vehicle:vehicles(photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), customer:customers(full_name, company_name, is_vip), gate_in:gate_ins(is_complete)")
      .eq("is_open", true)
      .is("assigned_to", null)
      .in("status", ["gate_in_pending", "pending_approval", "pending_inspection"])
      .order("gated_in_at"),
    supabase.from("staff").select("id, display_name, department_id").eq("is_active", true).eq("role_id", "technician").order("display_name"),
    supabase.from("jobs").select("assigned_to").eq("is_open", true).not("assigned_to", "is", null),
  ]);
  const rows = ((jobs ?? []) as unknown as Row[]).filter((j) => jobConcernsSide(j.department, side));
  const counts = new Map<string, number>();
  for (const l of load ?? []) if (l.assigned_to) counts.set(l.assigned_to, (counts.get(l.assigned_to) ?? 0) + 1);
  const technicians = (techs ?? []).filter((t) => !side || !sideOfDepartment(t.department_id) || sideOfDepartment(t.department_id) === side);
  const pictures = await signCarPictures(rows.map((j) => j.vehicle?.photo_path));
  const ready = rows.filter((j) => j.status === "pending_inspection");
  const waiting = rows.filter((j) => j.status !== "pending_inspection");
  const deptLabel = (d: string | null) => JOB_DEPARTMENTS.find((x) => x.value === d)?.label ?? "Not set";

  const renderList = (items: Row[], canAssign: boolean) => (
    <div className="flex flex-col gap-3">
      {items.map((j) => (
        <Card key={j.id} className="flex flex-col md:flex-row md:items-center gap-4">
          <CarPicture url={j.vehicle?.photo_path ? (pictures.get(j.vehicle.photo_path) ?? null) : null} alt={j.vehicle ? formatPlate(j.vehicle) : "Car"} className="w-full md:w-44" />
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/jobs/${j.id}`} className="text-[17px] font-extrabold tracking-[0.03em] hover:underline underline-offset-4">
                {j.vehicle ? formatPlate(j.vehicle) : j.job_number}
              </Link>
              {j.customer?.is_vip ? <Badge tone="ink">VIP</Badge> : null}
              {j.priority === "high" ? <Badge tone="outline">High priority</Badge> : null}
              <Badge tone="neutral">{deptLabel(j.department)}</Badge>
            </div>
            <span className="text-sm font-semibold">{[j.vehicle?.make?.name, j.vehicle?.model?.name, j.vehicle?.variant, j.vehicle?.model_year].filter(Boolean).join(" ")}</span>
            <span className="text-xs text-muted">
              {j.customer?.company_name ?? j.customer?.full_name} · {j.job_number} · gated in {formatDateTime(j.gated_in_at)} · {STATUS_LABELS[j.status]}
            </span>
          </div>
          {canAssign ? (
            <form action={assignJob.bind(null, j.id)} className="flex flex-col sm:flex-row gap-2 md:w-80">
              <input type="hidden" name="back" value="/assign" />
              <Select name="technician" defaultValue="" required className="flex-1">
                <option value="" disabled>
                  Choose a technician…
                </option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.display_name} · {counts.get(t.id) ?? 0} car{(counts.get(t.id) ?? 0) === 1 ? "" : "s"}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="md">
                Assign
              </Button>
            </form>
          ) : (
            <span className="text-xs text-muted md:w-80">{j.status === "gate_in_pending" ? "Gate-in photos or video still missing." : "Waiting for the customer to approve the job card."}</span>
          )}
        </Card>
      ))}
    </div>
  );

  return (
    <>
      <LiveRefresh tables={["jobs", "gate_ins", "approval_requests"]} pollMs={60000} />
      <PageHeader title="To assign" subtitle={side ? `${side === "mechanical" ? "Mechanical" : "Bodyshop"} cars waiting for a technician` : "All cars waiting for a technician"} />
      <Card className="flex flex-wrap gap-2 items-center">
        <SectionLabel>Technicians</SectionLabel>
        {technicians.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm font-semibold">
            {t.display_name}
            <span className="inline-flex min-w-6 h-6 items-center justify-center rounded-full bg-ink px-1.5 text-xs font-bold text-white">{counts.get(t.id) ?? 0}</span>
          </span>
        ))}
        {technicians.length === 0 ? <span className="text-sm text-muted">No technicians in this department yet. Set departments on the Team page.</span> : null}
      </Card>
      <section className="flex flex-col gap-3">
        <SectionLabel right={`${ready.length}`}>Ready to assign (customer approved)</SectionLabel>
        {ready.length ? renderList(ready, true) : <Empty title="Nothing waiting to be assigned" />}
      </section>
      <section className="flex flex-col gap-3">
        <SectionLabel right={`${waiting.length}`}>Gated in, not yet approved</SectionLabel>
        {waiting.length ? renderList(waiting, false) : <p className="text-sm text-muted">None.</p>}
      </section>
    </>
  );
}
