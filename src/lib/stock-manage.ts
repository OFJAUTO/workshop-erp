import "server-only";
import { createAdminClient } from "./supabase/admin";
import { logAppError, SAVE_FAILED } from "./app-errors";
import { schemaReady } from "./schema-ready";
import { can, type RoleId } from "./roles";
import { STOCK_ITEM_SELECT, recordStockMovement, toStockItem, type StockItemRow } from "./stock";
import { countDifferences, countLabel, valueWords, type CountLine } from "./stock-rules";
import { notifyRoles } from "./notifications";

/*
 * STOCK: CATEGORIES, VIEW ACCESS, MERGE AND THE STOCK COUNT (20 November 2026, Section 5). The server half of
 * src/lib/stock-rules.ts. Every read goes through the admin client after the page's own check: a viewer (the personal
 * "Can view stock" switch, given to DEEPAK) gets names, quantities and status only - never a cost or a value, and every
 * action refuses him on the server. The count is saved line by line, applied only when the owner approves the batch
 * through the approval box; items not found are archived; nothing is deleted or reset; nothing posts to Zoho.
 */

type Actor = { id: string; display_name: string; role_id: string };

export const stockRedesignReady = () => schemaReady("stock_items", "category_id,brand,photo_path,archived_at,merged_into");
export const stockCountsReady = () => schemaReady("stock_count_lines", "count_id,counted_qty,not_found");

export const STOCK_EXTRA_SELECT = ", category_id, brand, photo_path, archived_at, merged_into";

export type StockAccess = { manage: boolean; view: boolean; seesCost: boolean };

/** Who sees what on the stock page: the parts desk, accounts and the owner manage it; a person with the switch views it. */
export async function stockAccessOf(staff: { id: string; role_id: string; viewingAs?: unknown }): Promise<StockAccess> {
  const manage = can(staff.role_id as RoleId, "manageStock");
  let personal = false;
  if (!manage && (await schemaReady("staff", "can_view_stock"))) {
    const { data } = await createAdminClient().from("staff").select("can_view_stock").eq("id", staff.id).maybeSingle();
    personal = !!(data as { can_view_stock?: boolean } | null)?.can_view_stock;
  }
  return { manage, view: manage || personal, seesCost: manage };
}

export type StockCategory = { id: string; name: string; position: number };

export async function loadCategories(): Promise<StockCategory[]> {
  if (!(await stockRedesignReady())) return [];
  const { data } = await createAdminClient().from("stock_categories").select("id, name, position").eq("is_active", true).order("position").order("name");
  return (data ?? []) as StockCategory[];
}

const mayCategories = (role: string) => role === "owner" || role === "parts";

export async function saveCategory(input: { id?: string | null; name: string }, by: Actor): Promise<{ error?: string; words?: string }> {
  if (!mayCategories(by.role_id)) return { error: "Only the owner or the parts desk edit the categories." };
  if (!(await stockRedesignReady())) return { error: "Categories switch on once the database change is applied (WAITING FOR APPLY)." };
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (name.length < 2) return { error: "Type the category name." };
  const admin = createAdminClient();
  if (input.id) {
    const { error } = await admin.from("stock_categories").update({ name, updated_by: by.id }).eq("id", input.id);
    if (error) return { error: /duplicate|unique/i.test(error.message) ? `There is already a category called "${name}".` : SAVE_FAILED };
    return { words: `Category renamed: ${name}.` };
  }
  const { data: last } = await admin.from("stock_categories").select("position").eq("is_active", true).order("position", { ascending: false }).limit(1);
  const { error } = await admin.from("stock_categories").insert({ name, position: (Number((last ?? [])[0]?.position) || 0) + 1, created_by: by.id, updated_by: by.id });
  if (error) return { error: /duplicate|unique/i.test(error.message) ? `There is already a category called "${name}".` : SAVE_FAILED };
  return { words: `Category added: ${name}.` };
}

export async function archiveCategory(id: string, by: Actor): Promise<{ error?: string; words?: string }> {
  if (!mayCategories(by.role_id)) return { error: "Only the owner or the parts desk edit the categories." };
  const admin = createAdminClient();
  const { count } = await admin.from("stock_items").select("id", { count: "exact", head: true }).eq("category_id", id).eq("is_active", true);
  if ((count ?? 0) > 0) return { error: `${count} item${count === 1 ? " is" : "s are"} in this category: move ${count === 1 ? "it" : "them"} first.` };
  const { error } = await admin.from("stock_categories").update({ is_active: false, updated_by: by.id }).eq("id", id);
  return error ? { error: SAVE_FAILED } : { words: "Category archived." };
}

