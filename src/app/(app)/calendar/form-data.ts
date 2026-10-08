import "server-only";
import type { CurrentStaff } from "@/lib/auth";
import type { BookingKind, CollectMethod } from "@/lib/calendar";
import type { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import type { AdvisorOption, CustomerOption, JobOption, VehicleOption } from "./AppointmentForm";

type Client = Awaited<ReturnType<typeof createClient>>;

type VehicleLite = { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null };

function carLabel(v: VehicleLite | null | undefined) {
  if (!v) return "";
  return `${formatPlate(v)} · ${[v.make?.name, v.model?.name].filter(Boolean).join(" ")}`;
}

/** Customers, cars, advisors and open jobs for the booking form. */
export async function loadAppointmentFormData(supabase: Client): Promise<{ customers: CustomerOption[]; vehicles: VehicleOption[]; advisors: AdvisorOption[]; jobs: JobOption[] }> {
  const [{ data: customers }, { data: vehicles }, { data: advisors }, { data: jobs }] = await Promise.all([
    supabase.from("customers").select("id, full_name, company_name, phone").eq("is_active", true).order("full_name").limit(3000),
    supabase
      .from("vehicles")
      .select("id, customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)")
      .eq("is_active", true)
      .limit(5000),
    // Bookings belong to service advisors or the owner only.
    supabase.from("staff").select("id, display_name, colour").eq("is_active", true).in("role_id", ["service_advisor", "owner"]).order("display_name"),
    supabase
      .from("jobs")
      .select("id, job_number, customer_id, vehicle_id, customer:customers(full_name, company_name), vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))")
      .eq("is_open", true)
      .order("job_number"),
  ]);
  type V = VehicleLite & { id: string; customer_id: string };
  type J = { id: string; job_number: string; customer_id: string; vehicle_id: string; customer: { full_name: string; company_name: string | null } | null; vehicle: VehicleLite | null };
  return {
    customers: (customers ?? []).map((c) => ({ id: c.id, label: c.company_name ? `${c.company_name} (${c.full_name})` : c.full_name, phone: c.phone })),
    vehicles: ((vehicles ?? []) as unknown as V[]).map((v) => ({ id: v.id, customerId: v.customer_id, label: carLabel(v) })),
    advisors: (advisors ?? []).map((a) => ({ id: a.id, name: a.display_name, colour: a.colour ?? null })),
    jobs: ((jobs ?? []) as unknown as J[]).map((j) => ({ id: j.id, customerId: j.customer_id, vehicleId: j.vehicle_id, label: `${carLabel(j.vehicle)} · ${j.customer?.company_name ?? j.customer?.full_name ?? ""} · ${j.job_number}` })),
  };
}

export const APPOINTMENT_SELECT =
  "id, kind, department, customer_id, vehicle_id, vehicle_text, reason, starts_at, duration_minutes, advisor_id, status, job_id, notes, cancel_reason, collect_address, collect_method, reminder_sent_at, reminder_notified_at, notified_hour_before_at, notified_evening_before_at, missed_notified_at, is_active, created_at, created_by, updated_at, updated_by, customer:customers(full_name, company_name, phone, is_vip), vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), advisor:staff!appointments_advisor_id_fkey(id, display_name, colour), job:jobs(job_number, gated_out_at, is_open)";

export type AppointmentFull = {
  id: string;
  kind: BookingKind;
  department: "mechanical" | "bodyshop" | "both" | null;
  customer_id: string;
  vehicle_id: string | null;
  vehicle_text: string | null;
  reason: string;
  starts_at: string;
  duration_minutes: number;
  advisor_id: string | null;
  status: "booked" | "arrived" | "done" | "no_show" | "cancelled";
  job_id: string | null;
  notes: string | null;
  cancel_reason: string | null;
  collect_address: string | null;
  collect_method: CollectMethod | null;
  reminder_sent_at: string | null;
  reminder_notified_at: string | null;
  notified_hour_before_at: string | null;
  notified_evening_before_at: string | null;
  missed_notified_at: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  customer: { full_name: string; company_name: string | null; phone: string; is_vip: boolean } | null;
  vehicle: VehicleLite | null;
  advisor: { id: string; display_name: string; colour: string | null } | null;
  job: { job_number: string; gated_out_at: string | null; is_open: boolean } | null;
};

export function appointmentCustomerName(a: AppointmentFull) {
  return a.customer?.company_name ?? a.customer?.full_name ?? "Customer";
}

export function appointmentCarText(a: AppointmentFull) {
  if (a.vehicle) return carLabel(a.vehicle);
  return a.vehicle_text ?? "Car not in the system yet";
}

/** The owner may change any booking; an advisor only their own (assigned to them or booked by them). */
export function canEditAppointment(staff: Pick<CurrentStaff, "id" | "role_id">, a: Pick<AppointmentFull, "advisor_id" | "created_by">) {
  if (staff.role_id === "owner") return true;
  if (staff.role_id !== "service_advisor") return false;
  return a.advisor_id === staff.id || a.created_by === staff.id;
}

/** The WhatsApp wording that fits the booking type. */
export function reminderTemplateFor(kind: BookingKind, settings: { whatsapp_reminder_template: string; whatsapp_reminder_car_drop: string; whatsapp_reminder_we_collect: string; whatsapp_reminder_customer_collects: string }) {
  switch (kind) {
    case "car_drop":
      return settings.whatsapp_reminder_car_drop;
    case "we_collect":
      return settings.whatsapp_reminder_we_collect;
    case "customer_collects":
      return settings.whatsapp_reminder_customer_collects;
    default:
      return settings.whatsapp_reminder_template;
  }
}

/** Roles that may not read customers still get the name (never the phone) through the limited view. */
export async function fillCustomerNames(supabase: Client, appts: AppointmentFull[]) {
  const missing = appts.filter((a) => !a.customer);
  if (!missing.length) return;
  const { data } = await supabase.from("customer_public").select("id, full_name, company_name, is_vip").in("id", Array.from(new Set(missing.map((a) => a.customer_id))));
  const byId = new Map((data ?? []).map((c) => [c.id, c]));
  for (const a of missing) {
    const c = byId.get(a.customer_id);
    if (c) a.customer = { full_name: c.full_name, company_name: c.company_name, phone: "", is_vip: c.is_vip };
  }
}
