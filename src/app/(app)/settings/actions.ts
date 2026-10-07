"use server";

import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const NUMBER_KEYS = [
  "tablet_idle_lock_seconds",
  "pin_max_attempts",
  "pin_lock_minutes",
  "keep_signed_in_days_staff",
  "keep_signed_in_days_owner_accounts",
  "discount_limit_percent",
  "parts_min_markup_percent",
  "technician_cost_rate_aed",
  "daily_profit_target_aed",
  "profit_target_yellow_percent",
  "supplier_invoice_pending_red_days",
  "video_retention_months",
] as const;
const TEXT_KEYS = ["company_name", "company_trn", "terms_and_conditions"] as const;

const LIMITS: Record<(typeof NUMBER_KEYS)[number], [number, number, string]> = {
  tablet_idle_lock_seconds: [30, 3600, "Tablet idle lock"],
  pin_max_attempts: [3, 10, "Wrong PINs before lock"],
  pin_lock_minutes: [1, 60, "PIN lock time"],
  keep_signed_in_days_staff: [1, 90, "Keep me signed in, office staff"],
  keep_signed_in_days_owner_accounts: [1, 90, "Keep me signed in, owner and accounts"],
  discount_limit_percent: [0, 100, "Advisor discount limit"],
  parts_min_markup_percent: [0, 500, "Minimum parts markup"],
  technician_cost_rate_aed: [0, 10000, "Technician cost rate"],
  daily_profit_target_aed: [0, 10000000, "Daily profit target"],
  profit_target_yellow_percent: [0, 100, "Target yellow threshold"],
  supplier_invoice_pending_red_days: [1, 365, "Supplier invoice red days"],
  video_retention_months: [1, 120, "Video retention"],
};

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function overrides(formData: FormData, prefix: string): Record<string, number> | string {
  const out: Record<string, number> = {};
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith(prefix) || typeof raw !== "string") continue;
    const name = key.slice(prefix.length);
    const text = raw.trim();
    if (!text) continue;
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) return `The value for ${name} must be a number.`;
    out[name] = n;
  }
  return out;
}

export async function saveSettings(_state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("manageSettings");
  const values = formValues(formData);
  const supabase = await createClient();

  const updates: { key: string; value: unknown }[] = [];

  for (const key of NUMBER_KEYS) {
    const raw = String(formData.get(key) ?? "").trim();
    const n = Number(raw);
    const [min, max, label] = LIMITS[key];
    if (!raw || !Number.isFinite(n) || n < min || n > max) {
      return { error: `${label} must be a number between ${min} and ${max}.`, values };
    }
    updates.push({ key, value: Math.round(n) });
  }
  for (const key of TEXT_KEYS) {
    const text = String(formData.get(key) ?? "").trim();
    if (key === "company_name" && text.length < 2) return { error: "Enter the company name.", values };
    if (key === "company_trn" && text && !/^\d{15}$/.test(text)) return { error: "The company TRN is 15 digits.", values };
    updates.push({ key, value: text });
  }

  const byMake = overrides(formData, "markup_make__");
  if (typeof byMake === "string") return { error: byMake, values };
  updates.push({ key: "parts_min_markup_by_make", value: byMake });

  const byDept = overrides(formData, "cost_dept__");
  if (typeof byDept === "string") return { error: byDept, values };
  updates.push({ key: "technician_cost_rate_by_department", value: byDept });

  const days = formData.getAll("working_days").map(String).filter((d) => DAYS.includes(d));
  if (days.length === 0) return { error: "Tick at least one working day.", values };
  updates.push({ key: "working_days", value: DAYS.filter((d) => days.includes(d)) });

  for (const u of updates) {
    const { error } = await supabase.from("settings").update({ value: u.value }).eq("key", u.key);
    if (error) return { error: error.message, values };
  }

  revalidatePath("/", "layout");
  return { success: "Settings saved.", values };
}
