import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { gateInCustomer } from "@/lib/gate-in-search";
import { createClient } from "@/lib/supabase/server";
import type { VehicleMakeRow, VehicleModelRow } from "@/lib/types";
import { createCustomerAndVehicle } from "../actions";
import { QuickCarForm, type VariantMap } from "./QuickCarForm";

export default async function NewCarForGateInPage({ searchParams }: { searchParams: Promise<{ appointment?: string; customer?: string }> }) {
  await requirePermission("gateIn");
  const { appointment: appointmentId, customer: customerId } = await searchParams;
  const supabase = await createClient();
  // "+ New car for this customer": the customer is fixed (name and mobile only), the form asks for the car.
  const existing = customerId ? await gateInCustomer(customerId) : null;
  if (customerId && !existing) notFound();
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
      <PageHeader
        title={existing ? `New car for ${existing.name}` : appointment ? "Add the car from the appointment" : "New customer and car"}
        subtitle={existing ? "The customer is already on record. Add the car to gate it in." : appointment ? "The customer is already on the appointment. Add the car to gate it in." : "Just enough to gate the car in. Everything else can be added later."}
      />
      <QuickCarForm
        action={createCustomerAndVehicle}
        makes={(makes ?? []) as VehicleMakeRow[]}
        models={(models ?? []) as VehicleModelRow[]}
        variants={variants}
        initialValues={initialValues}
        customer={existing ? { id: existing.id, name: existing.name, phone: existing.phone, cars: existing.cars.length } : null}
      />
    </>
  );
}
