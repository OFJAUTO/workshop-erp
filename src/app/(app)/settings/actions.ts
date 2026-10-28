"use server";

import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { cleanChecklist } from "@/lib/inspection";
import { STAGES } from "@/lib/jobs";
import { isTone } from "@/lib/tones";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { getSettings } from "@/lib/settings";
import { DOC_KEYS, DOC_LABELS } from "@/lib/doc-reminder-defs";
import { REASON_CONTEXTS } from "@/lib/reasons";
import { LINE_TEXT_MAX, tooLongWords } from "@/lib/text-limits";

const NUMBER_KEYS = [
  "ppf_warranty_years",
  "bodyshop_final_check_days",
  "tablet_idle_lock_seconds",
  "pin_max_attempts",
  "pin_lock_minutes",
  "keep_signed_in_days_staff",
  "keep_signed_in_days_owner_accounts",
  "discount_limit_percent",
  "parts_min_markup_percent",
  "technician_cost_rate_aed",
  "daily_profit_target_aed",
  "quote_margin_yellow_percent",
  "quote_margin_red_percent",
  "advisor_bonus_percent",
  "monthly_fixed_costs_aed",
  "profit_target_yellow_percent",
  "supplier_invoice_pending_red_days",
  "video_retention_months",
  "approval_reminder_hours",
  "inspection_fee_aed",
  "premium_brand_fee_aed",
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
  "order_now_amber_minutes",
  "order_now_red_minutes",
  "quote_send_target_hours",
  "estimate_followup_days",
  "next_invoice_number",
  "consumables_default_aed",
  "label_width_mm",
  "label_height_mm",
  "followup_days",
  "payment_waiting_hours",
  "report_good_margin_percent",
  "parts_remind_minutes",
  "parts_escalate_minutes",
  "notification_remind_minutes",
  "markup_warn_percent",
  "markup_confirm_percent",
  "pin_needed_above_aed",
  "comeback_window_days",
  "supplier_discount_approval_above_percent",
] as const;
/** Settings that keep decimals (percentages like 1.9). */
const DECIMAL_KEYS = ["bank_charge_card_percent", "bank_charge_link_percent", "bank_charge_cash_percent", "bank_charge_cheque_percent", "bank_charge_transfer_percent"] as const;
const DECIMAL_LIMITS: Record<(typeof DECIMAL_KEYS)[number], [number, number, string]> = {
  bank_charge_card_percent: [0, 20, "Bank charge, card machine"],
  bank_charge_link_percent: [0, 20, "Bank charge, payment link"],
  bank_charge_cash_percent: [0, 20, "Bank charge, cash"],
  bank_charge_cheque_percent: [0, 20, "Bank charge, cheque"],
  bank_charge_transfer_percent: [0, 20, "Bank charge, bank transfer"],
};
/** Settings kept as a list, one entry per line on the form. */
const LIST_KEYS = ["part_types", "labour_actions", "labour_positions", "big_job_tags", "fluid_grades", "quick_remarks", "known_words", "tyre_brands", "damage_note_chips", "premium_brands"] as const;
const LIMIT_KEYS = ["tread_max", "pads_max", "battery_max", "vent_min", "vent_max", "fluid_max", "tyre_years", "pads_bad_max", "pads_good_min"] as const;

const TEXT_KEYS = [
  "ppf_brand_name",
  "ppf_warranty_text",
  "ppf_care_text",
  "ppf_removal_note",
  "whatsapp_bodyshop_arrived_template",
  "whatsapp_bodyshop_film_template",
  "whatsapp_bodyshop_ready_template",
  "whatsapp_final_check_template",
  "company_name",
  "company_trn",
  "terms_and_conditions",
  "terms_and_conditions_ar",
  "declaration_text",
  "declaration_text_ar",
  "whatsapp_approval_template",
  "inspection_fee_notice",
  "inspection_fee_notice_ar",
  "receipt_footer_note",
  "whatsapp_reminder_template",
  "whatsapp_reminder_car_drop",
  "whatsapp_reminder_we_collect",
  "whatsapp_reminder_customer_collects",
  "whatsapp_report_template",
  "whatsapp_quote_template",
  "whatsapp_quote_revised_template",
  "whatsapp_invoice_template",
  "whatsapp_deposit_request_template",
  "whatsapp_deposit_receipt_template",
  "supplier_lpo_from_email",
  "supplier_lpo_email_text",
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
  "whatsapp_on_the_way_template",
  "whatsapp_followup_template",
  "dangerous_customer_text",
  "dangerous_customer_text_ar",
  "dangerous_acknowledgement_text",
] as const;

