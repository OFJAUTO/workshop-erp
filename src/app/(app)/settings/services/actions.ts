"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { parseHours } from "@/lib/quotes";
import { createAdminClient } from "@/lib/supabase/admin";

type Table = "service_categories" | "services";
const DEPARTMENTS = ["mechanical", "bodyshop", "both"];

function back(message: string | null, error?: string | null): never {
  revalidatePath("/settings/services");
  redirect(`/settings/services?${error ? `error=${encodeURIComponent(error)}` : `message=${encodeURIComponent(message ?? "Saved.")}`}`);
}

/** Positions 1, 2, 3… in the current order, after an add, a move or a removal. */
async function renumber(table: Table, categoryId?: string) {
  const admin = createAdminClient();
  let query = admin.from(table).select("id, position").eq("is_active", true).order("position").order("name");
  if (categoryId) query = query.eq("category_id", categoryId);
  const { data } = await query;
  let i = 1;
  for (const r of data ?? []) {
    if (Number(r.position) !== i) await admin.from(table).update({ position: i }).eq("id", r.id);
    i++;
  }
}

/** Swaps a row with its neighbour above or below. */
async function swap(table: Table, id: string, dir: "up" | "down", categoryId?: string) {
  await renumber(table, categoryId);
  const admin = createAdminClient();
  let query = admin.from(table).select("id, position").eq("is_active", true).order("position");
  if (categoryId) query = query.eq("category_id", categoryId);
  const { data } = await query;
  const rows = data ?? [];
  const i = rows.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return;
  await admin.from(table).update({ position: rows[j].position }).eq("id", rows[i].id);
  await admin.from(table).update({ position: rows[i].position }).eq("id", rows[j].id);
}

