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

/** Record a payment any time (1 November 2026): unallocated advances, the car, the allocation. Migration 20261202090000_payments_anytime. */
export const paymentsAnytimeReady = () => schemaReady("payments", "vehicle_id, allocated_at, allocated_by");

/** Nothing below cost (2 November 2026): the owner's approval of one line below its cost, and the parts behind a
 *  revision request. Migration 20261203090000_below_cost. Before it the owner cannot approve below cost (refused like everyone). */
export const belowCostReady = () => schemaReady("quotation_lines", "below_cost_reason, below_cost_by, below_cost_at, below_cost_sell_aed, below_cost_cost_aed");
export const BELOW_COST_SELECT = "id, below_cost_reason, below_cost_by, below_cost_at, below_cost_sell_aed, below_cost_cost_aed";
export const revisionPartsReady = () => schemaReady("quotations", "revision_request_parts");

/** Placeholder costs (2 November 2026, section 2): "Yes, real price" kept per cost figure on parts and estimate part
 *  lines, and an estimate part's stock item. Migration 20261203100000_part_costs. Before it the cost question is a
 *  warning only (its answer cannot be stored), and the LPO gate refuses what needs no new column. */
export const costConfirmReady = () => schemaReady("part_items", "cost_confirmed_aed, cost_confirmed_at, cost_confirmed_by");
export const lineCostConfirmReady = () => schemaReady("quotation_lines", "cost_confirmed_aed, cost_confirmed_at, cost_confirmed_by, stock_item_id");

/** Quantity + unit on every parts form (section 9, 3 November 2026): a part's unit (pieces, litres, sets), an estimate
 *  part's asked quantity, its quantity change stamps and the shared row's list price and supplier discount. Migration
 *  20261203160000_part_units. Before it the quantity still changes and is logged; the unit stays pieces everywhere and
 *  nothing reads or writes the new columns. */
export const partUnitsReady = async () => (await schemaReady("part_items", "unit")) && (await schemaReady("quotation_lines", "unit, asked_quantity, quantity_changed_at, quantity_changed_by, list_price_aed, supplier_discount_percent"));
/** The extra columns of an estimate's part line, read once they exist (attachPartLineExtras in quote-data.ts). */
export const PART_LINE_EXTRA_SELECT = "id, unit, asked_quantity, quantity_changed_at, quantity_changed_by, list_price_aed, supplier_discount_percent";

/** "Pricing done – send to advisor" on an estimate (section 10, 3 November 2026): the send kept on the estimate.
 *  Migration 20261203170000_estimate_pricing_done. Before it the button still sends the ONE notification, but the
 *  estimate leaves the parts desk's list by itself once nothing is left to price or check (as it always did). */
export const estimatePricingReady = () => schemaReady("quotations", "parts_priced_at, parts_priced_by");

/** Payment hand-over (2 November 2026, section 3): an advisor's "Payment received – send to accounts". Migration
 *  20261203110000_payment_reports. Before it the button is not shown and nothing reads the table (nothing half-works). */
export const paymentReportsReady = () => schemaReady("payment_reports", "id, status, payment_id, reminded_at, replaces_id");

/** Zoho Books on manual (3 November 2026, section 11): the stored "Sync to Zoho" runs (the results list kept after the
 *  window closes, "Last syncs", one run at a time). Migration 20261203180000_zoho_manual_sync. Before it a run still
 *  works and shows its results in the window; only the stored history and the one-run lock wait for the table. */
export const syncRunsReady = () => schemaReady("zoho_sync_runs", "id, status, heartbeat_at, outbox_ids, items, removed, skipped");
