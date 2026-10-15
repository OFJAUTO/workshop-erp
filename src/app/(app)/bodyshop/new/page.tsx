import { CustomerCarStartForm } from "@/components/CustomerCarStartForm";
import type { ChooserCar } from "@/components/CustomerCarChooser";
import { Card, LinkButton, Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate, type VehicleMakeRow, type VehicleModelRow } from "@/lib/types";
import { createBodyshopQuote } from "../actions";

export const dynamic = "force-dynamic";

type V = { id: string; customer_id: string; kind: string; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; colour: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };

/**
 * A bodyshop quotation before the car arrives: one page, three big choices for the customer and the car (make,
 * model, year, colour; the VIN can come later), then the usual quotation builder with the bodyshop packages.
 */
export default async function NewBodyshopQuotePage({ searchParams }: { searchParams: Promise<{ error?: string; customer?: string }> }) {
  await requirePermission("bodyshopQuote");
  const { error, customer } = await searchParams;
  const admin = createAdminClient();
  const [{ data: customers }, { data: vehicles }, { data: makes }, { data: models }] = await Promise.all([
    admin.from("customers").select("id, full_name, company_name, phone").eq("is_active", true).order("full_name").limit(3000),
    admin.from("vehicles").select("id, customer_id, kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, colour, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("is_active", true).neq("kind", "loose"),
    admin.from("vehicle_makes").select("id, name, is_active").eq("is_active", true).order("name"),
    admin.from("vehicle_models").select("id, make_id, name, is_active").eq("is_active", true).order("name"),
  ]);
  const cars: ChooserCar[] = ((vehicles ?? []) as unknown as V[]).map((v) => ({ id: v.id, customerId: v.customer_id, label: `${formatPlate(v)} · ${[v.make?.name, v.model?.name, v.model_year, v.colour].filter(Boolean).join(" ")}${v.vin ? "" : " · no VIN yet"}` }));
  return (
    <>
      <PageHeader title="New bodyshop quotation" subtitle="Before the car arrives: the customer, the car and the packages. The gate-in links to it when the car comes in." actions={<LinkButton href="/bodyshop" tone="secondary" size="lg">Bodyshop</LinkButton>} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card className="max-w-3xl">
        <CustomerCarStartForm
          action={createBodyshopQuote}
          initialValues={{ mode: "existing", customer_id: customer ?? "" }}
          customers={(customers ?? []).map((c) => ({ id: c.id, label: `${c.company_name ? `${c.company_name} · ` : ""}${c.full_name}${c.phone ? ` · ${c.phone}` : ""}` }))}
          cars={cars}
          makes={(makes ?? []) as VehicleMakeRow[]}
          models={(models ?? []) as VehicleModelRow[]}
          submitLabel="Start the quotation"
          testId="bodyshop"
        />
      </Card>
    </>
  );
}
