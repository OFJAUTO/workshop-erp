import { partNotNeeded } from "@/lib/handover";
import { createAdminClient } from "@/lib/supabase/admin";

export type DropActor = { id: string | null; display_name: string };

/**
 * Parts that leave a quotation: the customer declined their job, the advisor took them off, or a revised quotation
 * dropped them. A part not yet ordered goes off the parts list (it stays listed as removed, with Put back). A part
 * already ordered or received is never removed quietly: it is marked not needed and Parts are asked for its ending on
 * Returns and leftovers (or the Parts table's menu), which runs THE ending function (src/lib/part-endings-server.ts):
 * Cancelled with the supplier, Return to supplier, or Keep in stock.
 */
export async function dropParts(jobId: string, partIds: string[], actor: DropActor, why: "declined" | "revised" | "removed"): Promise<{ removed: number; asked: number }> {
  const admin = createAdminClient();
  const ids = Array.from(new Set(partIds.filter(Boolean)));
  let removed = 0;
  let asked = 0;
  if (!ids.length) return { removed, asked };
  const { data: rows } = await admin.from("part_items").select("id, description, order_status, received_qty, not_needed_at, is_active, po_id").in("id", ids).eq("job_id", jobId);
  // The customer's own answer carries no staff id: the stamps then name the car's advisor.
  let actingId = actor.id;
  if (!actingId) {
    const { data: job } = await admin.from("jobs").select("gated_in_by").eq("id", jobId).maybeSingle();
    actingId = job?.gated_in_by ?? null;
  }
  const now = new Date().toISOString();
  const reason = why === "declined" ? "Customer declined the job" : why === "revised" ? "Removed from the revised quotation" : "Removed from the quotation";
  for (const p of rows ?? []) {
    if (!p.is_active) continue;
    const ordered = ["ordered", "partly_received", "received"].includes(String(p.order_status)) || Number(p.received_qty) > 0 || !!p.po_id;
    if (!ordered) {
      await admin.from("part_items").update({ is_active: false, removed_at: now, removed_by: actingId, removed_reason: reason, updated_by: actingId }).eq("id", p.id);
      removed++;
    } else if (!p.not_needed_at && actingId) {
      // The question names the endings that fit (3 November 2026): nothing delivered yet = cancel it with the supplier.
      const ask = Number(p.received_qty) > 0 ? "return it to the supplier or keep it in stock?" : "cancel it with the supplier?";
      const question = why === "declined" ? `${p.description}: customer declined, part already ordered: ${ask}` : `${p.description}: removed from the quote, part already ordered: ${ask}`;
      const r = await partNotNeeded(jobId, p.id, { id: actingId, display_name: actor.display_name, role_id: "service_advisor" }, reason, { question });
      if (!r.error) asked++;
    }
  }
  if (removed) await admin.from("job_events").insert({ job_id: jobId, event_type: "part_removed", note: `${removed} part${removed === 1 ? "" : "s"} removed: ${reason} (${actor.display_name})`, created_by: actingId });
  return { removed, asked };
}
