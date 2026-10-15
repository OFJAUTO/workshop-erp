import { partsSteps, stepPartOf } from "@/lib/parts-steps";
import { CarHeaderThumb } from "@/components/CarHeaderThumb";
import Link from "next/link";
import { CopyVin } from "@/components/CopyVin";
import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { inspectionDangerous, loadInspection } from "@/lib/inspection-data";
import { loadJobLpos } from "@/lib/lpo";
import { loadCatalogue } from "@/lib/parts-catalogue";
import { dubaiDate } from "@/lib/jobs";
import { valuesOfPart, valuesOfRequest } from "@/lib/parts-pricing";
import { type SupplierOption } from "@/lib/parts-rows";
import { positionsWords } from "@/lib/parts-list";
import { reasonsFor } from "@/lib/reasons";
import { PARTS_BUCKET, PART_SELECT, REQUEST_SELECT, signPaths, toPart } from "@/lib/quote-data";
import { type PartItem, type PartRequest } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { pricingDone, reopenPricing } from "../actions";
import { markSupplierOrdered, receivePartAction, sendLpoForApproval, setPartExpectedDate } from "../lpo-actions";
import { SupplierLpoCard, type SupplierLpo } from "../SupplierLpoCard";
import { PartsSteps } from "@/components/PartsSteps";
import { PartsTable, type TableRow } from "./PartsTable";

export const dynamic = "force-dynamic";

/**
 * One job for the Parts team: the car, the job number and the VIN in the header; one table, Part · Qty · Part
 * number · Type · List · Disc % · Net · Supplier · Availability, where every row saves itself; "Pricing done" in
 * the bar at the bottom. After the customer's approval: a short summary, one "Send LPO for approval" button,
 * then one card per supplier LPO with Copy, PDF and Ordered. Nothing from the inspection report but the parts
 * themselves and the Dangerous flag.
 */
