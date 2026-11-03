import "server-only";
import { dubaiDate } from "@/lib/jobs";
import { cleanPartNumber, daysFromDate, pricingSummary, rowState, type PricingSummary, type RowFlags, type RowState, type RowValues } from "@/lib/parts-rows";
import { isSettledStatus } from "@/lib/part-cost-check";
import { costCheckValues, costChecksFor, type CostCheck } from "@/lib/part-cost-history";
import { costConfirmReady, partUnitsReady } from "@/lib/schema-ready";
import { cleanUnit, requestUnitOf } from "@/lib/part-units";
import { awaitingSend, inPricingPhase } from "@/lib/pricing-done";
import { PAST_QUOTE } from "@/lib/parts-steps";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTyreName, parseTyreSpec, tyreSizeIn } from "@/lib/tyres";

/**
 * The Parts pricing rows of a job as the server sees them, in the same shape and with the same state function the
 * table uses in the browser. Everything that counts parts (Pricing done, the advisor's notification, the quotation's
 * blockers, the job card) goes through here, so one definition of "priced" holds everywhere. Removed rows ("not
 * needed") stay in the list, greyed, and count for nothing.
 */
export const PRICING_PART_SELECT = "id, part_request_id, description, original_description, part_number, part_type, brand, tyre_spec, list_price_aed, discount_percent, cost_aed, supplier, availability, delivery_date, quantity, confirmed_quantity, confirm_status, is_active, created_at, removed_at, removed_by, removed_reason, discount_approval_status, option_group, order_status, stock_item_id, final_cost_aed";
/** The pricing select with "Yes, real price" once the database has it (migration 20261203100000_part_costs). */
export async function pricingPartSelect(): Promise<string> {
  const base = (await costConfirmReady()) ? `${PRICING_PART_SELECT}, cost_confirmed_aed` : PRICING_PART_SELECT;
  // Section 9 (3 November 2026): the part's unit once the database keeps it (migration 20261203160000).
  return (await partUnitsReady()) ? `${base}, unit` : base;
}
export const PRICING_REQUEST_SELECT = "id, label, status, quantity, unit, closed_reason, created_at, removed_at, removed_by, removed_reason";

export type PricingPart = {
  id: string;
  part_request_id: string | null;
  description: string;
  /** The technician's words, when Parts corrected the name. */
  original_description?: string | null;
  part_number: string | null;
  part_type: string | null;
  brand: string | null;
  tyre_spec?: unknown;
  list_price_aed?: number | string | null;
  discount_percent?: number | string | null;
  cost_aed: number | string | null;
  supplier: string | null;
  availability: string | null;
  delivery_date: string | null;
  quantity: number | string | null;
  confirmed_quantity: number | string | null;
  confirm_status?: string | null;
  is_active?: boolean;
  created_at: string;
  removed_at?: string | null;
  removed_by?: string | null;
  removed_reason?: string | null;
  discount_approval_status?: string | null;
  option_group?: string | null;
  order_status?: string | null;
  stock_item_id?: string | null;
  cost_confirmed_aed?: number | string | null;
  /** The cost that really stands once ordered: the supplier invoice price or the stock average. */
  final_cost_aed?: number | string | null;
  /** Section 9: pieces, litres or sets (read once the column exists). */
  unit?: string | null;
};

export type PricingRequest = { id: string; label: string; status: string; quantity: number | string | null; unit?: string | null; closed_reason: string | null; created_at: string; removed_at?: string | null; removed_by?: string | null; removed_reason?: string | null };

const text = (n: number | string | null | undefined) => (n === null || n === undefined ? "" : String(n));

/**
 * The row values of a saved part, the days counted from today in Dubai, with its cost check (2 November 2026) when
 * given. A part number stored before the rules (a line number, "OFJ") reads as "NO NUMBER", as the database change
 * writes it. A part from a stock item carries the item (and, when given, its words and what is on the shelf); a part
 * priced "Our stock" before the rule has no item and is never unpriced for it (Prices to fix lists it). An ordered or
 * received part is "settled": past pricing, its supplier and cost never make it unfinished.
 */
