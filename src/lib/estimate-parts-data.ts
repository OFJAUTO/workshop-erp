import "server-only";
import { createAdminClient } from "./supabase/admin";
import { formatPlate, type PlateFields } from "./types";
import { estimatePartState, isEstimatePart, type EstimatePartState } from "./estimate-parts";
import { cleanPartNumber, rowMissing, rowState, type RowState, type RowValues } from "./parts-rows";
import { costCheckValues, costChecksFor, type PartForCheck } from "./part-cost-history";
import { estimateDeskTodo, estimateLineMoment } from "./pricing-done";
import { cleanUnit, type PartUnit } from "./part-units";
import { PART_LINE_EXTRA_SELECT, estimatePricingReady, lineCostConfirmReady, partUnitsReady } from "./schema-ready";
import { startersOf } from "./quote-lead";
import { pageAll, pageAllIn } from "./page-all";

/**
 * Estimate parts for the parts desk (30 October 2026): every estimate with part lines sent to be priced and still
 * unpriced, or priced by the advisor and not checked yet. The car is not here yet, so the desk sees the make, model,
 * year and VIN. Read with the master key (the parts desk does not read quotations), narrowly.
 *
 * 3 November 2026 (section 10): an estimate leaves the list when the desk presses "Pricing done – send to advisor"
 * (quotations.parts_priced_at), and comes back when the advisor sends another part or a price changes after it.
 */
export type EstimateToPrice = {
  id: string;
  number: string;
  plate: string;
  car: string;
  vin: string | null;
  advisor: string | null;
  advisorId: string | null;
  /** Sent to the parts desk, no price yet. */
  toPrice: number;
  /** Priced by the advisor, not checked yet. */
  toCheck: number;
  /** Every part priced, "Pricing done – send to advisor" not pressed yet. */
  pricedNotSent: number;
  since: string | null;
};

type CarRow = PlateFields & { vin: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };

export const ESTIMATE_CAR_SELECT = "kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)";

/** "MERCEDES-BENZ GLC 200 2024": make, model and year, as the parts desk asks for them. */
export function carWords(v: CarRow | null): string {
  if (!v) return "";
  return [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" ");
}

type LineRow = { quotation_id: string; unit_cost: number | string | null; price_requested_at: string | null; priced_at: string | null; priced_by_advisor: boolean | null; price_checked_at: string | null; left_off: boolean | null };

/**
 * When the parts desk last pressed "Pricing done – send to advisor" on each estimate: the estimate's own stamp
 * (quotations.parts_priced_at) once the database has it, else the "parts_pricing_done" event the send always writes
 * (review of 3 November 2026: before that database change the bar never knew the send happened, showed no answer and
 * let every tap tell the advisor again). Read in short pieces.
 */
export async function estimateSentStamps(ids: string[], columns?: Map<string, string | null>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (columns) {
    for (const [id, at] of columns) if (at) out.set(id, at);
    return out;
  }
  const rows = await pageAllIn<{ quotation_id: string; created_at: string }>(ids, (piece, from, to) => createAdminClient().from("quotation_events").select("quotation_id, created_at").in("quotation_id", piece).eq("event_type", "parts_pricing_done").order("created_at").range(from, to));
  for (const r of rows) if (!out.get(r.quotation_id) || r.created_at > out.get(r.quotation_id)!) out.set(r.quotation_id, r.created_at);
  return out;
}

