import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Card, Empty, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { QC_SELECT, type QcCheckRow } from "@/lib/work-data";

export const dynamic = "force-dynamic";

type Row = { id: string; job_number: string; status: string; qc_round: number; rework_count: number; work_completed_at: string | null; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null; assignee: { display_name: string } | null };

/** The QC inspector's list: cars waiting for QC, then recent results. */
export default async function QcListPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("doQc");
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const [{ data: jobs }, { data: checks }] = await Promise.all([
    admin.from("jobs").select("id, job_number, status, qc_round, rework_count, work_completed_at, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), assignee:staff!jobs_assigned_to_fkey(display_name)").eq("is_open", true).eq("status", "pending_qc").order("work_completed_at"),
    admin.from("qc_checks").select(QC_SELECT + ", job:jobs(job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin))").eq("is_active", true).neq("status", "open").order("finished_at", { ascending: false }).limit(20),
  ]);
  const rows = (jobs ?? []) as unknown as Row[];
  const done = (checks ?? []) as unknown as (QcCheckRow & { job: { job_number: string; vehicle: Row["vehicle"] } | null })[];
  return (
    <>
      <LiveRefresh tables={["jobs", "qc_checks"]} pollMs={60000} />
      <PageHeader title="Cars for QC" subtitle={`${rows.length} waiting. Each item Pass or Fail; a Fail sends the car back to Work.`} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {rows.length === 0 ? <Empty title="Nothing waiting for QC" /> : null}
      <div className="flex flex-col gap-3">
        {rows.map((j) => (
          <Card key={j.id} className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[17px] font-extrabold tracking-[0.03em]">{j.vehicle ? formatPlate(j.vehicle) : j.job_number}</span>
                {j.qc_round > 1 ? <Badge tone="amber">Recheck, round {j.qc_round}</Badge> : <Badge tone="ink">First QC</Badge>}
                {j.assignee?.display_name === staff.display_name ? <Badge tone="red">You did the work: someone else must check</Badge> : null}
              </div>
              <span className="text-sm font-semibold">{[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · {j.job_number}</span>
              <span className="text-xs text-muted">Work complete {formatDateTime(j.work_completed_at)}{j.assignee ? ` · ${j.assignee.display_name}` : ""}</span>
            </div>
            <LinkButton href={`/qc/${j.id}`} size="lg">Start QC</LinkButton>
          </Card>
        ))}
      </div>
      {done.length ? (
        <section className="flex flex-col gap-3">
          <SectionLabel>Recent results</SectionLabel>
          <Card className="p-0 overflow-hidden">
            <ul className="divide-y divide-line">
              {done.map((c) => (
                <li key={c.id} className="px-5 py-3 flex flex-wrap items-center gap-3 text-sm">
                  <Badge tone={c.status === "passed" ? "green" : "red"}>{c.status === "passed" ? "Passed" : "Failed"}</Badge>
                  <Link href={`/qc/${c.job_id}`} className="font-semibold underline underline-offset-4">{c.job?.vehicle ? formatPlate(c.job.vehicle) : c.job?.job_number}</Link>
                  <span className="text-muted">round {c.round} · {formatDateTime(c.finished_at)}</span>
                  {c.status === "failed" ? <span className="text-muted">{c.items.filter((i) => i.result === "fail").map((i) => i.label).join(", ")}</span> : null}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </>
  );
}
