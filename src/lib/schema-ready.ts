import "server-only";
import { createAdminClient } from "./supabase/admin";

/**
 * A feature whose database change may not be applied yet (30 October 2026, night batch): the code is live, the feature
 * stays dormant until its columns exist, then switches itself on - no second deploy. Asked of the database for zero
 * rows; the answer is kept for an hour once ready, and re-asked every minute while not.
 */
const cache = new Map<string, { ok: boolean; at: number }>();

export async function schemaReady(table: string, columns: string): Promise<boolean> {
  const key = `${table}:${columns}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < (hit.ok ? 3_600_000 : 60_000)) return hit.ok;
  const { error } = await createAdminClient().from(table).select(columns).limit(0);
  // Only "this column / table does not exist" means not ready. A passing hiccup (no connection, a time-out) keeps the
  // last answer and is asked again next time - it never switches a feature off for a minute.
  const missing = !!error && /^(42703|42P01|PGRST204|PGRST205)$/.test(String(error.code ?? ""));
  if (error && !missing) return hit?.ok ?? false;
  const ok = !error;
  cache.set(key, { ok, at: now });
  return ok;
}

/** Section 8 (final km and the cluster photo at gate-out): migration 20261201100000_gate_out_mileage. */
export const gateOutMileageReady = () => schemaReady("gate_outs", "mileage_out, mileage_unreadable_reason, odometer_file_id");

/** Section 5 (complimentary jobs: a reason, the owner's approval, the cost to us): migration 20261201130000_complimentary_jobs. */
export const compReady = () => schemaReady("quotations", "comp_reason, comp_original_job_id, comp_note, comp_status, comp_cost_aed");
export const COMP_SELECT = "comp_reason, comp_original_job_id, comp_note, comp_status, comp_decided_by, comp_decided_at, comp_decision_note, comp_normal_aed, comp_cost_aed, comp_cost_detail";
