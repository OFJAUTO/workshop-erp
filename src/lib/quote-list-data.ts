import "server-only";
import { createAdminClient } from "./supabase/admin";
import { pageAllIn } from "./page-all";
import { schemaReady } from "./schema-ready";

/**
 * The line facts behind the Estimates and Quotations lists (13 November 2026, Section 6): how many lines count on each
 * quotation, and how many part lines still wait on the parts desk for a price (an estimate's own part lines; a job's
 * quotation reads its job's parts through `loadQuoteSummaries`). One read for the whole list, in pieces.
 */
export async function listLineFacts(quotationIds: string[]): Promise<Map<string, { lineCount: number; withDesk: number }>> {
  const out = new Map<string, { lineCount: number; withDesk: number }>();
  for (const id of quotationIds) out.set(id, { lineCount: 0, withDesk: 0 });
  if (!quotationIds.length) return out;
  const addReady = await schemaReady("quotation_lines", "parts_add_status");
  type L = { quotation_id: string; line_type: string; left_off: boolean | null; part_item_id: string | null; price_requested_at: string | null; priced_at: string | null; priced_by_advisor: boolean | null; parts_add_status?: string | null };
  const cols = "quotation_id, line_type, left_off, part_item_id, price_requested_at, priced_at, priced_by_advisor" + (addReady ? ", parts_add_status" : "");
  const lines = await pageAllIn<L>(quotationIds, (piece, from, to) =>
    createAdminClient().from("quotation_lines").select(cols as "quotation_id").in("quotation_id", piece).eq("is_active", true).order("id").range(from, to) as unknown as PromiseLike<{ data: L[] | null; error: { message: string } | null }>,
  ).catch(() => [] as L[]);
  for (const l of lines) {
    const f = out.get(l.quotation_id);
    if (!f) continue;
    if (!l.left_off) f.lineCount++;
    const onDesk = !l.left_off || l.parts_add_status === "pending";
    if (onDesk && l.line_type === "part" && !l.part_item_id && l.price_requested_at && !l.priced_at && !l.priced_by_advisor) f.withDesk++;
  }
  return out;
}