/** The fields of a service from the form, or the reason they are not right. */
function serviceFields(formData: FormData): Record<string, unknown> | string {
  const name = blankToNull(formData.get("name"));
  if (!name) return "Type the service name.";
  const department = String(formData.get("department") ?? "both");
  if (!DEPARTMENTS.includes(department)) return "Choose the department.";
  // One box: by hours or a fixed price (older forms still send the two separate fields).
  const pricing = String(formData.get("pricing") ?? "");
  const single = blankToNull(formData.get("price_value"));
  const priceText = pricing ? (pricing === "fixed" ? single : null) : blankToNull(formData.get("price_aed"));
  const hoursTyped = pricing ? (pricing === "hours" ? single : null) : blankToNull(formData.get("default_hours"));
  const price = priceText === null ? null : Number(priceText.replace(",", "."));
  if (price !== null && (!Number.isFinite(price) || price < 0)) return "The fixed price must be a number.";
  const hours = hoursTyped === null ? null : parseHours(hoursTyped);
  if (price !== null && hours !== null) return "Give a fixed price or default hours, not both.";
  const parts = String(formData.get("parts_requests") ?? "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const perRaw = (blankToNull(formData.get("price_per_other")) ?? blankToNull(formData.get("price_per")) ?? "job").toLowerCase().slice(0, 30);
  const usual = Math.max(1, Math.round(Number(String(formData.get("usual_quantity") ?? "1").replace(",", ".")) || 1));
  const allowanceRaw = blankToNull(formData.get("time_allowance_hours"));
  const allowance = allowanceRaw === null ? null : parseHours(allowanceRaw);
  return { name: name.slice(0, 120), department, price_aed: price, default_hours: hours, price_per: price !== null ? perRaw || "job" : "job", usual_quantity: price !== null ? usual : 1, time_allowance_hours: price !== null ? allowance : null, includes_oil_change: formData.get("includes_oil_change") === "on", description: blankToNull(formData.get("description"))?.slice(0, 500) ?? null, parts_requests: parts };
}

export async function addCategory(formData: FormData) {
  const staff = await requirePermission("manageServices");
  const name = blankToNull(formData.get("name"));
  if (!name) back(null, "Type the category name.");
  const admin = createAdminClient();
  const { data: last } = await admin.from("service_categories").select("position").eq("is_active", true).order("position", { ascending: false }).limit(1).maybeSingle();
  const { error } = await admin.from("service_categories").insert({ name: name.slice(0, 80), position: (Number(last?.position) || 0) + 1, created_by: staff.id, updated_by: staff.id });
  back(`Category "${name}" added.`, error?.message);
}

export async function renameCategory(id: string, formData: FormData) {
  const staff = await requirePermission("manageServices");
  const name = blankToNull(formData.get("name"));
  if (!name) back(null, "Type the category name.");
  const { error } = await createAdminClient().from("service_categories").update({ name: name.slice(0, 80), updated_by: staff.id }).eq("id", id);
  back(`Renamed to "${name}".`, error?.message);
}

export async function moveCategory(id: string, dir: "up" | "down") {
  await requirePermission("manageServices");
  await swap("service_categories", id, dir);
  back("Moved.");
}

export async function removeCategory(id: string) {
  const staff = await requirePermission("manageServices");
  const admin = createAdminClient();
  const { count } = await admin.from("services").select("id", { count: "exact", head: true }).eq("category_id", id).eq("is_active", true);
  if (count) back(null, `Move or remove its ${count} service${count === 1 ? "" : "s"} first.`);
  const { error } = await admin.from("service_categories").update({ is_active: false, updated_by: staff.id }).eq("id", id);
  if (!error) await renumber("service_categories");
  back("Category removed.", error?.message);
}

export async function addService(categoryId: string, formData: FormData) {
  const staff = await requirePermission("manageServices");
  const fields = serviceFields(formData);
  if (typeof fields === "string") back(null, fields);
  const admin = createAdminClient();
  const { data: last } = await admin.from("services").select("position").eq("category_id", categoryId).eq("is_active", true).order("position", { ascending: false }).limit(1).maybeSingle();
  const { error } = await admin.from("services").insert({ ...fields, category_id: categoryId, position: (Number(last?.position) || 0) + 1, created_by: staff.id, updated_by: staff.id });
  back(`"${String(fields.name)}" added.`, error?.message);
}

export async function saveService(id: string, formData: FormData) {
  const staff = await requirePermission("manageServices");
  const fields = serviceFields(formData);
  if (typeof fields === "string") back(null, fields);
  const admin = createAdminClient();
  const { data: current } = await admin.from("services").select("category_id").eq("id", id).maybeSingle();
  const categoryId = String(formData.get("category_id") ?? current?.category_id ?? "");
  const patch: Record<string, unknown> = { ...fields, updated_by: staff.id };
  if (categoryId && categoryId !== current?.category_id) {
    const { data: last } = await admin.from("services").select("position").eq("category_id", categoryId).eq("is_active", true).order("position", { ascending: false }).limit(1).maybeSingle();
    Object.assign(patch, { category_id: categoryId, position: (Number(last?.position) || 0) + 1 });
  }
  const { error } = await admin.from("services").update(patch).eq("id", id);
  if (!error && current?.category_id && categoryId !== current.category_id) await renumber("services", current.category_id);
  back(`"${String(fields.name)}" saved.`, error?.message);
}

export async function moveService(id: string, dir: "up" | "down") {
  await requirePermission("manageServices");
  const { data } = await createAdminClient().from("services").select("category_id").eq("id", id).maybeSingle();
  if (data?.category_id) await swap("services", id, dir, data.category_id);
  back("Moved.");
}

export async function removeService(id: string) {
  const staff = await requirePermission("manageServices");
  const admin = createAdminClient();
  const { data, error } = await admin.from("services").update({ is_active: false, updated_by: staff.id }).eq("id", id).select("name, category_id").maybeSingle();
  if (data?.category_id) await renumber("services", data.category_id);
  back(`"${data?.name ?? "Service"}" removed.`, error?.message);
}
