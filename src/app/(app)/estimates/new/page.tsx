import { LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { createEstimate } from "../actions";
import { NewEstimateForm } from "./NewEstimateForm";

export default async function NewEstimatePage({ searchParams }: { searchParams: Promise<{ customer?: string; vehicle?: string }> }) {
  await requirePermission("viewEstimates");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: customers }, { data: vehicles }] = await Promise.all([
    supabase.from("customers").select("id, full_name, company_name, phone").eq("is_active", true).order("full_name"),
    supabase.from("vehicles").select("id, customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("is_active", true),
  ]);
  type V = { id: string; customer_id: string; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };
  return (
    <>
      <PageHeader title="New estimate" subtitle="Before the car arrives. Pick the customer and car, then add the lines." actions={<><LinkButton href="/customers/new" tone="secondary" size="lg">New customer</LinkButton><LinkButton href="/vehicles/new" tone="secondary" size="lg">New car</LinkButton></>} />
      <div className="max-w-xl">
        <NewEstimateForm
          action={createEstimate}
          customers={(customers ?? []).map((c) => ({ id: c.id, label: `${c.company_name ?? c.full_name} · ${c.phone}` }))}
          vehicles={((vehicles ?? []) as unknown as V[]).map((v) => ({ id: v.id, customerId: v.customer_id, label: `${formatPlate(v)} · ${[v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" ")}` }))}
          initialCustomer={sp.customer ?? ""}
          initialVehicle={sp.vehicle ?? ""}
        />
      </div>
    </>
  );
}
