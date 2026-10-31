"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { finishRoll, openRoll, recordFilmUsage, recordTintUsage } from "@/lib/film";
import { blankToNull } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { bodyshopScopeOf, mayEnterProduct } from "@/lib/team-scope";
import { recordCeramicUsage } from "@/lib/film";
import { objectExists } from "@/lib/upload-targets/common";
import { JOB_FILES_BUCKET } from "@/lib/work-data";

const BODYSHOP_DEPTS = ["bodyshop", "paint", "ppf_tint", "detailing"];

/** Who may touch rolls and metres: the owner, the bodyshop manager and the PPF team's leader (film and tint are theirs). */
async function rollStaff(product: "ppf" | "tint" | "ceramic" = "ppf") {
  const staff = await requireStaff();
  void BODYSHOP_DEPTS;
  return mayEnterProduct(bodyshopScopeOf(staff), product) ? staff : null;
}

export async function openRollAction(formData: FormData) {
  const staff = await rollStaff();
  if (!staff) redirect(`/bodyshop/rolls?error=${encodeURIComponent("Only the owner, the bodyshop manager or the PPF team leader opens rolls.")}`);
  const kind = String(formData.get("kind") ?? "film") === "tint" ? "tint" : "film";
  const r = await openRoll({ kind, filmKey: blankToNull(formData.get("film_key")), name: String(formData.get("name") ?? "").trim() }, await getSettings(), staff!.id);
  revalidatePath("/bodyshop/rolls");
  redirect(`/bodyshop/rolls?${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? "Roll registered.")}`);
}

export async function finishRollAction(rollId: string) {
  const staff = await rollStaff();
  if (!staff) redirect(`/bodyshop/rolls?error=${encodeURIComponent("Not allowed.")}`);
  const r = await finishRoll(rollId, await getSettings(), { id: staff!.id, display_name: staff!.display_name });
  revalidatePath("/bodyshop/rolls");
  redirect(`/bodyshop/rolls?${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? r.message ?? "Done.")}`);
}

/**
 * The plotter photo's path handed over by the page: a file of this car in the job files (sent there straight from the
 * device as a "Film plotter" job file), and only once it really arrived. Anything else is no photo: it is optional.
 */
async function plotterPhotoOf(jobId: string, raw: FormDataEntryValue | null): Promise<string | null> {
  const path = typeof raw === "string" ? raw.trim() : "";
  const name = path.slice(jobId.length + 1);
  if (!jobId || !path.startsWith(`${jobId}/`) || !name || name.length > 80 || name.includes("/") || name.includes("..")) return null;
  return (await objectExists(JOB_FILES_BUCKET, path)) ? path : null;
}

/** The PPF leader's metres for one car, with the optional plotter photo. */
export async function filmUsageAction(jobId: string, formData: FormData) {
  const staff = await rollStaff();
  const back = `/bodyshop/${jobId}`;
  if (!staff) redirect(`${back}?error=${encodeURIComponent("Only the owner, the bodyshop manager or the PPF team leader enters metres.")}`);
  const rollId = String(formData.get("roll_id") ?? "");
  const metres = Number(String(formData.get("metres") ?? "").replace(",", "."));
  if (!rollId) redirect(`${back}?error=${encodeURIComponent("Pick the roll.")}`);
  // 31 October 2026: the page sends the photo straight to storage (a job file) and hands over its path; a tab opened
  // before that still sends the file itself.
  let photoPath: string | null = null;
  const sentPath = formData.get("photo_path");
  const photo = formData.get("photo");
  if (typeof sentPath === "string" && sentPath.trim()) {
    photoPath = await plotterPhotoOf(jobId, sentPath);
  } else if (photo instanceof File && photo.size > 0 && photo.size <= 15 * 1024 * 1024) {
    const admin = createAdminClient();
    photoPath = `film/${jobId}/${Date.now()}.jpg`;
    const { error } = await admin.storage.from("job-files").upload(photoPath, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type || "image/jpeg", upsert: true });
    if (error) photoPath = null;
  }
  const r = await recordFilmUsage(jobId, rollId, metres, photoPath, staff!.id);
  revalidatePath(back);
  redirect(`${back}?${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? `Saved: ${metres} m of film on this car.`)}`);
}

