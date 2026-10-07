import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { VehicleMakeRow, VehicleModelRow } from "@/lib/types";
import { createCustomerAndVehicle } from "../actions";
import { QuickCarForm } from "./QuickCarForm";

export default async function NewCarForGateInPage() {
  await requirePermission("gateIn");
  const supabase = await createClient();
  const [{ data: makes }, { data: models }] = await Promise.all([
    supabase.from("vehicle_makes").select("id, name, is_active").eq("is_active", true).order("name"),
    supabase.from("vehicle_models").select("id, make_id, name, is_active").eq("is_active", true).order("name"),
  ]);

  return (
    <>
      <PageHeader title="New customer and car" subtitle="Just enough to gate the car in. Everything else can be added later." />
      <Card className="max-w-3xl">
        <QuickCarForm action={createCustomerAndVehicle} makes={(makes ?? []) as VehicleMakeRow[]} models={(models ?? []) as VehicleModelRow[]} />
      </Card>
    </>
  );
}
