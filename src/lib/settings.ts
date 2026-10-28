import "server-only";
import { cache } from "react";
import { createAdminClient } from "./supabase/admin";
import { DEFAULT_CHECKLIST, type ChecklistSection } from "./inspection";
import { bankFeesFrom, feesFor, type BankFees, type FeeRule } from "./bank-fees";

export type Branch = { name: string; address: string };

const DEFAULTS = {
  /** Bodyshop packages the owner builds (Settings > Bodyshop packages): one customer price, the list included. */
  bodyshop_packages: [] as unknown[],
  /** Film types: roll price and roll length give the cost per metre. Prices excl. VAT. */
  film_types: [
    { key: "ppf_gloss", name: "PPF Gloss", roll_price: 1429, roll_m: 15 },
    { key: "ppf_matte", name: "PPF Matte", roll_price: 1524, roll_m: 15 },
  ] as { key: string; name: string; roll_price: number | string; roll_m: number | string }[],
  tint_roll_price_aed: 1200,
  /** The film gap allowed when a roll is finished before the owner is told, in percent of the roll. */
  bodyshop_waste_percent: 10,
  /** Alcohol, blades, cutting software… shared over the bodyshop cars finished each month. */
  bodyshop_consumables_monthly_aed: 1500,
  // Section 7 (21 October): the package cost estimate, filled in by itself on package quotes.
  tint_cars_per_roll: 10,
  ceramic_bottle_price_aed: 300,
  ceramic_cars_exterior_per_bottle: 4,
  ceramic_cars_interior_per_bottle: 5.5,
  package_installer_hours: 80,
  // Section 10: an optional surcharge for hand-cut PPF (0 = none).
  ppf_handcut_surcharge_aed: 0,
  // Section 11: the tint specification.
  tint_legal_max_darkness: 50,
  tint_double_layer_hours: 1,
  tint_presets: [] as unknown,
  whatsapp_tint_update_template: "Hello [name], here is the updated tint choice for your [make model] ([plate]): [tint]. If anything should be different, just reply to this message. OFJ Automotive",
  big_car_film_rolls: 1.5,
  big_car_models: ["G-Class", "Cullinan", "Urus", "Escalade", "Range Rover LWB", "GLS", "Phantom"],
  /** The bodyshop labour cost rate per hour; blank uses the workshop rate. */
  bodyshop_cost_rate_aed: 50 as string | number,
  /** Bodyshop costing: the fallback installer hours for a bodyshop service with no figure of its own. */
  bodyshop_default_installer_hours: 8 as string | number,
  whatsapp_aftercare_template: "Good day! Your car is due for its complimentary 10-day after-care check on [date]. It takes about half an hour - we check the film edges and polish anything that needs it. When would suit you?",
  /** Section 12: the warranty terms per product (src/lib/warranty.ts reads them; the owner edits them in Settings). */
  warranty_terms: {} as unknown,
  whatsapp_warranty_card_template: "Hello [name], your OFJ warranty card for the [make model] ([plate]): [link]. It shows what is covered and until when. Please book your 10-day after-care check to activate it. OFJ Automotive",
  whatsapp_aftercare_reminder_template: "Hello [name], a reminder to book the complimentary after-care check for your [make model] ([plate]). It activates your OFJ warranty: [link]. OFJ Automotive",
  /** Ceramic products the detailing leader typed before, offered as one-tap chips. */
  ceramic_products_used: [] as unknown,
  /** Real cost history per package (rolling average), for the advisor's low-price warning. */
  package_cost_history: {} as Record<string, { n: number; avg_cost: number }>,
  /** Dealer customer id -> supplier name, learned when a dealer PDF import is applied. */
  import_supplier_memory: {} as Record<string, string>,
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
  whatsapp_ready_template: "Dear [name],\n\nYour *[make model]* ([plate]) is ready.\n\nThe proforma and the amount due are here:\n[link]\n\nOnce payment is received, your car is ready to collect.\n\nOFJ Automotive",
  whatsapp_invoice_template: "Dear [name],\n\nThank you for your payment.\n\nThe tax invoice for your *[make model]* ([plate]) is here:\n[link]\n\nOFJ Automotive",
  whatsapp_followup_template:
    "Dear [name],\n\nThank you for choosing OFJ Automotive for your *[make model]* ([plate]). We hope everything is running well.\n\nIf anything needs our attention, please let us know.\n\nOFJ Automotive",
  /** Hours a sent proforma may wait unpaid before the job card turns amber and the owner is told once. */
  payment_waiting_hours: 24,
  /** Supplier LPOs by email go out from this Google Workspace mailbox (the service account must be allowed to send as it). */
  supplier_lpo_from_email: "peter@ofjauto.com",
  supplier_lpo_email_text: "Dear [supplier],\n\nPlease find attached our purchase order [number]. Kindly confirm availability and the delivery date.\n\nThank you,\nOFJ Automotive, Parts",
  /** The bank's fee per method (29 October 2026, src/lib/bank-fees.ts): MSF % BEFORE VAT, a fixed fee per transaction, VAT on both. */
  bank_charge_card_percent: 2.15,
  bank_charge_link_percent: 1.75,
  bank_charge_cash_percent: 0,
  bank_charge_cheque_percent: 0,
  bank_charge_transfer_percent: 0,
  bank_charge_fee_percent: 2.15,
  bank_fee_card_txn_aed: 0,
  bank_fee_link_txn_aed: 1,
  bank_fee_vat_percent: 5,
  /** Terminal IDs on Network International's reports, to tell the card machine from the payment link. */
  bank_terminal_ids_card: "",
  bank_terminal_ids_link: "",
  quick_remarks: ["Noise", "Crack", "Broken", "Leak", "Worn", "Loose", "Missing", "Corroded"] as string[],
  advisor_labour_discount: false,
  customer_documents_uppercase: false,
  known_words: ["BMW", "AMG", "A/C", "ABS", "TPMS", "VIN", "QC", "LPO", "LLC", "FZE", "UAE", "VAT", "TRN", "SUV", "AWD", "4WD", "RS", "GT", "GTS", "SRT", "McLaren", "LED", "ECU", "DPF", "OEM", "PPF", "II", "III", "IV", "V8", "V6", "V10", "V12"] as string[],
  part_types: ["Genuine", "OEM", "Aftermarket", "Used"] as string[],
  parts_remind_minutes: 30,
  parts_escalate_minutes: 60,
  prescan_gate_enabled: true,
  break_mechanical: "12:30-13:30",
  break_bodyshop: "13:30-14:30",
  /** The break per day of the week and department (Settings > Breaks); "" on a day means no break that day. */
  break_times: {
    mechanical: { sat: "12:30-13:30", sun: "12:30-13:30", mon: "12:30-13:30", tue: "12:30-13:30", wed: "12:30-13:30", thu: "12:30-13:30", fri: "12:30-14:00" },
    bodyshop: { sat: "13:30-14:30", sun: "13:30-14:30", mon: "13:30-14:30", tue: "13:30-14:30", wed: "13:30-14:30", thu: "13:30-14:30", fri: "12:30-14:00" },
  } as Record<string, Record<string, string>>,
  part_labels_enabled: false,
  sticker_part_width_mm: 40,
  sticker_part_height_mm: 30,
  sticker_large_mm: 60,
  sticker_battery_mm: 60,
  sticker_service_mm: 60,
  /** The battery warranty and oil service stickers: portrait, 50 × 100 mm by default. */
  sticker_battery_w_mm: 50,
  sticker_battery_h_mm: 100,
  sticker_service_w_mm: 50,
  sticker_service_h_mm: 100,
  /** The printer names shown on the print pages (Printer 1: 40 × 30; Printer 2: 50 × 100). */
  sticker_printer_part: "Printer 1 (40 × 30 mm)",
  sticker_printer_large: "Printer 2 (50 × 100 mm)",
  /** The oil service sticker's QR opens WhatsApp to this number with this message ([PLATE] filled in); empty number = the company phone. */
  sticker_service_whatsapp_number: "",
  sticker_service_whatsapp_text: "Hi, I'd like to book a service for [PLATE]",
  /** Tools and equipment orders at or above this are flagged for accounts as a fixed asset. */
  fixed_asset_threshold_aed: 2000,
  sticker_part_types: [] as string[],
  sticker_battery_required: true,
  sticker_service_required: true,
  battery_warranty_months: 12,
  battery_warranty_by_brand: {} as Record<string, number>,
  service_interval_months: 12,
  service_interval_km: 10000,
  service_interval_miles: 6000,
  sticker_service_show_phone: true,
  sticker_logo_url: "",
  sticker_wording: { part: "", battery: "Battery warranty", battery_valid: "Valid for this vehicle only", service: "Service", service_band: "Next service, whichever comes first", service_scan: "Scan to book your next service on WhatsApp" } as Record<string, string>,
  report_good_margin_percent: 25,
  monthly_summary_sent_for: "",
  stock_count_reminded_for: "",
  dangerous_customer_text: "SAFETY WARNING: our technician found a fault that makes this vehicle unsafe to drive. We strongly recommend the repair before the vehicle is driven. If you decline it, please consider recovery instead of driving.",
  dangerous_customer_text_ar: "تحذير سلامة: وجد الفني عطلاً يجعل هذه المركبة غير آمنة للقيادة. ننصح بشدة بإجراء الإصلاح قبل قيادة المركبة. في حال رفض الإصلاح، يُرجى التفكير في نقل المركبة بالشاحنة بدلاً من قيادتها.",
  dangerous_acknowledgement_text: "I understand that this vehicle has a fault that makes it unsafe to drive, that OFJ Automotive advised the repair, and that I decline it at my own risk.",
  inspection_limits: { tread_max: 12, pads_max: 20, battery_max: 16, vent_min: -5, vent_max: 40, fluid_max: 30, tyre_years: 15, pads_bad_max: 3, pads_good_min: 6 } as Record<string, number>,
  item_suggestions: {} as Record<string, { parts?: string[]; remarks?: string[] }>,
  manager_note_presets: [
    "Report checked and accurate.",
    "Report checked. Findings confirmed on the car.",
    "Report corrected by the workshop manager.",
    "All listed items should be done together.",
    "Urgent items should be done before the car is driven further.",
    "Recommended items can wait until the next service.",
    "Vehicle is safe to drive. No urgent work found.",
    "Vehicle is not safe to drive until the urgent items are repaired.",
    "Further diagnosis is needed to confirm the cause.",
    "Parts must be ordered. Timing depends on delivery.",
    "Engine or transmission removal is required for this repair.",
    "Outside work is required for part of this job.",
    "Additional faults may be found once work starts.",
    "Vehicle is in good overall condition.",
    "Vehicle shows signs of previous repair work.",
    "Vehicle shows signs of poor previous maintenance.",
  ] as string[],
  manager_note_usage: {} as Record<string, number>,
  complaint_keywords: {} as Record<string, string[]>,
  part_pool_custom: {} as Record<string, number>,
  custom_jobs_used: {} as Record<string, number>,
  supplier_quote_opening_line: "Please quote price and availability:",
  recovery_types: [
    { key: "normal", label: "Normal", cost: 150, price: 150 },
    { key: "full_down", label: "Full down", cost: 250, price: 250 },
    { key: "closed_box", label: "Closed box", cost: 400, price: 400 },
  ] as { key: string; label: string; cost: number; price: number }[],
  recovery_companies: [] as string[],
  /** The normal recovery price per kind of truck (see recoveryRatesOf in src/lib/recovery.ts) and the flag percent. */
  recovery_rates: {} as unknown,
  recovery_flag_percent: 25,
  /** The workshop dictionary for the pre-send spelling check (car words the owner adds; see src/lib/spell.ts). */
  spell_words: [] as string[],
  /** The pay-page domains a pasted payment link may use (one per line in Settings); empty keeps the N-Genius defaults. */
  payment_gateway_domains: ["paypage.ngenius-payments.com", "paypage.sandbox.ngenius-payments.com"] as string[],
  workshop_hours_text: "Monday to Saturday, 8:00–17:00",
  /** Tyre models per brand for the tyre details window; learned from what Parts type. */
  tyre_models: {} as Record<string, string[]>,
  manager_note_groups: {} as Record<string, string[]>,
  fluid_grades: ["0W-20", "0W-30", "0W-40", "5W-30", "5W-40", "5W-50", "10W-40", "ATF", "CVT", "DCT", "75W-90", "80W-90", "DOT 4", "DOT 5.1", "G12", "G13", "R134a", "R1234yf"] as string[],
  labour_actions: ["Remove and replace", "Remove and refit", "Remove and clean", "Remove and inspect", "Repair", "Reseal", "Overhaul", "Adjust", "Tighten", "Lubricate", "Skim", "Bleed", "Flush", "Drain and refill", "Top up", "Recharge", "Balance", "Align", "Calibrate", "Program or code", "Reset", "Diagnose", "Test", "Road test"] as string[],
  labour_positions: ["Front", "Rear", "Left", "Right", "Front left", "Front right", "Rear left", "Rear right", "Upper", "Lower", "Inner", "Outer"] as string[],
  big_job_tags: ["Engine removal", "Transmission removal", "Subframe down", "Special tool", "Outside work"] as string[],
  labour_hours_memory: {} as Record<string, number>,
  inbound_scan_token: "",
  whatsapp_on_the_way_template: "Dear [name],\n\nYour *[car]* is on its way to you.\n\n*Recovery truck:* [truck plate]\n*Driver:* [driver name], [driver mobile]\n\nFor anything else, call OFJ Automotive on +971 4 330 3113.",
  workshop_location_pin: "",
  /** Written by the mailbox reader: when it last ran and what came in. */
  scans_mailbox_last_check: {} as Record<string, unknown>,
  notification_tone: "marimba",
  notification_tone_owner: "chord",
  notification_remind_minutes: 2,
  markup_warn_percent: 50,
  markup_confirm_percent: 100,
  pin_needed_above_aed: 100,
  wash_board_show_times: false,
  test_mode_enabled: true,
  wash_board_done_button: false,
  comeback_window_days: 90,
  recovery_providers: [] as string[],
  labour_jobs: {} as Record<string, string[]>,
  labour_job_candidates: {} as Record<string, number>,
  tyre_brands: ["Michelin", "Pirelli", "Continental", "Bridgestone", "Goodyear", "Dunlop", "Yokohama", "Hankook", "Toyo", "Falken", "Kumho", "BFGoodrich", "Nexen", "Other"] as string[],
  tyre_brand_custom: {} as Record<string, number>,
  road_test_chips: {} as Record<string, { label: string; chips: string[] }[]>,
  road_test_chip_usage: {} as Record<string, number>,
  reason_presets: {} as Record<string, string[]>,
  doc_reminder_limits: {} as Record<string, { amber: number; red: number | string }>,
  supplier_discount_approval_above_percent: 70,
  tablet_idle_lock_seconds: 120,
  pin_max_attempts: 5,
  pin_lock_minutes: 5,
  keep_signed_in_days_staff: 30,
  keep_signed_in_days_owner_accounts: 1,
  discount_limit_percent: 10,
  parts_min_markup_percent: 5,
  /** People we pay commission to (one-tap choices in the internal box of a quotation). */
  commission_people: [] as string[],
  parts_min_markup_by_make: {} as Record<string, number>,
  technician_cost_rate_aed: 90,
  technician_cost_rate_by_department: {} as Record<string, number>,
  daily_profit_target_aed: 20000,
  /** A quotation's profit colour: yellow below this margin, red below the red one; red asks "Are you sure?". */
  quote_margin_yellow_percent: 30,
  quote_margin_red_percent: 20,
  /** The advisor bonus rate on a qualifying invoice's pure profit; the owner can override any invoice. */
  advisor_bonus_percent: 5,
  /** The target box's break-even line. Not technicians' pay when it is already charged as labour cost on jobs. */
  monthly_fixed_costs_aed: 380000,
  /** Typed by accounts each month for the labour rate check: { "2026-10": { mechanical: 0, bodyshop: 0 } }. */
  labour_cost_actuals: {} as Record<string, Record<string, number>>,
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
  /** Section 8: brands whose inspection fee defaults higher, and that default. */
  premium_brands: [] as string[],
  premium_brand_fee_aed: 1500,
  inspection_fee_notice: "If no work is approved after the inspection, an inspection fee of AED [amount] will apply.",
  // Zoho Books (26 October 2026, docs/zoho-plan.md): the REAL organization is read-only until go-live.
  zoho_org_real: "942979945",
  zoho_org_test: "",
  zoho_live_enabled: false,
  /** Phase 1: Zoho account NAMES per line type and payment method (Settings > Zoho Books > Mapping). */
  zoho_account_map: {} as Record<string, unknown>,
  /** Phase 4: Mathew's side-by-side review tick ({by, name, at}), the start date, and the switch history. */
  zoho_golive_reviewed: {} as Record<string, unknown>,
  zoho_golive_start_date: "",
  zoho_golive_log: [] as unknown[],
  zoho_went_live_at: "" as string,
  zoho_golive_followup: {} as Record<string, unknown>,
  zoho_last_live_test_at: "" as string,
  // The grey note at the end of every receipt (26 October 2026), edited by the owner in Settings.
  receipt_footer_note: "This is a payment receipt, not a tax invoice. The tax invoice is issued when the job is paid in full, with this amount deducted.",
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
  /** What the customer gets for a deposit: "receipt" (the usual) or "tax_invoice" (a tax invoice for the advance as well). */
  deposit_document: "receipt" as "receipt" | "tax_invoice",
  whatsapp_deposit_request_template: "Dear [name],\n\nTo order the parts for your *[make model]* ([plate]), an advance payment of *AED [amount]* is required.\n\nPay here:\n[link]\n\nOFJ Automotive",
  whatsapp_deposit_receipt_template: "Dear [name],\n\nThank you for your deposit of *AED [amount]* for the *[make model]* ([plate]).\n\nYour receipt is here:\n[link]\n\nOFJ Automotive",
  quote_validity_days: 7,
  quote_owner_approval_above_aed: 0,
  parts_pricing_target_hours: 4,
  /** The ORDER NOW clock on an approved LPO: amber past the first figure, red (and the owner told once) past the second. Working minutes. */
  order_now_amber_minutes: 30,
  order_now_red_minutes: 60,
  quote_send_target_hours: 4,
  estimate_followup_days: 2,
  whatsapp_quote_template: "Dear [name],\n\nYour quotation for the *[make model]* ([plate]) is ready:\n[link]\n\nAny questions, just reply here.\n\nOFJ Automotive",
  whatsapp_quote_revised_template: "Dear [name],\n\nYour quotation for the *[make model]* ([plate]) has been updated:\n[link]\n\nAny questions, just reply here.\n\nOFJ Automotive",
  damage_note_chips: ["Scratches", "Dents", "Stone chips", "Paint peeling", "PPF peeling", "PPF scratched", "Cracked bumper", "Kerbed wheels", "Windscreen chip", "Broken light"] as string[],
  whatsapp_estimate_template: "Dear [name],\n\nOur estimate for the *[make model]* ([plate]) is here:\n[link]\n\nThe final price is confirmed once the car is with us.\n\nOFJ Automotive",
  whatsapp_report_template: "Dear [name],\n\nThe inspection of your *[make model]* ([plate]) is complete.\n\nThe report is here:\n[link]\n\nOFJ Automotive",
  inspection_checklist: DEFAULT_CHECKLIST as ChecklistSection[],
  appointment_reminder_hours_before: 1,
  appointment_evening_reminder_hour: 18,
  appointment_missed_after_minutes: 30,
  whatsapp_reminder_car_drop:
    "Dear [name],\n\nA reminder that your *[car]* is booked to be dropped at OFJ Automotive tomorrow:\n*[date] at [time]*\nFor: [reason]\n\nPlease reply to confirm.\n\nOFJ Automotive",
  whatsapp_reminder_we_collect:
    "Dear [name],\n\nA reminder that OFJ Automotive will collect your *[car]* tomorrow:\n*[date] at [time]*\nFrom: [address]\nFor: [reason]\n\nPlease have the keys ready.\n\nOFJ Automotive",
  whatsapp_reminder_customer_collects:
    "Dear [name],\n\nYour *[car]* is ready for collection at OFJ Automotive tomorrow:\n*[date] at [time]*\n\nOFJ Automotive",
  whatsapp_reminder_template:
    "Dear [name],\n\nA reminder of your appointment at OFJ Automotive tomorrow:\n*[date] at [time]*\nFor: [reason]\n\nPlease reply to confirm.\n\nOFJ Automotive",
  whatsapp_approval_template: "Dear [name],\n\nYour *[make model]* ([plate]) has been received at OFJ Automotive.\n\nPlease review the check-in and approve the inspection:\n[link]\n\nOFJ Automotive",
  // The bodyshop (14 October 2026): the PPF warranty and care texts, the old-film note, the three customer updates, the final check.
  ppf_brand_name: "OFJ Bespoke PPF",
  ppf_warranty_years: 10,
  ppf_warranty_text: "OFJ Bespoke PPF is warranted against yellowing, cracking, peeling, bubbling and delamination for ten years from the installation date, when the film is cared for as described in the care instructions. The warranty covers the film and its reinstallation; it does not cover damage from accidents, stones, chemicals, abrasion, improper washing or removal by a third party. Valid for the vehicle named on this certificate.",
  ppf_care_text: "Wait 7 days before the first wash. Hand wash or touchless only; no automatic brushes. Use pH-neutral shampoo and microfibre only. Remove bird droppings, tree sap and insects as soon as you can. No wax or sealant with petroleum distillates; a PPF-safe sealant is fine. Keep pressure washers 50 cm away and off the film edges.",
  ppf_removal_note: "We take great care removing old film, but paint underneath can occasionally lift.",
  bodyshop_final_check_days: 10,
  whatsapp_bodyshop_arrived_template: "Dear [name],\n\nYour *[make model]* ([plate]) has arrived at OFJ Automotive and is in good hands.\n\nFollow the progress here:\n[link]\n\nOFJ Automotive",
  whatsapp_bodyshop_film_template: "Dear [name],\n\nFilm is going on your *[make model]* ([plate]).\n\nSee the progress here:\n[link]\n\nOFJ Automotive",
  whatsapp_bodyshop_ready_template: "Dear [name],\n\nYour *[make model]* ([plate]) is ready for collection.\n\nYour handover page, warranty and care instructions:\n[link]\n\nOFJ Automotive",
  whatsapp_final_check_template: "Dear [name],\n\nA reminder of the final check of your *[make model]* ([plate]) at OFJ Automotive tomorrow:\n*[date] at [time]*\n\nOFJ Automotive",
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

/** Every method's fee rule (MSF %, fee per transaction, VAT, terminals): the ONE source for payments, quotations and settlements. */
export function bankFeesOf(settings: Settings): BankFees {
  return bankFeesFrom(settings as unknown as Record<string, unknown>);
}

/** The fee rule a quotation assumes from the way the customer is expected to pay ("Not sure" = the card machine). */
export function expectedFeeRule(settings: Settings, method: string | null | undefined): FeeRule {
  const m = method && method !== "not_sure" ? method : "card";
  return bankFeesOf(settings)[m] ?? { msfPercent: 0, txnFee: 0, vatPercent: 0, terminals: [] };
}

/** The bank fee a quotation counts as cost on its total (MSF + transaction fee, without the reclaimable VAT). */
export function expectedFeeCost(settings: Settings, method: string | null | undefined, total: number): number {
  return feesFor(total, expectedFeeRule(settings, method)).cost;
}

/** The figures the bank fee settings box starts from. */
export function bankFeeValuesOf(settings: Settings) {
  const f = bankFeesOf(settings);
  return {
    cardMsf: f.card.msfPercent,
    cardTxn: f.card.txnFee,
    cardTerminals: f.card.terminals.join(", "),
    linkMsf: f.link.msfPercent,
    linkTxn: f.link.txnFee,
    linkTerminals: f.link.terminals.join(", "),
    vat: Number(settings.bank_fee_vat_percent) || 0,
    cash: f.cash.msfPercent,
    cheque: f.cheque.msfPercent,
    transfer: f.transfer.msfPercent,
  };
}

/** The MSF percentage (before VAT) of each payment method. */
export function bankChargePercentFor(settings: Settings, method: string): number {
  const key = method === "card" ? "bank_charge_card_percent" : method === "link" ? "bank_charge_link_percent" : method === "cash" ? "bank_charge_cash_percent" : method === "cheque" ? "bank_charge_cheque_percent" : method === "transfer" ? "bank_charge_transfer_percent" : null;
  return key ? Number(settings[key]) || 0 : 0;
}

export const EXPECTED_PAYMENT_METHODS = [
  { value: "not_sure", label: "Not sure" },
  { value: "card", label: "Card" },
  { value: "link", label: "Payment link" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "transfer", label: "Bank transfer" },
] as const;

/** The bank charge a quotation assumes from the way the customer is expected to pay: "Not sure" takes the card rate; the real charge replaces it at payment. */
export function expectedChargePercent(settings: Settings, method: string | null | undefined): number {
  const m = method && method !== "not_sure" ? method : "card";
  return bankChargePercentFor(settings, m);
}

/** The rate a quotation assumes for its hidden bank charge: the highest of the four, corrected at payment. */
export function highestBankCharge(settings: Settings): number {
  return Math.max(...["card", "link", "cash", "cheque"].map((m) => bankChargePercentFor(settings, m)));
}
