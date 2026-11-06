import { notFound } from "next/navigation";
import { Card, Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { editCarTitle } from "@/lib/plate-rules";
import { plateHistoryReady } from "@/lib/schema-ready";
import { createClient } from "@/lib/supabase/server";
import { type VehicleRow } from "@/lib/types";
import { updateVehicle } from "../../actions";
import { loadVehicleFormData } from "../../data";
import { VehicleForm } from "../../VehicleForm";

export default async function EditVehiclePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("editVehicles");
  const { id } = await params;
  const { message, error } = await searchParams;
  // The old-plates line only once its column is applied (plate history, 6 November 2026).
  const historyOn = await plateHistoryReady();
  const supabase = await createClient();
  const { data } = await supabase
    .from("vehicles")
    .select(`kind, id, customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make_id, model_id, variant, model_year, colour, fuel_type, last_mileage, notes, is_active, created_at, updated_at${historyOn ? ", old_plates" : ""}, make:vehicle_makes(name), model:vehicle_models(name)`)
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const v = data as unknown as VehicleRow & { make: { name: string } | null; model: { name: string } | null; old_plates?: string | null };
  const lists = await loadVehicleFormData();
  const carWords = [v.make?.name, v.model?.name].filter(Boolean).join(" ");
  // Earlier plates without the compact search forms (the entry is "Dubai DD 23864 DD23864").
  const earlier = String(v.old_plates ?? "")
    .split(" · ")
    .map((s) => s.trim().split(" ").slice(0, -1).join(" ") || s.trim())
    .filter(Boolean);

  return (
    <>
      <PageHeader title={editCarTitle(carWords, v)} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {earlier.length ? (
        <p className="text-sm text-muted" data-earlier-plates>
          Earlier plates of this car: <span className="font-semibold">{earlier.join(" · ")}</span>. Searching any of them still finds it.
        </p>
      ) : null}
      <Card className="max-w-3xl">
        <VehicleForm
          action={updateVehicle.bind(null, v.id)}
          mode="edit"
          vehicleId={v.id}
          initialValues={{
            customer_id: v.customer_id,
            has_plate: v.has_plate ? "yes" : "no",
            plate_country: v.plate_country,
            plate_emirate: v.plate_emirate ?? "",
            plate_code: v.plate_code ?? "",
            plate_number: v.plate_number ?? "",
            plate_remark: "",
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
