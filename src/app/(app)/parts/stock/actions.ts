"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { notifyRoles } from "@/lib/notifications";
import { round2 } from "@/lib/money";
import { STOCK_ITEM_SELECT, recordStockMovement, toStockItem } from "@/lib/stock";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { LINE_TEXT_MAX, tooLongWords } from "@/lib/text-limits";

const enc = encodeURIComponent;
const back = (msg: { error?: string; message?: string }, extra = "") => redirect(`/parts/stock${extra}${extra ? "&" : "?"}${msg.error ? `error=${enc(msg.error)}` : `message=${enc(msg.message ?? "Done.")}`}`);

function refresh() {
  revalidatePath("/parts/stock");
  revalidatePath("/parts/orders");
  revalidatePath("/dashboard");
}

/** A stock item: name, unit, part number, minimum, reorder quantity, supplier. The quantity itself moves only through movements. */
export async function saveStockItemDetails(formData: FormData) {
  const staff = await requirePermission("manageStock");
  const id = blankToNull(formData.get("id"));
  const name = blankToNull(formData.get("name"));
  if (!name) back({ error: "Type the item name." });
  const num = (k: string) => Number(String(formData.get(k) ?? "0").replace(",", ".")) || 0;
  const row = { item_type: formData.get("item_type") === "consumable" ? "consumable" : "part", name: name!.slice(0, 120), unit: (blankToNull(formData.get("unit")) ?? "pc").slice(0, 20), part_number: blankToNull(formData.get("part_number"))?.slice(0, 60) ?? null, minimum_level: Math.max(0, num("minimum_level")), reorder_quantity: Math.max(0, num("reorder_quantity")), supplier_id: blankToNull(formData.get("supplier_id")), updated_by: staff.id };
  const admin = createAdminClient();
  if (id) {
    const { error } = await admin.from("stock_items").update(row).eq("id", id);
    if (error) back({ error: error.message });
  } else {
    const opening = Math.max(0, num("quantity"));
    const cost = Math.max(0, num("unit_cost"));
    const { data, error } = await admin.from("stock_items").insert({ ...row, quantity: 0, unit_cost: cost, created_by: staff.id }).select("id").single();
    if (error || !data) back({ error: error?.message ?? "Could not add the item." });
    if (opening > 0) await recordStockMovement(data!.id, { kind: "in", quantity: opening, unitCost: cost, note: "Opening stock" }, staff);
  }
  refresh();
  back({ message: "Saved." });
}

/** The shelf count: every counted figure replaces the stock figure, with the difference written as a count movement. */
export async function countStock(formData: FormData) {
  const staff = await requirePermission("manageStock");
  const admin = createAdminClient();
  const { data } = await admin.from("stock_items").select(STOCK_ITEM_SELECT).eq("is_active", true);
  let counted = 0;
  for (const raw of data ?? []) {
    const item = toStockItem(raw as Record<string, unknown>);
    const text = String(formData.get(`counted__${item.id}`) ?? "").trim();
    if (!text) continue;
    const qty = Number(text.replace(",", "."));
    if (!Number.isFinite(qty) || qty < 0) continue;
    const r = await recordStockMovement(item.id, { kind: "count", quantity: qty, note: `Counted by ${staff.display_name}` }, staff);
    if (!r.error) counted++;
  }
  refresh();
  if (!counted) back({ error: "Type the counted quantity for at least one item." }, "?count=1");
  back({ message: `${counted} item${counted === 1 ? "" : "s"} counted.` });
}

/** A correction with a reason (a spill, a miscount found later). */
export async function adjustStock(formData: FormData) {
  const staff = await requirePermission("manageStock");
  const id = String(formData.get("id") ?? "");
  const delta = Number(String(formData.get("delta") ?? "").replace(",", "."));
  const note = blankToNull(formData.get("note"));
  if (!id || !Number.isFinite(delta) || delta === 0) back({ error: "Enter the change (minus takes stock off)." });
  if (!note) back({ error: "Write why." });
  const r = await recordStockMovement(id, { kind: "adjust", quantity: delta, note }, staff);
  refresh();
  back(r.error ? { error: r.error } : { message: "Adjusted." });
}

/**
 * A stock order: an LPO with no job, one supplier, the items and quantities. It waits for the owner or the head
 * accountant like any LPO, is sent and marked ordered the same way, and the delivery goes straight onto the shelf
 * with the cost averaged in.
 */
