import { CopyVin } from "@/components/CopyVin";
import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { inspectionDangerous, loadInspection } from "@/lib/inspection-data";
import { loadCatalogue } from "@/lib/parts-catalogue";
import { dubaiDate } from "@/lib/jobs";
import { valuesOfPart, valuesOfRequest } from "@/lib/parts-pricing";
import { daysFromDate, type SupplierOption } from "@/lib/parts-rows";
import { positionsWords } from "@/lib/parts-list";
import { reasonsFor } from "@/lib/reasons";
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
import { PartsTable, type TableRow } from "./PartsTable";

export const dynamic = "force-dynamic";

/**
 * One job for the Parts team: the car, the job number and the VIN in the header; one table, Part · Qty · Part
 * number · Type · List · Disc % · Net · Supplier · Availability, where every row saves itself; "Pricing done" in
 * the bar at the bottom. Nothing from the inspection report but the parts themselves and the Dangerous flag.
 */
export default async function PartsJobPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "priceParts") || can(role, "editQuotes"))) notFound();
  const { jobId } = await params;
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const [{ data: job }, { data: reqRows }, { data: partRows }, { data: supplierRows }, { data: names }, insp, catalogue] = await Promise.all([
    admin.from("jobs").select("id, job_number, status, is_open, parts_pricing_done_at, plan_parts_done_at, plan_parts_ready_date, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", jobId).maybeSingle(),
    admin.from("part_requests").select(REQUEST_SELECT + ", removed_at, removed_by, removed_reason").eq("job_id", jobId).eq("is_active", true).order("created_at"),
    // Removed parts ("not needed") stay on the list, greyed, with Put back.
    admin.from("part_items").select(PART_SELECT + ", po_id, expected_date, received_qty, issue_status, return_status").eq("job_id", jobId).or("is_active.eq.true,removed_at.not.is.null").order("created_at"),
    admin.from("suppliers").select("id, name, default_discount_percent, discount_by_type").eq("is_active", true).order("name"),
    admin.from("staff").select("id, display_name").eq("is_active", true),
    loadInspection(jobId),
    loadCatalogue(),
  ]);
  if (!job) notFound();
  type V = { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };
  const v = job.vehicle as unknown as V;
  const requests = (reqRows ?? []) as unknown as PartRequest[];
  const parts = ((partRows ?? []) as unknown as Record<string, unknown>[]).map(toPart);
  const rawById = new Map(((partRows ?? []) as unknown as Record<string, unknown>[]).map((r) => [String(r.id), r]));
  const nameOf = new Map((names ?? []).map((n) => [n.id, n.display_name]));
  const dangers = insp ? inspectionDangerous(insp) : [];
  const inPlanning = ["approved", "waiting_parts"].includes(job.status) && job.is_open;
  const types = ((settings.part_types ?? []) as string[]).map((t) => t.toLowerCase());
  const canPrice = can(role, "priceParts") && !staff.viewingAs && job.is_open;
  const urls = await signPaths(PARTS_BUCKET, parts.map((p) => p.diagram_path).filter((x): x is string => !!x));
  const suppliers: SupplierOption[] = (supplierRows ?? []).map((s) => ({ id: s.id as string, name: s.name as string, discount: Number(s.default_discount_percent) || 0, byType: (s.discount_by_type as Record<string, number> | null) ?? {} }));
  // A server page: rendered once per request, today's date (Dubai) is read once.
  const today = dubaiDate();
  const daysOf = (p: PartItem) => daysFromDate(p.delivery_date, today);
  const orderLabel = (p: PartItem) => (p.order_status === "none" ? null : p.order_status === "to_order" ? "To order" : p.order_status === "ordered" ? "Ordered" : p.order_status === "partly_received" ? "Partly received" : "Received");
  const infoOf = (r: PartRequest | null) => (r ? [r.positions?.length ? positionsWords(r.positions) : "", r.note ?? ""].filter(Boolean).join(" · ") || null : null);
  const rowOfPart = (p: PartItem, r: PartRequest | null, key: string): TableRow => ({
    key,
    requestId: p.part_request_id,
    partId: p.id,
    name: p.description,
    original: p.original_description ?? null,
    techQty: Number(p.quantity) || 1,
    info: infoOf(r),
    // The same values and state function as the server's counts (src/lib/parts-pricing.ts), so nothing can disagree.
    values: valuesOfPart(p, today),
    removed: p.removed_at ? { by: nameOf.get(p.removed_by ?? "") ?? "Parts", reason: p.removed_reason ?? "" } : null,
    waitingApproval: p.discount_approval_status === "pending",
    optionGroup: p.option_group,
    unavailable: false,
    closedReason: null,
    locked: p.order_status !== "none" || String(rawById.get(p.id)?.issue_status ?? "") === "confirmed",
    orderLabel: orderLabel(p),
    diagramUrl: p.diagram_path ? (urls[p.diagram_path] ?? null) : null,
    question: p.question_text,
    answer: p.answer_text ? `${nameOf.get(p.answered_by ?? "") ?? "Manager"}: ${p.answer_text}` : null,
    perSet: r?.unit === "set",
  });
  const rows: TableRow[] = [];
  for (const r of requests) {
    const items = parts.filter((p) => p.part_request_id === r.id);
    // The row keeps the request's key once its part exists, so the screen never redraws under someone's fingers.
    if (items.length) items.forEach((p, i) => rows.push(rowOfPart(p, r, i === 0 ? `req:${r.id}` : p.id)));
    else if (r.status !== "rejected" || r.removed_at) rows.push({ key: `req:${r.id}`, requestId: r.id, partId: null, name: r.label, original: null, techQty: Number(r.quantity) || 1, info: infoOf(r), values: valuesOfRequest(r, types[0] ?? ""), optionGroup: null, unavailable: r.status === "unavailable", closedReason: r.closed_reason, locked: false, orderLabel: null, diagramUrl: null, question: null, answer: null, perSet: r.unit === "set", removed: r.removed_at ? { by: nameOf.get(r.removed_by ?? "") ?? "Parts", reason: r.removed_reason ?? "" } : null, waitingApproval: false });
  }
  for (const p of parts.filter((p) => !p.part_request_id)) rows.push(rowOfPart(p, null, p.id));

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

      <Card className="flex flex-col gap-2 overflow-visible">
        <PartsTable jobId={jobId} rows={rows} suppliers={suppliers} types={types.length ? types : ["genuine", "oem", "aftermarket", "used"]} canPrice={canPrice} car={[v?.make?.name, v?.model?.name, v?.variant, v?.model_year].filter(Boolean).join(" ")} vin={v?.vin ?? null} openingLine={String(settings.supplier_quote_opening_line || "Please quote price and availability:")} catalogue={catalogue.map((c) => c.name)} pricingDoneAt={job.parts_pricing_done_at} onPricingDone={pricingDone.bind(null, jobId)} showBar={canPrice && !inPlanning} removeReasons={reasonsFor(settings, "remove_part")} />
      </Card>
      {canPrice ? <div className="h-20" /> : null}
      {canPrice && inPlanning ? <PartsBar planning={{ unplanned: unplanned.length, planned: !!job.plan_parts_done_at, onAllInStock: allInStock.bind(null, jobId), onPartsPlanned: partsPlanned.bind(null, jobId) }} /> : null}
    </>
  );
}
