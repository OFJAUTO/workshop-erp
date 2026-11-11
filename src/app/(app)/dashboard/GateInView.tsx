import Link from "next/link";
import { CarCard } from "@/components/CarCard";
import { HomeHeader } from "@/components/HomeHeader";
import { LiveRefresh } from "@/components/LiveRefresh";
import { WaitingPanel } from "@/components/WaitingPanel";
import { Badge, Card, SectionLabel } from "@/components/ui";
import type { CurrentStaff } from "@/lib/auth";
import { boardSearchHit, gateOutBlocks, makeChips } from "@/lib/car-board";
import { jobBalance } from "@/lib/invoice-data";
import { STATUS_LABELS, type JobStatus } from "@/lib/jobs";
import { thumbsFor } from "@/lib/media-urls";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

/**
 * THE GATE-IN DASHBOARD (11 November 2026, Section 11): a large search (plate, VIN, make, model), the make chips, the
 * tiles as filters - Ready to go out (first), Expected today (with Gate in pre-filled), In the workshop, Out with our
 * driver - and the car cards: the car's picture, plate, car, job, step and advisor. No customer name, price or quote
 * detail (those stay inside the gate-in and gate-out forms). Gate out only when the car is cleared to leave; otherwise
 * why, without an amount.
 */
type Veh = Parameters<typeof formatPlate>[0] & { vin: string | null; photo_path: string | null; model_year: number | null; variant: string | null; make: { name: string } | null; model: { name: string } | null };
type Row = { id: string; job_number: string; job_kind: string | null; status: string; gated_in_at: string | null; ready_sent_at: string | null; customer_id: string | null; advisor_id: string | null; vehicle: Veh };
const TILES = [
  { key: "ready", label: "Ready to go out" },
  { key: "expected", label: "Expected today" },
  { key: "in", label: "In the workshop" },
  { key: "out", label: "Out with our driver" },
] as const;

