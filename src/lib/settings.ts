import "server-only";
import { cache } from "react";
import { createAdminClient } from "./supabase/admin";
import { DEFAULT_CHECKLIST, type ChecklistSection } from "./inspection";

export type Branch = { name: string; address: string };

const DEFAULTS = {
  company_name: "OFJ Automotive",
  company_legal_name: "O F J AUTOMOTIVE WORKS L.L.C",
  company_legal_name_ar: "او اف جي اوتوموتيف وركس ش.ذ.م.م",
  company_trn: "100520937200003",
  company_address: "Warehouse S02-S03, 24B Street, Al Quoz Industrial Third, Dubai, United Arab Emirates",
  company_address_1: "Warehouse S02-S03, 24B Street",
  company_address_2: "Al Quoz Industrial Third",
  company_address_3: "Dubai, United Arab Emirates",
  company_phone: "+971 4 330 3113",
  company_email: "accounts@ofjauto.com",
  company_website: "www.ofjauto.com",
  bank_name: "The National Bank of Ras Al Khaimah",
  bank_account_name: "OFJ Automotive Works L L C",
  bank_account_number: "0552886630001",
  bank_iban: "AE44 0400 0005 5288 6630 001",
  bank_swift: "NRAKAEAK",
  labour_rate_by_make: {} as Record<string, number>,
  labour_rate_bodyshop_aed: "" as string | number,
  next_invoice_number: 1,
  consumables_default_aed: 50,
  document_currency: "symbol",
  label_width_mm: 50,
  label_height_mm: 30,
  qc_general_checks: ["No warning lights on the dashboard", "Fluid levels correct", "No leaks under the car", "Wheel bolts torqued", "Tyre pressures set", "Undertrays, covers and clips refitted", "Battery terminals tight", "No tools, rags or old parts left in the car", "Interior clean, no grease marks", "Protective covers removed", "Service indicator reset where a service was done", "Dash cam reconnected if fitted", "Old parts kept for the customer if requested", "Road test after repair"] as string[],
  followup_days: 3,
  whatsapp_ready_template:
    "Dear [name], your [make model] ([plate]) is ready for collection at OFJ Automotive. Your invoice and balance are here:\n[link]\nThank you, [advisor], OFJ Automotive",
  whatsapp_followup_template:
    "Dear [name], thank you for choosing OFJ Automotive for your [make model] ([plate]). We hope everything is running well. If anything needs our attention, please let us know.\nThank you, [advisor], OFJ Automotive",
  bank_charge_card_percent: 1.9,
  bank_charge_link_percent: 1.9,
  bank_charge_fee_percent: 1.9,
  part_types: ["Genuine", "OEM", "Aftermarket", "Used"] as string[],
  parts_remind_minutes: 30,
  parts_escalate_minutes: 60,
  prescan_gate_enabled: false,
  dangerous_customer_text: "SAFETY WARNING: our technician found a fault that makes this vehicle unsafe to drive. We strongly recommend the repair before the vehicle is driven. If you decline it, please consider recovery instead of driving.",
  dangerous_customer_text_ar: "تحذير سلامة: وجد الفني عطلاً يجعل هذه المركبة غير آمنة للقيادة. ننصح بشدة بإجراء الإصلاح قبل قيادة المركبة. في حال رفض الإصلاح، يُرجى التفكير في نقل المركبة بالشاحنة بدلاً من قيادتها.",
  dangerous_acknowledgement_text: "I understand that this vehicle has a fault that makes it unsafe to drive, that OFJ Automotive advised the repair, and that I decline it at my own risk.",
  inspection_limits: { tread_max: 12, pads_max: 20, battery_max: 16, vent_min: -5, vent_max: 40, fluid_max: 30, tyre_years: 15 } as Record<string, number>,
  item_suggestions: {} as Record<string, { parts?: string[]; remarks?: string[] }>,
  fluid_grades: ["0W-20", "0W-30", "0W-40", "5W-30", "5W-40", "5W-50", "10W-40", "ATF", "CVT", "DCT", "75W-90", "80W-90", "DOT 4", "DOT 5.1", "G12", "G13", "R134a", "R1234yf"] as string[],
  labour_actions: ["Remove and replace", "Remove and refit", "Remove and clean", "Remove and inspect", "Repair", "Reseal", "Overhaul", "Adjust", "Tighten", "Lubricate", "Skim", "Bleed", "Flush", "Drain and refill", "Top up", "Recharge", "Balance", "Align", "Calibrate", "Program or code", "Reset", "Diagnose", "Test", "Road test"] as string[],
  labour_positions: ["Front", "Rear", "Left", "Right", "Front left", "Front right", "Rear left", "Rear right", "Upper", "Lower", "Inner", "Outer"] as string[],
  big_job_tags: ["Engine removal", "Transmission removal", "Subframe down", "Special tool", "Outside work"] as string[],
  labour_hours_memory: {} as Record<string, number>,
  inbound_scan_token: "",
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
  labour_rate_aed: 350,
  labour_rate_by_department: {} as Record<string, number>,
  deposit_threshold_aed: 5000,
  deposit_percent: 50,
  quote_validity_days: 7,
  quote_owner_approval_above_aed: 0,
  parts_pricing_target_hours: 4,
  quote_send_target_hours: 4,
  estimate_followup_days: 2,
  whatsapp_quote_template:
    "Dear [name], your quotation for your [make model] ([plate]) is ready. Please review it and approve the work you would like us to do:\n[link]\nThank you, [advisor], OFJ Automotive",
  whatsapp_estimate_template:
    "Dear [name], our estimate for your [make model] ([plate]) is ready. The final price is confirmed once the vehicle is with us:\n[link]\nThank you, [advisor], OFJ Automotive",
  whatsapp_report_template:
    "Dear [name], the inspection of your [make model] ([plate]) is complete. Please review the report with our findings and photos:\n[link]\nThank you, [advisor], OFJ Automotive",
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
    "Dear [name], your [make model] ([plate]) has been received at OFJ Automotive. Please review the check-in video and job card, and approve so we can begin the inspection:\n[link]\nThank you, [advisor], OFJ Automotive",
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
