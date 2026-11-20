import { Card, SectionLabel } from "@/components/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import { LOOSE_STEPS, looseStepsOf } from "@/lib/booked-job-rules";
import { JOB_FILE_SELECT, signJobFiles } from "@/lib/work-data";
import { LooseReceive } from "./LooseReceive";

/**
 * The short flow of a job with no car (20 November 2026, Section 2): ITEMS RECEIVED (photos, or "nothing to receive")
 * > PARTS AND WORK > INVOICE AND PAYMENT > HANDED OVER. No km, fuel, car photos, panel check, wash or road test.
 */
export async function LooseFlowCard({ jobId, job, canAct }: { jobId: string; job: { status: string; is_open: boolean; gated_out_at: string | null }; canAct: boolean }) {
  const admin = createAdminClient();
  const [{ count: items }, { data: none }, { data: photos }] = await Promise.all([
    admin.from("job_items").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("is_active", true),
    admin.from("job_events").select("id").eq("job_id", jobId).eq("event_type", "items_none").limit(1),
    admin.from("job_files").select(JOB_FILE_SELECT).eq("job_id", jobId).eq("kind", "work_photo").eq("caption", "Items received").is("removed_at", null).order("created_at"),
  ]);
  const files = (photos ?? []) as { id: string; storage_path: string; caption: string | null; content_type: string | null }[];
  const urls = await signJobFiles(files.map((f) => f.storage_path));
  const nothing = (none ?? []).length > 0;
  const received = (items ?? 0) > 0 || nothing || files.length > 0;
  const steps = looseStepsOf(job, received);
  return (
    <Card className="flex flex-col gap-3" data-loose-flow>
      <SectionLabel>Loose items – no car</SectionLabel>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-loose-steps>
        {LOOSE_STEPS.map((s, i) => {
          const st = steps[s.key];
          return (
            <li key={s.key} className={`flex items-center gap-2 rounded-control border px-3 py-2 text-sm font-bold ${st === "done" ? "border-green bg-green-soft" : st === "current" ? "border-ink bg-white" : "border-line bg-chip text-muted"}`} data-loose-step={s.key} data-state={st}>
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs">{st === "done" ? "✓" : i + 1}</span>
              <span>{s.label}</span>
            </li>
          );
        })}
      </ol>
      {!received && job.is_open ? (
        <LooseReceive jobId={jobId} canAct={canAct} files={files.map((f) => ({ id: f.id, path: f.storage_path, url: urls[f.storage_path] ?? null, caption: f.caption, contentType: f.content_type }))} />
      ) : (
        <p className="text-sm text-muted" data-loose-received>{nothing ? "Nothing to receive (parts sale)." : (items ?? 0) > 0 ? `${items} item${items === 1 ? "" : "s"} received.` : `${files.length} photo${files.length === 1 ? "" : "s"} of the items received.`}</p>
      )}
    </Card>
  );
}
