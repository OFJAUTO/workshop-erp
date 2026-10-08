import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import type { AdvisorOption, CustomerOption, VehicleOption } from "./AppointmentForm";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Customers, cars and advisors for the booking form. */
export async function loadAppointmentFormData(supabase: Client): Promise<{ customers: CustomerOption[]; vehicles: VehicleOption[]; advisors: AdvisorOption[] }> {
  const [{ data: customers }, { data: vehicles }, { data: advisors }] = await Promise.all([
    supabase.from("customers").select("id, full_name, company_name, phone").eq("is_active", true).order("full_name").limit(3000),
    supabase
      .from("vehicles")
      .select("id, customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)")
      .eq("is_active", true)
      .limit(5000),
    supabase.from("staff").select("id, display_name").eq("is_active", true).in("role_id", ["service_advisor", "workshop_manager", "owner"]).order("display_name"),
  ]);
  type V = { id: string; customer_id: string; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null };
  return {
    customers: (customers ?? []).map((c) => ({ id: c.id, label: c.company_name ? `${c.company_name} (${c.full_name})` : c.full_name, phone: c.phone })),
    vehicles: ((vehicles ?? []) as unknown as V[]).map((v) => ({ id: v.id, customerId: v.customer_id, label: `${formatPlate(v)} · ${[v.make?.name, v.model?.name].filter(Boolean).join(" ")}` })),
    advisors: (advisors ?? []).map((a) => ({ id: a.id, name: a.display_name })),
  };
}

export const APPOINTMENT_SELECT =
  "id, customer_id, vehicle_id, vehicle_text, reason, starts_at, duration_minutes, advisor_id, status, job_id, notes, cancel_reason, reminder_sent_at, reminder_notified_at, is_active, created_at, created_by, updated_at, updated_by, customer:customers(full_name, company_name, phone, is_vip), vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), advisor:staff!appointments_advisor_id_fkey(display_name), job:jobs(job_number)";

export type AppointmentFull = {
  id: string;
  customer_id: string;
  vehicle_id: string | null;
  vehicle_text: string | null;
  reason: string;
  starts_at: string;
  duration_minutes: number;
  advisor_id: string | null;
  status: "booked" | "arrived" | "no_show" | "cancelled";
  job_id: string | null;
  notes: string | null;
  cancel_reason: string | null;
  reminder_sent_at: string | null;
  reminder_notified_at: string | null;
  is_active: boolean;
  created_at: string;
  customer: { full_name: string; company_name: string | null; phone: string; is_vip: boolean } | null;
  vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null;
  advisor: { display_name: string } | null;
  job: { job_number: string } | null;
};

export function appointmentCustomerName(a: AppointmentFull) {
  return a.customer?.company_name ?? a.customer?.full_name ?? "Customer";
}

export function appointmentCarText(a: AppointmentFull) {
  if (a.vehicle) return `${formatPlate(a.vehicle)} · ${[a.vehicle.make?.name, a.vehicle.model?.name].filter(Boolean).join(" ")}`;
  return a.vehicle_text ?? "Car not in the system yet";
}
