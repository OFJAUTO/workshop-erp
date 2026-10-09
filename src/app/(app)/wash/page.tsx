import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Card, Empty, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { WASH_SELECT, type WashRow } from "@/lib/work-data";
import { skipWash, washDone } from "./actions";
import { WashForms } from "./WashForms";

export const dynamic = "force-dynamic";

type Row = { id: string; job_number: string; stage_entered_at: string; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null };

/** The car wash list: cars that passed QC. "Wash done" records the name and time; an advisor or the owner can skip with a reason. */
export default async function WashPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("washCars");
  const role = staff.role_id as RoleId;
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const [{ data: jobs }, { data: recent }] = await Promise.all([
    admin.from("jobs").select("id, job_number, stage_entered_at, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))").eq("is_open", true).eq("status", "pending_wash").order("stage_entered_at"),
    admin.from("washes").select(WASH_SELECT + ", job:jobs(job_number), person:staff!washes_done_by_fkey(display_name)").eq("is_active", true).order("updated_at", { ascending: false }).limit(15),
  ]);
  const rows = (jobs ?? []) as unknown as Row[];
  const done = (recent ?? []) as unknown as (WashRow & { job: { job_number: string } | null; person: { display_name: string } | null })[];
  return (
    <>
      <LiveRefresh tables={["jobs", "washes"]} pollMs={60000} />
      <PageHeader title="Car wash" subtitle={rows.length === 1 ? "1 car passed QC and waits for the wash." : `${rows.length} cars passed QC and wait for the wash.`} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {rows.length === 0 ? <Empty title="No cars waiting for the wash" /> : null}
      <div className="flex flex-col gap-3">
        {rows.map((j) => (
          <Card key={j.id} className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <span className="text-[17px] font-extrabold tracking-[0.03em]">{j.vehicle ? formatPlate(j.vehicle) : j.job_number}</span>
              <span className="text-sm font-semibold">{[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · {j.job_number}</span>
              <span className="text-xs text-muted">Waiting since {formatDateTime(j.stage_entered_at)}</span>
            </div>
            {!staff.viewingAs ? <WashForms jobId={j.id} canSkip={role === "owner" || role === "service_advisor"} doneAction={washDone.bind(null, j.id)} skipAction={skipWash.bind(null, j.id)} /> : null}
          </Card>
        ))}
      </div>
      {done.length ? (
        <section className="flex flex-col gap-3">
          <SectionLabel>Recent</SectionLabel>
          <Card className="p-0 overflow-hidden">
            <ul className="divide-y divide-line text-sm">
              {done.map((w) => (
                <li key={w.id} className="px-5 py-2.5 flex flex-wrap items-center gap-3">
                  <Badge tone={w.skipped ? "amber" : "green"}>{w.skipped ? "Skipped" : "Washed"}</Badge>
                  <span className="font-semibold">{w.job?.job_number}</span>
                  <span className="text-muted">{w.skipped ? w.skip_reason : `${w.person?.display_name ?? ""} · ${formatDateTime(w.done_at)}`}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </>
  );
}
