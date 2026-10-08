import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Card, Empty, LinkButton, Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { INSPECTION_STATUS_LABELS, type InspectionStatus } from "@/lib/inspection";
import { CONDITIONS, labelOf } from "@/lib/jobs";
import { ROAD_TEST_STATUS_LABELS, type RoadTestRow } from "@/lib/road-test";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";

type Row = {
  id: string;
  job_id: string;
  status: InspectionStatus;
  started_at: string | null;
  job: { job_number: string; is_open: boolean; assigned_at: string | null; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null; gate_in: { condition: string } | null; assignee: { display_name: string } | null } | null;
};

/** The QC inspector's list: every mechanical car assigned for inspection, with its road test state. */
export default async function RoadTestsPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  await requirePermission("roadTest");
  const { message } = await searchParams;
  const supabase = await createClient();
  const [{ data: insp }, { data: tests }] = await Promise.all([
    supabase
      .from("inspections")
      .select("id, job_id, status, started_at, job:jobs(job_number, is_open, assigned_at, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), gate_in:gate_ins(condition), assignee:staff!jobs_assigned_to_fkey(display_name))")
      .eq("is_active", true)
      .neq("status", "approved")
      .order("created_at", { ascending: false }),
    supabase.from("road_tests").select("id, job_id, inspector_id, status, items, not_possible_reason, started_at, done_at, created_at, updated_at"),
  ]);
  const rows = ((insp ?? []) as unknown as Row[]).filter((r) => r.job?.is_open);
  const testByJob = new Map(((tests ?? []) as RoadTestRow[]).map((t) => [t.job_id, t]));
  const pending = rows.filter((r) => (testByJob.get(r.job_id)?.status ?? "not_started") === "not_started");
  const done = rows.filter((r) => (testByJob.get(r.job_id)?.status ?? "not_started") !== "not_started");

  const list = (items: Row[]) => (
    <div className="flex flex-col gap-3">
      {items.map((r) => {
        const t = testByJob.get(r.job_id);
        const status = t?.status ?? "not_started";
        return (
          <Card key={r.id} className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[17px] font-extrabold tracking-[0.03em]">{r.job?.vehicle ? formatPlate(r.job.vehicle) : r.job?.job_number}</span>
                <Badge tone={status === "done" ? "green" : status === "not_possible" ? "neutral" : "amber"}>{ROAD_TEST_STATUS_LABELS[status]}</Badge>
                {r.job?.gate_in?.condition && r.job.gate_in.condition !== "runs_drives" ? <Badge tone="red">{labelOf(CONDITIONS, r.job.gate_in.condition)}</Badge> : null}
              </div>
              <span className="text-sm font-semibold">{[r.job?.vehicle?.make?.name, r.job?.vehicle?.model?.name].filter(Boolean).join(" ")}</span>
              <span className="text-xs text-muted">
                {r.job?.job_number} · {r.job?.assignee ? `technician ${r.job.assignee.display_name}` : "no technician"} · {INSPECTION_STATUS_LABELS[r.status]}
                {r.job?.assigned_at ? ` · assigned ${formatDateTime(r.job.assigned_at)}` : ""}
                {t?.done_at ? ` · road test ${formatDateTime(t.done_at)}` : ""}
              </span>
            </div>
            <LinkButton href={`/road-tests/${r.job_id}`} size="md" tone={status === "not_started" ? "primary" : "secondary"}>
              {status === "not_started" ? "Do the road test" : "Open"}
            </LinkButton>
          </Card>
        );
      })}
    </div>
  );

  return (
    <>
      <LiveRefresh tables={["inspections", "road_tests", "jobs"]} pollMs={60000} />
      <PageHeader title="Road tests" subtitle="Every mechanical car assigned for inspection. The road test can be done before, during or after the technician's inspection." />
      {message ? <Notice tone="success">{message}</Notice> : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">To do · {pending.length}</h2>
        {pending.length ? list(pending) : <Empty title="No road tests waiting" />}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">Done · {done.length}</h2>
        {done.length ? list(done) : <p className="text-sm text-muted">None yet.</p>}
      </section>
      <p className="text-xs text-muted">
        <Link href="/workshop" className="underline underline-offset-4">
          Workshop list
        </Link>
      </p>
    </>
  );
}