const LIMITS: Record<(typeof NUMBER_KEYS)[number], [number, number, string]> = {
  tablet_idle_lock_seconds: [30, 3600, "Tablet idle lock"],
  ppf_warranty_years: [1, 30, "PPF warranty years"],
  bodyshop_final_check_days: [1, 60, "Final check days after handover"],
  pin_max_attempts: [3, 10, "Wrong PINs before lock"],
  pin_lock_minutes: [1, 60, "PIN lock time"],
  keep_signed_in_days_staff: [1, 90, "Keep me signed in, office staff"],
  keep_signed_in_days_owner_accounts: [1, 90, "Keep me signed in, owner and accounts"],
  discount_limit_percent: [0, 100, "Advisor discount limit"],
  parts_min_markup_percent: [0, 500, "Minimum parts markup"],
  technician_cost_rate_aed: [0, 10000, "Technician cost rate"],
  daily_profit_target_aed: [0, 10000000, "Daily profit target"],
  quote_margin_yellow_percent: [0, 100, "Quote margin yellow threshold"],
  quote_margin_red_percent: [0, 100, "Quote margin red threshold"],
  advisor_bonus_percent: [0, 100, "Advisor bonus rate"],
  monthly_fixed_costs_aed: [0, 100000000, "Monthly fixed costs"],
  profit_target_yellow_percent: [0, 100, "Target yellow threshold"],
  supplier_invoice_pending_red_days: [1, 365, "Supplier invoice red days"],
  video_retention_months: [1, 120, "Video retention"],
  approval_reminder_hours: [1, 168, "Approval link reminder"],
  inspection_fee_aed: [0, 1000000, "Inspection fee"],
  premium_brand_fee_aed: [0, 1000000, "Premium brand inspection fee"],
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
  order_now_amber_minutes: [5, 2000, "Order-now amber minutes"],
  order_now_red_minutes: [5, 4000, "Order-now red minutes"],
  quote_send_target_hours: [1, 1000, "Quote sent after pricing"],
  estimate_followup_days: [1, 90, "Estimate follow-up"],
  next_invoice_number: [1, 100000000, "Next invoice number"],
  consumables_default_aed: [0, 100000, "Consumables line"],
  label_width_mm: [20, 200, "Label width"],
  label_height_mm: [10, 200, "Label height"],
  followup_days: [1, 90, "Follow-up after gate-out"],
  payment_waiting_hours: [1, 720, "Payment waiting limit (hours)"],
  report_good_margin_percent: [0, 100, "Good margin"],
  parts_remind_minutes: [1, 1440, "Remind Parts after"],
  parts_escalate_minutes: [1, 1440, "Escalate to the owner after"],
  notification_remind_minutes: [1, 60, "Reminder sound every"],
  markup_warn_percent: [5, 10000, "Markup warning from"],
  markup_confirm_percent: [5, 100000, "Markup confirmation from"],
  pin_needed_above_aed: [0, 1000000, "PIN needed for consumables above"],
  comeback_window_days: [1, 365, "Comeback window"],
  supplier_discount_approval_above_percent: [0, 100, "Supplier discount needing owner approval above"],
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
    if (key.startsWith("whatsapp_") && !key.startsWith("whatsapp_reminder") && key !== "whatsapp_followup_template" && key !== "whatsapp_final_check_template" && key !== "whatsapp_on_the_way_template" && !text.includes("[link]")) return { error: "The WhatsApp message must contain [link].", values };
    if (key === "company_legal_name" && text.length < 2) return { error: "Enter the legal name.", values };
    if (key === "document_currency" && text !== "symbol" && text !== "aed") return { error: "Choose the currency shown on documents.", values };
    if (key === "labour_rate_bodyshop_aed" && text && !(Number(text) >= 0)) return { error: "The bodyshop labour rate must be a number, or empty.", values };
    if (key === "inspection_fee_notice" && text.length < 10) return { error: "Enter the English inspection fee notice.", values };
    if (key.startsWith("whatsapp_reminder") && text.length < 10) return { error: "Enter every WhatsApp reminder message.", values };
    if ((key === "dangerous_customer_text" || key === "dangerous_acknowledgement_text") && text.length < 10) return { error: "Enter the safety warning and the acknowledgement text.", values };
    updates.push({ key, value: text });
  }

  if (Number(formData.get("closing_hour")) <= Number(formData.get("opening_hour"))) return { error: "The closing hour must be after the opening hour.", values };

  // Breaks per day and department: "12:30-13:30", or empty for no break that day. A box missing from the
  // post altogether keeps the stored value, so a partial submit can never wipe the grid.
  {
    const { data: storedRow } = await supabase.from("settings").select("value").eq("key", "break_times").maybeSingle();
    const stored = (storedRow?.value ?? {}) as Record<string, Record<string, string>>;
    const grid: Record<string, Record<string, string>> = { mechanical: {}, bodyshop: {} };
    for (const side of ["mechanical", "bodyshop"] as const) {
      for (const day of ["sat", "sun", "mon", "tue", "wed", "thu", "fri"]) {
        const posted = formData.get(`break__${side}__${day}`);
        if (posted === null) { grid[side][day] = stored[side]?.[day] ?? ""; continue; }
        const raw = String(posted ?? "").trim();
        if (raw) {
          const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(raw);
          const ok = m && Number(m[1]) < 24 && Number(m[2]) < 60 && Number(m[3]) < 24 && Number(m[4]) < 60 && Number(m[1]) * 60 + Number(m[2]) < Number(m[3]) * 60 + Number(m[4]);
          if (!ok || !m) return { error: `The ${side} break on ${day.charAt(0).toUpperCase() + day.slice(1)} must look like 12:30-13:30 (start before end), or be empty for no break.`, values };
          grid[side][day] = `${m[1].padStart(2, "0")}:${m[2]}-${m[3].padStart(2, "0")}:${m[4]}`;
        } else grid[side][day] = "";
      }
    }
    updates.push({ key: "break_times", value: grid });
  }

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
  // The workshop dictionary may be empty: comma or line separated, up to 1,000 words.
  updates.push({ key: "spell_words", value: Array.from(new Set(String(formData.get("spell_words") ?? "").split(/[\r\n,]+/).map((l) => l.trim().slice(0, 40)).filter(Boolean))).slice(0, 1000) });
  // Recovery companies may be an empty list: the ones typed at gate-out are added on their own.
  updates.push({ key: "recovery_companies", value: Array.from(new Set(String(formData.get("recovery_companies") ?? "").split(/\r?\n/).map((l) => l.trim().slice(0, 60)).filter(Boolean))).slice(0, 60) });
  updates.push({ key: "payment_gateway_domains", value: Array.from(new Set(String(formData.get("payment_gateway_domains") ?? "").split(/[\s,;]+/).map((l) => l.trim().toLowerCase().slice(0, 80)).filter(Boolean))).slice(0, 20) });
  updates.push({ key: "workshop_hours_text", value: String(formData.get("workshop_hours_text") ?? "").trim().slice(0, 120) || "Monday to Saturday, 8:00–17:00" });
  // Tyre models, one line per brand: "Pirelli: P Zero, Cinturato".
  {
    const models: Record<string, string[]> = {};
    for (const line of String(formData.get("tyre_models") ?? "").split(/\r?\n/)) {
      const [brand, rest] = line.split(":");
      const b = (brand ?? "").trim().slice(0, 40);
      if (!b || rest === undefined) continue;
      models[b] = Array.from(new Set(rest.split(",").map((m) => m.trim().slice(0, 60)).filter(Boolean))).slice(0, 60);
    }
    updates.push({ key: "tyre_models", value: models });
  }
  updates.push({ key: "deposit_document", value: formData.get("deposit_document") === "tax_invoice" ? "tax_invoice" : "receipt" });
  updates.push({ key: "prescan_gate_enabled", value: formData.get("prescan_gate_enabled") === "on" });
  updates.push({ key: "advisor_labour_discount", value: formData.get("advisor_labour_discount") === "on" });
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

  // Documents not sent: two limits per document, in working minutes (the customer's second one may be "next working day").
  const docLimits: Record<string, { amber: number; red: number | string }> = {};
  for (const k of DOC_KEYS) {
    const amber = Number(String(formData.get(`doc__${k}_amber`) ?? "").trim());
    const redRaw = String(formData.get(`doc__${k}_red`) ?? "").trim();
    const red = redRaw === "next_working_day" ? "next_working_day" : Number(redRaw);
    if (!Number.isFinite(amber) || amber <= 0 || (red !== "next_working_day" && (!Number.isFinite(red) || red <= amber))) return { error: `"${DOC_LABELS[k]}": the amber limit must be above 0 and the red limit above the amber one.`, values };
    docLimits[k] = { amber: Math.round(amber), red: red === "next_working_day" ? red : Math.round(red) };
  }
  updates.push({ key: "doc_reminder_limits", value: docLimits });
  // One-tap reasons, one list per place; an empty box keeps the built-in list.
  const reasons: Record<string, string[]> = {};
  for (const c of REASON_CONTEXTS) {
    const list = Array.from(new Set(String(formData.get(`reason__${c.key}`) ?? "").split(/\r?\n/).map((l) => l.trim().slice(0, 120)).filter(Boolean))).slice(0, 40);
    if (list.length) reasons[c.key] = list;
  }
  updates.push({ key: "reason_presets", value: reasons });

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
  // The customer-complaint words per section, typed comma separated in the editor.
  let complaints: Record<string, string[]> = {};
  try {
    const raw = JSON.parse(String(formData.get("complaint_keywords") ?? "{}")) as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw ?? {})) {
      if (!Array.isArray(v)) continue;
      const words = Array.from(new Set(v.map((w) => String(w).trim().toLowerCase().slice(0, 40)).filter(Boolean))).slice(0, 40);
      if (words.length) complaints[String(k).slice(0, 80)] = words;
    }
  } catch {
    complaints = {};
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("settings")
    .upsert({ key: "inspection_checklist", value: clean, label: "Inspection checklist", description: "Sections and items of the mechanical inspection report." }, { onConflict: "key" });
  if (error) return { error: error.message };
  const { error: e2 } = await supabase
    .from("settings")
    .upsert({ key: "complaint_keywords", value: complaints, label: "Complaint keywords", description: 'Words in a customer request that tag a checklist section with "Customer complaint".' }, { onConflict: "key" });
  if (e2) return { error: e2.message };
  revalidatePath("/", "layout");
  return { success: "Checklist saved." };
}

