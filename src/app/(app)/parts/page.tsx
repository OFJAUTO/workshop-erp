import { formatDate } from "@/lib/format";
import { partsWithNoHome } from "@/lib/handover";
import { CarThumb } from "@/components/CarThumb";
import { signCarPictures } from "@/lib/car-pictures";
import { partsSteps, stepPartOf } from "@/lib/parts-steps";
import { CopyVin } from "@/components/CopyVin";
import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Button, Input,Badge, Card, Empty, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { STATUS_LABELS, type JobStatus,formatWait, workingMinutesSince, workingTimeOf } from "@/lib/jobs";
import { REQUEST_SELECT } from "@/lib/quote-data";
import { PART_FULL_SELECT, toPartFull } from "@/lib/parts-data";
import { type PartRequest } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { WaitingPanel } from "@/components/WaitingPanel";
import { PartsSteps } from "@/components/PartsSteps";

export const dynamic = "force-dynamic";

const todayIso = () => new Date().toISOString().slice(0, 10);

type JobInfo = { id: string; job_number: string; is_open: boolean; status: string; parts_pricing_done_at: string | null; parts_pricing_reopened_at: string | null; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null; assignee: { display_name: string } | null };

/** The Parts role's desk: price requests from inspections, parts waiting for prices or the technician, and approved parts to order. */
type AllJob = { id: string; job_number: string; status: string; is_open: boolean; gated_in_at: string; gated_out_at: string | null; parts_pricing_done_at: string | null; parts_pricing_reopened_at: string | null; vehicle: { kind?: string | null; photo_path?: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null; customer: { full_name: string; company_name: string | null } | null };
const ALL_JOB_SELECT = "id, job_number, status, is_open, gated_in_at, gated_out_at, parts_pricing_done_at, parts_pricing_reopened_at, vehicle:vehicles(kind, photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), customer:customers(full_name, company_name)";

export default async function PartsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; q?: string }> }) {
  const staff = await requirePermission("priceParts");
  const { message, error, q: rawQ } = await searchParams;
  const q = String(rawQ ?? "").trim().slice(0, 60);
  const admin = createAdminClient();
  const settings = await getSettings();
  const wt = workingTimeOf(settings);
  const target = Number(settings.parts_pricing_target_hours) || 4;
  const [{ data: reqRows }, { data: partRows }] = await Promise.all([
    admin.from("part_requests").select(REQUEST_SELECT).eq("is_active", true).in("status", ["open"]).order("created_at"),
    admin.from("part_items").select(PART_FULL_SELECT).eq("is_active", true).order("created_at"),
  ]);
  const requests = (reqRows ?? []) as PartRequest[];
  const noHomeCount = (await partsWithNoHome()).length;
  const parts = ((partRows ?? []) as unknown as Record<string, unknown>[]).map(toPartFull).map((p) => ({ ...p, advisor_added_label: p.added_by_role === "service_advisor" && !p.part_request_id ? "Added by advisor" : null }));
  const today = todayIso();
  const jobIds = Array.from(new Set([...requests.map((r) => r.job_id), ...parts.map((p) => p.job_id)]));
  const { data: jobRows } = jobIds.length ? await admin.from("jobs").select("id, job_number, is_open, status, parts_pricing_done_at, parts_pricing_reopened_at, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), assignee:staff!jobs_assigned_to_fkey(display_name)").in("id", jobIds) : { data: [] };
  const jobs = new Map(((jobRows ?? []) as unknown as JobInfo[]).filter((j) => j.is_open).map((j) => [j.id, j]));
  const jobLine = (id: string) => {
    const j = jobs.get(id);
    if (!j) return null;
    return `${j.vehicle ? formatPlate(j.vehicle) : ""} · ${[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · ${j.job_number}${j.assignee ? ` · ${j.assignee.display_name}` : ""}`;
  };
  /** The five steps of a car's parts as dots (the same rule as the car's parts page). */
  const dotsOf = (jobId: string) => {
    const j = jobs.get(jobId);
    if (!j) return null;
    return <PartsSteps size="dots" steps={partsSteps({ jobStatus: j.status, pricingDoneAt: j.parts_pricing_done_at, pricingReopenedAt: j.parts_pricing_reopened_at, parts: parts.filter((p) => p.job_id === jobId).map((p) => stepPartOf(p as unknown as Parameters<typeof stepPartOf>[0])) })} />;
  };
  const tone = (sinceIso: string) => {
    const min = workingMinutesSince(sinceIso, wt);
    return { min, tone: min >= target * 120 ? "red" : min >= target * 60 ? "amber" : "neutral" } as const;
  };

  const toPrice = requests.filter((r) => jobs.has(r.job_id) && r.status === "open");
  const waitingPrice = parts.filter((p) => jobs.has(p.job_id) && p.cost_aed === null && p.confirm_status !== "rejected");
  const toOrder = parts.filter((p) => jobs.has(p.job_id) && p.order_status === "to_order" && !p.po_id);
  const ordered = parts.filter((p) => jobs.has(p.job_id) && ((p.order_status === "to_order" && !!p.po_id) || p.order_status === "ordered" || p.order_status === "partly_received"));
  const toIssue = parts.filter((p) => jobs.has(p.job_id) && p.order_status === "received" && p.issue_status !== "confirmed" && p.return_status === "none");
  const byJob = (items: { job_id: string }[]) => Array.from(new Set(items.map((i) => i.job_id)));
  // All cars: every open job with any part, newest first. The search: plate, job number, VIN or customer, closed jobs included.
  const { data: partJobRows } = await admin.from("part_items").select("job_id");
  const partJobIds = Array.from(new Set((partJobRows ?? []).map((r) => r.job_id as string)));
  const { data: allRows } = partJobIds.length ? await admin.from("jobs").select(ALL_JOB_SELECT).in("id", partJobIds).eq("is_open", true).order("gated_in_at", { ascending: false }) : { data: [] as unknown[] };
  const allCars = (allRows ?? []) as unknown as AllJob[];
  let found: AllJob[] = [];
  if (q) {
    const like = `%${q.replace(/[%_,()]/g, " ").trim()}%`;
    const [{ data: vj }, { data: cj }, { data: nj }] = await Promise.all([
      admin.from("vehicles").select("id").or(`plate_number.ilike.${like},vin.ilike.${like}`).limit(60),
      admin.from("customers").select("id").or(`full_name.ilike.${like},company_name.ilike.${like}`).limit(60),
      admin.from("jobs").select("id").ilike("job_number", like).limit(60),
    ]);
    const ors = [
      (nj ?? []).length ? `id.in.(${(nj ?? []).map((j) => j.id).join(",")})` : "",
      (vj ?? []).length ? `vehicle_id.in.(${(vj ?? []).map((v) => v.id).join(",")})` : "",
      (cj ?? []).length ? `customer_id.in.(${(cj ?? []).map((c) => c.id).join(",")})` : "",
    ].filter(Boolean);
    if (ors.length) {
      const { data } = await admin.from("jobs").select(ALL_JOB_SELECT).or(ors.join(",")).order("gated_in_at", { ascending: false }).limit(40);
      found = (data ?? []) as unknown as AllJob[];
    }
  }
  const pics = await signCarPictures([...allCars, ...found].map((j) => j.vehicle?.photo_path));
  const carRow = (j: AllJob) => {
    const steps = partsSteps({ jobStatus: j.status, pricingDoneAt: j.parts_pricing_done_at, pricingReopenedAt: j.parts_pricing_reopened_at, parts: parts.filter((p) => p.job_id === j.id).map((p) => stepPartOf(p as unknown as Parameters<typeof stepPartOf>[0])) });
    const allDone = steps.every((s) => s.state === "done");
    const gone = !j.is_open;
    const car = [j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ");
    return (
      <Link key={j.id} href={`/parts/${j.id}`} className={`flex flex-wrap items-center gap-3 rounded-card border px-3 py-2 min-h-12 ${gone ? "border-line bg-chip" : allDone ? "border-green bg-green-soft" : "border-line bg-white"}`} data-all-car={j.id} data-all-done={allDone && !gone ? "1" : undefined} data-gone={gone ? "1" : undefined}>
        <CarThumb size="sm" url={j.vehicle?.photo_path ? (pics.get(j.vehicle.photo_path) ?? null) : null} alt={j.vehicle ? formatPlate(j.vehicle) : j.job_number} />
        <span className="font-extrabold uppercase">{j.vehicle ? formatPlate(j.vehicle) : "—"}</span>
        <span className="text-sm uppercase">{car}</span>
        <span className="text-sm text-muted">{j.job_number}</span>
        {j.customer ? <span className="text-sm text-muted uppercase">{j.customer.company_name ?? j.customer.full_name}</span> : null}
        <PartsSteps size="dots" steps={steps} />
        <span className={`ml-auto text-xs font-semibold ${allDone && !gone ? "text-green" : "text-muted"}`}>{gone ? `Gated out${j.gated_out_at ? ` ${formatDate(j.gated_out_at)}` : ""}` : allDone ? "All parts handed over" : (STATUS_LABELS[j.status as JobStatus] ?? j.status)}</span>
      </Link>
    );
  };

  return (
    <>
      <LiveRefresh tables={["part_requests", "part_items", "jobs"]} />
      <PageHeader title="Parts" subtitle="To price, to order, deliveries expected, received to issue." actions={<LinkButton href="/parts/no-home" tone="secondary" size="lg" data-returns-tab>Returns and leftovers{noHomeCount ? ` (${noHomeCount})` : ""}</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <WaitingPanel staff={staff} />

      <form method="get" className="flex flex-wrap items-center gap-2" data-parts-search-form>
        <Input name="q" defaultValue={q} placeholder="Find a car: plate, job number, VIN or customer (gone-out cars too)" aria-label="Find a car" className="min-w-64 flex-1" data-parts-search />
        <Button type="submit" size="md" tone="secondary">Search</Button>
        {q ? <LinkButton href="/parts" tone="ghost" size="md">Clear</LinkButton> : null}
      </form>
      {q ? (
        <section className="flex flex-col gap-2" data-search-results>
          <SectionLabel right={`${found.length}`}>Cars matching &quot;{q}&quot;</SectionLabel>
          {found.length === 0 ? <p className="text-sm text-muted">No car found. Try the plate number, the job number, the VIN or the customer&apos;s name.</p> : found.map(carRow)}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionLabel right={`${toPrice.length}`}>To price</SectionLabel>
        <p className="text-xs text-muted">What the technician asked for on the report, the moment the workshop manager approves it. One row per part: number, description, quantity, type, cost, supplier, availability. Target: {target} working hours, amber past it, red at double.</p>
        {toPrice.length === 0 ? <Empty title="No requests waiting" /> : null}
        {byJob(toPrice).map((jobId) => {
          const rows = toPrice.filter((r) => r.job_id === jobId);
          const oldest = rows.reduce((a, r) => (r.created_at < a ? r.created_at : a), rows[0].created_at);
          const t = tone(oldest);
          return (
            <Card key={jobId} className={`flex flex-col gap-2 ${t.tone === "red" ? "border-red-bar" : t.tone === "amber" ? "border-amber-bar" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2"><Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>{dotsOf(jobId)}<CopyVin vin={jobs.get(jobId)?.vehicle?.vin} /></span>
                <span className="flex items-center gap-2">
                  <Badge tone={t.tone}>{formatWait(t.min, wt)} waiting</Badge>
                  <LinkButton href={`/parts/${jobId}`} size="md">Open</LinkButton>
                </span>
              </div>
              <ul className="text-sm divide-y divide-line">
                {rows.map((r) => (
                  <li key={r.id} className="py-1.5"><span className="font-semibold">{r.label}</span>{r.requested_text ? <span className="text-muted"> · {r.requested_text}</span> : null}</li>
                ))}
              </ul>
            </Card>
          );
        })}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="flex flex-col gap-3">
          <SectionLabel right={`${waitingPrice.length}`}>Waiting for a price</SectionLabel>
          {waitingPrice.length === 0 ? <p className="text-sm text-muted">None.</p> : null}
          {byJob(waitingPrice).map((jobId) => (
            <Card key={jobId} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2"><Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>{dotsOf(jobId)}<CopyVin vin={jobs.get(jobId)?.vehicle?.vin} /></span>
              <ul className="text-sm divide-y divide-line">
                {waitingPrice.filter((p) => p.job_id === jobId).map((p) => (
                  <li key={p.id} className="py-1.5">{p.description}{p.part_number ? <span className="text-muted"> · {p.part_number}</span> : null} · × {p.confirmed_quantity ?? p.quantity}</li>
                ))}
              </ul>
            </Card>
          ))}
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <SectionLabel right={`${toOrder.length}`}>To order (approved by the customer)</SectionLabel>
        <p className="text-xs text-muted">The approved parts are on the page of the car. One button there sends the LPO for approval; after the one-tap approval, one LPO per supplier appears with Copy, PDF and Ordered.</p>
        {toOrder.length === 0 ? <p className="text-sm text-muted">Nothing to order.</p> : null}
        {byJob(toOrder).map((jobId) => {
          const items = toOrder.filter((p) => p.job_id === jobId);
          const total = items.reduce((a, p) => a + (p.cost_aed ?? 0) * (Number(p.confirmed_quantity ?? p.quantity) || 1), 0);
          const supplierSet = Array.from(new Set(items.map((p) => (p.supplier ?? "").trim()).filter(Boolean)));
          return (
            <Card key={jobId} className="flex flex-wrap items-center gap-3">
              <span className="flex flex-wrap items-center gap-2"><Link href={`/parts/${jobId}#lpo`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>{dotsOf(jobId)}<CopyVin vin={jobs.get(jobId)?.vehicle?.vin} /></span>
              <span className="text-sm text-muted">{items.length} part{items.length === 1 ? "" : "s"} · {supplierSet.length ? `${supplierSet.length} supplier${supplierSet.length === 1 ? "" : "s"}` : "no supplier yet"} · AED {total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
              <LinkButton href={`/parts/${jobId}#lpo`} size="md" className="ml-auto">Send LPO for approval</LinkButton>
            </Card>
          );
        })}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="flex flex-col gap-3">
          <SectionLabel right={`${ordered.length}`}>Deliveries expected</SectionLabel>
          {ordered.length === 0 ? <p className="text-sm text-muted">Nothing on order.</p> : null}
          {byJob(ordered).map((jobId) => (
            <Card key={jobId} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2"><Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>{dotsOf(jobId)}<CopyVin vin={jobs.get(jobId)?.vehicle?.vin} /></span>
                <LinkButton href="/parts/orders" tone="secondary" size="md">LPOs</LinkButton>
              </div>
              <ul className="text-sm divide-y divide-line">
                {ordered.filter((p) => p.job_id === jobId).map((p) => {
                  const late = !!p.expected_date && p.expected_date < today && p.order_status !== "to_order";
                  return (
                    <li key={p.id} className="py-1.5 flex flex-wrap items-center gap-2">
                      <Badge tone={late ? "red" : p.order_status === "to_order" ? "amber" : "neutral"}>{p.order_status === "to_order" ? "PO waiting for approval" : late ? "Late" : p.order_status === "partly_received" ? "Partly received" : "Ordered"}</Badge>
                      <span className="font-semibold">{p.description}</span>
                      {p.expected_date ? <span className="text-muted">expected {p.expected_date}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </section>
        <section className="flex flex-col gap-3">
          <SectionLabel right={`${toIssue.length}`}>Received, to issue</SectionLabel>
          {toIssue.length === 0 ? <p className="text-sm text-muted">Nothing waiting to be issued.</p> : null}
          {byJob(toIssue).map((jobId) => (
            <Card key={jobId} className="flex flex-col gap-1 border-ink">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2"><Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>{dotsOf(jobId)}<CopyVin vin={jobs.get(jobId)?.vehicle?.vin} /></span>
                <span className="flex gap-2"><LinkButton href={`/parts/labels/${jobId}`} tone="secondary" size="md">Labels</LinkButton><LinkButton href={`/parts/issue/${jobId}`} size="md">Issue</LinkButton></span>
              </div>
              <ul className="text-sm divide-y divide-line">
                {toIssue.filter((p) => p.job_id === jobId).map((p) => (
                  <li key={p.id} className="py-1.5 flex flex-wrap items-center gap-2"><Badge tone="green">Received</Badge><span className="font-semibold">{p.description}</span>{p.label_code ? <span className="text-muted">label {p.label_code}</span> : null}</li>
                ))}
              </ul>
            </Card>
          ))}
        </section>
      </div>

      <section className="flex flex-col gap-2" data-all-cars>
        <SectionLabel right={`${allCars.length}`}>All cars</SectionLabel>
        <p className="text-xs text-muted">Every open car with parts, newest first. A car turns green once every part is handed over and stays here until it has gone out; after that the search still finds it.</p>
        {allCars.length === 0 ? <p className="text-sm text-muted">No open car has parts yet.</p> : allCars.map(carRow)}
      </section>
    </>
  );
}