export default async function PartsJobPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "priceParts") || can(role, "editQuotes"))) notFound();
  const { jobId } = await params;
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const [{ data: job }, { data: reqRows }, { data: partRows }, { data: supplierRows }, { data: names }, insp, catalogue, { data: lastImportRow }, lpos] = await Promise.all([
    admin.from("jobs").select("id, vehicle_id, job_number, status, is_open, parts_pricing_done_at, parts_pricing_reopened_at, plan_parts_done_at, plan_parts_ready_date, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", jobId).maybeSingle(),
    admin.from("part_requests").select(REQUEST_SELECT + ", removed_at, removed_by, removed_reason").eq("job_id", jobId).eq("is_active", true).order("created_at"),
    // Removed parts ("not needed") stay on the list, greyed, with Put back.
    admin.from("part_items").select(PART_SELECT + ", po_id, expected_date, received_qty, issue_status, return_status").eq("job_id", jobId).or("is_active.eq.true,removed_at.not.is.null").order("created_at"),
    admin.from("suppliers").select("id, name, default_discount_percent, discount_by_type").eq("is_active", true).order("name"),
    admin.from("staff").select("id, display_name").eq("is_active", true),
    loadInspection(jobId),
    loadCatalogue(),
    // The last price import still in force, for "Undo last import".
    admin.from("price_imports").select("id, applied_count, created_at").eq("job_id", jobId).is("undone_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    loadJobLpos(jobId),
  ]);
  if (!job) notFound();
  const lastImport = lastImportRow ? { id: lastImportRow.id as string, count: Number(lastImportRow.applied_count) || 0, at: lastImportRow.created_at as string } : null;
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
  const canOrder = can(role, "managePurchaseOrders") && !staff.viewingAs && job.is_open;
  const urls = await signPaths(PARTS_BUCKET, parts.map((p) => p.diagram_path).filter((x): x is string => !!x));
  const suppliers: SupplierOption[] = (supplierRows ?? []).map((s) => ({ id: s.id as string, name: s.name as string, discount: Number(s.default_discount_percent) || 0, byType: (s.discount_by_type as Record<string, number> | null) ?? {} }));
  // A server page: rendered once per request, today's date (Dubai) is read once.
  const today = dubaiDate();
  const orderLabel = (p: PartItem) => (p.order_status === "none" ? null : p.order_status === "to_order" ? "To order" : p.order_status === "ordered" ? "Ordered" : p.order_status === "partly_received" ? "Partly received" : "Received");
  // The request's positions and note; a part added by Parts (no request) shows its own positions.
  const infoOf = (r: PartRequest | null, p?: PartItem) => [r ? [r.positions?.length ? positionsWords(r.positions) : "", r.note ?? ""].filter(Boolean).join(" · ") : p ? [p.positions?.length ? positionsWords(p.positions) : "", "Added by Parts"].filter(Boolean).join(" · ") : "", p?.availability_note ?? ""].filter(Boolean).join(" · ") || null;
  const rowOfPart = (p: PartItem, r: PartRequest | null, key: string): TableRow => ({
    key,
    requestId: p.part_request_id,
    partId: p.id,
    name: p.description,
    original: p.original_description ?? null,
    techQty: Number(p.quantity) || 1,
    info: infoOf(r, p),
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

  // After the customer's approval: the approved parts, the one main LPO and its supplier LPOs.
  const approvedParts = parts.filter((p) => p.order_status !== "none" && String(rawById.get(p.id)?.return_status ?? "none") !== "returned");
  const hasApproved = approvedParts.length > 0 || lpos.suppliers.length > 0 || !!lpos.main;
  const pendingMain = lpos.main && lpos.main.status === "pending_approval" ? lpos.main : null;
  const supplierNames = Array.from(new Set(lpos.toOrder.map((p) => (p.supplier ?? "").trim()).filter(Boolean)));
  const toOrderTotal = lpos.toOrder.reduce((a, p) => a + (p.cost_aed ?? 0) * (Number(p.confirmed_quantity ?? p.quantity) || 1), 0);
  const summaryText = [
    `${approvedParts.length} part${approvedParts.length === 1 ? "" : "s"} approved`,
    lpos.toOrder.length ? `${lpos.toOrder.length} to order${supplierNames.length ? ` from ${supplierNames.length === 1 ? supplierNames[0] : `${supplierNames.length} suppliers (${supplierNames.join(", ")})`}` : ""}, AED ${toOrderTotal.toLocaleString("en-GB", { minimumFractionDigits: 2 })} before VAT` : "",
    lpos.fromStock.length ? `${lpos.fromStock.length} from our stock` : "",
    lpos.suppliers.length ? `${lpos.suppliers.length} supplier LPO${lpos.suppliers.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");
  const toView = (s: { po: { id: string; number: string; supplier_name: string; status: string; ordered_at: string | null; verify_token: string | null; total_cost_aed: number }; lines: { id: string; part_item_id: string; description: string; part_number: string | null; quantity: number; unit_cost: number; expected_date: string | null; received_qty: number }[] }): SupplierLpo => ({ id: s.po.id, number: s.po.number, supplier_name: s.po.supplier_name, status: s.po.status, ordered_at: s.po.ordered_at, verify_token: s.po.verify_token, total_cost_aed: s.po.total_cost_aed, lines: s.lines.map((l) => ({ id: l.id, part_item_id: l.part_item_id, description: l.description, part_number: l.part_number, quantity: l.quantity, unit_cost: l.unit_cost, expected_date: l.expected_date, received_qty: l.received_qty })) });
  const car = [v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" ");
  // Pricing done locks the rows until Edit; after the customer's approval the ordered rows are locked on their own.
  const pricingLocked = !inPlanning && !!job.parts_pricing_done_at && !job.parts_pricing_reopened_at;
  // The five steps across the top (one rule with the parts desk and the job card), and the parts still to receive.
  const stepParts = parts.map((p) => stepPartOf({ ...p, received_qty: Number(rawById.get(p.id)?.received_qty) || 0, issue_status: String(rawById.get(p.id)?.issue_status ?? "") || null, po_id: (rawById.get(p.id)?.po_id as string | null) ?? null, return_status: String(rawById.get(p.id)?.return_status ?? "none") }));
  const steps = partsSteps({ jobStatus: job.status, pricingDoneAt: job.parts_pricing_done_at, pricingReopenedAt: job.parts_pricing_reopened_at, parts: stepParts.map((sp, i) => ({ ...sp, from_stock: sp.from_stock || lpos.fromStock.some((f) => f.id === parts[i].id) })), mainLpoStatus: lpos.main?.status ?? null, toOrder: lpos.toOrder.length });
  const toReceive = parts.filter((p) => ["ordered", "partly_received"].includes(String(p.order_status)));

  return (
    <>
      <LiveRefresh tables={["part_requests", "part_items", "purchase_orders"]} jobId={jobId} pollMs={60000} />
      <PageHeader
        picture={<CarHeaderThumb vehicleId={job.vehicle_id} />}
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
      <PartsSteps steps={steps} hrefs={{ pricing: "#pricing", approval: "#lpo", lpo: "#lpos", received: "#received", handover: `/parts/handover/${jobId}` }} />

      {hasApproved ? (
        <Card id="lpo" className={`flex flex-col gap-3 ${lpos.toOrder.length && !pendingMain && canOrder ? "border-ink" : ""}`} data-lpo-card>
          <div className="flex flex-wrap items-center gap-2">
            <SectionLabel>Approved parts</SectionLabel>
            {pendingMain ? <Badge tone="amber">{pendingMain.number} waiting for approval</Badge> : null}
            {job.plan_parts_done_at && !pendingMain && !lpos.toOrder.length && !lpos.suppliers.some((s) => s.po.status === "approved") ? <Badge tone="green">{job.plan_parts_ready_date && job.plan_parts_ready_date > today ? `All parts here by ${formatDate(job.plan_parts_ready_date)}` : "Every part is here"}</Badge> : null}
          </div>
          <p className="text-sm" data-lpo-summary>{summaryText}</p>
          {lpos.toOrder.length && !pendingMain ? (
            canOrder ? (
              <form action={sendLpoForApproval.bind(null, jobId)}>
                <Button type="submit" size="lg" data-send-lpo>Send LPO for approval</Button>
              </form>
            ) : <p className="text-xs text-muted">Parts send the LPO for approval.</p>
          ) : null}
          {pendingMain ? (
            <p className="text-xs text-muted">
              The owner or the head accountant approves it with one tap. <Link href={`/parts/orders/${pendingMain.id}`} className="font-semibold underline underline-offset-4">Open {pendingMain.number}</Link>
            </p>
          ) : null}
        </Card>
      ) : null}

      {lpos.suppliers.length ? (
        <section id="lpos" className="flex flex-col gap-3" data-supplier-lpos>
          <SectionLabel right={`${lpos.suppliers.length}`}>Supplier LPOs</SectionLabel>
          {lpos.suppliers.map((s) => (
            <SupplierLpoCard key={s.po.id} po={toView(s)} vin={v?.vin ?? null} canManage={canOrder} onOrdered={markSupplierOrdered.bind(null, s.po.id)} onSetDate={setPartExpectedDate} />
          ))}
        </section>
      ) : null}

      {toReceive.length ? (
        <Card id="received" className="flex flex-col gap-2" data-received-card>
          <SectionLabel right={steps.find((s) => s.key === "received")?.detail ?? undefined}>Parts received</SectionLabel>
          <p className="text-xs text-muted">Tick each part as it arrives from the supplier. A partial delivery, a wrong or a damaged part: use the LPO page.</p>
          <ul className="divide-y divide-line text-sm">
            {toReceive.map((p) => (
              <li key={p.id} className="py-1.5 flex items-center gap-2" data-receive-row={p.id}>
                <span className="flex-1 min-w-0 font-semibold">{p.description}<span className="font-normal text-muted"> · × {Number(p.confirmed_quantity ?? p.quantity) || 1}{p.supplier ? ` · ${p.supplier}` : ""}{orderLabel(p) ? ` · ${orderLabel(p)}` : ""}</span></span>
                {canOrder ? <form action={receivePartAction.bind(null, jobId, p.id)}><Button type="submit" tone="secondary" size="md" data-receive-part={p.id}>Received</Button></form> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card id="pricing" className="flex flex-col gap-2 overflow-visible">
        <PartsTable jobId={jobId} rows={rows} suppliers={suppliers} types={types.length ? types : ["genuine", "oem", "aftermarket", "used"]} canPrice={canPrice} car={[v?.make?.name, v?.model?.name, v?.variant, v?.model_year].filter(Boolean).join(" ")} vin={v?.vin ?? null} openingLine={String(settings.supplier_quote_opening_line || "Please quote price and availability:")} catalogue={catalogue} lastImport={lastImport} pricingDoneAt={job.parts_pricing_done_at} onPricingDone={pricingDone.bind(null, jobId)} showBar={canPrice && !inPlanning} removeReasons={reasonsFor(settings, "remove_part")} pricingLocked={pricingLocked} onReopen={reopenPricing.bind(null, jobId)} reopenedAt={job.parts_pricing_reopened_at} />
      </Card>
      {canPrice && !inPlanning ? <div className="h-20" /> : null}
    </>
  );
}
