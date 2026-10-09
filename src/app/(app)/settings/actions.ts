"use server";

import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { cleanChecklist } from "@/lib/inspection";
import { STAGES } from "@/lib/jobs";
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
  "approval_reminder_hours",
  "inspection_fee_aed",
  "opening_hour",
  "closing_hour",
  "appointments_per_day",
  "appointment_reminder_hours_before",
  "appointment_evening_reminder_hour",
  "appointment_missed_after_minutes",
  "inspection_target_minutes",
  "inspection_unlock_hours",
  "assignment_target_minutes",
  "labour_rate_aed",
  "deposit_threshold_aed",
  "deposit_percent",
  "quote_validity_days",
  "quote_owner_approval_above_aed",
  "parts_pricing_target_hours",
  "quote_send_target_hours",
  "estimate_followup_days",
] as const;
/** Settings that keep decimals (percentages like 1.9). */
const DECIMAL_KEYS = ["bank_charge_card_percent", "bank_charge_link_percent"] as const;
const DECIMAL_LIMITS: Record<(typeof DECIMAL_KEYS)[number], [number, number, string]> = {
  bank_charge_card_percent: [0, 20, "Bank charge, card machine"],
  bank_charge_link_percent: [0, 20, "Bank charge, payment link"],
};

const TEXT_KEYS = [
  "company_name",
  "company_trn",
  "terms_and_conditions",
  "terms_and_conditions_ar",
  "declaration_text",
  "declaration_text_ar",
  "whatsapp_approval_template",
  "inspection_fee_notice",
  "inspection_fee_notice_ar",
  "whatsapp_reminder_template",
  "whatsapp_reminder_car_drop",
  "whatsapp_reminder_we_collect",
  "whatsapp_reminder_customer_collects",
  "whatsapp_report_template",
  "whatsapp_quote_template",
  "whatsapp_estimate_template",
  "company_address",
  "company_phone",
  "company_email",
] as const;

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
  approval_reminder_hours: [1, 168, "Approval link reminder"],
  inspection_fee_aed: [0, 1000000, "Inspection fee"],
  opening_hour: [0, 23, "Opening hour"],
  closing_hour: [1, 24, "Closing hour"],
  appointments_per_day: [1, 100, "Appointments per day"],
  appointment_reminder_hours_before: [1, 72, "Booking reminder hours before"],
  appointment_evening_reminder_hour: [0, 23, "Evening reminder hour"],
  appointment_missed_after_minutes: [5, 1440, "Booking counts as missed after"],
  inspection_target_minutes: [10, 1440, "Inspection target"],
  inspection_unlock_hours: [1, 72, "Approved report opens for"],
  assignment_target_minutes: [5, 1440, "Assignment target"],
  labour_rate_aed: [0, 100000, "Labour rate"],
  deposit_threshold_aed: [0, 10000000, "Deposit threshold"],
  deposit_percent: [0, 100, "Deposit percent"],
  quote_validity_days: [1, 365, "Quotation validity"],
  quote_owner_approval_above_aed: [0, 100000000, "Owner approval above"],
  parts_pricing_target_hours: [1, 1000, "Parts pricing target"],
  quote_send_target_hours: [1, 1000, "Quote sent after pricing"],
  estimate_followup_days: [1, 90, "Estimate follow-up"],
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
  for (const key of DECIMAL_KEYS) {
    const raw = String(formData.get(key) ?? "").trim().replace(",", ".");
    const n = Number(raw);
    const [min, max, label] = DECIMAL_LIMITS[key];
    if (!raw || !Number.isFinite(n) || n < min || n > max) return { error: `${label} must be a number between ${min} and ${max}.`, values };
    updates.push({ key, value: Math.round(n * 100) / 100 });
  }
  for (const key of TEXT_KEYS) {
    const text = String(formData.get(key) ?? "").trim();
    if (key === "company_name" && text.length < 2) return { error: "Enter the company name.", values };
    if (key === "company_trn" && text && !/^\d{15}$/.test(text)) return { error: "The company TRN is 15 digits.", values };
    if (key === "declaration_text" && text.length < 10) return { error: "Enter the English declaration text.", values };
    if (key.startsWith("whatsapp_") && !key.startsWith("whatsapp_reminder") && !text.includes("[link]")) return { error: "The WhatsApp message must contain [link].", values };
    if (key === "inspection_fee_notice" && text.length < 10) return { error: "Enter the English inspection fee notice.", values };
    if (key.startsWith("whatsapp_reminder") && text.length < 10) return { error: "Enter every WhatsApp reminder message.", values };
    updates.push({ key, value: text });
  }

  if (Number(formData.get("closing_hour")) <= Number(formData.get("opening_hour"))) return { error: "The closing hour must be after the opening hour.", values };

  const byMake = overrides(formData, "markup_make__");
  if (typeof byMake === "string") return { error: byMake, values };
  updates.push({ key: "parts_min_markup_by_make", value: byMake });

  const byDept = overrides(formData, "cost_dept__");
  if (typeof byDept === "string") return { error: byDept, values };
  updates.push({ key: "technician_cost_rate_by_department", value: byDept });

  const labourByDept = overrides(formData, "labour_dept__");
  if (typeof labourByDept === "string") return { error: labourByDept, values };
  updates.push({ key: "labour_rate_by_department", value: labourByDept });

  const stageHours: Record<string, number> = {};
  for (const s of STAGES) {
    const raw = String(formData.get(`stage__${s}`) ?? "").trim();
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n < 0 || n > 10000) return { error: `Target hours for ${s} must be a number.`, values };
    stageHours[s] = n;
  }
  updates.push({ key: "stage_target_hours", value: stageHours });

  const branchLines = String(formData.get("branches") ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, ...rest] = l.split("|");
      return { name: name.trim(), address: rest.join("|").trim() };
    })
    .filter((b) => b.name);
  if (branchLines.length === 0) return { error: "Enter at least one branch, as Name | Address.", values };
  updates.push({ key: "branches", value: branchLines });

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

/* ---------------------------------------------------------------------------
   Makes and models review (owner and workshop manager)
   --------------------------------------------------------------------------- */

export async function reviewCatalogEntry(kind: "make" | "model", id: string, formData: FormData) {
  const staff = await requirePermission("viewTablets"); // owner or workshop manager
  void staff;
  const decision = String(formData.get("decision") ?? "");
  const newName = String(formData.get("name") ?? "").trim();
  const table = kind === "make" ? "vehicle_makes" : "vehicle_models";
  const supabase = await createClient();
  if (decision === "approve") {
    await supabase.from(table).update({ needs_review: false, ...(newName ? { name: newName } : {}) }).eq("id", id);
  } else if (decision === "deactivate") {
    await supabase.from(table).update({ needs_review: false, is_active: false }).eq("id", id);
  }
  revalidatePath("/settings/catalog");
}

/** The inspection checklist editor (owner). Saved as one setting; reports keep the version they started with. */
export async function saveInspectionChecklist(_state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("manageSettings");
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(formData.get("checklist") ?? "[]"));
  } catch {
    return { error: "The checklist could not be read." };
  }
  const clean = cleanChecklist(parsed);
  if (typeof clean === "string") return { error: clean };
  const supabase = await createClient();
  const { error } = await supabase
    .from("settings")
    .upsert({ key: "inspection_checklist", value: clean, label: "Inspection checklist", description: "Sections and items of the mechanical inspection report." }, { onConflict: "key" });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { success: "Checklist saved." };
}
