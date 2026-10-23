import { Badge, Button, Card, Empty, Input, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { gateInSearch, type GateInCar } from "@/lib/gate-in-search";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type VehicleRow } from "@/lib/types";
import { WaitingPanel } from "@/components/WaitingPanel";

type Mode = "car" | "customer";

const carLine = (c: GateInCar) => [c.make, c.model, c.variant, c.model_year].filter(Boolean).join(" ") + (c.colour ? ` · ${c.colour}` : "");

export default async function GateInSearchPage({ searchParams }: { searchParams: Promise<{ q?: string; mode?: string }> }) {
  const staff = await requirePermission("gateIn");
  const gateInOnly = staff.role_id === "gate_in";
  const { q = "", mode: modeRaw } = await searchParams;
  const mode: Mode = modeRaw === "customer" ? "customer" : "car";
  const term = q.trim();

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

  // Server side and narrow: name, mobile and the customer's cars only.
  const { cars, customers } = term ? await gateInSearch(term) : { cars: [], customers: [] };
  const nothing = !!term && cars.length === 0 && customers.length === 0;

  const carButton = (c: GateInCar) =>
    c.openJob ? (
      gateInOnly ? (
        <LinkButton href={`/jobs/${c.openJob.id}/media`} tone="secondary" size="lg">
          Photos and video
        </LinkButton>
      ) : (
        <LinkButton href={`/jobs/${c.openJob.id}`} tone="secondary" size="lg">
          Open job card
        </LinkButton>
      )
    ) : (
      <LinkButton href={`/gate-in/new?vehicle=${c.id}`} size="lg" data-gatein-car-start={c.id}>
        Gate in this car
      </LinkButton>
    );

  const carsBlock = cars.length ? (
    <section className="flex flex-col gap-3" data-gatein-cars>
      <SectionLabel right={`${cars.length}`}>Cars</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
        {cars.map((c) => (
          <Card key={c.id} className="flex flex-col gap-3" data-gatein-car={c.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-extrabold text-xl tracking-[0.03em]">{formatPlate(c)}</span>
              {c.isVip ? <Badge tone="ink">VIP</Badge> : null}
              {c.openJob ? <Badge tone="amber">In workshop · {c.openJob.job_number}</Badge> : null}
            </div>
            <span className="font-semibold">{carLine(c)}</span>
            <span className="text-sm text-muted">
              {c.customerName} · {c.customerPhone}
              {c.vin ? ` · VIN ${c.vin}` : ""}
            </span>
            <div className="flex flex-wrap gap-2 mt-1">
              {carButton(c)}
              {!gateInOnly ? (
                <LinkButton href={`/vehicles/${c.id}`} tone="ghost" size="lg">
                  Car details
                </LinkButton>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </section>
  ) : null;

  const customersBlock = customers.length ? (
    <section className="flex flex-col gap-3" data-gatein-customers>
      <SectionLabel right={`${customers.length}`}>Customers</SectionLabel>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {customers.map((cu) => (
          <Card key={cu.id} className="flex flex-col gap-3" data-gatein-customer={cu.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-extrabold text-lg uppercase">{cu.name}</span>
              {cu.isVip ? <Badge tone="ink">VIP</Badge> : null}
            </div>
            <span className="text-sm font-semibold">{cu.phone}</span>
            {cu.cars.length ? (
              <ul className="flex flex-col divide-y divide-line border-y border-line">
                {cu.cars.map((c) => (
                  <li key={c.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3" data-gatein-customer-car={c.id}>
                    <span className="flex flex-col">
                      <span className="font-bold tracking-[0.03em]">
                        {formatPlate(c)}
                        {c.openJob ? <span className="ml-2 align-middle"><Badge tone="amber">In workshop · {c.openJob.job_number}</Badge></span> : null}
                      </span>
                      <span className="text-xs text-muted">{carLine(c)}</span>
                    </span>
                    {carButton(c)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No car on record yet.</p>
            )}
            <div>
              <LinkButton href={`/gate-in/new-car?customer=${cu.id}`} tone={mode === "customer" ? "primary" : "secondary"} size="lg" data-new-car-for={cu.id}>
                + New car for this customer
              </LinkButton>
            </div>
          </Card>
        ))}
      </div>
    </section>
  ) : null;

  const modeLink = (m: Mode) => `/gate-in?mode=${m}${term ? `&q=${encodeURIComponent(term)}` : ""}`;

  return (
    <>
      <PageHeader title="Gate in a car" subtitle="Find the car, or the customer, in one box. A new customer? Add the customer and car in one step." />

      <WaitingPanel staff={staff} />
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" data-gatein-modes>
          <LinkButton href={modeLink("car")} tone={mode === "car" ? "primary" : "secondary"} size="lg" aria-pressed={mode === "car"} data-gatein-mode="car">
            Existing car
          </LinkButton>
          <LinkButton href={modeLink("customer")} tone={mode === "customer" ? "primary" : "secondary"} size="lg" aria-pressed={mode === "customer"} data-gatein-mode="customer">
            Existing customer, new car
          </LinkButton>
          <LinkButton href="/gate-in/new-car" tone="secondary" size="lg" data-gatein-mode="new">
            New customer and car
          </LinkButton>
        </div>
        <form className="flex flex-wrap gap-2" action="/gate-in">
          <input type="hidden" name="mode" value={mode} />
          <Input
            name="q"
            defaultValue={q}
            placeholder={mode === "customer" ? "Customer name or mobile" : "Plate, VIN, customer name or mobile"}
            className="max-w-md text-lg font-bold"
            autoFocus
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="characters"
            data-gatein-search
          />
          <Button type="submit" size="lg">
            Search
          </Button>
        </form>
        <p className="text-sm text-muted">
          {mode === "customer" ? "Find the customer by name or mobile, then add the new car to them." : "Plate, VIN, the customer's name or mobile all work."}{" "}
          <a href="/gate-in/loose" className="underline underline-offset-4 font-semibold">Loose items, no car</a>
        </p>
      </Card>

      {nothing ? (
        <div data-gatein-nothing>
          <Empty title="Nothing matches">
            <span className="flex flex-col items-center gap-3">
              <span>No car or customer found for “{term}”.</span>
              <LinkButton href="/gate-in/new-car" size="lg">New customer and car</LinkButton>
            </span>
          </Empty>
        </div>
      ) : null}

      {mode === "customer" ? (
        <>
          {customersBlock}
          {carsBlock}
        </>
      ) : (
        <>
          {carsBlock}
          {customersBlock}
        </>
      )}
    </>
  );
}