export function valuesOfPart(p: PricingPart, today: string, check?: CostCheck | null, stock?: { words: string; onHand: number } | null): RowValues {
  const settled = isSettledStatus(p.order_status);
  return {
    ...costCheckValues(check, p.cost_aed),
    ...(p.stock_item_id ? { stock_item: p.stock_item_id } : {}),
    ...(stock ? { stock_words: stock.words, stock_on_hand: String(stock.onHand) } : {}),
    ...(settled ? { settled: "1" } : {}),
    part_number: cleanPartNumber(p.part_number) ?? "",
    part_type: p.part_type ?? "",
    brand: p.brand ?? "",
    list_price: text(p.list_price_aed),
    discount: text(p.discount_percent),
    cost_aed: text(p.cost_aed),
    supplier: p.supplier ?? "",
    availability: p.availability ?? "",
    days: p.availability === "to_order" ? daysFromDate(p.delivery_date, today) : "",
    qty: String(Number(p.confirmed_quantity ?? p.quantity) || 1),
    unit: cleanUnit(p.unit) ?? "pc",
    ...tyreValues(p.description, p.tyre_spec, p.brand),
  };
}

/** The flags of a saved part: removed as not needed, or its supplier discount waiting for the owner. */
export function flagsOfPart(p: Pick<PricingPart, "removed_at" | "is_active" | "discount_approval_status">): RowFlags {
  return { removed: !!p.removed_at || p.is_active === false, waitingApproval: p.discount_approval_status === "pending" };
}

/** The tyre fields of a row: from the stored details, else read off the name. */
export function tyreValues(name: string, raw: unknown, brand: string | null): Pick<RowValues, "tyre_row" | "tyre_brand" | "tyre_size"> {
  const spec = parseTyreSpec(raw);
  const tyre = isTyreName(name) || !!spec;
  if (!tyre) return {};
  return { tyre_row: true, tyre_brand: spec?.brand ?? (brand ?? ""), tyre_size: spec?.size ?? tyreSizeIn(name) };
}

/** The row values of a request that has no part yet: empty, with the usual part type offered. */
export function valuesOfRequest(r: PricingRequest, defaultType = ""): RowValues {
  // The unit a request stands for: sets and litres as stored, else read from the name (a stored "pc" is nobody's choice).
  return { part_number: "", part_type: defaultType, brand: "", list_price: "", discount: "", cost_aed: "", supplier: "", availability: "", days: "", qty: String(Number(r.quantity) || 1), unit: requestUnitOf(r.label, r.unit), ...tyreValues(r.label, null, null) };
}

export type PricingRow = {
  /** Stable across saves: a request's first row keeps the request's key once its part exists. */
  key: string;
  requestId: string | null;
  partId: string | null;
  name: string;
  values: RowValues;
  flags: RowFlags;
  state: RowState;
  createdAt: string;
};

export type PricingRows = { rows: PricingRow[]; summary: PricingSummary; today: string; parts: PricingPart[]; requests: PricingRequest[]; /** Each part's cost check (2 November 2026). */ checks: Map<string, CostCheck> };

/** The rows of a job in the table's order: each request with its parts (or alone), then parts added by Parts. */
export function pricingRowsOf(requests: PricingRequest[], parts: PricingPart[], today: string, defaultType = "", checks?: Map<string, CostCheck>): PricingRow[] {
  const rows: PricingRow[] = [];
  const live = parts.filter((p) => p.confirm_status !== "rejected" && (p.is_active !== false || p.removed_at));
  for (const r of requests) {
    const items = live.filter((p) => p.part_request_id === r.id);
    if (items.length) {
      items.forEach((p, i) => {
        const values = valuesOfPart(p, today, checks?.get(p.id));
        const flags = flagsOfPart(p);
        rows.push({ key: i === 0 ? `req:${r.id}` : p.id, requestId: r.id, partId: p.id, name: p.description, values, flags, state: rowState(values, flags), createdAt: p.created_at });
      });
    } else if (r.status !== "rejected" || r.removed_at) {
      const values = valuesOfRequest(r, defaultType);
      const flags: RowFlags = { unavailable: r.status === "unavailable", removed: !!r.removed_at };
      rows.push({ key: `req:${r.id}`, requestId: r.id, partId: null, name: r.label, values, flags, state: rowState(values, flags), createdAt: r.created_at });
    }
  }
  for (const p of live.filter((p) => !p.part_request_id)) {
    const values = valuesOfPart(p, today, checks?.get(p.id));
    const flags = flagsOfPart(p);
    rows.push({ key: p.id, requestId: null, partId: p.id, name: p.description, values, flags, state: rowState(values, flags), createdAt: p.created_at });
  }
  return rows;
}

