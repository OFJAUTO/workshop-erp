import Link from "next/link";
import { Badge, Button, Empty, Input, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { STATUS_LABELS, type JobStatus } from "@/lib/jobs";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type VehicleRow } from "@/lib/types";
import { VehicleCard } from "./VehicleCard";

type Row = VehicleRow & {
  make: { name: string } | null;
  model: { name: string } | null;
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
      "id, customer_id, photo_path, plate_country, plate_emirate, plate_code, plate_number, vin, make_id, model_id, variant, model_year, colour, fuel_type, last_mileage, notes, is_active, created_at, updated_at, make:vehicle_makes(name), model:vehicle_models(name)",
    )
    .order("updated_at", { ascending: false })
    .limit(120);
  if (show !== "all" || role === "workshop_manager") query = query.eq("is_active", true);
  // The workshop manager's Cars tab: only cars currently in the workshop, with their status.
  const { data: openJobs } = await supabase.from("jobs").select("vehicle_id, status").eq("is_open", true);
  const statusByVehicle = new Map((openJobs ?? []).map((j) => [j.vehicle_id, j.status as JobStatus]));
  if (role === "workshop_manager") query = query.in("id", Array.from(statusByVehicle.keys()).length ? Array.from(statusByVehicle.keys()) : ["00000000-0000-0000-0000-000000000000"]);
  if (term) {
    const like = `%${term.replace(/[%_\s]/g, "")}%`;
    query = query.or(`plate_number.ilike.${like},vin.ilike.${like},plate_code.ilike.${like},variant.ilike.${like},colour.ilike.${like}`);
  }
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  const { data: names } = rows.length
    ? await supabase.from("customer_public").select("id, full_name, company_name, is_vip").in("id", Array.from(new Set(rows.map((r) => r.customer_id))))
    : { data: [] as { id: string; full_name: string; company_name: string | null; is_vip: boolean }[] };
  const nameOf = new Map((names ?? []).map((n) => [n.id, n]));
  const vipIds = new Set((names ?? []).filter((v) => v.is_vip).map((v) => v.id));

  const paths = rows.map((r) => r.photo_path).filter((p): p is string => !!p);
  const signed = paths.length ? await supabase.storage.from("vehicle-photos").createSignedUrls(paths, 3600) : { data: [] };
  const urlByPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));

  return (
    <>
      <PageHeader title="Cars" actions={canEdit ? <LinkButton href="/vehicles/new">Add car</LinkButton> : undefined} />

      <form className="flex flex-wrap gap-2" action="/vehicles">
        <Input name="q" defaultValue={q} placeholder="Search by plate number, VIN, variant or colour" className="max-w-md" />
        {show === "all" ? <input type="hidden" name="show" value="all" /> : null}
        <Button type="submit" tone="secondary">
          Search
        </Button>
        {role !== "workshop_manager" ? (
          <LinkButton href={show === "all" ? "/vehicles" : "/vehicles?show=all"} tone="ghost">
            {show === "all" ? "Hide inactive" : "Show inactive"}
          </LinkButton>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <Empty title={term ? "No cars match" : "No cars yet"} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          {rows.map((v) => (
            <Link key={v.id} href={`/vehicles/${v.id}`} className="block">
              <VehicleCard
                photoUrl={v.photo_path ? (urlByPath.get(v.photo_path) ?? null) : null}
                plate={formatPlate(v)}
                title={[v.make?.name, v.model?.name, v.variant].filter(Boolean).join(" ") || "Make and model not set"}
                subtitle={[v.model_year, v.colour].filter(Boolean).join(" · ")}
                owner={seesCustomers || role === "workshop_manager" ? (nameOf.get(v.customer_id)?.company_name ?? nameOf.get(v.customer_id)?.full_name ?? null) : null}
                badges={
                  <>
                    {vipIds.has(v.customer_id) ? <Badge tone="ink">VIP</Badge> : null}
                    {statusByVehicle.has(v.id) ? <Badge tone="amber">{STATUS_LABELS[statusByVehicle.get(v.id)!]}</Badge> : null}
                    {!v.is_active ? <Badge tone="red">Inactive</Badge> : null}
                  </>
                }
              />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
