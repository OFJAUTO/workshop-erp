import Link from "next/link";
import { Badge, Button, Card, Empty, Input, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type VehicleRow } from "@/lib/types";

type Row = VehicleRow & {
  make: { name: string } | null;
  model: { name: string } | null;
  customer: { full_name: string; company_name: string | null } | null;
};

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  const staff = await requirePermission("viewVehicles");
  const { q = "", show } = await searchParams;
  const term = q.trim();
  const role = staff.role_id as RoleId;
  const canEdit = can(role, "editVehicles");
  const seesCustomers = can(role, "viewCustomers");

  const supabase = await createClient();
  let query = supabase
    .from("vehicles")
    .select(
      "id, customer_id, plate_country, plate_emirate, plate_code, plate_number, vin, make_id, model_id, variant, model_year, colour, fuel_type, last_mileage, notes, is_active, created_at, updated_at, make:vehicle_makes(name), model:vehicle_models(name), customer:customers(full_name, company_name)",
    )
    .order("updated_at", { ascending: false })
    .limit(100);
  if (show !== "all") query = query.eq("is_active", true);
  if (term) {
    const like = `%${term.replace(/[%_\s]/g, "")}%`;
    query = query.or(`plate_number.ilike.${like},vin.ilike.${like},plate_code.ilike.${like},variant.ilike.${like},colour.ilike.${like}`);
  }
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  const { data: vip } = await supabase
    .from("customer_vip_flags")
    .select("id, is_vip")
    .in("id", Array.from(new Set(rows.map((r) => r.customer_id))));
  const vipIds = new Set((vip ?? []).filter((v) => v.is_vip).map((v) => v.id));

  return (
    <>
      <PageHeader title="Cars" actions={canEdit ? <LinkButton href="/vehicles/new">Add car</LinkButton> : undefined} />

      <form className="flex flex-wrap gap-2" action="/vehicles">
        <Input name="q" defaultValue={q} placeholder="Search by plate number, VIN, variant or colour" className="max-w-md" />
        {show === "all" ? <input type="hidden" name="show" value="all" /> : null}
        <Button type="submit" tone="secondary">
          Search
        </Button>
        <LinkButton href={show === "all" ? "/vehicles" : "/vehicles?show=all"} tone="ghost">
          {show === "all" ? "Hide inactive" : "Show inactive"}
        </LinkButton>
      </form>

      {rows.length === 0 ? (
        <Empty title={term ? "No cars match" : "No cars yet"} />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((v) => (
            <Link key={v.id} href={`/vehicles/${v.id}`} className="block">
              <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 hover:border-ink py-4">
                <span className="flex items-center gap-2">
                  <span className="font-bold tracking-[0.03em] text-[17px]">{formatPlate(v)}</span>
                  {vipIds.has(v.customer_id) ? <Badge tone="ink">VIP</Badge> : null}
                  {!v.is_active ? <Badge tone="red">Inactive</Badge> : null}
                </span>
                <span className="text-sm font-medium flex-1 min-w-40">
                  {[v.make?.name, v.model?.name, v.variant].filter(Boolean).join(" ")}
                  {v.model_year ? ` · ${v.model_year}` : ""}
                  {v.colour ? ` · ${v.colour}` : ""}
                </span>
                {seesCustomers && v.customer ? (
                  <span className="text-sm text-muted">{v.customer.company_name ?? v.customer.full_name}</span>
                ) : null}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
