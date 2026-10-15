import { CustomerCarStartForm } from "@/components/CustomerCarStartForm";
import type { ChooserCar } from "@/components/CustomerCarChooser";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type VehicleMakeRow, type VehicleModelRow } from "@/lib/types";
import { createEstimate } from "../actions";

export const dynamic = "force-dynamic";

type V = { id: string; customer_id: string; kind: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };

/** A new estimate before the car arrives: one page, three big choices for the customer and the car, then the lines. */
export default async function NewEstimatePage({ searchParams }: { searchParams: Promise<{ customer?: string; vehicle?: string }> }) {
  await requirePermission("viewEstimates");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: customers }, { data: vehicles }, { data: makes }, { data: models }] = await Promise.all([
    supabase.from("customers").select("id, full_name, company_name, phone").eq("is_active", true).order("full_name").limit(3000),
    supabase.from("vehicles").select("kind, id, customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("is_active", true).neq("kind", "loose"),
    supabase.from("vehicle_makes").select("id, name, is_active").eq("is_active", true).order("name"),
    supabase.from("vehicle_models").select("id, make_id, name, is_active").eq("is_active", true).order("name"),
  ]);
  const cars: ChooserCar[] = ((vehicles ?? []) as unknown as V[]).map((v) => ({ id: v.id, customerId: v.customer_id, label: `${formatPlate(v)} · ${[v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" ")}` }));
  return (
    <>
      <PageHeader title="New estimate" subtitle="Before the car arrives. Pick or add the customer and the car, then add the lines." actions={<LinkButton href="/estimates" tone="secondary" size="lg">Estimates</LinkButton>} />
      <Card className="max-w-3xl">
        <CustomerCarStartForm
          action={createEstimate}
          initialValues={{ mode: "existing", customer_id: sp.customer ?? "", vehicle_id: sp.vehicle ?? "" }}
          customers={(customers ?? []).map((c) => ({ id: c.id, label: `${c.company_name ? `${c.company_name} · ` : ""}${c.full_name}${c.phone ? ` · ${c.phone}` : ""}` }))}
          cars={cars}
          makes={(makes ?? []) as VehicleMakeRow[]}
          models={(models ?? []) as VehicleModelRow[]}
          submitLabel="Start the estimate"
          testId="estimate"
        />
      </Card>
    </>
  );
}
