import Link from "next/link";
import { CarThumb } from "@/components/CarThumb";
import { Badge, Button, Input, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { signCarPictures } from "@/lib/car-pictures";
import { formatDate } from "@/lib/format";
import { INSPECTION_STATUS_LABELS, type InspectionStatus } from "@/lib/inspection";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The parts desk's inspection list (queue 4 of 4 November 2026): every inspection, read-only, to
 * double-check parts against the report. No customer details here or on the report it opens; the
 * report page shows the parts desk no action of any kind.
 */

type Row = {
  id: string;
  job_id: string;
  status: InspectionStatus;
  submitted_at: string | null;
  approved_at: string | null;
  started_at: string | null;
  technician_id: string | null;
};
type JobLite = { id: string; job_number: string; is_open: boolean; vehicle_id: string | null };
type VehicleLite = { id: string; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; kind: string | null; variant: string | null; photo_path: string | null; make: { name: string } | null; model: { name: string } | null };

export default async function PartsInspectionsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission("priceParts");
  const { q: qRaw } = await searchParams;
  const q = (qRaw ?? "").trim();
  const admin = createAdminClient();

  // The newest 120 inspections; a search narrows to the matching cars or job numbers first.
  let jobIdFilter: string[] | null = null;
  if (q) {
    const like = `%${q.replace(/[%_,()]/g, " ").trim()}%`;
    const [{ data: vj }, { data: nj }] = await Promise.all([
      admin.from("vehicles").select("id").or(`plate_number.ilike.${like},vin.ilike.${like}`).limit(60),
      admin.from("jobs").select("id").ilike("job_number", like).limit(60),
    ]);
    const vehicleIds = (vj ?? []).map((v) => v.id);
    const byCar = vehicleIds.length ? await admin.from("jobs").select("id").in("vehicle_id", vehicleIds).limit(120) : { data: [] as { id: string }[] };
    jobIdFilter = [...new Set([...(nj ?? []).map((j) => j.id), ...(byCar.data ?? []).map((j) => j.id)])];
  }
  let query = admin
    .from("inspections")
    .select("id, job_id, status, submitted_at, approved_at, started_at, technician_id")
    .order("created_at", { ascending: false })
    .limit(120);
  if (jobIdFilter) query = jobIdFilter.length ? query.in("job_id", jobIdFilter) : query.in("job_id", ["00000000-0000-4000-8000-000000000000"]);
  const rows = ((await query).data ?? []) as Row[];

  const jobIds = [...new Set(rows.map((r) => r.job_id))];
  const techIds = [...new Set(rows.map((r) => r.technician_id).filter((x): x is string => !!x))];
  const [{ data: jobsData }, { data: techData }] = await Promise.all([
    jobIds.length ? admin.from("jobs").select("id, job_number, is_open, vehicle_id").in("id", jobIds) : Promise.resolve({ data: [] as JobLite[] }),
    techIds.length ? admin.from("staff").select("id, display_name").in("id", techIds) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
  ]);
  const jobs = new Map(((jobsData ?? []) as JobLite[]).map((j) => [j.id, j]));
  const techs = new Map(((techData ?? []) as { id: string; display_name: string }[]).map((t) => [t.id, t.display_name]));
  const vehicleIds = [...new Set([...jobs.values()].map((j) => j.vehicle_id).filter((x): x is string => !!x))];
  const { data: vehData } = vehicleIds.length
    ? await admin.from("vehicles").select("id, plate_country, plate_emirate, plate_code, plate_number, vin, kind, variant, photo_path, make:vehicle_makes(name), model:vehicle_models(name)").in("id", vehicleIds)
    : { data: [] as unknown[] };
  const vehicles = new Map(((vehData ?? []) as unknown as VehicleLite[]).map((v) => [v.id, v]));
  const pics = await signCarPictures([...vehicles.values()].map((v) => v.photo_path));

  const shown = rows.filter((r) => jobs.has(r.job_id));
  const open = shown.filter((r) => jobs.get(r.job_id)!.is_open);
  const gone = shown.filter((r) => !jobs.get(r.job_id)!.is_open);

  const statusTone = (s: InspectionStatus) => (s === "approved" ? "green" : s === "submitted" ? "amber" : s === "returned" ? "red" : "outline") as "green" | "amber" | "red" | "outline";
  const row = (r: Row) => {
    const job = jobs.get(r.job_id)!;
    const v = job.vehicle_id ? (vehicles.get(job.vehicle_id) ?? null) : null;
    const car = [v?.make?.name, v?.model?.name].filter(Boolean).join(" ");
    return (
      <Link key={r.id} href={`/jobs/${r.job_id}/inspection`} className={`flex min-h-12 flex-wrap items-center gap-3 rounded-card border px-3 py-2 ${job.is_open ? "border-line bg-white" : "border-line bg-chip"}`} data-inspection-row={r.job_id} data-inspection-status={r.status}>
        <CarThumb size="sm" url={v?.photo_path ? (pics.get(v.photo_path) ?? null) : null} alt={v ? formatPlate(v) : job.job_number} />
        <span className="font-extrabold uppercase">{v ? formatPlate(v) : "—"}</span>
        <span className="text-sm uppercase">{car}</span>
        <span className="text-sm text-muted">{job.job_number}</span>
        <Badge tone={statusTone(r.status)}>{INSPECTION_STATUS_LABELS[r.status] ?? r.status}</Badge>
        {r.technician_id && techs.get(r.technician_id) ? <span className="text-xs text-muted">Tech · {techs.get(r.technician_id)}</span> : null}
        <span className="ml-auto text-xs font-semibold text-muted">
          {r.approved_at ? `Approved ${formatDate(r.approved_at)}` : r.submitted_at ? `Submitted ${formatDate(r.submitted_at)}` : r.started_at ? `Started ${formatDate(r.started_at)}` : "Not started"}
        </span>
        <span className="text-xs font-semibold underline underline-offset-4">View</span>
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title="Inspection reports"
        subtitle="Read-only: findings, measurements, photos and scan reports, to double-check parts."
        actions={<LinkButton href="/parts" tone="secondary" size="lg">Parts desk</LinkButton>}
      />
      <form method="get" className="flex flex-wrap items-center gap-2" data-inspections-search-form>
        <Input name="q" defaultValue={q} placeholder="Find a car: plate, job number or VIN" aria-label="Find a car" className="min-w-64 flex-1" data-inspections-search />
        <Button type="submit" size="md" tone="secondary">Search</Button>
        {q ? <LinkButton href="/parts/inspections" tone="ghost" size="md">Clear</LinkButton> : null}
      </form>
      <section className="flex flex-col gap-2" data-inspections-open>
        <SectionLabel right={`${open.length}`}>Cars in the workshop</SectionLabel>
        {open.length === 0 ? <p className="text-sm text-muted">{q ? "No inspection matches the search." : "No inspection on an open car yet."}</p> : open.map(row)}
      </section>
      {gone.length ? (
        <section className="flex flex-col gap-2" data-inspections-gone>
          <SectionLabel right={`${gone.length}`}>Cars that have left</SectionLabel>
          {gone.map(row)}
        </section>
      ) : null}
    </>
  );
}
