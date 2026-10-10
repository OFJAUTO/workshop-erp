"use server";

import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { cleanChecklist } from "@/lib/inspection";
import { STAGES } from "@/lib/jobs";
import { isTone } from "@/lib/tones";
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
  "next_invoice_number",
  "consumables_default_aed",
  "label_width_mm",
  "label_height_mm",
  "followup_days",
  "report_good_margin_percent",
  "parts_remind_minutes",
  "parts_escalate_minutes",
  "notification_remind_minutes",
  "markup_warn_percent",
  "markup_confirm_percent",
  "pin_needed_above_aed",
  "comeback_window_days",
] as const;
/** Settings that keep decimals (percentages like 1.9). */
const DECIMAL_KEYS = ["bank_charge_card_percent", "bank_charge_link_percent", "bank_charge_cash_percent", "bank_charge_cheque_percent"] as const;
const DECIMAL_LIMITS: Record<(typeof DECIMAL_KEYS)[number], [number, number, string]> = {
  bank_charge_card_percent: [0, 20, "Bank charge, card machine"],
  bank_charge_link_percent: [0, 20, "Bank charge, payment link"],
  bank_charge_cash_percent: [0, 20, "Bank charge, cash"],
  bank_charge_cheque_percent: [0, 20, "Bank charge, cheque"],
};
/** Settings kept as a list, one entry per line on the form. */
const LIST_KEYS = ["part_types", "labour_actions", "labour_positions", "big_job_tags", "fluid_grades", "quick_remarks", "known_words"] as const;
const LIMIT_KEYS = ["tread_max", "pads_max", "battery_max", "vent_min", "vent_max", "fluid_max", "tyre_years"] as const;

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
  "whatsapp_invoice_template",
  "whatsapp_estimate_template",
  "company_address",
  "company_phone",
  "company_email",
  "company_legal_name",
  "company_legal_name_ar",
  "company_address_1",
  "company_address_2",
  "company_address_3",
  "company_website",
  "bank_name",
  "bank_account_name",
  "bank_account_number",
  "bank_iban",
  "bank_swift",
  "document_currency",
  "labour_rate_bodyshop_aed",
  "whatsapp_ready_template",
  "whatsapp_followup_template",
  "dangerous_customer_text",
  "dangerous_customer_text_ar",
  "dangerous_acknowledgement_text",
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
  next_invoice_number: [1, 100000000, "Next invoice number"],
  consumables_default_aed: [0, 100000, "Consumables line"],
  label_width_mm: [20, 200, "Label width"],
  label_height_mm: [10, 200, "Label height"],
  followup_days: [1, 90, "Follow-up after gate-out"],
  report_good_margin_percent: [0, 100, "Good margin"],
  parts_remind_minutes: [1, 1440, "Remind Parts after"],
  parts_escalate_minutes: [1, 1440, "Escalate to the owner after"],
  notification_remind_minutes: [1, 60, "Reminder sound every"],
  markup_warn_percent: [5, 10000, "Markup warning from"],
  markup_confirm_percent: [5, 100000, "Markup confirmation from"],
  pin_needed_above_aed: [0, 1000000, "PIN needed for consumables above"],
  comeback_window_days: [1, 365, "Comeback window"],
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
    if (key.startsWith("whatsapp_") && !key.startsWith("whatsapp_reminder") && key !== "whatsapp_followup_template" && !text.includes("[link]")) return { error: "The WhatsApp message must contain [link].", values };
    if (key === "company_legal_name" && text.length < 2) return { error: "Enter the legal name.", values };
    if (key === "document_currency" && text !== "symbol" && text !== "aed") return { error: "Choose the currency shown on documents.", values };
    if (key === "labour_rate_bodyshop_aed" && text && !(Number(text) >= 0)) return { error: "The bodyshop labour rate must be a number, or empty.", values };
    if (key === "inspection_fee_notice" && text.length < 10) return { error: "Enter the English inspection fee notice.", values };
    if (key.startsWith("whatsapp_reminder") && text.length < 10) return { error: "Enter every WhatsApp reminder message.", values };
    if ((key === "dangerous_customer_text" || key === "dangerous_acknowledgement_text") && text.length < 10) return { error: "Enter the safety warning and the acknowledgement text.", values };
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

  const labourByMake = overrides(formData, "labour_make__");
  if (typeof labourByMake === "string") return { error: labourByMake, values };
  updates.push({ key: "labour_rate_by_make", value: labourByMake });

  const qcChecks = String(formData.get("qc_general_checks") ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 60);
  if (qcChecks.length === 0) return { error: "Enter at least one QC general check.", values };
  updates.push({ key: "qc_general_checks", value: qcChecks });

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

  for (const key of LIST_KEYS) {
    const list = Array.from(new Set(String(formData.get(key) ?? "").split(key === "known_words" ? /[\r\n,]+/ : /\r?\n/).map((l) => l.trim().slice(0, 60)).filter(Boolean))).slice(0, key === "known_words" ? 400 : 60);
    if (list.length === 0) return { error: `Enter at least one line for ${key.replaceAll("_", " ")}.`, values };
    updates.push({ key, value: list });
  }
  updates.push({ key: "prescan_gate_enabled", value: formData.get("prescan_gate_enabled") === "on" });
  updates.push({ key: "advisor_labour_discount", value: formData.get("advisor_labour_discount") === "on" });
  updates.push({ key: "customer_documents_uppercase", value: formData.get("customer_documents_uppercase") === "on" });
  // The quotation's hidden bank charge assumes the highest rate; the real one is taken at payment.
  updates.push({ key: "bank_charge_fee_percent", value: Math.max(...DECIMAL_KEYS.map((k) => Number(String(formData.get(k) ?? "0").replace(",", ".")) || 0)) });
  updates.push({ key: "wash_board_show_times", value: formData.get("wash_board_show_times") === "on" });
  updates.push({ key: "wash_board_done_button", value: formData.get("wash_board_done_button") === "on" });
  updates.push({ key: "test_mode_enabled", value: formData.get("test_mode_enabled") === "on" });
  for (const key of ["notification_tone", "notification_tone_owner"] as const) {
    const t = String(formData.get(key) ?? "");
    if (!isTone(t)) return { error: "Choose the notification sounds.", values };
    updates.push({ key, value: t });
  }
  if (Number(formData.get("markup_confirm_percent")) < Number(formData.get("markup_warn_percent"))) return { error: "The markup confirmation figure must be at or above the warning figure.", values };
  // The ready-made jobs list: "Category:" lines start a group, the lines under it are the jobs.
  const jobs: Record<string, string[]> = {};
  let group = "General";
  for (const raw of String(formData.get("labour_jobs") ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.endsWith(":")) {
      group = line.slice(0, -1).trim() || "General";
      if (!jobs[group]) jobs[group] = [];
      continue;
    }
    if (!jobs[group]) jobs[group] = [];
    if (!jobs[group].some((j) => j.toLowerCase() === line.toLowerCase())) jobs[group].push(line.slice(0, 120));
  }
  // Jobs built twice that the owner ticks join the permanent list; the rest stay as suggestions.
  const { data: candRow } = await supabase.from("settings").select("value").eq("key", "labour_job_candidates").maybeSingle();
  const candidates = { ...((candRow?.value as Record<string, number> | null) ?? {}) };
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("candidate__") || raw !== "on") continue;
    const title = key.slice("candidate__".length);
    if (!jobs["General"]) jobs["General"] = [];
    if (!Object.values(jobs).some((list) => list.some((j) => j.toLowerCase() === title.toLowerCase()))) jobs["General"].push(title.slice(0, 120));
    delete candidates[title];
  }
  for (const [key] of formData.entries()) if (key.startsWith("drop_candidate__")) delete candidates[key.slice("drop_candidate__".length)];
  if (!Object.keys(jobs).length) return { error: "Keep at least one job on the ready-made jobs list.", values };
  updates.push({ key: "labour_jobs", value: jobs });
  updates.push({ key: "labour_job_candidates", value: candidates });
  const limits: Record<string, number> = {};
  for (const k of LIMIT_KEYS) {
    const raw = String(formData.get(`limit__${k}`) ?? "").trim().replace(",", ".");
    const n = Number(raw);
    if (!raw || !Number.isFinite(n)) return { error: `The inspection limit ${k.replaceAll("_", " ")} must be a number.`, values };
    limits[k] = n;
  }
  if (limits.vent_max <= limits.vent_min) return { error: "The vent temperature maximum must be above the minimum.", values };
  updates.push({ key: "inspection_limits", value: limits });

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
