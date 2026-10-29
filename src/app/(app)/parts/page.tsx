import { formatDate } from "@/lib/format";
import { seesCustomers } from "@/lib/customer-data";
import { partsWithNoHome } from "@/lib/handover";
import { CarThumb } from "@/components/CarThumb";
import { signCarPictures } from "@/lib/car-pictures";
import { partsSteps, stepPartOf } from "@/lib/parts-steps";
import { CopyVin } from "@/components/CopyVin";
import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Button, Input,Badge, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { STATUS_LABELS, type JobStatus,formatWait, workingMinutesSince, workingTimeOf } from "@/lib/jobs";
import { REQUEST_SELECT } from "@/lib/quote-data";
import { PART_FULL_SELECT, PO_LINE_SELECT, PO_SELECT, toPartFull, toPo, toPoLine } from "@/lib/parts-data";
import { SupplierLpoCard } from "./SupplierLpoCard";
import { emailSupplierLpo, markSupplierOrdered, setPartExpectedDate } from "./lpo-actions";
import { gmailConfigured } from "@/lib/gmail";
import { formatDayTime } from "@/lib/format";
import { type PartRequest } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { chargesByPo } from "@/lib/supplier-charges";
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
  // Customers are for the owner, advisors and accounts only (29 October 2026): Parts find a car by plate, job number or VIN.
  const seesCust = seesCustomers(staff.role_id);
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
  // ORDER NOW: every approved supplier or stock LPO as a big card with its own clock.
  const amberMin = Number(settings.order_now_amber_minutes) || 30;
  const redMin = Number(settings.order_now_red_minutes) || 60;
  const [{ data: onRaw }, { data: pendRaw }] = await Promise.all([
    admin.from("purchase_orders").select(PO_SELECT).eq("is_active", true).eq("status", "approved").in("kind", ["supplier", "stock"]).order("approved_at"),
    admin.from("purchase_orders").select(PO_SELECT).eq("is_active", true).eq("status", "pending_approval").order("created_at"),
  ]);
  const orderNowPos = ((onRaw ?? []) as Record<string, unknown>[]).map(toPo);
  const pendingPos = ((pendRaw ?? []) as Record<string, unknown>[]).map(toPo);
  const onIds = orderNowPos.map((p) => p.id);
  const { data: onLineRows } = onIds.length ? await admin.from("purchase_order_lines").select(PO_LINE_SELECT).in("po_id", onIds).eq("is_active", true).order("position") : { data: [] };
  const onLines = new Map<string, ReturnType<typeof toPoLine>[]>();
  for (const r of (onLineRows ?? []) as Record<string, unknown>[]) {
    const l = toPoLine(r);
    onLines.set(l.po_id, [...(onLines.get(l.po_id) ?? []), l]);
  }
  const onCharges = await chargesByPo(onIds);
  const approverIds = Array.from(new Set(orderNowPos.map((p) => p.approved_by).filter((x): x is string => !!x)));
  const { data: approverRows } = approverIds.length ? await admin.from("staff").select("id, display_name").in("id", approverIds) : { data: [] as { id: string; display_name: string }[] };
  const approverName = new Map((approverRows ?? []).map((x) => [x.id, x.display_name]));
  const supplierIds = Array.from(new Set(orderNowPos.map((p) => p.supplier_id).filter((x): x is string => !!x)));
  const { data: supplierRows } = supplierIds.length ? await admin.from("suppliers").select("id, email").in("id", supplierIds) : { data: [] as { id: string; email: string | null }[] };
  const supplierEmail = new Map((supplierRows ?? []).map((x) => [x.id, x.email]));
  // Extra job lines for LPO jobs the request/part lists may not carry.
  const extraJobIds = [...orderNowPos, ...pendingPos].map((p) => p.job_id).filter((x): x is string => !!x && !jobs.has(x));
  if (extraJobIds.length) {
    const { data: extraJobs } = await admin.from("jobs").select("id, job_number, is_open, status, parts_pricing_done_at, parts_pricing_reopened_at, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), assignee:staff!jobs_assigned_to_fkey(display_name)").in("id", Array.from(new Set(extraJobIds)));
    for (const j of ((extraJobs ?? []) as unknown as JobInfo[]).filter((j) => j.is_open)) jobs.set(j.id, j);
  }

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
  // Deliveries expected = genuinely ordered. A part on a pending LPO sits under Waiting for owner approval; on an approved one it is ORDER NOW.
  const ordered = parts.filter((p) => jobs.has(p.job_id) && (p.order_status === "ordered" || p.order_status === "partly_received"));
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
      seesCust ? admin.from("customers").select("id").or(`full_name.ilike.${like},company_name.ilike.${like}`).limit(60) : Promise.resolve({ data: [] as { id: string }[] }),
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
        {seesCust && j.customer ? <span className="text-sm text-muted uppercase">{j.customer.company_name ?? j.customer.full_name}</span> : null}
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
        <Input name="q" defaultValue={q} placeholder={seesCust ? "Find a car: plate, job number, VIN or customer (gone-out cars too)" : "Find a car: plate, job number or VIN (gone-out cars too)"} aria-label="Find a car" className="min-w-64 flex-1" data-parts-search />
        <Button type="submit" size="md" tone="secondary">Search</Button>
        {q ? <LinkButton href="/parts" tone="ghost" size="md">Clear</LinkButton> : null}
      </form>
      {q ? (
        <section className="flex flex-col gap-2" data-search-results>
          <SectionLabel right={`${found.length}`}>Cars matching &quot;{q}&quot;</SectionLabel>
          {found.length === 0 ? <p className="text-sm text-muted">No car found. Try the plate number, the job number, the VIN or the customer&apos;s name.</p> : found.map(carRow)}
        </section>
      ) : null}

      {orderNowPos.length ? (
        <section className="flex flex-col gap-3" data-order-now-section>
          <SectionLabel right={`${orderNowPos.length}`}>Order now <span className="cursor-help font-normal text-muted" title={`Approved: send each supplier LPO (Copy, PDF or Email) and press Ordered. Amber past ${amberMin} working minutes, red past ${redMin} - the owner is told once.`}>ⓘ</span></SectionLabel>
          {orderNowPos.map((po) => {
            const lines = onLines.get(po.id) ?? [];
            const j = po.job_id ? jobs.get(po.job_id) : undefined;
            const mins = po.approved_at ? workingMinutesSince(po.approved_at, wt) : 0;
            const toneCls = mins >= redMin ? "!border-red-bar" : mins >= amberMin ? "!border-amber-bar" : "border-ink";
            return (
              <Card key={po.id} className={`flex flex-col gap-2 border-2 ${toneCls}`} data-order-now={po.number} data-order-tone={mins >= redMin ? "red" : mins >= amberMin ? "amber" : "fresh"}>
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`text-base font-extrabold ${mins >= redMin ? "text-red" : ""}`}>ORDER NOW</span>
                  {j ? <span className="font-bold uppercase">{j.vehicle ? formatPlate(j.vehicle) : j.job_number}</span> : <span className="font-bold">Stock order</span>}
                  {j ? <span className="uppercase">{[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")}</span> : null}
                  <span className="text-muted">· {po.supplier_name} · {lines.length} part{lines.length === 1 ? "" : "s"} · AED {po.total_cost_aed.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
                  <span className={`ml-auto text-xs font-bold ${mins >= redMin ? "text-red" : mins >= amberMin ? "text-amber-bar" : "text-muted"}`} data-order-wait>Approved{po.approved_by ? ` by ${approverName.get(po.approved_by) ?? ""}` : ""}{po.approved_at ? ` ${formatDayTime(po.approved_at)}` : ""} · waiting {formatWait(mins, wt)}</span>
                </span>
                <SupplierLpoCard po={{ id: po.id, number: po.number, supplier_name: po.supplier_name, status: po.status, ordered_at: po.ordered_at, verify_token: po.verify_token, sent_at: po.sent_at, emailed_at: po.emailed_at, emailed_to: po.emailed_to, total_cost_aed: po.total_cost_aed, lines: lines.map((l) => ({ id: l.id, part_item_id: l.part_item_id, description: l.description, positions: parts.find((x) => x.id === l.part_item_id)?.positions ?? null, part_number: l.part_number, quantity: l.quantity, unit_cost: l.unit_cost, expected_date: l.expected_date, received_qty: l.received_qty })), charges: onCharges.get(po.id) ?? [] }} vin={j?.vehicle?.vin ?? null} canManage={!staff.viewingAs} onOrdered={markSupplierOrdered.bind(null, po.id)} onSetDate={setPartExpectedDate} supplierEmail={po.supplier_id ? (supplierEmail.get(po.supplier_id) ?? null) : null} emailReady={gmailConfigured()} onEmail={emailSupplierLpo.bind(null, po.id)} jobId={po.job_id} />
              </Card>
            );
          })}
        </section>
      ) : null}

      {toPrice.length || waitingPrice.length ? (
      <section className="flex flex-col gap-3">
        <SectionLabel right={`${toPrice.length + waitingPrice.length}`}>To price <span className="cursor-help font-normal text-muted" title={`What the technician asked for on the approved report. Target: ${target} working hours, amber past it, red at double.`}>ⓘ</span></SectionLabel>
        {byJob(toPrice).map((jobId) => {
          const rows = toPrice.filter((r) => r.job_id === jobId);
          const oldest = rows.map((r) => r.created_at).sort()[0];
          const t = tone(oldest);
          return (
            <Card key={jobId} className={`flex flex-col gap-1 ${t.tone === "red" ? "!border-red-bar" : t.tone === "amber" ? "!border-amber-bar" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2"><Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>{dotsOf(jobId)}<CopyVin vin={jobs.get(jobId)?.vehicle?.vin} /></span>
                <span className="flex items-center gap-2"><Badge tone={t.tone === "neutral" ? "outline" : t.tone}>waiting {formatWait(t.min, wt)}</Badge><LinkButton href={`/parts/${jobId}`} size="md">Price the parts</LinkButton></span>
              </div>
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-muted">{rows.length} request{rows.length === 1 ? "" : "s"}</summary>
                <ul className="text-sm divide-y divide-line">
                  {rows.map((r) => (
                    <li key={r.id} className="py-1.5"><span className="font-semibold">{r.label}</span>{r.requested_text ? <span className="text-muted"> · {r.requested_text}</span> : null}</li>
                  ))}
                </ul>
              </details>
            </Card>
          );
        })}
        {waitingPrice.length ? (
          <details className="rounded-card border border-line bg-white px-4 py-2">
            <summary className="min-h-10 cursor-pointer text-sm font-bold">Waiting for a price · {waitingPrice.length}</summary>
            {byJob(waitingPrice).map((jobId) => (
              <div key={jobId} className="flex flex-col gap-1 border-t border-line py-2">
                <span className="flex flex-wrap items-center gap-2"><Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>{dotsOf(jobId)}</span>
                <ul className="text-sm divide-y divide-line">
                  {waitingPrice.filter((p) => p.job_id === jobId).map((p) => (
                    <li key={p.id} className="py-1.5">{p.description}{p.part_number ? <span className="text-muted"> · {p.part_number}</span> : null} · × {p.confirmed_quantity ?? p.quantity}</li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        ) : null}
      </section>
      ) : null}

      {toOrder.length ? (
      <section className="flex flex-col gap-3">
        <SectionLabel right={`${toOrder.length}`}>Send LPO for approval <span className="cursor-help font-normal text-muted" title="The customer approved these parts. One button on the car's page sends the LPO; the owner or accounts approve it with one tap.">ⓘ</span></SectionLabel>
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
      ) : null}

      {pendingPos.length ? (
        <section className="flex flex-col gap-3" data-pending-approval-section>
          <SectionLabel right={`${pendingPos.length}`}>Waiting for owner approval <span className="cursor-help font-normal text-muted" title="Sent for approval; the owner or the head accountant approve with one tap on the LPO page.">ⓘ</span></SectionLabel>
          {pendingPos.map((po) => {
            const j = po.job_id ? jobs.get(po.job_id) : undefined;
            return (
              <Card key={po.id} className="flex flex-wrap items-center gap-3">
                <span className="font-extrabold">{po.number}</span>
                {j ? <span className="uppercase">{j.vehicle ? formatPlate(j.vehicle) : j.job_number}</span> : <span>Stock order</span>}
                <span className="text-sm text-muted">{po.kind === "main" ? "every supplier" : po.supplier_name} · AED {po.total_cost_aed.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
                <LinkButton href={`/parts/orders/${po.id}`} size="md" tone="secondary" className="ml-auto">Open the LPO</LinkButton>
              </Card>
            );
          })}
        </section>
      ) : null}

      {ordered.length ? (
        <section className="flex flex-col gap-3" data-deliveries-section>
          <SectionLabel right={`${ordered.length}`}>Deliveries expected <span className="cursor-help font-normal text-muted" title="Grouped per supplier with the expected dates; anything past its date shows red. Receiving is on each LPO.">ⓘ</span></SectionLabel>
          {Array.from(new Set(ordered.map((p) => (p.supplier ?? "").trim() || "No supplier"))).sort().map((sup) => {
            const items = ordered.filter((p) => ((p.supplier ?? "").trim() || "No supplier") === sup);
            const overdue = items.filter((p) => !!p.expected_date && p.expected_date < today);
            const nextDate = items.map((p) => p.expected_date).filter(Boolean).sort()[0] ?? null;
            return (
              <details key={sup} className={`rounded-card border bg-white px-4 py-2 ${overdue.length ? "border-red-bar" : "border-line"}`} data-supplier-group={sup}>
                <summary className="min-h-11 cursor-pointer flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-extrabold">{sup}</span>
                  <span className="text-muted">{items.length} part{items.length === 1 ? "" : "s"}</span>
                  {overdue.length ? <Badge tone="red">{overdue.length} overdue</Badge> : nextDate ? <Badge tone="neutral">next {formatDate(nextDate)}</Badge> : null}
                </summary>
                <ul className="text-sm divide-y divide-line">
                  {items.map((p) => {
                    const late = !!p.expected_date && p.expected_date < today;
                    return (
                      <li key={p.id} className="py-1.5 flex flex-wrap items-center gap-2">
                        <Link href={`/parts/${p.job_id}#received`} className="font-semibold hover:underline underline-offset-4">{jobs.get(p.job_id)?.vehicle ? formatPlate(jobs.get(p.job_id)!.vehicle!) : jobs.get(p.job_id)?.job_number}</Link>
                        <span>{p.description}</span>
                        <span className="text-muted">× {p.confirmed_quantity ?? p.quantity}</span>
                        <Badge tone={late ? "red" : p.order_status === "partly_received" ? "amber" : "neutral"}>{late ? `Late · expected ${formatDate(p.expected_date!)}` : p.order_status === "partly_received" ? "Partly received" : p.expected_date ? `expected ${formatDate(p.expected_date)}` : "no date"}</Badge>
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </section>
      ) : null}

      {toIssue.length ? (
        <section className="flex flex-col gap-3" data-handover-section>
          <SectionLabel right={`${toIssue.length}`}>Received, to hand over <span className="cursor-help font-normal text-muted" title="At the desk: mark them ready; the technician receives them on his tablet with his PIN.">ⓘ</span></SectionLabel>
          {byJob(toIssue).map((jobId) => (
            <Card key={jobId} className="flex flex-wrap items-center gap-3">
              <span className="flex flex-wrap items-center gap-2"><Link href={`/parts/handover/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>{dotsOf(jobId)}</span>
              <span className="text-sm text-muted">{toIssue.filter((p) => p.job_id === jobId).length} part{toIssue.filter((p) => p.job_id === jobId).length === 1 ? "" : "s"} ready</span>
              <LinkButton href={`/parts/handover/${jobId}`} size="md" className="ml-auto">Hand over</LinkButton>
            </Card>
          ))}
        </section>
      ) : null}

      <details data-all-cars-fold>
        <summary className="min-h-11 cursor-pointer text-sm font-extrabold uppercase tracking-[0.08em]" data-all-cars-summary>All cars ({allCars.length})</summary>
        <section className="flex flex-col gap-2 pt-2" data-all-cars>
          {allCars.length === 0 ? <p className="text-sm text-muted">No open car has parts yet.</p> : allCars.map(carRow)}
        </section>
      </details>
    </>
  );
}
