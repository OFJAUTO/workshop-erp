import { LiveRefresh } from "@/components/LiveRefresh";
import { Card, Empty, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { STATUS_LABELS, type JobStatus } from "@/lib/jobs";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";

type Row = { job_id: string; job_number: string; status: JobStatus; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: string | null; model: string | null; technician: string | null };

/** The workshop list: every car in the workshop with its technician. View only; rows do not open. */
export default async function WorkshopListPage() {
  await requirePermission("viewWorkshopList");
  const supabase = await createClient();
  const { data } = await supabase.from("workshop_board").select("job_id, job_number, status, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make, model, technician").order("gated_in_at", { ascending: false });
  const rows = (data ?? []) as Row[];
  return (
    <>
      <LiveRefresh tables={["jobs"]} pollMs={60000} />
      <PageHeader title="Workshop list" subtitle={`${rows.length} car${rows.length === 1 ? "" : "s"} in the workshop`} />
      {rows.length === 0 ? (
        <Empty title="No cars in the workshop" />
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.job_id} className="px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-1">
                <span className="text-[17px] font-extrabold tracking-[0.03em] w-44">{formatPlate(r)}</span>
                <span className="font-semibold flex-1 min-w-40">{[r.make, r.model].filter(Boolean).join(" ") || "Make and model not set"}</span>
                <span className="text-sm text-muted w-40">{STATUS_LABELS[r.status] ?? r.status}</span>
                <span className="text-sm font-semibold w-40">{r.technician ?? "Not assigned"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