export async function loadEstimatesToPrice(onlyId?: string): Promise<EstimateToPrice[]> {
  const admin = createAdminClient();
  const stampReady = await estimatePricingReady();
  // 1. The estimates the desk can still act on (review of 3 November 2026: the line read used to take every estimate
  // part ever sent to the desk, past PostgREST's 1,000-row cap and into one long id list). Read page by page.
  type QRow = { id: string; number: string; created_by: string | null; status: string; parts_priced_at?: string | null; vehicle: CarRow | null; creator: { display_name: string } | null };
  const qs = await pageAll<QRow>((from, to) => {
    let q = admin
      .from("quotations")
      .select(`id, number, created_by, kind, status, carried_job_id${stampReady ? ", parts_priced_at" : ""}, vehicle:vehicles(${ESTIMATE_CAR_SELECT}), creator:staff!quotations_created_by_fkey(display_name)`)
      .eq("kind", "estimate")
      .eq("is_active", true)
      .is("deleted_at", null)
      .is("carried_job_id", null)
      .not("status", "in", "(superseded,cancelled,declined,expired)")
      .order("created_at")
      .range(from, to);
    if (onlyId) q = q.eq("id", onlyId);
    return q as unknown as PromiseLike<{ data: QRow[] | null; error: { message: string } | null }>;
  }).catch(() => [] as QRow[]);
  if (!qs.length) return [];
  // 2. Their part lines sent to the desk, or priced by the advisor (both may still need the desk), in short pieces.
  const ids = qs.map((q) => q.id);
  const lines = await pageAllIn<LineRow>(ids, (piece, from, to) =>
    admin
      .from("quotation_lines")
      .select("quotation_id, unit_cost, price_requested_at, priced_at, priced_by_advisor, price_checked_at, left_off")
      .in("quotation_id", piece)
      .eq("line_type", "part")
      .is("part_item_id", null)
      .eq("is_active", true)
      .or("price_requested_at.not.is.null,priced_by_advisor.eq.true")
      .order("id")
      .range(from, to),
  ).catch(() => [] as LineRow[]);
  const rows = lines.filter((l) => !l.left_off);
  if (!rows.length) return [];
  const withLines = new Set(rows.map((l) => l.quotation_id));
  const stamps = await estimateSentStamps(Array.from(withLines), stampReady ? new Map(qs.map((q) => [q.id, q.parts_priced_at ?? null])) : undefined);
  const out: EstimateToPrice[] = [];
  for (const q of qs.filter((x) => withLines.has(x.id))) {
    const mine = rows.filter((l) => l.quotation_id === q.id).map((l) => ({ ...l, unit_cost: l.unit_cost === null ? null : Number(l.unit_cost) }));
    const todo = estimateDeskTodo(mine, stamps.get(q.id) ?? null, true);
    // A price waiting to be sent back only counts while the estimate is still being prepared (the desk can still press it).
    const pricedNotSent = ["draft", "pending_owner"].includes(q.status) ? todo.pricedNotSent : 0;
    // An advisor's own price never HOLDS the estimate on the desk's waiting list (5 November 2026): they are told once
    // and can look at it later; only parts still to price, or prices waiting to be sent, keep it here.
    if (!todo.toPrice && !pricedNotSent) continue;
    out.push({
      id: q.id,
      number: q.number,
      plate: q.vehicle ? formatPlate(q.vehicle) : "No car",
      car: carWords(q.vehicle),
      vin: q.vehicle?.vin ?? null,
      advisor: q.creator?.display_name ?? null,
      advisorId: q.created_by,
      toPrice: todo.toPrice,
      toCheck: todo.toCheck,
      pricedNotSent,
      since: mine.map((l) => l.price_requested_at).filter((x): x is string => !!x).sort()[0] ?? null,
    });
  }
  return out.sort((a, b) => ((a.since ?? "9") < (b.since ?? "9") ? -1 : 1));
}

/**
 * "3 parts to price", or "all priced – send to advisor"; a price the advisor typed himself is information, never a task
 * (5 November 2026: it leaves the desk's waiting list at once), so it rides along as "· 1 priced by advisor".
 */
export function estimateTaskWords(e: Pick<EstimateToPrice, "toPrice" | "toCheck"> & { pricedNotSent?: number }): string {
  const task = e.toPrice ? `${e.toPrice} part${e.toPrice === 1 ? "" : "s"} to price` : e.pricedNotSent ? "all priced – send to advisor" : "";
  const info = e.toCheck ? `${e.toCheck} priced by advisor` : "";
  return [task, info].filter(Boolean).join(" · ");
}

/* ---------------------------------------------------------------------------------------------------------------
   The estimate's parts as the parts desk prices them (3 November 2026): ONE shared Parts row for a job's parts and an
   estimate's parts. The values, the state and what a line still needs come from the same pure rules as a job's rows
   (src/lib/parts-rows.ts), so the bar's "3 of 4 priced", the send and the advisor's view agree.
   --------------------------------------------------------------------------------------------------------------- */

export type EstimateDeskLine = {
  id: string;
  title: string;
  quantity: number;
  unit: PartUnit;
  /** What the advisor asked for before the desk changed it (null when unchanged, or before the database change). */
  askedQuantity: number | null;
  positions: string[];
  note: string | null;
  state: EstimatePartState;
  values: RowValues;
  rowState: RowState;
  missing: string[];
  /** The advisor's own price ("I have a price"), shown for the desk to check. */
  advisorCost: number | null;
  advisorSupplier: string | null;
  stockItemId: string | null;
  pricedAt: string | null;
  priceRequestedBy: string | null;
  /** The last time the desk had something to do on it (sent, priced, checked): newer than the send = to send again. */
  moment: string | null;
};

