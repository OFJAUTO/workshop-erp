import { notFound } from "next/navigation";
import { estimateOrderState } from "@/lib/estimate-order";
import { OrderPartsNow } from "@/app/(app)/estimates/[id]/OrderPartsNow";
import { Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { VinCopy } from "@/components/VinCopy";
import { requirePermission } from "@/lib/auth";
import { ESTIMATE_CAR_SELECT, carWords, estimateBarMode, loadEstimateDesk } from "@/lib/estimate-parts-data";
import { formatDateTime } from "@/lib/format";
import { QUOTE_STATUS_LABELS } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate, type PlateFields } from "@/lib/types";
import { partUnitsReady } from "@/lib/schema-ready";
import { type SupplierOption } from "@/lib/parts-rows";
import { loadCatalogue } from "@/lib/parts-catalogue";
import { lastQuantitiesFor } from "@/lib/part-memory";
import { PartsTable, type TableRow } from "../../[jobId]/PartsTable";
import { vatChargingSupplierNames } from "@/lib/supplier-vat";
import { estimatePricingDone } from "../../estimate-actions";

export const dynamic = "force-dynamic";

/**
 * The parts desk prices an ESTIMATE (30 October 2026): the car is not here yet, so the page shows what the parts desk
 * needs instead - the make, model and year, the VIN when known, and each part the advisor named with his note.
 *
 * 3 November 2026 (sections 9 and 10): ONE shared parts form. The estimate's parts are priced on the same rows as a
 * job's parts (Part, Qty and unit, Part number, Type, List, Disc %, Net per unit, Supplier, Availability, line total),
 * each saving itself as it is typed; the quantity the advisor asked for can be changed ("Advisor asked 1, Parts changed
 * to 8 L") and the quantity used last time on the same model is offered; one bar at the bottom says "3 of 4 priced" and
 * sends it all to the advisor with ONE notification.
 */