/** The workshop manager's one-tap notes for the report approval, one per line. */
export async function saveManagerNotePresets(_state: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("manageSettings");
  const values = formValues(formData);
  const groups: Record<string, string[]> = {};
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("group__") || typeof v !== "string") continue;
    const list = Array.from(new Set(v.split(/\r?\n/).map((l) => l.trim().slice(0, 200)).filter(Boolean))).slice(0, 40);
    if (list.length) groups[k.slice(7).slice(0, 60)] = list;
  }
  const lines = Array.from(new Set(Object.values(groups).flat()));
  if (!lines.length) return { error: "Write at least one note.", values };
  const supabase = await createClient();
  const { error } = await supabase
    .from("settings")
    .upsert({ key: "manager_note_presets", value: lines, label: "Manager note presets", description: "One-tap notes on the report approval. Most used come first." }, { onConflict: "key" });
  if (error) return { error: error.message, values };
  const { error: e2 } = await supabase
    .from("settings")
    .upsert({ key: "manager_note_groups", value: groups, label: "Manager note groups", description: "The one-tap notes on the report approval, under four small headings." }, { onConflict: "key" });
  if (e2) return { error: e2.message, values };
  revalidatePath("/", "layout");
  return { success: `${lines.length} note${lines.length === 1 ? "" : "s"} saved.` };
}