export async function GateInView({ staff, sp = {} }: { staff: CurrentStaff; sp?: { q?: string; make?: string; tile?: string } }) {
  const admin = createAdminClient();
  const q = (sp.q ?? "").trim();
  const make = (sp.make ?? "").trim();
  const tile = TILES.some((t) => t.key === sp.tile) ? (sp.tile as (typeof TILES)[number]["key"]) : "ready";
  // eslint-disable-next-line react-hooks/purity -- a server page: today is read once per request
  const dayStart = new Date(new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10) + "T00:00:00+04:00");
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const [{ data: jobs }, { data: appts }] = await Promise.all([
    admin.from("jobs").select("id, job_number, job_kind, status, gated_in_at, ready_sent_at, customer_id, advisor_id, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, photo_path, model_year, variant, make:vehicle_makes(name), model:vehicle_models(name))").eq("is_open", true).order("gated_in_at", { ascending: false }).limit(300),
    admin.from("appointments").select("id, kind, starts_at, vehicle_text, vehicle_id, job_id, status, advisor_id, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, photo_path, model_year, variant, make:vehicle_makes(name), model:vehicle_models(name))").eq("is_active", true).in("kind", ["car_drop", "customer_visit", "we_collect"]).gte("starts_at", dayStart.toISOString()).lt("starts_at", dayEnd.toISOString()).is("job_id", null).order("starts_at"),
  ]);
  const rows = ((jobs ?? []) as unknown as Row[]).filter((r) => r.vehicle && r.job_kind !== "loose");
  type Appt = { id: string; kind: string; starts_at: string; vehicle_text: string | null; vehicle_id: string | null; status: string; advisor_id: string | null; vehicle: Veh | null };
  const expected = ((appts ?? []) as unknown as Appt[]).filter((a) => !["cancelled", "no_show", "arrived", "done"].includes(a.status));
  const advisorIds = Array.from(new Set([...rows.map((r) => r.advisor_id), ...expected.map((a) => a.advisor_id)].filter((x): x is string => !!x)));
  const { data: staffRows } = advisorIds.length ? await admin.from("staff").select("id, display_name").in("id", advisorIds) : { data: [] };
  const nameOf = new Map(((staffRows ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  const thumbs = await thumbsFor("vehicle-photos", [...rows.map((r) => r.vehicle.photo_path), ...expected.map((a) => a.vehicle?.photo_path ?? null)], 480);
  const readyRows = rows.filter((r) => ["ready", "pending_payment"].includes(r.status));
  // Cleared to leave: paid (or credit approved) - read per car only for the cars at the end.
  // 11 November 2026 (Section 16): the customers' credit terms in one read and every balance at the same time
  // (they were read one car after another).
  const custIds = Array.from(new Set(readyRows.map((r) => r.customer_id).filter((x): x is string => !!x)));
  const [{ data: custRows }, balances] = await Promise.all([
    custIds.length ? admin.from("customers").select("id, credit_terms_days").in("id", custIds) : Promise.resolve({ data: [] }),
    Promise.all(readyRows.map((r) => jobBalance(r.id).catch(() => null))),
  ]);
  const creditOf = new Map(((custRows ?? []) as { id: string; credit_terms_days: number | null }[]).map((c) => [c.id, (Number(c.credit_terms_days) || 0) > 0]));
  const cleared = new Map<string, string[]>();
  readyRows.forEach((r, i) => {
    const bal = balances[i];
    const credit = r.customer_id ? (creditOf.get(r.customer_id) ?? false) : false;
    const paid = !!bal && (bal.state === "nothing" || (bal.state !== "no_invoice" && (bal.balance <= 0 || credit)));
    cleared.set(r.id, gateOutBlocks({ status: r.status, paidOrCredit: paid, readySentAt: r.ready_sent_at, jobKind: r.job_kind }));
  });
  const car = (v: Veh | null, jobNumber: string | null) => ({ plate: v ? formatPlate(v) : "", vin: v?.vin ?? null, make: v?.make?.name ?? null, model: v?.model?.name ?? null, jobNumber });
  const inList = tile === "ready" ? readyRows : tile === "out" ? rows.filter((r) => r.status === "in_delivery") : tile === "in" ? rows.filter((r) => r.status !== "in_delivery") : [];
  const counts = { ready: readyRows.length, expected: expected.length, in: rows.filter((r) => r.status !== "in_delivery").length, out: rows.filter((r) => r.status === "in_delivery").length };
  const pool = tile === "expected" ? expected.map((a) => car(a.vehicle, null)) : inList.map((r) => car(r.vehicle, r.job_number));
  const chips = makeChips(pool);
  const keep = (c: ReturnType<typeof car>) => boardSearchHit(c, q) && (!make || c.make === make);
  const href = (o: { tile?: string; make?: string | null; q?: string }) => {
    const p = new URLSearchParams();
    p.set("tile", o.tile ?? tile);
    if ((o.make ?? make) && o.make !== null) p.set("make", o.make ?? make);
    if (o.q ?? q) p.set("q", o.q ?? q);
    return `/dashboard?${p.toString()}`;
  };
  const titleOf = (v: Veh) => [v.make?.name, v.model?.name, v.variant, v.model_year].filter(Boolean).join(" ");
  return (
    <>
      <LiveRefresh tables={["jobs", "appointments"]} />
      <HomeHeader staff={staff} />
      <form method="get" action="/dashboard" className="flex gap-2" data-gatein-search>
        <input type="hidden" name="tile" value={tile} />
        <input name="q" defaultValue={q} placeholder="Plate, VIN, make or model" className="min-h-14 flex-1 rounded-control border-2 border-ink bg-white px-4 text-lg font-semibold" data-gatein-search-input data-spell="" autoComplete="off" />
        <button type="submit" className="min-h-14 rounded-control bg-ink px-6 text-base font-bold text-on-dark">Find</button>
      </form>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-gatein-tiles>
        {TILES.map((t) => (
          <Link key={t.key} href={href({ tile: t.key, make: null })} className={`flex min-h-20 flex-col justify-center rounded-card border-2 px-4 py-3 ${tile === t.key ? "border-ink bg-white" : "border-line bg-white"}`} data-gatein-tile={t.key} aria-current={tile === t.key ? "page" : undefined}>
            <span className="text-2xl font-extrabold">{counts[t.key]}</span>
            <span className="text-sm font-semibold text-muted">{t.label}</span>
          </Link>
        ))}
      </div>
      {chips.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" data-make-chips>
          <Link href={href({ make: null })} className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-bold ${!make ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`}>All</Link>
          {chips.map((c) => <Link key={c.make} href={href({ make: c.make })} className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-bold uppercase ${make === c.make ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`} data-make-chip={c.make}>{c.make} · {c.count}</Link>)}
        </div>
      ) : null}
      <WaitingPanel staff={staff} />
      <Card className="flex flex-col gap-3" data-gatein-board={tile}>
        <SectionLabel>{TILES.find((t) => t.key === tile)!.label}</SectionLabel>
        {tile === "expected" ? (
          expected.filter((a) => keep(car(a.vehicle, null))).length ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {expected.filter((a) => keep(car(a.vehicle, null))).map((a) => (
                <CarCard key={a.id} pictureUrl={a.vehicle?.photo_path ? thumbs.get(a.vehicle.photo_path) ?? null : null} plate={a.vehicle ? formatPlate(a.vehicle) : (a.vehicle_text ?? "Car")} title={a.vehicle ? titleOf(a.vehicle) : ""} sub={[new Date(a.starts_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }), a.advisor_id ? nameOf.get(a.advisor_id) ?? null : null]} actions={<Link href={`/gate-in?appointment=${a.id}`} className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-on-dark" data-gatein-expected={a.id}>Gate in</Link>} data-gatein-expected-card={a.id} />
              ))}
            </div>
          ) : <p className="text-sm text-muted">Nobody expected today{q || make ? " for this search" : ""}.</p>
        ) : inList.filter((r) => keep(car(r.vehicle, r.job_number))).length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {inList.filter((r) => keep(car(r.vehicle, r.job_number))).map((r) => {
              const blocks = cleared.get(r.id) ?? null;
              return (
                <CarCard
                  key={r.id}
                  data-gatein-car={r.job_number}
                  pictureUrl={r.vehicle.photo_path ? thumbs.get(r.vehicle.photo_path) ?? null : null}
                  plate={formatPlate(r.vehicle)}
                  title={titleOf(r.vehicle)}
                  sub={[r.job_number, r.advisor_id ? `Advisor ${nameOf.get(r.advisor_id) ?? ""}` : null]}
                  chips={<Badge tone="neutral">{STATUS_LABELS[r.status as JobStatus] ?? r.status}</Badge>}
                  actions={tile === "ready" && blocks ? (blocks.length ? <span className="text-sm font-bold text-red" data-gateout-blocked={r.job_number}>{blocks.join(" · ")}</span> : <Link href={`/jobs/${r.id}/gate-out`} className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-on-dark" data-gateout-go={r.job_number}>Gate out</Link>) : null}
                />
              );
            })}
          </div>
        ) : <p className="text-sm text-muted">No cars{q || make ? " for this search" : ""}.</p>}
      </Card>
    </>
  );
}