export async function createStockOrder(formData: FormData) {
  const staff = await requirePermission("manageStock");
  const admin = createAdminClient();
  const supplierId = blankToNull(formData.get("supplier_id"));
  const { data: supplier } = supplierId ? await admin.from("suppliers").select("id, name").eq("id", supplierId).maybeSingle() : { data: null };
  if (!supplier) back({ error: "Choose the supplier." }, "?order=1");
  // What kind of goods: stock parts or consumables from the shelf list, or tools and equipment typed line by line.
  const orderType = (["stock_parts", "consumables", "tools"] as const).find((t) => t === String(formData.get("order_type") ?? "")) ?? "stock_parts";
  const { data: itemsRaw } = await admin.from("stock_items").select(STOCK_ITEM_SELECT).eq("is_active", true);
  const items = ((itemsRaw ?? []) as Record<string, unknown>[]).map(toStockItem);
  const lines: { stock_item_id: string | null; description: string; part_number: string | null; quantity: number; unit_cost: number }[] = [];
  if (orderType === "tools") {
    for (let n = 1; n <= 6; n++) {
      const d = blankToNull(formData.get(`tool_desc__${n}`));
      const q = Number(String(formData.get(`tool_qty__${n}`) ?? "").replace(",", "."));
      const c = Number(String(formData.get(`tool_cost__${n}`) ?? "").replace(",", "."));
      if (!d || !Number.isFinite(q) || q <= 0) continue;
      if (d.length > LINE_TEXT_MAX) back({ error: `Line ${n}: ${tooLongWords(d.length)}` }, "?order=1");
      lines.push({ stock_item_id: null, description: d, part_number: null, quantity: round2(q), unit_cost: round2(Number.isFinite(c) && c >= 0 ? c : 0) });
    }
  }
  for (const i of orderType === "tools" ? [] : items) {
    const qty = Number(String(formData.get(`qty__${i.id}`) ?? "").replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const costText = String(formData.get(`cost__${i.id}`) ?? "").replace(",", ".");
    const cost = costText ? Number(costText) : i.unit_cost;
    lines.push({ stock_item_id: i.id, description: i.name, part_number: i.part_number, quantity: round2(qty), unit_cost: round2(Number.isFinite(cost) && cost >= 0 ? cost : i.unit_cost) });
  }
  if (!lines.length) back({ error: orderType === "tools" ? "Type at least one item with a quantity." : "Enter a quantity for at least one item." }, "?order=1");
  const total = round2(lines.reduce((a, l) => a + l.quantity * l.unit_cost, 0));
  const settings = await getSettings();
  const fixedAsset = orderType === "tools" && total >= (Number(settings.fixed_asset_threshold_aed) || 2000);
  const { data: po, error } = await admin.from("purchase_orders").insert({ job_id: null, kind: "stock", order_type: orderType, fixed_asset: fixedAsset, supplier_id: supplier!.id, supplier_name: supplier!.name, status: "pending_approval", total_cost_aed: total, notes: blankToNull(formData.get("notes")), created_by: staff.id, updated_by: staff.id }).select("id, number").single();
  if (error || !po) back({ error: error?.message ?? "Could not raise the stock order." }, "?order=1");
  const { error: lineError } = await admin.from("purchase_order_lines").insert(lines.map((l, i) => ({ po_id: po!.id, part_item_id: null, stock_item_id: l.stock_item_id, position: i + 1, description: l.description, part_number: l.part_number, quantity: l.quantity, unit_cost: l.unit_cost, created_by: staff.id, updated_by: staff.id })));
  if (lineError) {
    // Never leave an empty order behind: it is cancelled and the reason shown.
    await admin.from("purchase_orders").update({ status: "cancelled", notes: `Could not save the lines: ${lineError.message}`, updated_by: staff.id }).eq("id", po!.id);
    back({ error: `Could not save the order lines: ${lineError.message}` }, "?order=1");
  }
  await notifyRoles(["owner"], { type: "po_approval", title: `Stock order to approve · ${po!.number}`, body: `${supplier!.name} · ${lines.length} item${lines.length === 1 ? "" : "s"} · AED ${total.toLocaleString("en-GB")} · raised by ${staff.display_name}`, href: `/parts/orders/${po!.id}` });
  if (fixedAsset) await notifyRoles(["accounts"], { type: "fixed_asset", title: `Fixed asset to record: ${po!.number}, AED ${total.toLocaleString("en-GB")}`, body: `Tools and equipment from ${supplier!.name}: ${lines.map((l) => l.description).join(", ")}. Record it in the asset register once it is received.`, href: `/parts/orders/${po!.id}` });
  refresh();
  redirect(`/parts/orders/${po!.id}?message=${enc(`${po!.number} raised for ${supplier!.name}: it waits for approval, then Ordered, then the delivery ${orderType === "tools" ? "is recorded" : "goes onto the shelf"}.`)}`);
}
