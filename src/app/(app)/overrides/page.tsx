import Link from "next/link";
import { Card, Empty, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Ev = { id: string; job_id: string; event_type: string; note: string | null; created_at: string; by: { display_name: string } | null; job: { job_number: string } | null };

/** Every override in one place for the owner: special moves and changes to approved reports. */
export default async function OverridesPage() {
  await requirePermission("viewOverrides");
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_events")
    .select("id, job_id, event_type, note, created_at, by:staff!job_events_created_by_fkey(display_name), job:jobs(job_number)")
    .in("event_type", ["override", "move_refused", "inspection_change_decided", "inspection_edited"])
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []) as unknown as Ev[];
  const label: Record<string, string> = { override: "Special move", move_refused: "Move refused", inspection_change_decided: "Report change decision", inspection_edited: "Approved report edited" };
  return (
    <>
      <PageHeader title="Overrides" subtitle="Every time a gate was passed by the owner's decision, who asked, when and why." />
      {rows.length === 0 ? (
        <Empty title="No overrides yet" />
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map((e) => (
              <li key={e.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 text-sm">
                <span className="text-xs text-muted sm:w-36 shrink-0">{formatDateTime(e.created_at)}</span>
                <span className="font-bold sm:w-40 shrink-0">{label[e.event_type] ?? e.event_type}</span>
                <Link href={`/jobs/${e.job_id}`} className="font-semibold underline underline-offset-4 sm:w-20 shrink-0">
                  {e.job?.job_number ?? "job"}
                </Link>
                <span className="flex-1">
                  <span className="font-semibold">{e.by?.display_name ?? "System"}</span> · {e.note}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
