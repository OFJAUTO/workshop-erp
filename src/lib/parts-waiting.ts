import "server-only";
import { estimateTaskWords, loadEstimatesToPrice } from "./estimate-parts-data";
import type { ExtraWaiting } from "@/components/WaitingPanel";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

const PLATE_SELECT = "kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant";
type PlateRow = Parameters<typeof formatPlate>[0];
const aed = (n: number) => `AED ${Math.round(n).toLocaleString("en-GB")}`;

/**
 * Peter's own red tasks (2.3, 21 October 2026): every APPROVED supplier or stock LPO that nobody has
 * pressed Ordered on yet sits at the top of the Parts dashboard as ORDER NOW, aged from the owner's
 * approval, with the button opening that LPO's card (Copy, PDF, Email, Mark ordered).
 */
export async function partsWaitingExtra(): Promise<ExtraWaiting[]> {
  // 30 October 2026: estimates to price (the car not here yet) and advisors' prices to check come first.
  const estimates: ExtraWaiting[] = (await loadEstimatesToPrice()).map((e) => ({
    jobId: `est:${e.id}`,
    plate: e.plate,
    car: e.car || null,
    what: `ESTIMATE ${e.number} – car not here yet: ${estimateTaskWords(e)}`,
    amount: null,
    actionLabel: e.toPrice ? "Price the parts" : "Check the price",
    href: `/parts/estimate/${e.id}`,
    always: true,
    urgency: e.toPrice ? "amber" : "grey",
    since: e.since,
    hint: "The advisor's estimate before the car arrives: price each part he named, or check the price he typed.",
  }));
  return [...estimates, ...(await orderNowItems())];
}

async function orderNowItems(): Promise<ExtraWaiting[]> {
  const admin = createAdminClient();
  const { data: pos } = await admin
    .from("purchase_orders")
    .select(`id, number, supplier_name, total_cost_aed, approved_at, job_id, kind, job:jobs!purchase_orders_job_id_fkey(job_number, vehicle:vehicles(${PLATE_SELECT}, model_year, make:vehicle_makes(name), model:vehicle_models(name)))`)
    .eq("is_active", true)
    .eq("status", "approved")
    .in("kind", ["supplier", "stock"]);
  const rows = (pos ?? []) as unknown as Record<string, unknown>[];
  if (!rows.length) return [];
  const { data: lineRows } = await admin.from("purchase_order_lines").select("po_id").in("po_id", rows.map((r) => r.id as string)).eq("is_active", true);
  const lineCount = new Map<string, number>();
  for (const l of (lineRows ?? []) as { po_id: string }[]) lineCount.set(l.po_id, (lineCount.get(l.po_id) ?? 0) + 1);
  return rows.map((r) => {
    const job = r.job as { job_number: string; vehicle: (PlateRow & { model_year?: number | null; make?: { name: string } | null; model?: { name: string } | null }) | null } | null;
    const n = lineCount.get(r.id as string) ?? 0;
    return {
      jobId: (r.job_id as string | null) ?? `po:${r.id}`,
      plate: job?.vehicle ? formatPlate(job.vehicle) : (r.number as string),
      car: [job?.vehicle?.make?.name, job?.vehicle?.model?.name].filter(Boolean).join(" ") || (r.kind === "stock" ? "Stock order" : null),
      what: `ORDER NOW: ${r.number} · ${r.supplier_name} · ${n} part${n === 1 ? "" : "s"}`,
      amount: aed(Number(r.total_cost_aed) || 0),
      actionLabel: "Order now",
      href: `/parts/orders/${r.id}`,
      always: true,
      replaces: true,
      urgency: "red",
      since: (r.approved_at as string | null) ?? null,
      hint: "Approved: send it to the supplier (Copy, PDF or Email on the LPO) and press Ordered.",
    } as ExtraWaiting;
  });
}
