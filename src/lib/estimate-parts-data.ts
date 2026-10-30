import "server-only";
import { createAdminClient } from "./supabase/admin";
import { formatPlate, type PlateFields } from "./types";

/**
 * Estimate parts for the parts desk (30 October 2026): every estimate with part lines sent to be priced and still
 * unpriced, or priced by the advisor and not checked yet. The car is not here yet, so the desk sees the make, model,
 * year and VIN. Read with the master key (the parts desk does not read quotations), narrowly.
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
  since: string | null;
};

type CarRow = PlateFields & { vin: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };

export const ESTIMATE_CAR_SELECT = "kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)";

/** "MERCEDES-BENZ GLC 200 2024": make, model and year, as the parts desk asks for them. */
export function carWords(v: CarRow | null): string {
  if (!v) return "";
  return [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" ");
}

export async function loadEstimatesToPrice(onlyId?: string): Promise<EstimateToPrice[]> {
  const admin = createAdminClient();
  let lq = admin
    .from("quotation_lines")
    .select("quotation_id, unit_cost, price_requested_at, priced_by_advisor, price_checked_at, left_off")
    .eq("line_type", "part")
    .is("part_item_id", null)
    .eq("is_active", true)
    .or("and(price_requested_at.not.is.null,unit_cost.is.null),and(priced_by_advisor.eq.true,price_checked_at.is.null)");
  if (onlyId) lq = lq.eq("quotation_id", onlyId);
  const { data: lines } = await lq;
  const rows = (lines ?? []).filter((l) => !l.left_off);
  if (!rows.length) return [];
  const ids = Array.from(new Set(rows.map((l) => l.quotation_id as string)));
  const { data: qs } = await admin
    .from("quotations")
    .select(`id, number, created_by, kind, status, carried_job_id, vehicle:vehicles(${ESTIMATE_CAR_SELECT}), creator:staff!quotations_created_by_fkey(display_name)`)
    .in("id", ids)
    .eq("kind", "estimate")
    .eq("is_active", true)
    .is("deleted_at", null)
    .is("carried_job_id", null)
    .not("status", "in", "(superseded,cancelled,declined,expired)");
  const out: EstimateToPrice[] = [];
  for (const q of (qs ?? []) as unknown as { id: string; number: string; created_by: string | null; vehicle: CarRow | null; creator: { display_name: string } | null }[]) {
    const mine = rows.filter((l) => l.quotation_id === q.id);
    const toPrice = mine.filter((l) => l.unit_cost === null && l.price_requested_at);
    const toCheck = mine.filter((l) => l.unit_cost !== null && l.priced_by_advisor && !l.price_checked_at);
    if (!toPrice.length && !toCheck.length) continue;
    out.push({
      id: q.id,
      number: q.number,
      plate: q.vehicle ? formatPlate(q.vehicle) : "No car",
      car: carWords(q.vehicle),
      vin: q.vehicle?.vin ?? null,
      advisor: q.creator?.display_name ?? null,
      advisorId: q.created_by,
      toPrice: toPrice.length,
      toCheck: toCheck.length,
      since: toPrice.map((l) => l.price_requested_at as string).sort()[0] ?? null,
    });
  }
  return out.sort((a, b) => ((a.since ?? "9") < (b.since ?? "9") ? -1 : 1));
}

/** "3 parts to price · 1 price to check". */
export function estimateTaskWords(e: Pick<EstimateToPrice, "toPrice" | "toCheck">): string {
  return [e.toPrice ? `${e.toPrice} part${e.toPrice === 1 ? "" : "s"} to price` : null, e.toCheck ? `${e.toCheck} advisor price${e.toCheck === 1 ? "" : "s"} to check` : null].filter(Boolean).join(" · ");
}
