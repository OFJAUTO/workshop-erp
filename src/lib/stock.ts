import "server-only";
import { notifyRoles } from "./notifications";
import { compactPartNumber } from "./price-import";
import { round2 } from "./money";
import { createAdminClient } from "./supabase/admin";
import { realPartNumber } from "./parts-rows";
import { newLabelCode } from "./parts-data";

/**
 * Real stock for the bulk items (oils, filters, pads kept on the shelf): every change is a movement with the
 * quantity after it, the cost each is a weighted average of what came in, and an item below its minimum tells
 * Parts once until it is topped up.
 */
export type StockActor = { id: string | null; display_name: string };
export type MovementKind = "in" | "out" | "count" | "adjust" | "return";
export type StockItemRow = { /** A stock part on the shelf, or a workshop consumable. */ item_type: "part" | "consumable"; id: string; name: string; unit: string; quantity: number; minimum_level: number; unit_cost: number; part_number: string | null; supplier_id: string | null; reorder_quantity: number; last_counted_at: string | null; low_notified_at: string | null };

export const STOCK_ITEM_SELECT = "id, name, unit, quantity, minimum_level, unit_cost, part_number, supplier_id, reorder_quantity, last_counted_at, low_notified_at, item_type";
export const ITEM_TYPE_LABELS: Record<"part" | "consumable", string> = { part: "Stock part", consumable: "Consumable" };

export const toStockItem = (r: Record<string, unknown>): StockItemRow => ({
  item_type: (r.item_type === "consumable" ? "consumable" : "part") as "part" | "consumable",
  id: String(r.id),
  name: String(r.name ?? ""),
  unit: String(r.unit ?? "pc"),
  quantity: Number(r.quantity) || 0,
  minimum_level: Number(r.minimum_level) || 0,
  unit_cost: Number(r.unit_cost) || 0,
  part_number: (r.part_number as string | null) ?? null,
  supplier_id: (r.supplier_id as string | null) ?? null,
  reorder_quantity: Number(r.reorder_quantity) || 0,
  last_counted_at: (r.last_counted_at as string | null) ?? null,
  low_notified_at: (r.low_notified_at as string | null) ?? null,
});

export const isLow = (i: Pick<StockItemRow, "quantity" | "minimum_level">) => i.minimum_level > 0 && i.quantity <= i.minimum_level;

/**
 * One movement: in (a delivery or a part kept), out (issued to a job), return (back from a job), count (the shelf
 * count replaces the figure), adjust (a correction, signed). The quantity after the movement is written with it.
 */
export async function recordStockMovement(itemId: string, input: { kind: MovementKind; quantity: number; unitCost?: number | null; jobId?: string | null; poId?: string | null; partItemId?: string | null; note?: string | null }, actor: StockActor): Promise<{ error?: string; after?: number }> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("stock_items").select(STOCK_ITEM_SELECT).eq("id", itemId).maybeSingle();
  if (!raw) return { error: "Stock item not found." };
  const item = toStockItem(raw as Record<string, unknown>);
  const qty = Number(input.quantity);
  if (!Number.isFinite(qty)) return { error: "Enter a number." };
  let after = item.quantity;
  let unitCost = item.unit_cost;
  if (input.kind === "in" || input.kind === "return") {
    if (qty <= 0) return { error: "Enter the quantity that came in." };
    const cost = input.unitCost ?? null;
    // The cost each becomes the weighted average of what is on the shelf and what came in.
    if (cost !== null && cost >= 0) unitCost = round2(item.quantity + qty > 0 ? (Math.max(0, item.quantity) * item.unit_cost + qty * cost) / (Math.max(0, item.quantity) + qty) : cost);
    after = round2(item.quantity + qty);
  } else if (input.kind === "out") {
    if (qty <= 0) return { error: "Enter the quantity issued." };
    after = round2(Math.max(0, item.quantity - qty));
  } else if (input.kind === "count") {
    if (qty < 0) return { error: "A count cannot be below zero." };
    after = round2(qty);
  } else {
    after = round2(Math.max(0, item.quantity + qty));
  }
  const now = new Date().toISOString();
  await admin.from("stock_items").update({ quantity: after, unit_cost: unitCost, ...(input.kind === "count" ? { last_counted_at: now, last_counted_by: actor.id } : {}), ...(after > item.minimum_level ? { low_notified_at: null } : {}), updated_by: actor.id }).eq("id", itemId);
  await admin.from("stock_movements").insert({ stock_item_id: itemId, kind: input.kind, quantity: input.kind === "count" ? round2(after - item.quantity) : input.kind === "out" ? -qty : qty, unit_cost: input.kind === "in" || input.kind === "return" ? (input.unitCost ?? item.unit_cost) : item.unit_cost, quantity_after: after, job_id: input.jobId ?? null, po_id: input.poId ?? null, part_item_id: input.partItemId ?? null, note: input.note ?? null, created_by: actor.id, updated_by: actor.id });
  return { after };
}

