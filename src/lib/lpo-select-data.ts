import "server-only";
import { dubaiDate } from "./jobs";
import { lpoProblemsFor } from "./lpo";
import { PRICING_PART_SELECT, valuesOfPart } from "./parts-pricing";
import { partAdvisorCols } from "./parts-data";
import { costChecksFor } from "./part-cost-history";
import { isOurStock, rowMissing } from "./parts-rows";
import { costConfirmReady } from "./schema-ready";
import { repeatedPartNumbers, selectRowOf, type SelectRow } from "./lpo-select";
import { createAdminClient } from "./supabase/admin";

type Raw = Record<string, unknown>;

/**
 * THE tick list of "Send LPO for selected" (8 November 2026): every approved part of the job still to order, with
 * whether it may be ticked and why not - the same answer for the page and for the server action that sends it.
 * Also the repeated part numbers of the whole job (item 5), by part id.
 */
export async function lpoSelectRows(jobId: string): Promise<{ rows: SelectRow[]; repeated: Map<string, string> }> {
  const admin = createAdminClient();
  const confirmReady = await costConfirmReady();
  const { data } = await admin
    .from("part_items")
    .select(`${PRICING_PART_SELECT}, po_id, received_qty, not_needed_at, issue_status, return_status${confirmReady ? ", cost_confirmed_aed" : ""}${await partAdvisorCols()}`)
    .eq("job_id", jobId)
    .eq("is_active", true);
  const all = ((data ?? []) as unknown as Raw[]).filter((p) => !p.removed_at && String(p.return_status ?? "none") !== "returned");
  const repeated = repeatedPartNumbers(all.map((p) => ({ id: String(p.id), name: String(p.description ?? ""), partNumber: (p.part_number as string | null) ?? null })));
  const approved = all.filter((p) => String(p.order_status ?? "none") !== "none" || false);
  const today = dubaiDate();
  const checks = await costChecksFor(approved as never, all as never);
  const problems = await lpoProblemsFor(jobId, approved.filter((p) => p.order_status === "to_order" && !p.po_id).map((p) => String(p.id)));
  const rows = approved
    .filter((p) => p.order_status === "to_order" && !p.po_id)
    .map((p) => {
      const values = valuesOfPart(p as never, today, checks.get(String(p.id)) ?? null, null);
      return selectRowOf({
        id: String(p.id),
        name: String(p.description ?? ""),
        supplier: (p.supplier as string | null) ?? null,
        quantity: Number(p.confirmed_quantity ?? p.quantity) || 1,
        cost: p.cost_aed === null || p.cost_aed === undefined ? null : Number(p.cost_aed),
        orderStatus: String(p.order_status ?? "none"),
        onLpo: !!p.po_id,
        inStock: p.availability === "in_stock" || isOurStock(p.supplier as string | null),
        received: Number(p.received_qty ?? 0) > 0,
        removed: !!p.not_needed_at,
        missing: rowMissing(values).filter((m) => m.field !== "availability" && m.field !== "days").map((m) => m.long),
        costProblem: problems.get(String(p.id))?.words ?? null,
        repeated: repeated.get(String(p.id)) ?? null,
      });
    })
    // Removed or from stock are not lines to tick at all: they are shown elsewhere on the page.
    .filter((r) => r.why !== "Removed" && r.why !== "From our stock – no LPO");
  return { rows, repeated };
}