/**
 * MERGE two stock items (duplicates, e.g. BOSCH BRAKE FLUID twice): the second's quantity moves to the first as two
 * movements (history kept on both), its parts and estimate lines point to the first, and it is archived "merged into".
 */
export async function mergeStockItems(keepId: string, goneId: string, reason: string, by: Actor): Promise<{ error?: string; words?: string }> {
  if (!can(by.role_id as RoleId, "manageStock")) return { error: "Only the parts desk or the owner merge stock items." };
  if (!(await stockRedesignReady())) return { error: "Merging switches on once the database change is applied (WAITING FOR APPLY)." };
  if (keepId === goneId) return { error: "Pick two different items." };
  if (reason.trim().length < 3) return { error: "Write why they are the same item." };
  const admin = createAdminClient();
  const { data: rows } = await admin.from("stock_items").select(STOCK_ITEM_SELECT).in("id", [keepId, goneId]).eq("is_active", true);
  const keep = (rows ?? []).map((r) => toStockItem(r as Record<string, unknown>)).find((r) => r.id === keepId);
  const gone = (rows ?? []).map((r) => toStockItem(r as Record<string, unknown>)).find((r) => r.id === goneId);
  if (!keep || !gone) return { error: "One of the items is not there any more: reload the page." };
  const note = `Merged ${gone.name} into ${keep.name}: ${reason.trim().slice(0, 200)}`;
  if (gone.quantity > 0.0005) {
    const r1 = await recordStockMovement(goneId, { kind: "adjust", quantity: -gone.quantity, note }, by);
    if (r1.error) return { error: r1.error };
    const r2 = await recordStockMovement(keepId, { kind: "in", quantity: gone.quantity, unitCost: gone.unit_cost, note }, by);
    if (r2.error) return { error: r2.error };
  }
  await admin.from("part_items").update({ stock_item_id: keepId, updated_by: by.id }).eq("stock_item_id", goneId);
  await admin.from("quotation_lines").update({ stock_item_id: keepId, updated_by: by.id }).eq("stock_item_id", goneId);
  const { error } = await admin.from("stock_items").update({ is_active: false, merged_into: keepId, archived_at: new Date().toISOString(), archived_by: by.id, archive_reason: note.slice(0, 300), updated_by: by.id }).eq("id", goneId);
  if (error) {
    await logAppError("stock-manage: merge", error, { staffId: by.id });
    return { error: SAVE_FAILED };
  }
  return { words: `${gone.name} merged into ${keep.name}${gone.quantity > 0.0005 ? ` (${gone.quantity} ${gone.unit} moved)` : ""}. Its history stays.` };
}

/** Archive an item (it leaves the list; its history stays): only the parts desk, accounts and the owner, with a reason. */
export async function archiveStockItem(id: string, reason: string, by: Actor): Promise<{ error?: string; words?: string }> {
  if (!can(by.role_id as RoleId, "manageStock")) return { error: "Only the parts desk or the owner archive stock items." };
  const admin = createAdminClient();
  const { data } = await admin.from("stock_items").select("name, quantity").eq("id", id).maybeSingle();
  if (!data) return { error: "That item is not there any more." };
  if (Math.abs(Number(data.quantity) || 0) > 0.0005) return { error: `${data.name} still has ${data.quantity} on the shelf: adjust it to 0 first (or count it), then archive.` };
  const extra = (await stockRedesignReady()) ? { archived_at: new Date().toISOString(), archived_by: by.id, archive_reason: reason.trim().slice(0, 300) || null } : {};
  const { error } = await admin.from("stock_items").update({ is_active: false, ...extra, updated_by: by.id }).eq("id", id);
  return error ? { error: SAVE_FAILED } : { words: `${data.name} archived. Its history stays.` };
}

/* ----------------------------------- THE STOCK COUNT ----------------------------------- */

export type CountView = { id: string; label: string; status: string; countedOn: string; submittedBy: string | null; lines: CountLine[]; diff: ReturnType<typeof countDifferences> };

