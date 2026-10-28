import { VinCopy } from "@/components/VinCopy";
import { ReceivePanel } from "./ReceivePanel";
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
import { jobCharges } from "@/lib/supplier-charges";
import { SupplierChargesStrip } from "./SupplierChargesStrip";
import { loadCatalogue } from "@/lib/parts-catalogue";
import { dubaiDate } from "@/lib/jobs";
import { valuesOfPart, valuesOfRequest } from "@/lib/parts-pricing";
import { type SupplierOption } from "@/lib/parts-rows";
import { reasonsFor } from "@/lib/reasons";
import { PARTS_BUCKET, PART_SELECT, REQUEST_SELECT, signPaths, toPart } from "@/lib/quote-data";
import { type PartItem, type PartRequest } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { pricingDone, reopenPricing } from "../actions";
import { emailSupplierLpo, markSupplierOrdered, receiveTicked, sendLpoForApproval, setPartExpectedDate } from "../lpo-actions";
import { gmailConfigured } from "@/lib/gmail";
import { SupplierLpoCard, type SupplierLpo } from "../SupplierLpoCard";
import { PartsSteps } from "@/components/PartsSteps";
import { depositState, depositShortText } from "@/lib/deposits";
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
    admin.from("jobs").select("id, vehicle_id, job_number, status, is_open, parts_pricing_done_at, parts_pricing_reopened_at, plan_parts_done_at, plan_parts_ready_date, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, tyre_size_front, tyre_size_rear, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", jobId).maybeSingle(),
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
  const charges = await jobCharges(jobId);
  const poNumber = new Map<string, string>([...(lpos.main ? [[lpos.main.id, lpos.main.number] as [string, string]] : []), ...lpos.suppliers.map((s) => [s.po.id, s.po.number] as [string, string])]);
  const chargeRows = charges.map((c) => ({ id: c.id, description: c.description, supplier: c.supplier_name, amount: c.amount_aed, lpo: c.po_id ? poNumber.get(c.po_id) ?? "an LPO" : null }));
  const lastImport = lastImportRow ? { id: lastImportRow.id as string, count: Number(lastImportRow.applied_count) || 0, at: lastImportRow.created_at as string } : null;
  type V = { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; tyre_size_front?: string | null; tyre_size_rear?: string | null; make: { name: string } | null; model: { name: string } | null };
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
  // The request's note (the positions have their own line under the name); a part added by Parts says so.
  const infoOf = (r: PartRequest | null, p?: PartItem) => [r ? (r.note ?? "") : p ? "Added by Parts" : "", p?.availability_note ?? ""].filter(Boolean).join(" · ") || null;
  const rowOfPart = (p: PartItem, r: PartRequest | null, key: string): TableRow => ({
    key,
    requestId: p.part_request_id,
    partId: p.id,
    name: p.description,
    original: p.original_description ?? null,
    techQty: Number(p.quantity) || 1,
    info: infoOf(r, p),
    shownPositions: p.positions?.length ? p.positions : (r?.positions ?? null),
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
    else if (r.status !== "rejected" || r.removed_at) rows.push({ key: `req:${r.id}`, requestId: r.id, partId: null, name: r.label, original: null, techQty: Number(r.quantity) || 1, info: infoOf(r), shownPositions: r.positions ?? null, values: valuesOfRequest(r, types[0] ?? ""), optionGroup: null, unavailable: r.status === "unavailable", closedReason: r.closed_reason, locked: false, orderLabel: null, diagramUrl: null, question: null, answer: null, perSet: r.unit === "set", removed: r.removed_at ? { by: nameOf.get(r.removed_by ?? "") ?? "Parts", reason: r.removed_reason ?? "" } : null, waitingApproval: false });
  }
  for (const p of parts.filter((p) => !p.part_request_id)) rows.push(rowOfPart(p, null, p.id));

  // After the customer's approval: the approved parts, the one main LPO and its supplier LPOs.
  const approvedParts = parts.filter((p) => p.order_status !== "none" && String(rawById.get(p.id)?.return_status ?? "none") !== "returned");
  // Received and still with Parts: their labels are printed before the handover.
  const labelsToPrint = parts.filter((p) => (p.order_status === "received" || p.order_status === "partly_received") && String(rawById.get(p.id)?.issue_status ?? "none") !== "confirmed" && String(rawById.get(p.id)?.return_status ?? "none") === "none" && !rawById.get(p.id)?.not_needed_at);
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
  const supplierEmailOf = new Map<string, string | null>(((lpos.suppliers).length ? (await admin.from("suppliers").select("id, email").in("id", (lpos.suppliers).map((s) => s.po.supplier_id).filter((x): x is string => !!x))).data ?? [] : []).map((s) => [s.id as string, (s.email as string | null) ?? null]));
  const toView = (s: { po: { id: string; number: string; supplier_name: string; status: string; ordered_at: string | null; verify_token: string | null; total_cost_aed: number; sent_at?: string | null; emailed_at?: string | null; emailed_to?: string | null }; lines: { id: string; part_item_id: string; description: string; part_number: string | null; quantity: number; unit_cost: number; expected_date: string | null; received_qty: number }[]; charges?: { id: string; description: string; amount_aed: number }[] }): SupplierLpo => ({ id: s.po.id, number: s.po.number, sent_at: s.po.sent_at ?? null, emailed_at: s.po.emailed_at ?? null, emailed_to: s.po.emailed_to ?? null, supplier_name: s.po.supplier_name, status: s.po.status, ordered_at: s.po.ordered_at, verify_token: s.po.verify_token, total_cost_aed: s.po.total_cost_aed, lines: s.lines.map((l) => ({ id: l.id, part_item_id: l.part_item_id, description: l.description, positions: (rawById.get(l.part_item_id)?.positions as string[] | null | undefined) ?? null, part_number: l.part_number, quantity: l.quantity, unit_cost: l.unit_cost, expected_date: l.expected_date, received_qty: l.received_qty })), charges: s.charges ?? [] });
  const car = [v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" ");
  // Pricing done locks the rows until Edit; after the customer's approval the ordered rows are locked on their own.
  const pricingLocked = !inPlanning && !!job.parts_pricing_done_at && !job.parts_pricing_reopened_at;
  // The five steps across the top (one rule with the parts desk and the job card), and the parts still to receive.
  const stepParts = parts.map((p) => stepPartOf({ ...p, received_qty: Number(rawById.get(p.id)?.received_qty) || 0, issue_status: String(rawById.get(p.id)?.issue_status ?? "") || null, po_id: (rawById.get(p.id)?.po_id as string | null) ?? null, return_status: String(rawById.get(p.id)?.return_status ?? "none") }));
  const steps = partsSteps({ jobStatus: job.status, pricingDoneAt: job.parts_pricing_done_at, pricingReopenedAt: job.parts_pricing_reopened_at, parts: stepParts.map((sp, i) => ({ ...sp, from_stock: sp.from_stock || lpos.fromStock.some((f) => f.id === parts[i].id) })), mainLpoStatus: lpos.main?.status ?? null, toOrder: lpos.toOrder.length });
  const dep = await depositState(jobId);
  const toReceive = parts.filter((p) => ["ordered", "partly_received"].includes(String(p.order_status)));
  const receivedParts = parts.filter((p) => String(p.order_status) === "received");

  return (
    <>
      <LiveRefresh tables={["part_requests", "part_items", "purchase_orders"]} jobId={jobId} />
      <PageHeader
        picture={<CarHeaderThumb vehicleId={job.vehicle_id} />}
        title={`Parts · ${v ? formatPlate(v) : job.job_number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{car} · {job.job_number}</span>
            <VinCopy vin={v?.vin ?? null} />
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
      {dep.short ? <div data-deposit-wait><Notice tone="info">Waiting for the deposit: {depositShortText(dep)} Accounts record it; the owner can approve the LPO without it.</Notice></div> : null}
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
          <SectionLabel right={lpos.suppliers.every((s) => !["approved", "pending_approval"].includes(s.po.status)) ? <span className="font-bold text-green" data-all-ordered>All ordered ✓</span> : `${lpos.suppliers.length}`}>Supplier LPOs</SectionLabel>
          {lpos.suppliers.map((s) => (
            <SupplierLpoCard key={s.po.id} po={toView(s)} vin={v?.vin ?? null} canManage={canOrder} onOrdered={markSupplierOrdered.bind(null, s.po.id)} onSetDate={setPartExpectedDate} supplierEmail={supplierEmailOf.get(s.po.supplier_id ?? "") ?? null} emailReady={gmailConfigured()} onEmail={emailSupplierLpo.bind(null, s.po.id)} jobId={jobId} />
          ))}
        </section>
      ) : null}

      {labelsToPrint.length ? (
        <Card className="flex flex-wrap items-center gap-3 border-ink" data-labels-prompt>
          <span className="text-sm font-semibold">{labelsToPrint.length} part{labelsToPrint.length === 1 ? " is" : "s are"} here: print the label{labelsToPrint.length === 1 ? "" : "s"} before the handover.</span>
          <LinkButton href={`/parts/labels/${jobId}`} size="lg" className="ml-auto">Print labels ({labelsToPrint.length})</LinkButton>
        </Card>
      ) : null}
      {toReceive.length || receivedParts.length ? (
        <Card id="received" className="flex flex-col gap-2" data-received-card>
          <SectionLabel right={steps.find((s) => s.key === "received")?.detail ?? undefined}>Parts received</SectionLabel>
          {toReceive.length ? <p className="text-xs text-muted">Tick what arrived, press Mark received, choose the stickers and type the supplier invoice. A wrong or damaged part: use the LPO page.</p> : null}
          <ReceivePanel jobId={jobId} canAct={!!canOrder} action={receiveTicked.bind(null, jobId)} rows={toReceive.map((p) => ({ id: p.id, description: p.description, positions: p.positions ?? null, qty: Number(p.confirmed_quantity ?? p.quantity) || 1, supplier: p.supplier ?? null, state: orderLabel(p), poId: (rawById.get(p.id)?.po_id as string | null) ?? null }))} received={receivedParts.map((p) => ({ id: p.id, description: p.description, positions: p.positions ?? null, qty: Number(p.confirmed_quantity ?? p.quantity) || 1 }))} poTotals={Object.fromEntries(lpos.suppliers.map((s) => [s.po.id, s.po.total_cost_aed]))} />
        </Card>
      ) : null}

      <Card id="pricing" className="flex flex-col gap-2 overflow-visible">
        <PartsTable tyreBrands={Array.from(new Set([...((settings.tyre_brands ?? []) as string[]), ...Object.keys((settings.tyre_brand_custom ?? {}) as Record<string, number>)]))} tyreModels={(settings.tyre_models ?? {}) as Record<string, string[]>} tyreSizes={{ front: v?.tyre_size_front ?? "", rear: v?.tyre_size_rear ?? "" }} jobId={jobId} rows={rows} suppliers={suppliers} types={types.length ? types : ["genuine", "oem", "aftermarket", "used"]} canPrice={canPrice} car={[v?.make?.name, v?.model?.name, v?.variant, v?.model_year].filter(Boolean).join(" ")} vin={v?.vin ?? null} openingLine={String(settings.supplier_quote_opening_line || "Please quote price and availability:")} catalogue={catalogue} lastImport={lastImport} pricingDoneAt={job.parts_pricing_done_at} onPricingDone={pricingDone.bind(null, jobId)} showBar={canPrice && !inPlanning} showCost={["owner", "service_advisor", "parts"].includes(role)} removeReasons={reasonsFor(settings, "remove_part")} pricingLocked={pricingLocked} onReopen={reopenPricing.bind(null, jobId)} reopenedAt={job.parts_pricing_reopened_at} extraCosts={["owner", "service_advisor", "parts"].includes(role) ? chargeRows.map((c) => ({ supplier: c.supplier, amount: c.amount })) : []} />
        {["owner", "service_advisor", "parts", "accounts"].includes(role) ? <SupplierChargesStrip jobId={jobId} charges={chargeRows} canEdit={canPrice} /> : null}
      </Card>
      {canPrice && !inPlanning ? <div className="h-20" /> : null}
    </>
  );
}
