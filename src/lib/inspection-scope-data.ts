import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaReady } from "@/lib/schema-ready";
import { autoNotCheckedReason, isCondition, pendingOf, type Condition, type NotChecked } from "@/lib/inspection-scope";

/** The server half of the inspection type and "Could not check" (11 November 2026, Section 10). */
export const scopeReady = () => schemaReady("inspection_items", "not_checked_reason");

export type ScopeState = { ready: boolean; scope: string | null; request: { scope: string; reason: string | null; by: string | null } | null; condition: Condition | null; notChecked: (NotChecked & { label: string })[]; checked: number; pending: number };

/** One car's type, condition and items not checked (with how many are checked and how many wait). */
export async function loadScopeState(jobId: string): Promise<ScopeState> {
  const ready = await scopeReady();
  if (!ready) return { ready, scope: null, request: null, condition: null, notChecked: [], checked: 0, pending: 0 };
  const admin = createAdminClient();
  const [{ data: job }, { data: insp }] = await Promise.all([
    admin.from("jobs").select("inspection_scope, inspection_scope_request, inspection_scope_request_reason, inspection_scope_request_by").eq("id", jobId).maybeSingle(),
    admin.from("inspections").select("id, car_condition").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const { data: items } = insp ? await admin.from("inspection_items").select("item_key, item_label, status, not_checked_reason, not_checked_auto, not_checked_resolution").eq("inspection_id", insp.id) : { data: [] };
  const rows = (items ?? []) as { item_key: string; item_label: string; status: string | null; not_checked_reason: string | null; not_checked_auto: boolean; not_checked_resolution: string | null }[];
  const nc = rows.filter((r) => r.not_checked_reason).map((r) => ({ key: r.item_key, label: r.item_label, reason: r.not_checked_reason as string, auto: !!r.not_checked_auto, resolution: (r.not_checked_resolution as NotChecked["resolution"]) ?? null }));
  return {
    ready,
    scope: (job?.inspection_scope as string | null) ?? null,
    request: job?.inspection_scope_request ? { scope: job.inspection_scope_request as string, reason: (job.inspection_scope_request_reason as string | null) ?? null, by: (job.inspection_scope_request_by as string | null) ?? null } : null,
    condition: isCondition(insp?.car_condition) ? (insp!.car_condition as Condition) : null,
    notChecked: nc,
    checked: rows.filter((r) => r.status && !r.not_checked_reason).length,
    pending: pendingOf(nc).length,
  };
}

/** The car's condition set: items it makes impossible are marked by themselves; items it makes possible again wait. */
export async function applyCondition(inspectionId: string, condition: Condition, by: string): Promise<{ marked: number; reopened: number }> {
  const admin = createAdminClient();
  const { data: items } = await admin.from("inspection_items").select("id, item_key, item_label, section_key, status, not_checked_reason, not_checked_auto, not_checked_resolution").eq("inspection_id", inspectionId);
  let marked = 0;
  let reopened = 0;
  for (const it of (items ?? []) as { id: string; item_key: string; item_label: string; section_key: string | null; status: string | null; not_checked_reason: string | null; not_checked_auto: boolean; not_checked_resolution: string | null }[]) {
    if (it.status) continue; // answered: nothing to mark
    const reason = autoNotCheckedReason({ key: it.item_key, label: it.item_label, sectionKey: it.section_key }, condition);
    if (reason && !it.not_checked_reason) {
      await admin.from("inspection_items").update({ not_checked_reason: reason, not_checked_auto: true, not_checked_resolution: null, updated_by: by }).eq("id", it.id);
      marked++;
    } else if (!reason && it.not_checked_auto && !it.not_checked_resolution) {
      // The car runs now: the automatic mark comes off - the item is to check again.
      await admin.from("inspection_items").update({ not_checked_reason: null, not_checked_auto: false, updated_by: by }).eq("id", it.id);
      reopened++;
    }
  }
  return { marked, reopened };
}

/** QC waits while items could not be checked and nobody settled them (checked later, customer declined, not applicable). */
export async function pendingChecksWords(jobId: string): Promise<string | null> {
  if (!(await scopeReady())) return null;
  const s = await loadScopeState(jobId);
  if (!s.pending) return null;
  return `${s.pending} inspection item${s.pending === 1 ? "" : "s"} could not be checked yet (${pendingOf(s.notChecked).slice(0, 3).map((x) => x.label).join(", ")}${s.pending > 3 ? "…" : ""}): check them, or the advisor marks them Customer declined or Not applicable.`;
}
