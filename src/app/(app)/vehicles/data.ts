import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { VehicleMakeRow, VehicleModelRow } from "@/lib/types";
import type { CustomerOption } from "./VehicleForm";

/** Lists needed by the car form: customers to pick from, and makes and models. */
export async function loadVehicleFormData() {
  const supabase = await createClient();
  const [{ data: customers }, { data: makes }, { data: models }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, customer_number, full_name, company_name, phone")
      .eq("is_active", true)
      .order("full_name")
      .limit(2000),
    supabase.from("vehicle_makes").select("id, name, is_active").eq("is_active", true).order("name"),
    supabase.from("vehicle_models").select("id, make_id, name, is_active").eq("is_active", true).order("name"),
  ]);

  const customerOptions: CustomerOption[] = (customers ?? []).map((c) => ({
    id: c.id,
    label: `${c.company_name ? c.company_name + " · " : ""}${c.full_name} · ${c.phone} · ${c.customer_number}`,
  }));

  return {
    customers: customerOptions,
    makes: (makes ?? []) as VehicleMakeRow[],
    models: (models ?? []) as VehicleModelRow[],
  };
}