/** The count being entered (one at a time), or null. */
export async function openCount(): Promise<{ id: string; label: string; status: string } | null> {
  if (!(await stockCountsReady())) return null;
  const { data } = await createAdminClient().from("stock_counts").select("id, label, status").eq("is_active", true).in("status", ["draft", "submitted"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as { id: string; label: string; status: string } | null) ?? null;
}

/** Start a count (the first one is the OPENING COUNT). */
export async function startCount(by: Actor): Promise<{ error?: string; id?: string }> {
  if (!can(by.role_id as RoleId, "manageStock")) return { error: "Only the parts desk or the owner count stock." };
  if (!(await stockCountsReady())) return { error: "The stock count switches on once the database change is applied (WAITING FOR APPLY)." };
  const existing = await openCount();
  if (existing) return { id: existing.id };
  const admin = createAdminClient();
  const { count } = await admin.from("stock_counts").select("id", { count: "exact", head: true }).eq("status", "approved");
  const day = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const { data, error } = await admin.from("stock_counts").insert({ label: countLabel(day, (count ?? 0) === 0), counted_on: day, created_by: by.id, updated_by: by.id }).select("id").single();
  if (error || !data) {
    await logAppError("stock-manage: start count", error ?? new Error("no row"), { staffId: by.id });
    return { error: SAVE_FAILED };
  }
  return { id: String(data.id) };
}

/** One item counted (or "not found"), saved at once so the count can be continued later. */
export async function saveCountLine(countId: string, itemId: string, counted: number | null, notFound: boolean, by: Actor): Promise<{ error?: string }> {
  if (!can(by.role_id as RoleId, "manageStock")) return { error: "Only the parts desk or the owner count stock." };
  const admin = createAdminClient();
  const { data: c } = await admin.from("stock_counts").select("status").eq("id", countId).maybeSingle();
  if (!c || c.status !== "draft") return { error: "This count is not open for entries any more." };
  if (counted !== null && (!Number.isFinite(counted) || counted < 0)) return { error: "A count is 0 or more." };
  const { data: item } = await admin.from("stock_items").select("quantity, unit_cost").eq("id", itemId).maybeSingle();
  if (!item) return { error: "That item is not there any more." };
  const row = { count_id: countId, stock_item_id: itemId, system_qty: Number(item.quantity) || 0, unit_cost: Number(item.unit_cost) || 0, counted_qty: notFound ? null : counted, not_found: notFound, is_active: counted !== null || notFound, updated_by: by.id };
  const { error } = await admin.from("stock_count_lines").upsert({ ...row, created_by: by.id }, { onConflict: "count_id,stock_item_id" });
  if (error) {
    await logAppError("stock-manage: count line", error, { staffId: by.id });
    return { error: SAVE_FAILED };
  }
  return {};
}

/** The count with each line's difference and value and the total change (before anything changes). */
export async function loadCount(countId: string): Promise<CountView | null> {
  if (!(await stockCountsReady())) return null;
  const admin = createAdminClient();
  const { data: c } = await admin.from("stock_counts").select("id, label, status, counted_on, submitted_by").eq("id", countId).maybeSingle();
  if (!c) return null;
  const { data: lines } = await admin.from("stock_count_lines").select("stock_item_id, system_qty, counted_qty, not_found, unit_cost").eq("count_id", countId).eq("is_active", true);
  const ids = ((lines ?? []) as { stock_item_id: string }[]).map((l) => l.stock_item_id);
  const { data: items } = ids.length ? await admin.from("stock_items").select("id, name, unit").in("id", ids) : { data: [] };
  const itemOf = new Map(((items ?? []) as { id: string; name: string; unit: string }[]).map((i) => [i.id, i]));
  const list: CountLine[] = ((lines ?? []) as { stock_item_id: string; system_qty: number | string; counted_qty: number | string | null; not_found: boolean; unit_cost: number | string }[]).map((l) => ({ itemId: l.stock_item_id, name: itemOf.get(l.stock_item_id)?.name ?? "Item", unit: itemOf.get(l.stock_item_id)?.unit ?? "pc", systemQty: Number(l.system_qty) || 0, countedQty: l.counted_qty === null ? null : Number(l.counted_qty), notFound: !!l.not_found, unitCost: Number(l.unit_cost) || 0 }));
  const { data: who } = c.submitted_by ? await admin.from("staff").select("display_name").eq("id", c.submitted_by).maybeSingle() : { data: null };
  return { id: String(c.id), label: String(c.label), status: String(c.status), countedOn: String(c.counted_on), submittedBy: (who?.display_name as string | null) ?? null, lines: list, diff: countDifferences(list) };
}

/** Send the count to the owner: one batch, decided in the approval box. Nothing changes before he approves. */
export async function submitCount(countId: string, by: Actor): Promise<{ error?: string; words?: string }> {
  if (!can(by.role_id as RoleId, "manageStock")) return { error: "Only the parts desk or the owner count stock." };
  const v = await loadCount(countId);
  if (!v || v.status !== "draft") return { error: "This count is not open any more." };
  if (!v.diff.counted) return { error: "Count at least one item first." };
  const admin = createAdminClient();
  const { error } = await admin.from("stock_counts").update({ status: "submitted", submitted_at: new Date().toISOString(), submitted_by: by.id, updated_by: by.id }).eq("id", countId).eq("status", "draft");
  if (error) return { error: SAVE_FAILED };
  await notifyRoles(["owner"], { type: "stock_count", title: `Approve the stock count · ${v.label}`, body: `${v.diff.counted} items counted, ${v.diff.changed} change, ${v.diff.notFound} not found: total change ${valueWords(v.diff.totalValue)}. Nothing changes until you approve it.`, href: `/approvals?approval=${encodeURIComponent(`stock_count:${countId}`)}` });
  return { words: `${v.label} sent to the owner: ${v.diff.counted} items, total change ${valueWords(v.diff.totalValue)}. Nothing changes until he approves it.` };
}

/** The counts waiting for the owner (the approval box). */
export async function countApprovals(): Promise<{ id: string; label: string; submittedBy: string | null; submittedAt: string | null; words: string; value: number }[]> {
  if (!(await stockCountsReady())) return [];
  const { data } = await createAdminClient().from("stock_counts").select("id, submitted_at").eq("status", "submitted").eq("is_active", true);
  const out = [];
  for (const c of (data ?? []) as { id: string; submitted_at: string | null }[]) {
    const v = await loadCount(c.id);
    if (!v) continue;
    const top = v.diff.lines.filter((l) => Math.abs(l.diff) > 0.0005).slice(0, 6).map((l) => `${l.name}: ${l.notFound ? "not found" : `${l.systemQty} → ${l.countedQty}`} (${valueWords(l.value)})`).join("; ");
    out.push({ id: c.id, label: v.label, submittedBy: v.submittedBy, submittedAt: c.submitted_at, value: v.diff.totalValue, words: `${v.diff.counted} items counted, ${v.diff.changed} change, ${v.diff.notFound} not found. ${top}${v.diff.changed > 6 ? " …" : ""}` });
  }
  return out;
}

/** The owner approves (the figures change, items not found are archived) or refuses (nothing changes). */
export async function decideCount(countId: string, yes: boolean, note: string, by: Actor): Promise<{ ok?: boolean; error?: string; message?: string }> {
  if (by.role_id !== "owner") return { error: "Only the owner approves a stock count." };
  const v = await loadCount(countId);
  if (!v || v.status !== "submitted") return { error: "This count is not waiting for you any more." };
  const admin = createAdminClient();
  if (!yes) {
    await admin.from("stock_counts").update({ status: "refused", decided_at: new Date().toISOString(), decided_by: by.id, decision_note: note || null, updated_by: by.id }).eq("id", countId);
    return { ok: true, message: `${v.label} refused: nothing changed.` };
  }
  const { data: claimed } = await admin.from("stock_counts").update({ status: "approved", decided_at: new Date().toISOString(), decided_by: by.id, decision_note: note || null, updated_by: by.id }).eq("id", countId).eq("status", "submitted").select("id");
  if (!claimed?.length) return { error: "Decided a moment ago by someone else." };
  let applied = 0;
  let archived = 0;
  const problems: string[] = [];
  for (const l of v.diff.lines) {
    const after = l.notFound ? 0 : Number(l.countedQty) || 0;
    if (Math.abs(after - l.systemQty) > 0.0005) {
      const r = await recordStockMovement(l.itemId, { kind: "count", quantity: after, note: v.label }, by);
      if (r.error) { problems.push(`${l.name}: ${r.error}`); continue; }
      applied++;
    }
    if (l.notFound) {
      const a = await archiveStockItem(l.itemId, `${v.label}: not found`, { ...by, role_id: "owner" });
      if (!a.error) archived++;
    }
  }
  return { ok: true, message: `${v.label} approved: ${applied} item${applied === 1 ? "" : "s"} corrected, ${archived} archived (not found), total change ${valueWords(v.diff.totalValue)}.${problems.length ? ` Not changed: ${problems.join("; ")}` : ""}` };
}

/** Items with a placeholder part number, or no minimum set (the clean-up lists). */
export function cleanupLists(items: StockItemRow[]): { noMinimum: number } {
  return { noMinimum: items.filter((i) => !(i.minimum_level > 0)).length };
}

/** The approved stock counts dated in a period (the month-end stock report). */
export async function countsBetween(from: string, to: string): Promise<{ id: string; label: string; counted: number; changed: number; notFound: number; value: number }[]> {
  if (!(await stockCountsReady())) return [];
  const { data } = await createAdminClient().from("stock_counts").select("id").eq("status", "approved").eq("is_active", true).gte("counted_on", from).lte("counted_on", to).order("counted_on");
  const out = [];
  for (const c of (data ?? []) as { id: string }[]) {
    const v = await loadCount(c.id);
    if (v) out.push({ id: v.id, label: v.label, counted: v.diff.counted, changed: v.diff.changed, notFound: v.diff.notFound, value: v.diff.totalValue });
  }
  return out;
}
