import Link from "next/link";
import { PriorityBadge, TimingBadge } from "@/components/JobBadges";
import { JobMediaStrip } from "@/components/JobMediaStrip";
import { loadJobMediaSummaries } from "@/lib/job-media-strip";
import { StageTrack } from "@/components/StageTrack";
import { Badge, Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { STATUS_LABELS, jobTiming, urgencyRank } from "@/lib/jobs";
import { can, type RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type JobRow } from "@/lib/types";

type Row = JobRow & {
  vehicle: { photo_path: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null;
  customer: { full_name: string; company_name: string | null } | null;
};

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const staff = await requirePermission("viewJobs");
  const { show } = await searchParams;
  const closed = show === "closed";
  const role = staff.role_id as RoleId;

  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select(
      "id, job_number, vehicle_id, customer_id, stage, status, priority, promised_at, assigned_to, assigned_at, gated_in_at, gated_in_by, gated_out_at, gated_out_by, first_approval_at, is_open, created_at, updated_at, vehicle:vehicles(photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), customer:customers(full_name, company_name)",
    )
    .eq("is_open", !closed)
    .order(closed ? "gated_out_at" : "gated_in_at", { ascending: false })
    .limit(200);
  const summaries = await loadJobMediaSummaries(((data ?? []) as unknown as Row[]).map((j) => ({ id: j.id, photo_path: j.vehicle?.photo_path ?? null })));
  const rows = ((data ?? []) as unknown as Row[]).sort((a, b) => {
    if (closed) return 0;
    const ra = urgencyRank(a);
    const rb = urgencyRank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
    return 0;
  });

  return (
    <>
      <PageHeader
        title={closed ? "Closed jobs" : "Open jobs"}
        subtitle={`${rows.length} job${rows.length === 1 ? "" : "s"}`}
        actions={
          <>
            <LinkButton href={closed ? "/jobs" : "/jobs?show=closed"} tone="secondary">
              {closed ? "Show open" : "Show closed"}
            </LinkButton>
            {can(role, "gateIn") ? <LinkButton href="/gate-in">Gate in a car</LinkButton> : null}
          </>
        }
      />
      {rows.length === 0 ? (
        <Empty title={closed ? "No closed jobs yet" : "No cars in the workshop"} />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((j) => {
            const timing = jobTiming(j.promised_at, j.is_open);
            return (
              <Link key={j.id} href={`/jobs/${j.id}`} className="block">
                <Card className="flex flex-col gap-4 hover:border-ink">
                  <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
                  <div className="flex-1 basis-64 min-w-0 flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[17px] font-extrabold tracking-[0.03em]">{j.vehicle ? formatPlate(j.vehicle) : "?"}</span>
                      <PriorityBadge priority={j.priority} />
                      <TimingBadge timing={timing} />
                      {!j.is_open ? <Badge>Closed</Badge> : null}
                    </div>
                    <span className="text-sm font-semibold">{[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")}</span>
                    <span className="text-xs text-muted">
                      {j.job_number} · {j.customer ? (j.customer.company_name ?? j.customer.full_name) + " · " : ""}
                      {closed ? `Out ${formatDate(j.gated_out_at)}` : `In ${formatDate(j.gated_in_at)}`}
                    </span>
                  </div>
                  <div className="flex-[999] basis-[560px] min-w-0 flex flex-col gap-2.5">
                    <span className="text-sm font-bold">{STATUS_LABELS[j.status]}</span>
                    <StageTrack stage={j.stage} timing={timing} />
                  </div>
                  </div>
                  <JobMediaStrip summary={summaries.get(j.id)} />
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