/**
 * A part taken from our own shelf (2 November 2026): received at once with its label, ready to issue, never ordered
 * and never on an LPO. A part from a stock item leaves the shelf now (the "out" movement) and its cost is the stock
 * average at this moment (what the invoice and the profit count). Fewer on the shelf than the part needs never blocks:
 * Parts are told (the count is wrong, or more must be ordered). ONE path for the customer's approval (quote-respond)
 * and for a replacement priced "From our stock…" after the approval.
 */
export async function receiveFromShelf(partId: string, actor: StockActor, note: string): Promise<{ received: boolean; short?: string }> {
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id, description, quantity, confirmed_quantity, stock_item_id").eq("id", partId).maybeSingle();
  if (!p) return { received: false };
  const qty = Number(p.confirmed_quantity ?? p.quantity) || 1;
  const { data: item } = p.stock_item_id ? await admin.from("stock_items").select("name, unit, quantity, unit_cost").eq("id", p.stock_item_id).maybeSingle() : { data: null };
  const onHand = Number(item?.quantity) || 0;
  const avg = Number(item?.unit_cost);
  // Claimed first (received, its label and its stock cost in one write), so a second call never takes the part off the
  // shelf twice and nothing ever reads it received without its cost.
  const { data: claimed } = await admin.from("part_items").update({ order_status: "received", received_qty: qty, label_code: newLabelCode(), ...(avg > 0 ? { final_cost_aed: avg } : {}), updated_by: actor.id }).eq("id", partId).in("order_status", ["none", "to_order"]).select("id");
  if (!claimed?.length) return { received: false };
  if (!p.stock_item_id) return { received: true };
  await recordStockMovement(p.stock_item_id as string, { kind: "out", quantity: qty, jobId: p.job_id as string, partItemId: p.id as string, note }, actor);
  if (!item || onHand >= qty) return { received: true };
  const { data: job } = await admin.from("jobs").select("job_number").eq("id", p.job_id).maybeSingle();
  const short = `${String(item.name).toUpperCase()}: ${qty.toLocaleString("en-GB")} ${item.unit || "pc"} used on ${job?.job_number ?? "a job"}, ${onHand.toLocaleString("en-GB")} on the shelf by the count`;
  await notifyRoles(["parts"], { type: "stock_low", title: `Not enough on the shelf: ${String(item.name).toUpperCase()}`, body: `${short}. Count the shelf, or order more from the stock page.`, jobId: p.job_id as string, href: `/parts/stock` });
  return { received: true, short };
}

/** A part kept in stock: it joins the matching stock item (by part number, else by name), or starts one. */
export async function addPartToStock(part: { id: string; description: string; part_number: string | null; cost_aed: number | string | null; quantity: number | string; confirmed_quantity?: number | string | null; supplier?: string | null }, actor: StockActor, jobId: string | null): Promise<{ error?: string; itemId?: string; itemName?: string }> {
  const admin = createAdminClient();
  const qty = Number(part.confirmed_quantity ?? part.quantity) || 1;
  const cost = part.cost_aed === null || part.cost_aed === undefined || part.cost_aed === "" ? null : Number(part.cost_aed);
  const compact = compactPartNumber(part.part_number);
  let item: { id: string; name: string } | null = null;
  if (compact) {
    const { data } = await admin.from("stock_items").select("id, name, part_number").eq("is_active", true).not("part_number", "is", null);
    item = ((data ?? []) as { id: string; name: string; part_number: string | null }[]).find((i) => compactPartNumber(i.part_number) === compact) ?? null;
  }
  if (!item) {
    const { data } = await admin.from("stock_items").select("id, name").eq("is_active", true).ilike("name", part.description.trim()).limit(1).maybeSingle();
    item = (data as { id: string; name: string } | null) ?? null;
  }
  if (!item) {
    const { data, error } = await admin.from("stock_items").insert({ name: part.description.trim().slice(0, 120), unit: "pc", quantity: 0, minimum_level: 0, unit_cost: cost ?? 0, part_number: realPartNumber(part.part_number), created_by: actor.id, updated_by: actor.id }).select("id, name").single();
    if (error || !data) return { error: error?.message ?? "Could not add the stock item." };
    item = data;
  }
  const r = await recordStockMovement(item.id, { kind: "in", quantity: qty, unitCost: cost, jobId, partItemId: part.id, note: "Kept in stock from a job" }, actor);
  if (r.error) return { error: r.error };
  await admin.from("part_items").update({ stock_item_id: item.id, updated_by: actor.id }).eq("id", part.id);
  return { itemId: item.id, itemName: item.name };
}

/** Items at or below their minimum, Parts told once per dip (the flag clears when the item is topped up). */
export async function notifyLowStock(): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin.from("stock_items").select(STOCK_ITEM_SELECT).eq("is_active", true).gt("minimum_level", 0).is("low_notified_at", null);
  const low = ((data ?? []) as Record<string, unknown>[]).map(toStockItem).filter(isLow);
  for (const i of low) {
    await notifyRoles(["parts"], { type: "stock_low", title: `Stock low: ${i.name}`, body: `${i.quantity} ${i.unit} left, minimum ${i.minimum_level}. Reorder ${i.reorder_quantity || "some"} from the stock page.`, href: `/parts/stock?reorder=${i.id}` });
    await admin.from("stock_items").update({ low_notified_at: new Date().toISOString() }).eq("id", i.id);
  }
  return low.length;
}
