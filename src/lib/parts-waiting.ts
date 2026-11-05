import "server-only";
import { estimateTaskWords, loadEstimatesToPrice } from "./estimate-parts-data";
import type { ExtraWaiting } from "@/components/WaitingPanel";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";
import { pricesToFix } from "./part-cost-history";
import { partAdvisorCols } from "./parts-data";
import { PLANNING_STATUSES, pricingTodoOf } from "./pricing-done";

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
    actionLabel: e.toPrice ? "Price the parts" : "Send to advisor",
    href: `/parts/estimate/${e.id}`,
    always: true,
    urgency: e.toPrice ? "amber" : "grey",
    since: e.since,
    hint: "The advisor's estimate before the car arrives: price each part he named, or check the price he typed, then press Pricing done – send to advisor.",
  }));
  return [...(await pricesToFixItem()), ...estimates, ...(await pricingToSendItems()), ...(await orderNowItems())];
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

/**
 * "Prices to fix" (2 November 2026, 2.4): one line while parts not ordered yet carry a placeholder price, a stand-in
 * supplier or an unanswered cost question. Ordered or received ones are on the Parts page's list only (corrected with
 * "Correct the cost…"): they never keep a line here that nothing on this screen can clear.
 */
async function pricesToFixItem(): Promise<ExtraWaiting[]> {
  const open = (await pricesToFix()).filter((r) => !r.settled);
  if (!open.length) return [];
  return [{
    jobId: "prices-to-fix",
    plate: "Prices to fix",
    car: null,
    what: `Prices to fix: ${open.length} part${open.length === 1 ? "" : "s"} with a placeholder price or supplier`,
    amount: null,
    actionLabel: "Fix the prices",
    href: "/parts#prices-to-fix",
    always: true,
    urgency: "amber",
    since: null,
    hint: "A cost of AED 1.00 or a supplier like OFJ Additional makes the profit look bigger than it is: put the real price, the real supplier, or From our stock.",
  }];
}

/**
 * Section 10 (3 November 2026): a car whose parts are all priced but not sent to the advisor ("Pricing done – send to
 * advisor" not pressed), or whose changes wait for the send, stays on Parts' list with one button; once sent it leaves
 * (pricingTodoOf, the same rule as the parts desk). A car with parts still to price is already on the list through its
 * quotation's step.
 */
async function pricingToSendItems(): Promise<ExtraWaiting[]> {
  const admin = createAdminClient();
  const { data: jobRows } = await admin
    .from("jobs")
    .select(`id, job_number, status, parts_pricing_done_at, parts_pricing_reopened_at, vehicle:vehicles(${PLATE_SELECT}, model_year, make:vehicle_makes(name), model:vehicle_models(name))`)
    .eq("is_open", true)
    .not("status", "in", `(${PLANNING_STATUSES.join(",")})`)
    .or("parts_pricing_done_at.is.null,parts_pricing_reopened_at.not.is.null")
    .limit(300);
  const jobs = (jobRows ?? []) as unknown as { id: string; job_number: string; status: string; parts_pricing_done_at: string | null; parts_pricing_reopened_at: string | null; vehicle: (PlateRow & { make?: { name: string } | null; model?: { name: string } | null }) | null }[];
  if (!jobs.length) return [];
  const ids = jobs.map((j) => j.id);
  const [{ data: partRows }, { data: reqRows }] = await Promise.all([
    admin.from("part_items").select("job_id, is_active, confirm_status, order_status, cost_aed, priced_at, removed_at" + (await partAdvisorCols())).in("job_id", ids).eq("is_active", true),
    admin.from("part_requests").select("job_id, status").in("job_id", ids).eq("is_active", true).eq("status", "open"),
  ]);
  const parts = (partRows ?? []) as unknown as { job_id: string; is_active: boolean; confirm_status: string | null; order_status: string | null; cost_aed: number | string | null; priced_at: string | null; removed_at: string | null; priced_by_advisor?: boolean | null }[];
  const reqs = (reqRows ?? []) as { job_id: string; status: string }[];
  const out: ExtraWaiting[] = [];
  for (const j of jobs) {
    const mine = parts.filter((p) => p.job_id === j.id);
    if (pricingTodoOf(j, reqs.filter((r) => r.job_id === j.id), mine) !== "to_send") continue;
    out.push({
      jobId: j.id,
      plate: j.vehicle ? formatPlate(j.vehicle) : j.job_number,
      car: [j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ") || null,
      what: `${j.job_number}: ${j.parts_pricing_done_at && j.parts_pricing_reopened_at ? "prices changed" : "all parts priced"} – send to the advisor`,
      amount: null,
      actionLabel: "Send to advisor",
      href: `/parts/${j.id}#pricing`,
      always: true,
      urgency: "amber",
      since: mine.map((p) => p.priced_at).filter((x): x is string => !!x).sort().slice(-1)[0] ?? null,
      hint: "Every part is priced, but the advisor does not know yet: press Pricing done – send to advisor at the bottom of the car's parts page.",
    });
  }
  return out;
}
