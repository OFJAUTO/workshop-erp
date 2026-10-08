import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { VehicleMakeRow, VehicleModelRow } from "@/lib/types";
import { createCustomerAndVehicle } from "../actions";
import { QuickCarForm, type VariantMap } from "./QuickCarForm";

export default async function NewCarForGateInPage({ searchParams }: { searchParams: Promise<{ appointment?: string }> }) {
  await requirePermission("gateIn");
  const { appointment: appointmentId } = await searchParams;
  const supabase = await createClient();
  const { data: appointment } = appointmentId
    ? await supabase.from("appointments").select("id, customer:customers(full_name, phone, email, trn)").eq("id", appointmentId).maybeSingle()
    : { data: null };
  const apptCustomer = (appointment?.customer as unknown as { full_name: string; phone: string; email: string | null; trn: string | null } | null) ?? null;
  const initialValues: Record<string, string> = appointment && apptCustomer ? { appointment_id: appointment.id, full_name: apptCustomer.full_name, phone: apptCustomer.phone, email: apptCustomer.email ?? "", trn: apptCustomer.trn ?? "" } : {};
  const [{ data: makes }, { data: models }, { data: variantRows }] = await Promise.all([
    supabase.from("vehicle_makes").select("id, name, is_active").eq("is_active", true).order("name"),
    supabase.from("vehicle_models").select("id, make_id, name, is_active").eq("is_active", true).order("name"),
    supabase.from("vehicles").select("model_id, variant").not("variant", "is", null).not("model_id", "is", null),
  ]);
  const variants: VariantMap = {};
  for (const r of variantRows ?? []) {
    if (!r.model_id || !r.variant) continue;
    const list = (variants[r.model_id] ??= []);
    if (!list.includes(r.variant)) list.push(r.variant);
  }
  for (const k of Object.keys(variants)) variants[k].sort();

  return (
    <>
      <PageHeader title={appointment ? "Add the car from the appointment" : "New customer and car"} subtitle={appointment ? "The customer is already on the appointment. Add the car to gate it in." : "Just enough to gate the car in. Everything else can be added later."} />
      <QuickCarForm action={createCustomerAndVehicle} makes={(makes ?? []) as VehicleMakeRow[]} models={(models ?? []) as VehicleModelRow[]} variants={variants} initialValues={initialValues} />
    </>
  );
}
