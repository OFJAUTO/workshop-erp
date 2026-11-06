import { Card, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Settings > Problems behind the scenes (6 November 2026): the database's own words for every save that failed, the
 * owner's eyes only. Staff saw one plain sentence ("Couldn't save – nothing was recorded…") at that moment; this is the
 * detail behind it, newest first: when, where in the app, who, which car, and the raw message.
 */
export default async function ProblemsPage() {
  await requirePermission("manageSettings");
  const admin = createAdminClient();
  const { data: rows } = await admin.from("app_errors").select("id, at, place, message, detail, staff_id, job_id").order("at", { ascending: false }).limit(200);
  type Row = { id: string; at: string; place: string; message: string; detail: Record<string, unknown> | null; staff_id: string | null; job_id: string | null };
  const list = (rows ?? []) as Row[];
  // Names and job numbers read apart (app_errors carries plain ids, no foreign keys).
  const staffIds = Array.from(new Set(list.map((r) => r.staff_id).filter((x): x is string => !!x)));
  const jobIds = Array.from(new Set(list.map((r) => r.job_id).filter((x): x is string => !!x)));
  const [{ data: people }, { data: jobs }] = await Promise.all([
    staffIds.length ? admin.from("staff").select("id, display_name").in("id", staffIds) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    jobIds.length ? admin.from("jobs").select("id, job_number").in("id", jobIds) : Promise.resolve({ data: [] as { id: string; job_number: string }[] }),
  ]);
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.display_name]));
  const jobOf = new Map((jobs ?? []).map((j) => [j.id, j.job_number]));
  const detailLines = (d: Record<string, unknown> | null) =>
    d ? Object.entries(d).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`) : [];
  return (
    <>
      <PageHeader
        title="Problems behind the scenes"
        subtitle="Saves that failed, in the database's own words – only you see this. Staff were shown one plain sentence instead."
        actions={<LinkButton href="/settings" tone="secondary" size="lg">Settings</LinkButton>}
      />
      <Card className="flex flex-col gap-3" data-problems>
        <SectionLabel right={`${list.length}`}>Last 200</SectionLabel>
        {list.length === 0 ? <p className="text-sm text-muted">Nothing recorded.</p> : (
          <div className="flex flex-col divide-y divide-line">
            {list.map((r) => (
              <div key={r.id} className="py-2 grid grid-cols-1 md:grid-cols-[10rem_minmax(0,1fr)] gap-1 text-sm" data-problem-row>
                <div className="flex flex-col text-xs text-muted">
                  <span className="font-semibold text-ink">{formatDateTime(r.at)}</span>
                  <span>{r.staff_id ? (nameOf.get(r.staff_id) ?? "Someone") : "—"}</span>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-semibold">
                    {r.place}
                    {r.job_id && jobOf.get(r.job_id) ? <a href={`/jobs/${r.job_id}`} className="ml-2 text-xs font-bold underline underline-offset-4">{jobOf.get(r.job_id)}</a> : null}
                  </span>
                  {/* Raw text keeps its paths and ids whole: one line each, the strip scrolls sideways when one is long. */}
                  <div className="overflow-x-auto">
                    <span className="block whitespace-nowrap text-red font-semibold font-mono text-xs" data-problem-message>{r.message}</span>
                    {detailLines(r.detail).map((line) => (
                      <span key={line} className="block whitespace-nowrap text-xs text-muted">{line}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