export default async function EstimatePartsDesk({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("priceParts");
  const { id } = await params;
  const desk = await loadEstimateDesk(id);
  if (!desk) notFound();
  const admin = createAdminClient();
  const [{ data: qx }, settings, { data: supplierRows }, catalogue, unitsReady] = await Promise.all([
    admin.from("quotations").select(`id, vehicle:vehicles(${ESTIMATE_CAR_SELECT}), creator:staff!quotations_created_by_fkey(display_name)`).eq("id", id).maybeSingle(),
    getSettings(),
    admin.from("suppliers").select("id, name, default_discount_percent, discount_by_type").eq("is_active", true).order("name"),
    loadCatalogue(),
    partUnitsReady(),
  ]);
  const { q } = desk;
  const orderState = await estimateOrderState(q.id);
  const vehicle = (qx?.vehicle as unknown as (PlateFields & { vin: string | null; variant?: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null }) | null) ?? null;
  const advisor = (qx?.creator as unknown as { display_name: string } | null)?.display_name ?? null;
  const suppliers: SupplierOption[] = (supplierRows ?? []).map((s) => ({ id: s.id as string, name: s.name as string, discount: Number(s.default_discount_percent) || 0, byType: (s.discount_by_type as Record<string, number> | null) ?? {} }));
  const types = ((settings.part_types ?? []) as string[]).map((t) => t.toLowerCase());
  // 9.3: the quantity used last time for each part on the same model (this estimate itself never counts).
  const memory = await lastQuantitiesFor(q.vehicle_id, desk.lines.map((l) => ({ key: l.id, name: l.title })), [q.number]);
  // Section 3 (6 November 2026): sent but not accepted yet, the desk still changes the price and the supplier; each change
  // shows on its row ("Changed by Peter, 6 Nov 14:05: 6,180.00 → 5,900.00 · Al Tayer → Gargash").
  const editable = !q.carried_job_id && ["sent", "opened", "expired", "declined", "urgent_requested"].includes(q.status);
  const { data: changeEvents } = await admin.from("quotation_events").select("note, created_at").eq("quotation_id", q.id).eq("event_type", "desk_price_changed").order("created_at", { ascending: false });
  const changedOf = (title: string) => {
    const hit = ((changeEvents ?? []) as { note: string }[]).find((e) => e.note.includes(`: ${title.toUpperCase()}: `));
    return hit ? hit.note.replace(`: ${title.toUpperCase()}: `, ": ") : null;
  };
  const rows: TableRow[] = desk.lines.map((l) => ({
    changedWords: changedOf(l.title),
    key: l.id,
    requestId: null,
    partId: l.id,
    name: l.title,
    original: null,
    // What the advisor asked for (kept once the desk changed it), so the row says "Advisor asked 1, Parts changed to 8 L".
    techQty: l.askedQuantity ?? l.quantity,
    askedBy: "advisor",
    askedUnit: l.askedQuantity !== null ? "pc" : l.unit,
    info: null,
    values: l.values,
    optionGroup: null,
    unavailable: false,
    closedReason: null,
    locked: false,
    orderLabel: null,
    diagramUrl: null,
    question: null,
    answer: null,
    perSet: l.unit === "set",
    removed: null,
    waitingApproval: false,
    shownPositions: l.positions,
    qtyMemory: memory[l.id] ? { qty: memory[l.id].qty, unit: memory[l.id].unit, words: memory[l.id].words } : null,
    estimate: { state: l.state, note: l.note, advisorName: advisor, advisorCost: l.advisorCost, advisorSupplier: l.advisorSupplier },
  }));
  // The desk prices while the estimate is being prepared; afterwards the rows are read-only, but the desk still checks
  // the advisor's prices and tells him about a different one.
  const canPrice = !staff.viewingAs;
  const showBar = canPrice && desk.preparing && rows.length > 0;
  const toPrice = desk.lines.filter((l) => l.state === "with_desk").length;
  const toCheck = desk.lines.filter((l) => l.state === "advisor").length;

  return (
    <>
      <PageHeader
        title={`ESTIMATE ${q.number} – car not here yet`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-desk-car>
            <span className="font-bold">{vehicle ? formatPlate(vehicle) : "No car"}</span>
            <span>{carWords(vehicle)}</span>
            {vehicle?.vin ? <VinCopy vin={vehicle.vin} /> : <span className="text-muted">VIN not known yet</span>}
            {advisor ? <span className="text-muted">· Advisor {advisor}</span> : null}
          </span>
        }
        actions={<LinkButton href="/parts" tone="secondary" size="lg">Parts</LinkButton>}
      />
      {q.carried_job_id ? <Notice tone="info">The car has arrived: these parts are on the job now and are priced there.</Notice> : null}
      {/* 13 November 2026 (Section 7): accepted - order the parts now, or wait for the deposit (THE order state). */}
      {orderState.state !== "none" ? (
        <Card id="order-parts" className="flex flex-col gap-2 scroll-mt-4" data-desk-order-state={orderState.state}>
          <SectionLabel>Order the parts</SectionLabel>
          {orderState.state === "waiting_deposit" ? <p className="text-sm font-bold text-amber-text">Approved: waiting for deposit. Order once accounts record the money.</p> : null}
          {orderState.state === "cheque_pending" ? <p className="text-sm font-bold text-amber-text">The advance is a cheque not cleared yet: the owner approves the order on the LPO.</p> : null}
          {orderState.state === "ordered" ? <p className="text-sm font-bold text-green-text">Ordered: the LPO is made.</p> : null}
          {(orderState.state === "ready" || orderState.state === "cheque_pending") && !staff.viewingAs ? <OrderPartsNow estimateId={q.id} pricedCount={orderState.parts} /> : null}
        </Card>
      ) : null}
      {editable ? <Notice tone="info">{q.number} was sent to the customer{q.sent_at ? ` (${formatDateTime(q.sent_at)})` : ""}. You can still change a price or the supplier: the customer&apos;s price stays as it is and the advisor is told, to revise it if needed.</Notice> : null}
      {!desk.preparing && !q.carried_job_id && !editable ? <Notice tone="info">{q.number} is {QUOTE_STATUS_LABELS[q.status as keyof typeof QUOTE_STATUS_LABELS]?.toLowerCase() ?? q.status}{q.sent_at ? ` (sent ${formatDateTime(q.sent_at)})` : ""}: prices are not changed here any more. Check the advisor&apos;s prices, or tell him a price is different.</Notice> : null}
      <Card id="pricing" className="flex flex-col gap-3 overflow-visible" data-desk-estimate={q.number}>
        <SectionLabel right={[toPrice ? `${toPrice} to price` : null, toCheck ? `${toCheck} to check` : null].filter(Boolean).join(" · ") || "all priced"}>Parts on this estimate</SectionLabel>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">Nothing sent to the parts desk on this estimate.</p>
        ) : (
          <PartsTable
            jobId=""
            vatSupplierNames={await vatChargingSupplierNames()}
            estimate={{ id: q.id, number: q.number, preparing: desk.preparing, editable }}
            rows={rows}
            suppliers={suppliers}
            types={types.length ? types : ["genuine", "oem", "aftermarket", "used"]}
            canPrice={canPrice}
            car={[vehicle?.make?.name, vehicle?.model?.name, vehicle?.variant, vehicle?.model_year].filter(Boolean).join(" ")}
            vin={vehicle?.vin ?? null}
            openingLine={String(settings.supplier_quote_opening_line || "Please quote price and availability:")}
            catalogue={catalogue}
            pricingDoneAt={q.parts_priced_at}
            onPricingDone={showBar ? estimatePricingDone.bind(null, q.id) : null}
            showBar={showBar}
            pricingMode={estimateBarMode(desk)}
            editingWords="Changed since you sent it: the advisor sees the new prices on the estimate; press Send updated prices to tell him."
            showCost={["owner", "service_advisor", "parts"].includes(staff.role_id)}
            removeReasons={[]}
            unitsReady={unitsReady}
            refLabel={q.number}
          />
        )}
      </Card>
      {showBar ? <div className="h-28" /> : null}
    </>
  );
}
