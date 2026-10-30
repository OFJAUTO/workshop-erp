import { Card, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { refusalWords } from "@/lib/refusal-words";
import { ROLE_LABELS, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Settings > Refusals (30 October 2026, batch 2 section 3.4): every page that refused someone, with who, which page and
 * why, newest first. A role refused something it needs every day shows up here.
 */
export default async function RefusalsPage() {
  await requirePermission("manageSettings");
  const { data: rows } = await createAdminClient()
    .from("access_refusals")
    .select("id, created_at, role_id, code, path, record_kind, record_id, detail, staff:staff(display_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  type Row = { id: string; created_at: string; role_id: string | null; code: string; path: string | null; record_kind: string | null; record_id: string | null; detail: string | null; staff: { display_name: string } | null };
  const list = (rows ?? []) as unknown as Row[];
  return (
    <>
      <PageHeader title="Refusals" subtitle="Pages that refused someone, with the reason they saw. Newest first." actions={<LinkButton href="/settings" tone="secondary" size="lg">Settings</LinkButton>} />
      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${list.length}`}>Last 200</SectionLabel>
        {list.length === 0 ? <p className="text-sm text-muted">No refusals recorded.</p> : (
          <div className="flex flex-col divide-y divide-line">
            {list.map((r) => (
              <div key={r.id} className="grid grid-cols-1 gap-1 py-2 text-sm md:grid-cols-[11rem_minmax(0,1fr)]" data-refusal-row={r.code}>
                <div className="flex flex-col text-xs text-muted">
                  <span className="font-semibold text-ink">{formatDateTime(r.created_at)}</span>
                  <span>{r.staff?.display_name ?? "Unknown person"}{r.role_id ? ` · ${ROLE_LABELS[r.role_id as RoleId] ?? r.role_id}` : ""}</span>
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="font-semibold">{refusalWords(r.code).title}</span>
                  <span className="break-words text-xs text-muted">{[r.path, r.detail].filter(Boolean).join(" · ")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
