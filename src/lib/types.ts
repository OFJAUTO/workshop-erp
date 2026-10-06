import type { DepartmentId, RoleId } from "./roles";

export type StaffRow = {
  id: string;
  full_name: string;
  display_name: string;
  role_id: RoleId;
  department_id: DepartmentId | null;
  employee_number: string | null;
  login_type: "password" | "pin";
  is_head_accountant: boolean;
  photo_path: string | null;
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
  location: "workshop" | "bodyshop" | "office";
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

export type VehicleMakeRow = { id: string; name: string; is_active: boolean };
export type VehicleModelRow = { id: string; make_id: string; name: string; is_active: boolean };

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
  plate_country: string;
  plate_emirate: Emirate | null;
  plate_code: string | null;
  plate_number: string;
  vin: string | null;
  make_id: string;
  model_id: string | null;
  variant: string | null;
  model_year: number | null;
  colour: string | null;
  fuel_type: FuelType | null;
  last_mileage: number | null;
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
export function formatPlate(v: Pick<VehicleRow, "plate_country" | "plate_emirate" | "plate_code" | "plate_number">) {
  const region = v.plate_country === "UAE" ? v.plate_emirate ?? "UAE" : v.plate_country;
  return [region, v.plate_code, v.plate_number].filter(Boolean).join(" ");
}

/** Short plate without the emirate, matching the dashboard design ("F 60238"). */
export function shortPlate(v: Pick<VehicleRow, "plate_code" | "plate_number">) {
  return [v.plate_code, v.plate_number].filter(Boolean).join(" ");
}