/** One tap: this car used this tint roll. */
export async function tintUsageAction(jobId: string, rollId: string) {
  const staff = await rollStaff("tint");
  const back = `/bodyshop/${jobId}`;
  if (!staff) redirect(`${back}?error=${encodeURIComponent("Not allowed.")}`);
  const r = await recordTintUsage(jobId, rollId, staff!.id);
  revalidatePath(back);
  redirect(`${back}?${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? "Noted: this car is on that tint roll.")}`);
}

/** The owner's costing numbers (film types, tint roll, waste, consumables, the bodyshop rate). */
export async function saveBodyshopCosting(formData: FormData) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner" || staff.viewingAs) redirect(`/settings/packages?error=${encodeURIComponent("Owner only.")}`);
  const admin = createAdminClient();
  const names = formData.getAll("film_name").map(String);
  const prices = formData.getAll("film_price").map(String);
  const lengths = formData.getAll("film_m").map(String);
  const types = names.map((name, i) => ({ key: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40), name: name.trim(), roll_price: Number(prices[i]) || 0, roll_m: Number(lengths[i]) || 0 })).filter((t) => t.name);
  const upsert = async (key: string, label: string, value: unknown) => admin.from("settings").upsert({ key, label, value, updated_by: staff.id }, { onConflict: "key" });
  await upsert("film_types", "Film types (roll price and length)", types);
  await upsert("tint_roll_price_aed", "Tint roll price (AED)", Number(formData.get("tint_roll_price")) || 0);
  await upsert("bodyshop_waste_percent", "Film waste allowance (%)", Number(formData.get("waste_percent")) || 10);
  await upsert("bodyshop_consumables_monthly_aed", "Bodyshop consumables per month (AED)", Number(formData.get("consumables")) || 0);
  await upsert("bodyshop_cost_rate_aed", "Bodyshop labour cost rate (AED/h)", String(formData.get("bodyshop_rate") ?? "").trim());
  await upsert("bodyshop_default_installer_hours", "Default installer hours for other bodyshop services", Number(formData.get("default_installer_hours")) || 8);
  // Section 7: the package cost estimate's own numbers.
  await upsert("package_installer_hours", "Full package installer hours", Number(formData.get("package_hours")) || 80);
  await upsert("tint_cars_per_roll", "Tint: cars per roll", Number(formData.get("tint_cars")) || 10);
  await upsert("ceramic_bottle_price_aed", "Ceramic bottle price (AED)", Number(formData.get("ceramic_bottle")) || 300);
  await upsert("ceramic_cars_exterior_per_bottle", "Ceramic: cars per bottle (exterior)", Number(formData.get("ceramic_cars_ext")) || 4);
  await upsert("ceramic_cars_interior_per_bottle", "Ceramic: cars per bottle (interior)", Number(formData.get("ceramic_cars_int")) || 5.5);
  await upsert("big_car_film_rolls", "Big cars: film rolls", Number(formData.get("big_rolls")) || 1.5);
  await upsert("ppf_handcut_surcharge_aed", "PPF: hand-cut surcharge (AED, 0 = none)", Math.max(0, Number(formData.get("handcut_surcharge")) || 0));
  await upsert("big_car_models", "Big cars (1.5 film rolls)", String(formData.get("big_models") ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 60));
  revalidatePath("/settings/packages");
  redirect(`/settings/packages?message=${encodeURIComponent("Costing saved.")}`);
}

/** The detailing leader's ceramic on one car: exterior or interior, the product and its batch; the bottle share is costed. */
export async function ceramicUsageAction(jobId: string, formData: FormData) {
  const staff = await rollStaff("ceramic");
  const back = `/bodyshop/${jobId}`;
  if (!staff) redirect(`${back}?error=${encodeURIComponent("The detailing leader (or the bodyshop manager) enters the ceramic.")}#materials`);
  const kind = String(formData.get("kind") ?? "") === "interior" ? "interior" : "exterior";
  const r = await recordCeramicUsage(jobId, { kind, product: blankToNull(formData.get("product")), batch: blankToNull(formData.get("batch")) }, await getSettings(), staff!.id);
  revalidatePath(back);
  redirect(`${back}?${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? `Saved: ${kind} ceramic on this car.`)}#materials`);
}
