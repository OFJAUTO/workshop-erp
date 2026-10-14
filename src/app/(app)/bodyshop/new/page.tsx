import { Button, Card, LinkButton, Notice, PageHeader, Select } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { createBodyshopQuote } from "../actions";
import { CustomerCarPicker } from "./CustomerCarPicker";

export const dynamic = "force-dynamic";

/**
 * A bodyshop quotation before the car arrives: the customer and the car (make, model, year, colour; the VIN can
 * come later), then the usual quotation builder with the bodyshop packages. No gate-in or job card yet.
 */
export default async function NewBodyshopQuotePage({ searchParams }: { searchParams: Promise<{ error?: string; customer?: string }> }) {
  await requirePermission("bodyshopQuote");
  const { error, customer } = await searchParams;
  const admin = createAdminClient();
  const [{ data: customers }, { data: vehicles }] = await Promise.all([
    admin.from("customers").select("id, full_name, company_name, phone").eq("is_active", true).order("full_name").limit(2000),
    admin.from("vehicles").select("id, customer_id, kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, colour, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("is_active", true).neq("kind", "loose").order("created_at", { ascending: false }).limit(4000),
  ]);
  type V = { id: string; customer_id: string; kind: string; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; colour: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };
  const cars = ((vehicles ?? []) as unknown as V[]).map((v) => ({ id: v.id, customerId: v.customer_id, label: `${formatPlate(v)} · ${[v.make?.name, v.model?.name, v.model_year, v.colour].filter(Boolean).join(" ")}${v.vin ? "" : " · no VIN yet"}` }));
  return (
    <>
      <PageHeader title="New bodyshop quotation" subtitle="Before the car arrives: the customer, the car and the packages. The gate-in links to it when the car comes in." actions={<LinkButton href="/bodyshop" tone="secondary" size="lg">Bodyshop</LinkButton>} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card className="max-w-2xl flex flex-col gap-4">
        <form action={createBodyshopQuote} className="flex flex-col gap-4" data-bodyshop-new>
          <CustomerCarPicker customers={(customers ?? []).map((c) => ({ id: c.id, label: `${c.company_name ? `${c.company_name} · ` : ""}${c.full_name}${c.phone ? ` · ${c.phone}` : ""}` }))} cars={cars} initialCustomer={customer ?? ""} />
          <p className="text-xs text-muted">The car is not on the list? Add it under Cars first (make, model, year and colour are enough; the VIN can come at gate-in).</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg">Start the quotation</Button>
            <LinkButton href="/vehicles/new" tone="secondary" size="lg">Add a car</LinkButton>
          </div>
        </form>
        <Select name="unused" className="hidden" aria-hidden><option>-</option></Select>
      </Card>
    </>
  );
}