/** The bar on the estimate desk: never sent, sent and unchanged, or changed since the send. */
export function estimateBarMode(desk: Pick<EstimateDesk, "q" | "lines">): "open" | "editing" | "sent" {
  const sent = desk.q.parts_priced_at;
  if (!sent) return "open";
  return desk.lines.some((l) => (l.moment ?? "") > sent) ? "editing" : "sent";
}

export type EstimateDesk = {
  q: { id: string; number: string; version: number; status: string; sent_at: string | null; created_by: string | null; carried_job_id: string | null; vehicle_id: string | null; parts_priced_at: string | null; parts_priced_by: string | null };
  /** Every part line the desk has (sent to it, or priced by the advisor); a line the advisor is still naming stays his. */
  lines: EstimateDeskLine[];
  /** Still being prepared (draft or waiting for the owner) and not carried to a job: the desk prices here. */
  preparing: boolean;
};

const text = (n: number | string | null | undefined) => (n === null || n === undefined ? "" : String(n));

/** The estimate's desk lines with their row values, state and cost question, in the estimate's order. */
export async function loadEstimateDesk(quotationId: string): Promise<EstimateDesk | null> {
  const admin = createAdminClient();
  const [stampReady, unitsReady, lineReady] = await Promise.all([estimatePricingReady(), partUnitsReady(), lineCostConfirmReady()]);
  const { data: qRaw } = await admin.from("quotations").select(`id, number, version, kind, status, sent_at, created_by, carried_job_id, vehicle_id, is_active${stampReady ? ", parts_priced_at, parts_priced_by" : ""}`).eq("id", quotationId).maybeSingle();
  const q = qRaw as unknown as (EstimateDesk["q"] & { kind: string; is_active: boolean }) | null;
  if (!q || q.kind !== "estimate" || !q.is_active) return null;
  const { data: lineRows } = await admin
    .from("quotation_lines")
    .select(`id, line_type, title, quantity, positions, parts_note, unit_cost, part_item_id, is_active, left_off, option_group, chosen, price_requested_at, price_requested_by, priced_at, priced_by_advisor, price_checked_at, supplier_text, part_number, part_type, brand, availability, delivery_days, position${lineReady ? ", stock_item_id, cost_confirmed_aed" : ""}`)
    .eq("quotation_id", q.id)
    .eq("line_type", "part")
    .eq("is_active", true)
    .order("position");
  const raw = ((lineRows ?? []) as unknown as Record<string, unknown>[]).filter((l) => isEstimatePart({ line_type: l.line_type as string, part_item_id: l.part_item_id as string | null }) && !l.left_off);
  const { data: extraRows } = unitsReady && raw.length ? await admin.from("quotation_lines").select(PART_LINE_EXTRA_SELECT).in("id", raw.map((l) => l.id as string)) : { data: [] as unknown[] };
  const extra = new Map(((extraRows ?? []) as { id: string; unit: string | null; asked_quantity: number | string | null; list_price_aed: number | string | null; supplier_discount_percent: number | string | null }[]).map((r) => [r.id, r]));
  // The stock item behind a price, in words (as the job's row shows it).
  const stockIds = Array.from(new Set(raw.map((l) => l.stock_item_id as string | null | undefined).filter((x): x is string => !!x)));
  const { data: stockRows } = stockIds.length ? await admin.from("stock_items").select("id, name, unit, quantity, unit_cost").in("id", stockIds) : { data: [] as { id: string; name: string; unit: string | null; quantity: number | string; unit_cost: number | string }[] };
  const stockOf = new Map((stockRows ?? []).map((i) => [i.id as string, { words: `${String(i.name).toUpperCase()} · ${(Number(i.quantity) || 0).toLocaleString("en-GB")} ${i.unit || "pc"} on hand · AED ${(Number(i.unit_cost) || 0).toFixed(2)} average`, onHand: Number(i.quantity) || 0 }]));
  // THE cost question of every line (2 November 2026): the same check the job's rows and the desk's save read.
  const forCheck: PartForCheck[] = raw.map((l) => ({ id: l.id as string, job_id: null, description: String(l.title ?? ""), part_number: (l.part_number as string | null) ?? null, cost_aed: (l.unit_cost as number | string | null) ?? null, supplier: (l.supplier_text as string | null) ?? null, cost_confirmed_aed: (l.cost_confirmed_aed as number | string | null | undefined) ?? null, stock_item_id: (l.stock_item_id as string | null | undefined) ?? null }));
  const checks = await costChecksFor(forCheck, forCheck);
  const lines: EstimateDeskLine[] = [];
  for (const l of raw) {
    const id = l.id as string;
    const x = extra.get(id);
    const state = estimatePartState({ id, line_type: "part", title: String(l.title ?? ""), unit_cost: l.unit_cost === null ? null : Number(l.unit_cost), price_requested_at: (l.price_requested_at as string | null) ?? null, priced_at: (l.priced_at as string | null) ?? null, priced_by_advisor: !!l.priced_by_advisor, price_checked_at: (l.price_checked_at as string | null) ?? null });
    if (state === "draft") continue;
    const unit: PartUnit = cleanUnit(x?.unit) ?? "pc";
    const stockId = (l.stock_item_id as string | null | undefined) ?? null;
    const stock = stockId ? stockOf.get(stockId) : undefined;
    const advisorOpen = !!l.priced_by_advisor && !l.price_checked_at;
    // An advisor's price the desk checked is a price (cost and supplier); his own words never asked for more.
    const advisorChecked = !!l.priced_by_advisor && !!l.price_checked_at;
    const values: RowValues = {
      ...costCheckValues(checks.get(id), (l.unit_cost as number | string | null) ?? null),
      ...(stockId ? { stock_item: stockId } : {}),
      ...(stock ? { stock_words: stock.words, stock_on_hand: String(stock.onHand) } : {}),
      part_number: cleanPartNumber(l.part_number as string | null) ?? "",
      part_type: (l.part_type as string | null) ?? "",
      brand: (l.brand as string | null) ?? "",
      list_price: text(x?.list_price_aed),
      discount: text(x?.supplier_discount_percent),
      cost_aed: text(l.unit_cost as number | string | null),
      supplier: (l.supplier_text as string | null) ?? "",
      availability: (l.availability as string | null) ?? "",
      days: l.availability === "to_order" ? text(l.delivery_days as number | string | null) : "",
      qty: String(Number(l.quantity) || 1),
      unit,
      advisor_price: advisorOpen ? "1" : advisorChecked ? "checked" : "",
    };
    const rs = rowState(values);
    lines.push({
      id,
      title: String(l.title ?? ""),
      quantity: Number(l.quantity) || 1,
      unit,
      askedQuantity: x?.asked_quantity === null || x?.asked_quantity === undefined ? null : Number(x.asked_quantity),
      positions: (l.positions as string[] | null) ?? [],
      note: (l.parts_note as string | null) ?? null,
      state,
      values,
      rowState: rs,
      missing: rs === "not_finished" ? rowMissing(values).map((m) => m.long) : [],
      advisorCost: l.priced_by_advisor && l.unit_cost !== null ? Number(l.unit_cost) : null,
      advisorSupplier: l.priced_by_advisor ? ((l.supplier_text as string | null) ?? null) : null,
      stockItemId: stockId,
      pricedAt: (l.priced_at as string | null) ?? null,
      priceRequestedBy: (l.price_requested_by as string | null) ?? null,
      moment: estimateLineMoment({ unit_cost: l.unit_cost === null ? null : Number(l.unit_cost), price_requested_at: (l.price_requested_at as string | null) ?? null, priced_at: (l.priced_at as string | null) ?? null, price_checked_at: (l.price_checked_at as string | null) ?? null }),
    });
  }
  // The send: the estimate's own stamp, or before that database change its "Pricing done" event.
  const sentAt = stampReady ? (q.parts_priced_at ?? null) : ((await estimateSentStamps([q.id])).get(q.id) ?? null);
  return {
    q: { id: q.id, number: q.number, version: Number(q.version) || 1, status: q.status, sent_at: q.sent_at, created_by: q.created_by, carried_job_id: q.carried_job_id, vehicle_id: q.vehicle_id, parts_priced_at: sentAt, parts_priced_by: q.parts_priced_by ?? null },
    lines,
    preparing: (q.status === "draft" || q.status === "pending_owner") && !q.carried_job_id,
  };
}

/** The advisors to tell about an estimate's parts: whoever started it and whoever sent its parts to the desk. */
export async function estimateAdvisors(quotationId: string, createdBy: string | null, number?: string): Promise<string[]> {
  const { data } = await createAdminClient().from("quotation_lines").select("price_requested_by").eq("quotation_id", quotationId).not("price_requested_by", "is", null);
  // 1 November 2026: the advisor who started the estimate stays in charge, whoever made the newest version.
  const starter = number ? ((await startersOf([number])).get(number) ?? createdBy) : createdBy;
  return Array.from(new Set([starter, ...(data ?? []).map((r) => r.price_requested_by as string)].filter((x): x is string => !!x)));
}