/* ---------------------------------------------------------------------------
   Settings > Parts list: the pool the technicians pick from.
   --------------------------------------------------------------------------- */

type CatalogueEdit = { id?: string | null; category?: unknown; name?: unknown; needs_position?: unknown; paired?: unknown; goes_with?: unknown; position?: unknown; remove?: unknown };
const goesWithList = (raw: unknown) => Array.from(new Set(String(raw ?? "").split(/[,\n]/).map((s) => s.trim().slice(0, 120)).filter(Boolean))).slice(0, 10);

/** The whole pool in one save: renamed, reordered, added, removed (made inactive). */
export async function savePartCatalogue(_state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("manageSettings");
  let rows: CatalogueEdit[];
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]")) as CatalogueEdit[];
  } catch {
    return { error: "The list could not be read." };
  }
  if (!Array.isArray(rows)) return { error: "The list could not be read." };
  const admin = createAdminClient();
  const seen = new Set<string>();
  let added = 0;
  for (const r of rows) {
    const name = String(r.name ?? "").trim();
    if (name.length > LINE_TEXT_MAX) return { error: `${name.slice(0, 40)}…: ${tooLongWords(name.length)}` };
    const category = String(r.category ?? "").trim().slice(0, 80) || "Other";
    const position = Number(r.position) || 0;
    if (r.id && r.remove) {
      await admin.from("part_catalogue").update({ is_active: false, updated_by: staff.id }).eq("id", String(r.id));
      continue;
    }
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) return { error: `"${name}" is in the list twice.` };
    seen.add(key);
    if (r.id) {
      const { error } = await admin.from("part_catalogue").update({ name, category, needs_position: !!r.needs_position, paired: !!r.paired, goes_with: goesWithList(r.goes_with), position, updated_by: staff.id }).eq("id", String(r.id));
      if (error) return { error: error.message };
    } else {
      const { error } = await admin.from("part_catalogue").insert({ name, category, needs_position: !!r.needs_position, paired: !!r.paired, goes_with: goesWithList(r.goes_with), position, created_by: staff.id, updated_by: staff.id });
      if (error) return { error: /unique|duplicate/i.test(error.message) ? `"${name}" is already in the list.` : error.message };
      added++;
    }
  }
  revalidatePath("/", "layout");
  return { success: added ? `Saved. ${added} new part${added === 1 ? "" : "s"}.` : "Saved." };
}

