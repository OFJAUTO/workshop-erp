import { notFound } from "next/navigation";
import { JobsToDo } from "@/components/JobsToDo";
import { requireStaff } from "@/lib/auth";
import { loadJobsToDo, viewerSideOf } from "@/lib/jobs-to-do-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { PrintButton } from "./PrintButton";

/**
 * THE PRINTED JOB CARD (11 November 2026, Section 9): the same JOBS TO DO list on paper, both departments open, a box
 * per job to tick by hand. Car and job only: no prices, costs or customer details.
 */
export default async function PrintJobCard({ params }: { params: Promise<{ jobId: string }> }) {
  const staff = await requireStaff();
  const { jobId } = await params;
  const { data: job } = await createAdminClient().from("jobs").select("id, job_number, promised_at, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, vin, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", jobId).maybeSingle();
  if (!job) notFound();
  const v = job.vehicle as unknown as (Parameters<typeof formatPlate>[0] & { vin: string | null; make: { name: string } | null; model: { name: string } | null }) | null;
  const todo = await loadJobsToDo(jobId, viewerSideOf(staff.department_id ?? null, staff.role_id));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 bg-white p-6 text-ink" data-print-job-card>
      <style>{`@media print { [data-no-print] { display: none !important; } body { background: #fff; } }`}</style>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-ink pb-2">
        <h1 className="text-2xl font-extrabold">JOB CARD · {job.job_number}</h1>
        <span className="text-lg font-bold uppercase">{v ? formatPlate(v) : ""} · {[v?.make?.name, v?.model?.name].filter(Boolean).join(" ")}</span>
        {v?.vin ? <span className="w-full font-mono text-sm">VIN {v.vin}</span> : null}
      </div>
      {todo ? <JobsToDo jobId={jobId} data={todo} print /> : <p>No approved quotation yet.</p>}
      <div data-no-print><PrintButton /></div>
    </div>
  );
}
