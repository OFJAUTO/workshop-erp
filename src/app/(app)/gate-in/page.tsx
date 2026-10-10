import Link from "next/link";
import { Badge, Button, Card, Empty, Input, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type VehicleRow } from "@/lib/types";

type Row = VehicleRow & {
  make: { name: string } | null;
  model: { name: string } | null;
  customer: { full_name: string; company_name: string | null; phone: string; is_vip: boolean } | null;
};

export default async function GateInSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const staff = await requirePermission("gateIn");
  const gateInOnly = staff.role_id === "gate_in";
  const { q = "" } = await searchParams;
  const term = q.trim().replace(/\s+/g, "");

  const supabase = await createClient();
  // The person's own gate-ins still waiting for photos or video.
  const { data: pendingRows } = await supabase
    .from("jobs")
    .select("id, job_number, gated_in_at, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))")
    .eq("status", "gate_in_pending")
    .eq("gated_in_by", staff.id)
    .order("gated_in_at", { ascending: false })
    .limit(10);
  type Pending = { id: string; job_number: string; gated_in_at: string; vehicle: (Pick<VehicleRow, "has_plate" | "plate_country" | "plate_emirate" | "plate_code" | "plate_number" | "vin"> & { make: { name: string } | null; model: { name: string } | null }) | null };
  const pending = (pendingRows ?? []) as unknown as Pending[];
  let rows: Row[] = [];
  let openJobs = new Map<string, { id: string; job_number: string }>();
  if (term) {
    const like = `%${term.replace(/[%_]/g, "")}%`;
    const { data } = await supabase
      .from("vehicles")
      .select(
        "kind, id, customer_id, photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make_id, model_id, variant, model_year, colour, fuel_type, last_mileage, notes, is_active, created_at, updated_at, make:vehicle_makes(name), model:vehicle_models(name), customer:customers(full_name, company_name, phone, is_vip)",
      )
      .eq("is_active", true)
      .or(`plate_number.ilike.${like},vin.ilike.${like}`)
      .limit(20);
    rows = (data ?? []) as unknown as Row[];
    if (rows.length) {
      const { data: jobs } = await supabase
        .from("jobs")
        .select("id, job_number, vehicle_id")
        .eq("is_open", true)
        .in("vehicle_id", rows.map((r) => r.id));
      openJobs = new Map((jobs ?? []).map((j) => [j.vehicle_id, { id: j.id, job_number: j.job_number }]));
    }
  }

  return (
    <>
      <PageHeader title="Gate in a car" subtitle="Find the car by plate or VIN. New car? Add the customer and car in one step." actions={<><LinkButton href="/gate-in/loose" tone="secondary" size="lg">Loose items, no car</LinkButton><LinkButton href="/gate-in/new-car" tone="secondary" size="lg">New customer and car</LinkButton></>} />

      {pending.length ? (
        <Card className="flex flex-col gap-3 border-amber-bar">
          <SectionLabel right={`${pending.length}`}>Your gate-ins still waiting for photos or video</SectionLabel>
          <ul className="flex flex-col divide-y divide-line">
            {pending.map((p) => (
              <li key={p.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
                <span className="flex flex-col">
                  <span className="font-bold">{p.vehicle ? formatPlate(p.vehicle) : p.job_number}</span>
                  <span className="text-xs text-muted">{[p.vehicle?.make?.name, p.vehicle?.model?.name].filter(Boolean).join(" ")} · {p.job_number} · {formatDateTime(p.gated_in_at)}</span>
                </span>
                <LinkButton href={`/jobs/${p.id}/media`} size="md">
                  Finish photos and video
                </LinkButton>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-4">
        <form className="flex flex-wrap gap-2" action="/gate-in">
          <Input name="q" defaultValue={q} placeholder="Plate number or VIN" className="max-w-md text-lg font-bold uppercase" autoFocus autoCapitalize="characters" />
          <Button type="submit" size="lg">
            Search
          </Button>
        </form>
      </Card>

      {term && rows.length === 0 ? (
        <Empty title="No car matches">
          Check the plate, or <Link href="/gate-in/new-car" className="underline underline-offset-4 font-semibold">add the customer and car</Link>.
        </Empty>
      ) : null}

      {rows.length ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {rows.map((v) => {
            const open = openJobs.get(v.id);
            return (
              <Card key={v.id} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-extrabold text-xl tracking-[0.03em]">{formatPlate(v)}</span>
                  {v.customer?.is_vip ? <Badge tone="ink">VIP</Badge> : null}
                  {open ? <Badge tone="amber">In workshop · {open.job_number}</Badge> : null}
                </div>
                <span className="font-semibold">
                  {[v.make?.name, v.model?.name, v.variant, v.model_year].filter(Boolean).join(" ")}
                  {v.colour ? ` · ${v.colour}` : ""}
                </span>
                <span className="text-sm text-muted">
                  {v.customer?.company_name ?? v.customer?.full_name} · {v.customer?.phone}
                  {v.vin ? ` · VIN ${v.vin}` : ""}
                </span>
                <div className="flex flex-wrap gap-2 mt-1">
                  {open ? (
                    gateInOnly ? (
                      <LinkButton href={`/jobs/${open.id}/media`} tone="secondary" size="lg">
                        Photos and video
                      </LinkButton>
                    ) : (
                      <LinkButton href={`/jobs/${open.id}`} tone="secondary" size="lg">
                        Open job card
                      </LinkButton>
                    )
                  ) : (
                    <LinkButton href={`/gate-in/new?vehicle=${v.id}`} size="lg">
                      Gate in this car
                    </LinkButton>
                  )}
                  {!gateInOnly ? (
                    <LinkButton href={`/vehicles/${v.id}`} tone="ghost" size="lg">
                      Car details
                    </LinkButton>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
