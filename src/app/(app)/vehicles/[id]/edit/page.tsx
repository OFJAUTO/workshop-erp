import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type VehicleRow } from "@/lib/types";
import { updateVehicle } from "../../actions";
import { loadVehicleFormData } from "../../data";
import { VehicleForm } from "../../VehicleForm";

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("editVehicles");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("vehicles")
    .select("id, customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make_id, model_id, variant, model_year, colour, fuel_type, last_mileage, notes, is_active, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const v = data as VehicleRow;
  const lists = await loadVehicleFormData();

  return (
    <>
      <PageHeader title={`Edit ${formatPlate(v)}`} />
      <Card className="max-w-3xl">
        <VehicleForm
          action={updateVehicle.bind(null, v.id)}
          mode="edit"
          initialValues={{
            customer_id: v.customer_id,
            has_plate: v.has_plate ? "yes" : "no",
            plate_country: v.plate_country,
            plate_emirate: v.plate_emirate ?? "",
            plate_code: v.plate_code ?? "",
            plate_number: v.plate_number ?? "",
            vin: v.vin ?? "",
            make_id: v.make_id,
            model_id: v.model_id ?? "",
            variant: v.variant ?? "",
            model_year: v.model_year?.toString() ?? "",
            colour: v.colour ?? "",
            fuel_type: v.fuel_type ?? "",
            last_mileage: v.last_mileage?.toString() ?? "",
            notes: v.notes ?? "",
          }}
          {...lists}
        />
      </Card>
    </>
  );
}
