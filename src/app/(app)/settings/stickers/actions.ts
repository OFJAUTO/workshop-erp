"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

const back = (msg: string, ok: boolean) => redirect(`/settings/stickers?${ok ? "message" : "error"}=${encodeURIComponent(msg)}`);

/** The Stickers tab: sizes, wording, defaults, warranty and service intervals, which part types get a sticker, required switches. */
export async function saveStickerSettings(formData: FormData) {
  const staff = await requirePermission("manageSettings");
  const admin = createAdminClient();
  const num = (k: string, lo: number, hi: number, label: string) => {
    const n = Number(String(formData.get(k) ?? "").replace(",", "."));
    if (!Number.isFinite(n) || n < lo || n > hi) back(`${label} must be between ${lo} and ${hi}.`, false);
    return Math.round(n * 10) / 10;
  };
  const updates: { key: string; value: unknown }[] = [
    { key: "sticker_part_width_mm", value: num("sticker_part_width_mm", 10, 100, "Part sticker width") },
    { key: "sticker_part_height_mm", value: num("sticker_part_height_mm", 10, 100, "Part sticker height") },
    { key: "sticker_large_mm", value: num("sticker_large_mm", 30, 120, "Battery and service sticker size") },
    { key: "battery_warranty_months", value: Math.round(num("battery_warranty_months", 1, 120, "Battery warranty")) },
    { key: "service_interval_months", value: Math.round(num("service_interval_months", 1, 60, "Next service months")) },
    { key: "service_interval_km", value: Math.round(num("service_interval_km", 500, 100000, "Next service km")) },
    { key: "service_interval_miles", value: Math.round(num("service_interval_miles", 300, 60000, "Next service miles")) },
    { key: "sticker_battery_required", value: formData.get("sticker_battery_required") === "on" },
    { key: "sticker_service_required", value: formData.get("sticker_service_required") === "on" },
    { key: "sticker_service_show_phone", value: formData.get("sticker_service_show_phone") === "on" },
    { key: "part_labels_enabled", value: formData.get("part_labels_enabled") === "on" },
    { key: "sticker_part_types", value: String(formData.get("sticker_part_types") ?? "").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 30) },
  ];
  const byBrand: Record<string, number> = {};
  for (const line of String(formData.get("battery_warranty_by_brand") ?? "").split(/\r?\n/)) {
    const m = /^\s*(.+?)\s*[=:]\s*(\d{1,3})\s*$/.exec(line);
    if (m) byBrand[m[1]] = Number(m[2]);
  }
  updates.push({ key: "battery_warranty_by_brand", value: byBrand });
  updates.push({ key: "sticker_wording", value: { part: blankToNull(formData.get("w_part")) ?? "", battery: blankToNull(formData.get("w_battery")) ?? "Battery warranty", battery_valid: blankToNull(formData.get("w_battery_valid")) ?? "Valid for this vehicle only", service: blankToNull(formData.get("w_service")) ?? "Service", service_band: blankToNull(formData.get("w_service_band")) ?? "Next service, whichever comes first" } });
  for (const u of updates) await admin.from("settings").update({ value: u.value }).eq("key", u.key);
  await admin.from("audit_log").insert({ table_name: "settings", record_id: null, action: "update", new_data: { stickers: Object.fromEntries(updates.map((u) => [u.key, u.value])), by: staff.display_name } }).then(() => null, () => null);
  revalidatePath("/settings/stickers");
  back("Sticker settings saved. They apply to stickers printed from now on.", true);
}

/** The logo file for the stickers (SVG or PNG), kept in the files bucket; empty to go back to the standard logo. */
export async function uploadStickerLogo(formData: FormData) {
  await requirePermission("manageSettings");
  const admin = createAdminClient();
  const file = formData.get("logo");
  if (formData.get("reset") === "1") {
    await admin.from("settings").update({ value: "" }).eq("key", "sticker_logo_url");
    revalidatePath("/settings/stickers");
    back("Back to the standard logo.", true);
  }
  if (!(file instanceof File) || !file.size) back("Choose a logo file (SVG or PNG).", false);
  const f = file as File;
  const type = f.type || (f.name.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/png");
  if (!/^image\/(svg\+xml|png|jpeg)$/.test(type)) back("Use an SVG, PNG or JPG file.", false);
  if (f.size > 2_000_000) back("The logo file must be under 2 MB.", false);
  const ext = type === "image/svg+xml" ? "svg" : type === "image/png" ? "png" : "jpg";
  const path = `branding/sticker-logo-${Date.now()}.${ext}`;
  const { error } = await admin.storage.from("job-files").upload(path, Buffer.from(await f.arrayBuffer()), { contentType: type, upsert: true });
  if (error) back(error.message, false);
  await admin.from("settings").update({ value: path }).eq("key", "sticker_logo_url");
  revalidatePath("/settings/stickers");
  back("Logo saved for the stickers.", true);
}
