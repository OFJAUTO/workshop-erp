import type { DepartmentId, RoleId } from "./roles";
import type { JobStatus, Priority, Stage } from "./jobs";

export type StaffRow = {
  id: string;
  full_name: string;
  display_name: string;
  role_id: RoleId;
  department_id: DepartmentId | null;
  employee_number: string | null;
  login_type: "password" | "pin" | "both";
  is_head_accountant: boolean;
  photo_path: string | null;
  colour: string | null;
  is_active: boolean;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StaffPrivateRow = {
  staff_id: string;
  phone: string | null;
  email: string | null;
  pin_hash: string | null;
  pin_failed_attempts: number;
  pin_locked_until: string | null;
  pin_updated_at: string | null;
};

export type DeviceRow = {
  id: string;
  name: string;
  location: "workshop" | "bodyshop" | "office" | "personal";
  kind: "shared" | "personal";
  staff_id: string | null;
  is_active: boolean;
  registered_at: string;
  registered_by: string | null;
  last_seen_at: string | null;
  last_staff_id: string | null;
};

export type CustomerRow = {
  id: string;
  customer_number: string;
  customer_type: "individual" | "company";
  full_name: string;
  company_name: string | null;
  phone: string;
  phone2: string | null;
  email: string | null;
  area: string | null;
  trn: string | null;
  is_vip: boolean;
  vip_note: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CustomerContactRow = {
  id: string;
  customer_id: string;
  name: string;
  phone: string;
  relationship: string | null;
  can_approve: boolean;
  is_active: boolean;
};

export type VehicleMakeRow = { id: string; name: string; is_active: boolean; needs_review?: boolean };
export type VehicleModelRow = { id: string; make_id: string; name: string; is_active: boolean; needs_review?: boolean };

export const EMIRATES = [
  "Dubai",
  "Abu Dhabi",
  "Sharjah",
  "Ajman",
  "Umm Al Quwain",
  "Ras Al Khaimah",
  "Fujairah",
] as const;
export type Emirate = (typeof EMIRATES)[number];

export const PLATE_COUNTRIES = ["UAE", "Saudi Arabia", "Oman", "Qatar", "Kuwait", "Bahrain", "Other"] as const;

export const FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export type VehicleRow = {
  id: string;
  customer_id: string;
  photo_path: string | null;
  has_plate: boolean;
  plate_country: string;
  plate_emirate: Emirate | null;
  plate_code: string | null;
  plate_number: string | null;
  vin: string | null;
  make_id: string;
  model_id: string | null;
  variant: string | null;
  model_year: number | null;
  colour: string | null;
  fuel_type: FuelType | null;
  last_mileage: number | null;
  mileage_unit: "km" | "mi";
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type VehiclePhotoRow = {
  id: string;
  vehicle_id: string;
  storage_path: string;
  caption: string | null;
  wheel_condition: string[] | null;
  taken_at: string;
  uploaded_by: string | null;
};

export type SettingRow = {
  key: string;
  value: unknown;
  label: string;
  description: string | null;
  updated_at: string;
};

export type AuditRow = {
  id: number;
  table_name: string;
  record_id: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_by: string | null;
  changed_at: string;
};

/** Formats a plate for display, e.g. "Dubai F 60238" or "Saudi Arabia 1234 ABC". */
export type PlateFields = {
  plate_country: string;
  plate_emirate: string | null;
  plate_code: string | null;
  plate_number: string | null;
  has_plate?: boolean;
  vin?: string | null;
};

export function formatPlate(v: PlateFields) {
  if (v.has_plate === false || !v.plate_number) {
    return v.vin ? `No plate · VIN …${v.vin.slice(-6)}` : "No plate";
  }
  const region = v.plate_country === "UAE" ? v.plate_emirate ?? "UAE" : v.plate_country;
  return [region, v.plate_code, v.plate_number].filter(Boolean).join(" ");
}

/** Short plate without the emirate, matching the dashboard design ("F 60238"). */
export function shortPlate(v: Pick<PlateFields, "plate_code" | "plate_number">) {
  return [v.plate_code, v.plate_number].filter(Boolean).join(" ") || "No plate";
}

/* ---------------------------------------------------------------------------
   Phase 2: job cards
   --------------------------------------------------------------------------- */

export type JobRow = {
  id: string;
  job_number: string;
  vehicle_id: string;
  customer_id: string;
  stage: Stage;
  status: JobStatus;
  priority: Priority;
  promised_at: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  gated_in_at: string;
  gated_in_by: string;
  gated_out_at: string | null;
  gated_out_by: string | null;
  first_approval_at: string | null;
  stage_entered_at: string;
  is_open: boolean;
  department: "mechanical" | "bodyshop" | "both" | null;
  assignment_note: string | null;
  assignment_note_by: string | null;
  assignment_note_at: string | null;
  assignment_reminded_at: string | null;
  assignment_overdue_notified_at: string | null;
  estimate_id: string | null;
  inspection_fee_due: boolean;
  parts_state: "none" | "ordering" | "ordered" | "received" | "issued";
  work_started_at: string | null;
  work_completed_at: string | null;
  qc_round: number;
  rework_count: number;
  mileage_out: number | null;
  ready_to_invoice_at: string | null;
  ready_to_invoice_by: string | null;
  ready_token: string | null;
  ready_sent_at: string | null;
  followup_due_at: string | null;
  followup_done_at: string | null;
  /** Planning inside the Parts step: Parts, then the workshop manager, then the advisor. */
  plan_parts_done_at: string | null;
  plan_parts_by: string | null;
  plan_parts_ready_date: string | null;
  plan_start_date: string | null;
  plan_released_at: string | null;
  plan_released_by: string | null;
  plan_release_note: string | null;
  plan_date_confirmed_at: string | null;
  plan_date_confirmed_by: string | null;
  plan_reminded_at: string | null;
  /** Every technician pressed "Job finished"; the workshop manager confirms or sends it back. */
  work_done_at: string | null;
  work_sendbacks: number;
  wash_sent_at: string | null;
  wash_sent_by: string | null;
  /** A car back with the same problem: the original job, the cause, and whether it is free of charge. */
  comeback_of: string | null;
  comeback_cause: "workmanship" | "faulty_part" | "unrelated" | "customer_caused" | null;
  comeback_cause_by: string | null;
  comeback_cause_at: string | null;
  comeback_confirmed_by: string | null;
  comeback_confirmed_at: string | null;
  comeback_free: boolean;
  comeback_claim_status: "none" | "to_claim" | "claimed" | "paid";
  comeback_claim_amount: number | null;
  comeback_claim_po: string | null;
  comeback_claim_supplier: string | null;
  summary: Record<string, unknown> | null;
  summary_verdict: "good" | "acceptable" | "talk" | null;
  summary_at: string | null;
  summary_comment: string | null;
  summary_comment_by: string | null;
  created_at: string;
  updated_at: string;
};

export type GateInRow = {
  id: string;
  job_id: string;
  arrived_by: "our_recovery" | "customer_drove" | "customer_driver" | "outside_recovery";
  condition: "runs_drives" | "needs_assistance" | "does_not_run";
  fuel_level: "empty" | "quarter" | "half" | "three_quarters" | "full" | null;
  battery_percent: number | null;
  cleanliness: "clean" | "average" | "dirty" | "very_dirty";
  dash_cam: boolean;
  mileage: number;
  mileage_unit: "km" | "mi";
  mileage_miles: number | null;
  keys_count: number;
  keys_keychain: boolean;
  customer_requests: string;
  notes: string | null;
  old_parts_return: boolean;
  major_damage: boolean;
  damage_note: string | null;
  wheels_required: boolean;
  location_type: "branch" | "customer" | "other";
  location_name: string | null;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  is_complete: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MediaKind =
  | "video"
  | "video_exterior"
  | "video_interior"
  | "dashboard_photo"
  | "keys_photo"
  | "keys_photo_front"
  | "keys_photo_back"
  | "damage_photo"
  | "gate_out_photo"
  | "wheel_fl"
  | "wheel_fr"
  | "wheel_rl"
  | "wheel_rr"
  | "car_picture";

export type GateInMediaRow = {
  id: string;
  job_id: string;
  kind: MediaKind;
  storage_path: string;
  duration_s: number | null;
  caption: string | null;
  wheel_condition: string[] | null;
  taken_at: string;
  uploaded_by: string | null;
};

export type JobRequestRow = {
  id: string;
  job_id: string;
  position: number;
  text: string;
  is_active: boolean;
};

export type JobEventRow = {
  id: number;
  job_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  from_stage: string | null;
  to_stage: string | null;
  from_staff: string | null;
  to_staff: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
};

export type ApprovalRequestRow = {
  id: string;
  job_id: string;
  kind: "job_card" | "quote";
  token: string;
  sent_to_name: string | null;
  sent_to_phone: string;
  sent_at: string | null;
  sent_method: "whatsapp" | "copy" | "tablet" | null;
  sent_by: string | null;
  opened_at: string | null;
  approved_at: string | null;
  approver_name: string | null;
  terms_text: string;
  terms_text_ar: string | null;
  declaration_text: string | null;
  declaration_text_ar: string | null;
  reminded_at: string | null;
  status: "created" | "sent" | "opened" | "approved" | "cancelled";
  created_at: string;
};

export type NotificationRow = {
  id: number;
  staff_id: string;
  type: string;
  title: string;
  body: string | null;
  job_id: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

export type GateOutRow = {
  id: string;
  job_id: string;
  keys_returned: number;
  keychain_returned: boolean;
  keys_match: boolean;
  keys_override_by: string | null;
  keys_override_reason: string | null;
  dash_cam_reconnected: boolean | null;
  balance_due_aed: number;
  release_approved_by: string | null;
  release_reason: string | null;
  notes: string | null;
  created_at: string;
};

export type AppointmentRow = {
  id: string;
  customer_id: string;
  vehicle_id: string | null;
  vehicle_text: string | null;
  reason: string;
  starts_at: string;
  duration_minutes: number;
  advisor_id: string | null;
  kind: "customer_visit" | "car_drop" | "we_collect" | "customer_collects";
  department: "mechanical" | "bodyshop" | "both" | null;
  status: "booked" | "arrived" | "done" | "no_show" | "cancelled";
  job_id: string | null;
  notes: string | null;
  cancel_reason: string | null;
  collect_address: string | null;
  collect_method: "our_recovery" | "outside_recovery" | "our_driver" | null;
  reminder_sent_at: string | null;
  reminder_notified_at: string | null;
  notified_hour_before_at: string | null;
  notified_evening_before_at: string | null;
  missed_notified_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
