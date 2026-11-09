import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Card, PageHeader, SectionLabel } from "@/components/ui";
import { WaitingPanel } from "@/components/WaitingPanel";
import type { CurrentStaff } from "@/lib/auth";
import { STATUS_LABELS, type JobStatus } from "@/lib/jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

/**
 * Fix 2.6 (4 November 2026): the gate-in person's read-only board, to help the parts desk. Every open car
 * with its stage, and the inspection report once there is one - findings, photos and measurements open
 * read-only on the report page. Nothing here changes anything, and no customer name, phone or money shows
 * (the cars are read with the server's own key and the customer is simply never asked for).
 */
export async function GateInView({ staff }: { staff: CurrentStaff }) {
  const admin = createAdminClient();
  const { data: jobs } = await admin
    .from("jobs")
    .select("id, job_number, status, gated_in_at, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, variant, make:vehicle_makes(name), model:vehicle_models(name))")
    .eq("is_open", true)
    .order("gated_in_at", { ascending: false })
    .limit(120);
  type Veh = Parameters<typeof formatPlate>[0] & { model_year: number | null; variant: string | null; make: { name: string } | null; model: { name: string } | null };
  const rows = (jobs ?? []) as unknown as { id: string; job_number: string; status: string; gated_in_at: string | null; vehicle: Veh }[];
  const titleOf = (v: Veh) => [v.make?.name, v.model?.name, v.variant, v.model_year].filter(Boolean).join(" ");
  const { data: insps } = rows.length
    ? await admin.from("inspections").select("job_id, status").eq("path", "mechanical").eq("is_active", true).in("job_id", rows.map((r) => r.id))
    : { data: [] };
  const inspOf = new Map((insps ?? []).map((i) => [i.job_id as string, i.status as string]));
  return (
    <>
      <LiveRefresh tables={["jobs", "inspections"]} />
      <PageHeader title="Workshop board" subtitle="Read-only: every car in the workshop with its step. Tap a report to read the findings." />
      <WaitingPanel staff={staff} />
      <Card className="flex flex-col gap-2" data-gatein-board>
        <SectionLabel right={`${rows.length}`}>Cars in the workshop</SectionLabel>
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((r) => {
            const insp = inspOf.get(r.id) ?? null;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5" data-gatein-car={r.job_number}>
                <span className="text-sm font-extrabold">{formatPlate(r.vehicle)}</span>
                <span className="text-sm uppercase">{titleOf(r.vehicle)}</span>
                <span className="text-xs text-muted">{r.job_number}</span>
                <span className="rounded-full bg-chip px-2 py-0.5 text-xs font-bold" data-gatein-stage>{STATUS_LABELS[r.status as JobStatus] ?? r.status}</span>
                {insp ? (
                  <Link href={`/jobs/${r.id}/inspection`} className="ml-auto text-sm font-bold underline underline-offset-4" data-gatein-report>
                    Inspection report{insp === "approved" ? "" : insp === "submitted" ? " (with the manager)" : " (being filled)"}
                  </Link>
                ) : (
                  <span className="ml-auto text-xs text-muted">No inspection yet</span>
                )}
              </li>
            );
          })}
          {rows.length === 0 ? <li className="py-3 text-sm text-muted">No cars in the workshop.</li> : null}
        </ul>
      </Card>
    </>
  );
}
