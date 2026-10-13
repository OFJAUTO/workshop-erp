import "server-only";
import { dubaiDate } from "@/lib/jobs";
import { daysFromDate, pricingSummary, rowState, type PricingSummary, type RowFlags, type RowState, type RowValues } from "@/lib/parts-rows";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The Parts pricing rows of a job as the server sees them, in the same shape and with the same state function the
 * table uses in the browser. Everything that counts parts (Pricing done, the advisor's notification, the quotation's
 * blockers, the job card) goes through here, so one definition of "priced" holds everywhere. Removed rows ("not
 * needed") stay in the list, greyed, and count for nothing.
 */
export const PRICING_PART_SELECT = "id, part_request_id, description, original_description, part_number, part_type, brand, list_price_aed, discount_percent, cost_aed, supplier, availability, delivery_date, quantity, confirmed_quantity, confirm_status, is_active, created_at, removed_at, removed_by, removed_reason, discount_approval_status";
export const PRICING_REQUEST_SELECT = "id, label, status, quantity, closed_reason, created_at, removed_at, removed_by, removed_reason";

export type PricingPart = {
  id: string;
  part_request_id: string | null;
  description: string;
  /** The technician's words, when Parts corrected the name. */
  original_description?: string | null;
  part_number: string | null;
  part_type: string | null;
  brand: string | null;
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
};

export type PricingRequest = { id: string; label: string; status: string; quantity: number | string | null; closed_reason: string | null; created_at: string; removed_at?: string | null; removed_by?: string | null; removed_reason?: string | null };

const text = (n: number | string | null | undefined) => (n === null || n === undefined ? "" : String(n));

/** The row values of a saved part, the days counted from today in Dubai. */
export function valuesOfPart(p: PricingPart, today: string): RowValues {
  return {
    part_number: p.part_number ?? "",
    part_type: p.part_type ?? "",
    brand: p.brand ?? "",
    list_price: text(p.list_price_aed),
    discount: text(p.discount_percent),
    cost_aed: text(p.cost_aed),
    supplier: p.supplier ?? "",
    availability: p.availability ?? "",
    days: p.availability === "to_order" ? daysFromDate(p.delivery_date, today) : "",
    qty: String(Number(p.confirmed_quantity ?? p.quantity) || 1),
  };
}

/** The flags of a saved part: removed as not needed, or its supplier discount waiting for the owner. */
export function flagsOfPart(p: Pick<PricingPart, "removed_at" | "is_active" | "discount_approval_status">): RowFlags {
  return { removed: !!p.removed_at || p.is_active === false, waitingApproval: p.discount_approval_status === "pending" };
}

/** The row values of a request that has no part yet: empty, with the usual part type offered. */
export function valuesOfRequest(r: PricingRequest, defaultType = ""): RowValues {
  return { part_number: "", part_type: defaultType, brand: "", list_price: "", discount: "", cost_aed: "", supplier: "", availability: "", days: "", qty: String(Number(r.quantity) || 1) };
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

export type PricingRows = { rows: PricingRow[]; summary: PricingSummary; today: string; parts: PricingPart[]; requests: PricingRequest[] };

/** The rows of a job in the table's order: each request with its parts (or alone), then parts added by Parts. */
export function pricingRowsOf(requests: PricingRequest[], parts: PricingPart[], today: string, defaultType = ""): PricingRow[] {
  const rows: PricingRow[] = [];
  const live = parts.filter((p) => p.confirm_status !== "rejected" && (p.is_active !== false || p.removed_at));
  for (const r of requests) {
    const items = live.filter((p) => p.part_request_id === r.id);
    if (items.length) {
      items.forEach((p, i) => {
        const values = valuesOfPart(p, today);
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
    const values = valuesOfPart(p, today);
    const flags = flagsOfPart(p);
    rows.push({ key: p.id, requestId: null, partId: p.id, name: p.description, values, flags, state: rowState(values, flags), createdAt: p.created_at });
  }
  return rows;
}

export async function loadPricingRows(jobId: string, defaultType = ""): Promise<PricingRows> {
  const admin = createAdminClient();
  const [{ data: reqRows }, { data: partRows }] = await Promise.all([
    admin.from("part_requests").select(PRICING_REQUEST_SELECT).eq("job_id", jobId).eq("is_active", true).order("created_at"),
    // Removed parts are inactive but stay on the list, greyed.
    admin.from("part_items").select(PRICING_PART_SELECT).eq("job_id", jobId).or("is_active.eq.true,removed_at.not.is.null").order("created_at"),
  ]);
  const today = dubaiDate();
  const requests = (reqRows ?? []) as PricingRequest[];
  const parts = (partRows ?? []) as PricingPart[];
  const rows = pricingRowsOf(requests, parts, today, defaultType);
  return { rows, summary: pricingSummary(rows.map((r) => r.state)), today, parts, requests };
}