export async function loadPricingRows(jobId: string, defaultType = ""): Promise<PricingRows> {
  const admin = createAdminClient();
  const select = await pricingPartSelect();
  const [{ data: reqRows }, { data: partRows }] = await Promise.all([
    admin.from("part_requests").select(PRICING_REQUEST_SELECT).eq("job_id", jobId).eq("is_active", true).order("created_at"),
    // Removed parts are inactive but stay on the list, greyed.
    admin.from("part_items").select(select).eq("job_id", jobId).or("is_active.eq.true,removed_at.not.is.null").order("created_at"),
  ]);
  const today = dubaiDate();
  const requests = (reqRows ?? []) as PricingRequest[];
  const parts = ((partRows ?? []) as unknown as PricingPart[]).map((p) => ({ ...p, job_id: jobId }));
  // The cost check of every part (2 November 2026): the same one the table, Pricing done and the quotation read.
  const checks = await costChecksFor(parts.filter((p) => p.is_active !== false), parts.filter((p) => p.is_active !== false));
  const rows = pricingRowsOf(requests, parts, today, defaultType, checks);
  return { rows, summary: pricingSummary(rows.map((r) => r.state)), today, parts, requests, checks };
}

type PricingJob = { id: string; status: string; parts_pricing_done_at: string | null; parts_pricing_reopened_at: string | null };

/**
 * A new part on a car (the advisor's "+ Add a part", a service's parts, additional work, a revised inspection, a part
 * Parts add themselves) opens the pricing again by itself (section 10, 3 November 2026): the car is back on the parts
 * desk's list and the advisor hears it with the one send. Before the customer's approval only a pricing already sent
 * needs opening (an unsent one is open anyway); past the approval, once the work started, the pricing opens whether or
 * not it was ever sent (review of 3 November 2026: a car approved before Parts pressed the button used to hold the new
 * part's notices with nothing asking for a send). Nothing in planning (the revision flow takes those). Returns the
 * stamp written, or null.
 */
export async function reopenPricingFor(jobId: string, by: string | null): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("jobs").select("id, status, parts_pricing_done_at, parts_pricing_reopened_at").eq("id", jobId).maybeSingle();
  const job = data as PricingJob | null;
  if (!job || job.parts_pricing_reopened_at || !inPricingPhase(job)) return null;
  if (!job.parts_pricing_done_at && !PAST_QUOTE.includes(job.status)) return null;
  const now = new Date().toISOString();
  await admin.from("jobs").update({ parts_pricing_reopened_at: now, parts_pricing_reopened_by: by, ...(by ? { updated_by: by } : {}) }).eq("id", jobId).is("parts_pricing_reopened_at", null);
  return now;
}

/**
 * THE gate for every per-part notice to the advisor (not available, quantity, removed, split, changed after the
 * quotation went out): true when it is held for the send - exactly while a send is expected (awaitingSend) - and then
 * the job is marked as having changes waiting (parts_pricing_reopened_at), so the car stays on the parts desk's list
 * until "Pricing done – send to advisor" and the customer's approval releases it if nobody pressed it. False: tell the
 * advisor now. The job object is updated in place, so later checks in the same save agree.
 */
export async function holdForSend(job: PricingJob, by: string | null): Promise<boolean> {
  if (!awaitingSend(job)) return false;
  if (!job.parts_pricing_reopened_at) {
    const now = new Date().toISOString();
    await createAdminClient().from("jobs").update({ parts_pricing_reopened_at: now, parts_pricing_reopened_by: by, ...(by ? { updated_by: by } : {}) }).eq("id", job.id).is("parts_pricing_reopened_at", null);
    job.parts_pricing_reopened_at = now;
  }
  return true;
}
