"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { formValues, type FormState } from "@/lib/form-state";
import { ROAD_TEST_ITEMS } from "@/lib/road-test";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";

/** The road test's one-tap remarks: per item, rows of chips ("What", "Where", "When"), one chip per line. */
export async function saveRoadTestChips(_state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("manageSettings");
  const values = formValues(formData);
  const out: Record<string, { label: string; chips: string[] }[]> = {};
  for (const it of ROAD_TEST_ITEMS) {
    const rows: { label: string; chips: string[] }[] = [];
    for (let i = 0; i < 4; i++) {
      const label = String(formData.get(`label__${it.key}__${i}`) ?? "").trim().slice(0, 40);
      const chips = Array.from(new Set(String(formData.get(`chips__${it.key}__${i}`) ?? "").split(/\r?\n/).map((l) => l.trim().slice(0, 60)).filter(Boolean))).slice(0, 40);
      if (chips.length) rows.push({ label: label || ["What", "Where", "When", "Also"][i], chips });
    }
    if (rows.length) out[it.key] = rows;
  }
  const admin = createAdminClient();
  const { error } = await admin.from("settings").upsert({ key: "road_test_chips", value: out, label: "Road test one-tap remarks", description: "Per road test item: rows of chips (what, where, when) that write the remark." }, { onConflict: "key" });
  if (error) return { error: error.message, values };
  revalidatePath("/", "layout");
  return { success: "Road test remarks saved." };
}

/** A tyre brand typed on reports more than once joins the brand list. */
export async function adoptTyreBrand(name: string) {
  await requirePermission("manageSettings");
  const admin = createAdminClient();
  const settings = await getSettings();
  const brands = ((settings.tyre_brands ?? []) as string[]).filter((b) => b.toLowerCase() !== "other");
  const clean = name.trim().slice(0, 40);
  if (clean && !brands.some((b) => b.toLowerCase() === clean.toLowerCase())) brands.push(clean);
  await admin.from("settings").update({ value: [...brands, "Other"] }).eq("key", "tyre_brands");
  await dropBrand(clean);
  revalidatePath("/", "layout");
  redirect(`/settings/inspection?message=${encodeURIComponent(`"${clean}" added to the tyre brands.`)}`);
}

export async function dismissTyreBrand(name: string) {
  await requirePermission("manageSettings");
  await dropBrand(name.trim());
  revalidatePath("/settings/inspection");
  redirect(`/settings/inspection?message=${encodeURIComponent(`"${name.trim()}" dismissed.`)}`);
}

async function dropBrand(name: string) {
  const admin = createAdminClient();
  const settings = await getSettings();
  const custom = { ...((settings.tyre_brand_custom ?? {}) as Record<string, number>) };
  for (const k of Object.keys(custom)) if (k.toLowerCase() === name.toLowerCase()) delete custom[k];
  await admin.from("settings").update({ value: custom }).eq("key", "tyre_brand_custom");
}
