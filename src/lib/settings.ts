import "server-only";
import { cache } from "react";
import { createAdminClient } from "./supabase/admin";
import { DEFAULT_CHECKLIST, type ChecklistSection } from "./inspection";

export type Branch = { name: string; address: string };

const DEFAULTS = {
  company_name: "OFJ Automotive",
  company_trn: "",
  tablet_idle_lock_seconds: 120,
  pin_max_attempts: 5,
  pin_lock_minutes: 5,
  keep_signed_in_days_staff: 30,
  keep_signed_in_days_owner_accounts: 1,
  discount_limit_percent: 25,
  parts_min_markup_percent: 20,
  parts_min_markup_by_make: {} as Record<string, number>,
  technician_cost_rate_aed: 90,
  technician_cost_rate_by_department: {} as Record<string, number>,
  daily_profit_target_aed: 20000,
  working_days: ["mon", "tue", "wed", "thu", "fri", "sat"] as string[],
  profit_target_yellow_percent: 80,
  supplier_invoice_pending_red_days: 7,
  video_retention_months: 12,
  terms_and_conditions: "",
  terms_and_conditions_ar: "",
  declaration_text:
    "I agree to the terms and conditions and confirm I am the owner of the vehicle or a legal representative authorised to act on the owner's behalf.",
  declaration_text_ar: "أوافق على الشروط والأحكام وأقر بأنني مالك المركبة أو ممثل قانوني مفوّض بالتصرف نيابةً عن المالك.",
  stage_target_hours: { gate_in: 2, inspection: 4, quote: 4, approval: 24, parts: 48, work: 24, qc: 2, wash: 2, ready: 24 } as Record<string, number>,
  branches: [{ name: "OFJ Automotive (Al Quoz, Dubai)", address: "" }] as Branch[],
  approval_reminder_hours: 4,
  inspection_fee_aed: 750,
  inspection_fee_notice: "If no work is approved after the inspection, an inspection fee of AED [amount] will apply.",
  inspection_fee_notice_ar: "في حال عدم الموافقة على أي أعمال بعد الفحص، تُطبَّق رسوم فحص بقيمة [amount] درهمًا.",
  opening_hour: 8,
  closing_hour: 17,
  appointments_per_day: 8,
  inspection_target_minutes: 90,
  inspection_unlock_hours: 1,
  assignment_target_minutes: 30,
  whatsapp_report_template:
    "Dear [name], the inspection of your [make model] ([plate]) is complete. Please review the report with our findings and photos: [link]. Thank you, [advisor], OFJ Automotive",
  inspection_checklist: DEFAULT_CHECKLIST as ChecklistSection[],
  appointment_reminder_hours_before: 1,
  appointment_evening_reminder_hour: 18,
  appointment_missed_after_minutes: 30,
  whatsapp_reminder_car_drop:
    "Dear [name], a reminder that your [car] is booked to be dropped at OFJ Automotive tomorrow, [date] at [time], for [reason]. Please reply to confirm. Thank you, [advisor], OFJ Automotive",
  whatsapp_reminder_we_collect:
    "Dear [name], a reminder that OFJ Automotive will collect your [car] tomorrow, [date] at [time], from [address], for [reason]. Please have the keys ready. Thank you, [advisor], OFJ Automotive",
  whatsapp_reminder_customer_collects:
    "Dear [name], your [car] is ready for collection at OFJ Automotive tomorrow, [date] at [time]. Thank you, [advisor], OFJ Automotive",
  whatsapp_reminder_template:
    "Dear [name], a reminder of your appointment at OFJ Automotive tomorrow, [date] at [time], for [reason]. Please reply to confirm. Thank you, [advisor], OFJ Automotive",
  whatsapp_approval_template:
    "Dear [name], your [make model] ([plate]) has been received at OFJ Automotive. Please review the check-in video and job card, and approve so we can begin the inspection: [link]. Thank you, [advisor], OFJ Automotive",
};

export type Settings = typeof DEFAULTS;
export type SettingKey = keyof Settings;
export const SETTING_KEYS = Object.keys(DEFAULTS) as SettingKey[];

/** All settings, with safe defaults if a row is missing. Read with the master key so every screen can use them. */
export const getSettings = cache(async (): Promise<Settings> => {
  const admin = createAdminClient();
  const { data } = await admin.from("settings").select("key, value");
  const result: Record<string, unknown> = { ...DEFAULTS };
  for (const row of data ?? []) {
    if (row.key in DEFAULTS && row.value !== null && row.value !== undefined) result[row.key] = row.value;
  }
  return result as Settings;
});
