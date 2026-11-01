import "server-only";
import { notifyRoles } from "./notifications";
import { changeWords, lineChange, priceDecision, type PriceDecision } from "./price-change";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { invoiceHref } from "./supplier-invoices";

type Actor = { id: string; display_name: string };
const money = (n: number) => `AED ${(Math.round(n * 100) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

/** The automatic limit from Settings: the higher of the percent of the LPO and the fixed amount (5% / AED 100). */
export function priceLimits(settings: Settings): { percent: number; aed: number } {
  const s = settings as unknown as Record<string, unknown>;
  return { percent: Number(s.supplier_price_auto_percent ?? 5) || 5, aed: Number(s.supplier_price_auto_aed ?? 100) || 100 };
}

/**
 * The supplier's invoice prices on an LPO (1 November 2026): they become the parts' cost on the job (final_cost_aed),
 * the profit and the bill; the LPO keeps the approved price. A price down is accepted. A price up is accepted up to
 * the limit (the owner is told, with the invoice one tap away); above it the line waits for the owner's OK or
 * "Query with supplier", and the bill does not go to accounts before.
 */
export async function applyInvoicePrices(poId: string, prices: Map<string, number>, by: Actor, settings: Settings): Promise<{ decision: PriceDecision; changed: string[] }> {
  const admin = createAdminClient();
  const [{ data: po }, { data: lineRows }] = await Promise.all([
    admin.from("purchase_orders").select("id, number, job_id, supplier_id, supplier_name, total_cost_aed, supplier_invoice_number, supplier_invoice_status").eq("id", poId).maybeSingle(),
    admin.from("purchase_order_lines").select("id, description, quantity, received_qty, unit_cost, invoice_unit_cost, part_item_id").eq("po_id", poId).eq("is_active", true),
  ]);
  const lines = ((lineRows ?? []) as { id: string; description: string; quantity: number | string; received_qty: number | string; unit_cost: number | string; invoice_unit_cost: number | string | null; part_item_id: string | null }[]).map((l) => ({ ...l, quantity: Number(l.quantity) || 0, received_qty: Number(l.received_qty) || 0, unit_cost: Number(l.unit_cost) || 0, invoice_unit_cost: prices.has(l.id) ? Number(prices.get(l.id)) : l.invoice_unit_cost === null ? null : Number(l.invoice_unit_cost) }));
  const { percent, aed } = priceLimits(settings);
  const decision = priceDecision(lines, Number(po?.total_cost_aed) || 0, percent, aed);
  const now = new Date().toISOString();
  const changed: string[] = [];
  for (const l of lines) {
    if (!prices.has(l.id)) continue;
    const c = lineChange(l);
    const check = !c ? "match" : c.each < 0 || decision.auto ? "accepted" : "mismatch";
    await admin.from("purchase_order_lines").update({ invoice_unit_cost: l.invoice_unit_cost, invoice_check: check, invoice_check_by: by.id, invoice_check_at: now, updated_by: by.id }).eq("id", l.id);
    // The supplier's invoice is the real cost on the job (and so in the profit and the bill); the LPO keeps its price.
    if (l.part_item_id) await admin.from("part_items").update({ final_cost_aed: c ? l.invoice_unit_cost : null, updated_by: by.id }).eq("id", l.part_item_id);
    if (c) changed.push(`${String(l.description).toUpperCase()}: ${changeWords(l)}`);
  }
  if (!po || !changed.length) return { decision, changed };
  if (po.job_id) await admin.from("job_events").insert({ job_id: po.job_id, event_type: "supplier_price_change", note: `${po.number} (${po.supplier_name}): ${changed.join("; ")}. ${decision.increase > 0 ? (decision.auto ? `Price up ${money(decision.increase)}, within the limit of ${money(decision.limit)}: accepted.` : `Price up ${money(decision.increase)}, above the limit of ${money(decision.limit)}: waits for the owner.`) : "Price down: accepted."} (${by.display_name})`, created_by: by.id });
  if (decision.increase > 0) {
    const href = invoiceHref({ id: po.id, supplier_id: po.supplier_id, supplier_name: po.supplier_name, supplier_invoice_number: po.supplier_invoice_number, supplier_invoice_status: po.supplier_invoice_status });
    await notifyRoles(["owner"], decision.auto
      ? { type: "supplier_invoice_mismatch", title: `Price up after approval · ${po.number} · ${po.supplier_name}: +${money(decision.increase)}`, body: `${changed.join("; ")}. Within the limit of ${money(decision.limit)}: accepted. The invoice photo is one tap away.`, jobId: po.job_id, href }
      : { type: "supplier_invoice_mismatch", title: `Your OK needed · ${po.number} · ${po.supplier_name}: price up +${money(decision.increase)}`, body: `${changed.join("; ")}. Above the limit of ${money(decision.limit)}: OK or Query with supplier on the LPO. The bill waits until then.`, jobId: po.job_id, href: `/parts/orders/${po.id}` });
  }
  return { decision, changed };
}
