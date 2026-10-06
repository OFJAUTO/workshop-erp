"use server";

import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const NUMBER_KEYS = [
  "tablet_idle_lock_seconds",
  "pin_max_attempts",
  "pin_lock_minutes",
  "discount_limit_percent",
  "video_retention_months",
] as const;
const TEXT_KEYS = ["company_name", "company_trn", "terms_and_conditions"] as const;

const LIMITS: Record<(typeof NUMBER_KEYS)[number], [number, number]> = {
  tablet_idle_lock_seconds: [30, 3600],
  pin_max_attempts: [3, 10],
  pin_lock_minutes: [1, 60],
  discount_limit_percent: [0, 100],
  video_retention_months: [1, 120],
};

export async function saveSettings(_state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("manageSettings");
  const values = formValues(formData);
  const supabase = await createClient();

  for (const key of NUMBER_KEYS) {
    const raw = String(formData.get(key) ?? "").trim();
    const n = Number(raw);
    const [min, max] = LIMITS[key];
    if (!raw || !Number.isFinite(n) || n < min || n > max) {
      return { error: `${key.replaceAll("_", " ")} must be a number between ${min} and ${max}.`, values };
    }
    const { error } = await supabase.from("settings").update({ value: Math.round(n) }).eq("key", key);
    if (error) return { error: error.message, values };
  }
  for (const key of TEXT_KEYS) {
    const text = String(formData.get(key) ?? "").trim();
    if (key === "company_name" && text.length < 2) return { error: "Enter the company name.", values };
    if (key === "company_trn" && text && !/^\d{15}$/.test(text)) return { error: "The company TRN is 15 digits.", values };
    const { error } = await supabase.from("settings").update({ value: text }).eq("key", key);
    if (error) return { error: error.message, values };
  }

  revalidatePath("/", "layout");
  return { success: "Settings saved.", values };
}