/** A custom part typed on reports joins the pool in the chosen category. */
export async function adoptCustomPart(name: string, formData: FormData) {
  const staff = await requirePermission("manageSettings");
  const admin = createAdminClient();
  const category = String(formData.get("category") ?? "Other").trim().slice(0, 80) || "Other";
  const { data: last } = await admin.from("part_catalogue").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
  if (name.trim().length > LINE_TEXT_MAX) redirect(`/settings/parts?error=${encodeURIComponent(tooLongWords(name.trim().length))}`);
  const { error } = await admin.from("part_catalogue").insert({ name: name.trim(), category, needs_position: formData.get("needs_position") === "on", position: (Number(last?.position) || 0) + 1, created_by: staff.id, updated_by: staff.id });
  if (error && !/unique|duplicate/i.test(error.message)) redirect(`/settings/parts?error=${encodeURIComponent(error.message)}`);
  await dropCustom(name);
  revalidatePath("/", "layout");
  redirect(`/settings/parts?message=${encodeURIComponent(`"${name}" added to the parts list.`)}`);
}

/** A custom part suggestion the owner does not want. */
export async function dismissCustomPart(name: string) {
  await requirePermission("manageSettings");
  await dropCustom(name);
  revalidatePath("/settings/parts");
  redirect("/settings/parts");
}

async function dropCustom(name: string) {
  const settings = await getSettings();
  const pool = { ...((settings.part_pool_custom ?? {}) as Record<string, number>) };
  delete pool[name];
  await createAdminClient().from("settings").upsert({ key: "part_pool_custom", value: pool, label: "Custom parts used", description: "Custom part names typed by staff, with counts, offered to the owner to add to the pool." }, { onConflict: "key" });
}
