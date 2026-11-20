"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAppError, SAVE_FAILED } from "@/lib/app-errors";
import { archiveCategory, archiveStockItem, mergeStockItems, saveCategory, saveCountLine, startCount, stockRedesignReady, submitCount } from "@/lib/stock-manage";
import { can, type RoleId } from "@/lib/roles";

/*
 * The stock page's own actions (20 November 2026, Section 5). Each one checks who may do it on the server: a person
 * who only VIEWS stock is refused here whatever the screen shows.
 */

export type StockAnswer = { error?: string; words?: string } | null;

async function actor() {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." as const };
  return { staff };
}
const done = (r: { error?: string; words?: string }): StockAnswer => {
  if (!r.error) revalidatePath("/parts/stock");
  return r;
};

export async function saveCategoryAction(_s: StockAnswer, f: FormData): Promise<StockAnswer> {
  const a = await actor();
  if ("error" in a) return { error: a.error };
  return done(await saveCategory({ id: String(f.get("id") ?? "") || null, name: String(f.get("name") ?? "") }, a.staff));
}

export async function archiveCategoryAction(id: string): Promise<StockAnswer> {
  const a = await actor();
  if ("error" in a) return { error: a.error };
  return done(await archiveCategory(id, a.staff));
}

export async function mergeItemsAction(keepId: string, _s: StockAnswer, f: FormData): Promise<StockAnswer> {
  const a = await actor();
  if ("error" in a) return { error: a.error };
  return done(await mergeStockItems(keepId, String(f.get("gone") ?? ""), String(f.get("reason") ?? ""), a.staff));
}

export async function archiveItemAction(id: string, _s: StockAnswer, f: FormData): Promise<StockAnswer> {
  const a = await actor();
  if ("error" in a) return { error: a.error };
  return done(await archiveStockItem(id, String(f.get("reason") ?? ""), a.staff));
}

export async function startCountAction(): Promise<{ error?: string; id?: string }> {
  const a = await actor();
  if ("error" in a) return { error: a.error };
  const r = await startCount(a.staff);
  if (!r.error) revalidatePath("/parts/stock");
  return r;
}

/** One line of the count, saved as it is typed (the count can be continued later). */
export async function saveCountLineAction(countId: string, itemId: string, counted: string, notFound: boolean): Promise<{ error?: string }> {
  const a = await actor();
  if ("error" in a) return { error: a.error };
  const t = counted.replace(/,/g, "").trim();
  const n = t === "" ? null : Number(t);
  if (n !== null && !Number.isFinite(n)) return { error: "Type a number." };
  return saveCountLine(countId, itemId, n, notFound, a.staff);
}

export async function submitCountAction(countId: string): Promise<StockAnswer> {
  const a = await actor();
  if ("error" in a) return { error: a.error };
  return done(await submitCount(countId, a.staff));
}

/** The item's photo (taken on the device; the page shrinks it before it is sent). */
export async function saveStockPhotoAction(id: string, _s: StockAnswer, f: FormData): Promise<StockAnswer> {
  const a = await actor();
  if ("error" in a) return { error: a.error };
  if (!can(a.staff.role_id as RoleId, "manageStock")) return { error: "Only the parts desk or the owner change a stock item." };
  if (!(await stockRedesignReady())) return { error: "Photos switch on once the database change is applied (WAITING FOR APPLY)." };
  const file = f.get("photo");
  if (!(file instanceof File) || !file.size) return { error: "Take or pick a photo first." };
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { error: "A photo must be JPG, PNG or WebP." };
  if (file.size > 6 * 1024 * 1024) return { error: "The photo is too big (6 MB at most)." };
  const admin = createAdminClient();
  const path = `stock-items/${id}/${Date.now()}.${file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"}`;
  const { error: up } = await admin.storage.from("job-files").upload(path, file, { contentType: file.type, upsert: false });
  if (up) {
    await logAppError("stock: photo upload", up, { staffId: a.staff.id });
    return { error: SAVE_FAILED };
  }
  const { error } = await admin.from("stock_items").update({ photo_path: path, updated_by: a.staff.id }).eq("id", id);
  if (error) return { error: SAVE_FAILED };
  return done({ words: "Photo saved." });
}

/** The personal "Can view stock" switch on a person's team record (the owner): view only, no costs, no actions. */
export async function setCanViewStockAction(staffId: string, on: boolean): Promise<{ error?: string; words?: string }> {
  const staff = await requireStaff();
  if (staff.role_id !== "owner" || staff.viewingAs) return { error: "Only the owner gives stock access." };
  const { error } = await createAdminClient().from("staff").update({ can_view_stock: on, updated_by: staff.id }).eq("id", staffId);
  if (error) return { error: /can_view_stock/i.test(error.message) ? "This switches on once the database change is applied (WAITING FOR APPLY)." : SAVE_FAILED };
  revalidatePath(`/team/${staffId}`);
  return { words: on ? "Can view stock: on (items, quantities and status; no costs, no actions)." : "Can view stock: off." };
}

/** "Start the count" from the stock page (a form): opens the count being entered. */
export async function startCountFromPage(): Promise<void> {
  const r = await startCountAction();
  const { redirect } = await import("next/navigation");
  redirect(r.error ? `/parts/stock?count=1&error=${encodeURIComponent(r.error)}` : `/parts/stock?count=${r.id}#count`);
}
