import { CopyVin } from "@/components/CopyVin";
import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { inspectionDangerous, loadInspection } from "@/lib/inspection-data";
import { PARTS_BUCKET, PART_SELECT, REQUEST_SELECT, signPaths, toPart } from "@/lib/quote-data";
import { type PartItem, type PartRequest } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { pricingDone } from "../actions";
import { allInStock, partsPlanned, setPartPlan } from "../../jobs/planning-actions";
import { PlanPartRow, type PlanPart } from "./PlanParts";
import { PartsBar } from "./PartsBar";
import { rowComplete } from "@/lib/parts-rows";
import { PartsTable, type TableRow } from "./PartsTable";

export const dynamic = "force-dynamic";

/**
 * One job for the Parts team: the car, the job number and the VIN in the header; one table, Part · Qty · Part number
 * · Type · Cost · Supplier · Availability, where every row saves itself; "Pricing done" in the bar at the bottom.
 * Nothing from the inspection report but the parts themselves and the Dangerous flag. No customer, no technician.
 */
export default async function PartsJobPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "priceParts") || can(role, "editQuotes"))) notFound();
  const { jobId } = await params;
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const [{ data: job }, { data: reqRows }, { data: partRows }, { data: supplierRows }, { data: names }, insp] = await Promise.all([
    admin.from("jobs").select("id, job_number, status, is_open, parts_pricing_done_at, plan_parts_done_at, plan_parts_ready_date, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", jobId).maybeSingle(),
    admin.from("part_requests").select(REQUEST_SELECT).eq("job_id", jobId).eq("is_active", true).order("created_at"),
    admin.from("part_items").select(PART_SELECT + ", po_id, expected_date, received_qty, issue_status, return_status").eq("job_id", jobId).eq("is_active", true).order("created_at"),
    admin.from("suppliers").select("name").eq("is_active", true).order("name"),
    admin.from("staff").select("id, display_name").eq("is_active", true),
    loadInspection(jobId),
  ]);
  if (!job) notFound();
  type V = { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };
  const v = job.vehicle as unknown as V;
  const requests = (reqRows ?? []) as PartRequest[];
  const parts = ((partRows ?? []) as unknown as Record<string, unknown>[]).map(toPart);
  const rawById = new Map(((partRows ?? []) as unknown as Record<string, unknown>[]).map((r) => [String(r.id), r]));
  const nameOf = new Map((names ?? []).map((n) => [n.id, n.display_name]));
  const dangers = insp ? inspectionDangerous(insp) : [];
  const inPlanning = ["approved", "waiting_parts"].includes(job.status) && job.is_open;
  const types = ((settings.part_types ?? []) as string[]).map((t) => t.toLowerCase());
  const canPrice = can(role, "priceParts") && !staff.viewingAs && job.is_open;
  const urls = await signPaths(PARTS_BUCKET, parts.map((p) => p.diagram_path).filter((x): x is string => !!x));
  const suppliers = Array.from(new Set([...(supplierRows ?? []).map((s) => s.name as string), ...parts.map((p) => p.supplier).filter((x): x is string => !!x)])).sort();
  // eslint-disable-next-line react-hooks/purity -- a server page: rendered once per request, the clock is read once
  const nowMs = Date.now();
  const daysOf = (p: PartItem) => (p.delivery_date ? String(Math.max(1, Math.round((Date.parse(p.delivery_date) - nowMs) / 86400000))) : "");
  const orderLabel = (p: PartItem) => (p.order_status === "none" ? null : p.order_status === "to_order" ? "To order" : p.order_status === "ordered" ? "Ordered" : p.order_status === "partly_received" ? "Partly received" : "Received");
  const infoOf = (r: PartRequest | null) => (r ? [r.positions?.length ? r.positions.join(", ") : "", r.note ?? ""].filter(Boolean).join(" · ") || null : null);
  const rowOfPart = (p: PartItem, r: PartRequest | null): TableRow => ({
    key: p.id,
    requestId: p.part_request_id,
    partId: p.id,
    name: p.description,
    qty: Number(p.confirmed_quantity ?? p.quantity) || 1,
    info: infoOf(r),
    values: { part_number: p.part_number ?? "", part_type: p.part_type ?? "", brand: p.brand ?? "", cost_aed: p.cost_aed === null ? "" : String(p.cost_aed), supplier: p.supplier ?? "", availability: p.availability ?? "", days: daysOf(p) },
    optionGroup: p.option_group,
    unavailable: false,
    closedReason: null,
    locked: p.order_status !== "none" || String(rawById.get(p.id)?.issue_status ?? "") === "confirmed",
    orderLabel: orderLabel(p),
    diagramUrl: p.diagram_path ? (urls[p.diagram_path] ?? null) : null,
    question: p.question_text,
    answer: p.answer_text ? `${nameOf.get(p.answered_by ?? "") ?? "Manager"}: ${p.answer_text}` : null,
  });
  const rows: TableRow[] = [];
  for (const r of requests) {
    const items = parts.filter((p) => p.part_request_id === r.id);
    if (items.length) items.forEach((p) => rows.push(rowOfPart(p, r)));
    else if (r.status !== "rejected") rows.push({ key: `req:${r.id}`, requestId: r.id, partId: null, name: r.label, qty: Number(r.quantity) || 1, info: infoOf(r), values: { part_number: "", part_type: types[0] ?? "", brand: "", cost_aed: "", supplier: "", availability: "", days: "" }, optionGroup: null, unavailable: r.status === "unavailable", closedReason: r.closed_reason, locked: false, orderLabel: null, diagramUrl: null, question: null, answer: null });
  }
  for (const p of parts.filter((p) => !p.part_request_id)) rows.push(rowOfPart(p, null));
  const openCount = rows.filter((r) => !r.unavailable && !rowComplete(r.values, !!r.partId)).length;

  // Planning inside the Parts step: the approved parts, in stock or to order with the date.
  const planParts: PlanPart[] = parts.filter((p) => p.order_status !== "none" && String(rawById.get(p.id)?.return_status ?? "none") !== "returned").map((p) => {
    const raw = rawById.get(p.id) ?? {};
    return { id: p.id, description: p.description, quantity: Number(p.confirmed_quantity ?? p.quantity) || 1, availability: p.availability, delivery_date: p.delivery_date, order_status: p.order_status, expected_date: (raw.expected_date as string | null) ?? null, received: Number(raw.received_qty ?? 0) >= Number(p.confirmed_quantity ?? p.quantity), days: daysOf(p) };
  });
  const unplanned = planParts.filter((p) => !p.received && p.order_status !== "ordered" && p.order_status !== "partly_received" && (!p.availability || (p.availability === "to_order" && !p.delivery_date)));
  const car = [v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" ");

  return (
    <>
      <LiveRefresh tables={["part_requests", "part_items"]} jobId={jobId} pollMs={60000} />
      <PageHeader
        title={`Parts · ${v ? formatPlate(v) : job.job_number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{car} · {job.job_number}</span>
            {dangers.length ? <Badge tone="red">Dangerous to drive</Badge> : null}
          </span>
        }
        actions={
          <>
            <CopyVin vin={v?.vin} />
            <LinkButton href="/parts" tone="secondary" size="lg">Parts desk</LinkButton>
            {can(role, "viewJobs") ? <LinkButton href={`/jobs/${jobId}`} tone="secondary" size="lg">Job card</LinkButton> : null}
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!job.is_open ? <Notice tone="info">This job is closed.</Notice> : null}
      {inPlanning ? (
        <Card id="planning" className={`flex flex-col gap-3 ${job.plan_parts_done_at ? "border-green" : "border-ink"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <SectionLabel right={planParts.length ? `${planParts.length - unplanned.length} of ${planParts.length} decided` : undefined}>Planning: the approved parts</SectionLabel>
            {job.plan_parts_done_at ? <Badge tone="green">Parts planned{job.plan_parts_ready_date ? ` · all here by ${job.plan_parts_ready_date}` : ""}</Badge> : <Badge tone="amber">Your turn</Badge>}
          </div>
          {planParts.length === 0 ? <p className="text-sm">No parts on this job. Press Parts planned in the bar below so the workshop manager can plan the work.</p> : <p className="text-xs text-muted">For each part: In stock, or To order with the days until it arrives. Then Parts planned in the bar below.</p>}
          {canPrice ? <div className="divide-y divide-line">{planParts.map((p) => <PlanPartRow key={p.id} part={p} action={setPartPlan.bind(null, p.id)} />)}</div> : null}
        </Card>
      ) : null}

      <Card className="flex flex-col gap-2">
        <PartsTable jobId={jobId} rows={rows} suppliers={suppliers} types={types.length ? types : ["genuine", "oem", "aftermarket", "used"]} canPrice={canPrice} car={[v?.make?.name, v?.model?.name, v?.variant, v?.model_year].filter(Boolean).join(" ")} vin={v?.vin ?? null} openingLine={String(settings.supplier_quote_opening_line || "Please quote price and availability:")} />
      </Card>
      {canPrice ? <div className="h-20" /> : null}
      {canPrice ? (
        <PartsBar
          mode={inPlanning ? "planning" : "pricing"}
          openCount={openCount}
          pricingDoneAt={job.parts_pricing_done_at}
          onPricingDone={pricingDone.bind(null, jobId)}
          planning={inPlanning ? { unplanned: unplanned.length, planned: !!job.plan_parts_done_at, onAllInStock: allInStock.bind(null, jobId), onPartsPlanned: partsPlanned.bind(null, jobId) } : null}
        />
      ) : null}
    </>
  );
}
