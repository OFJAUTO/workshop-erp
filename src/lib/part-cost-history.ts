import "server-only";
import { compactPartNumber } from "./price-import";
import { costLimitsOf, discountTwiceNote, isSettledStatus, partCostCheck, settledCostProblem, type CostLimits, type CostRefs, type CostVerdict, type PaidPrice } from "./part-cost-check";
import { isOurStock, isPlaceholderSupplier, realPartNumber, type RowValues } from "./parts-rows";
import { REAL_COST_MIN_AED, sidelessName } from "./quotes";
import { costConfirmReady } from "./schema-ready";
import { getSettings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate, type PlateFields } from "./types";

/*
 * Placeholder costs (2 November 2026, section 2), the server side: what a part number was really BOUGHT at (LPO lines
 * at the supplier invoice price when there is one, parts ordered or received, the stock list), and the one cost check
 * of each part with it (THE rule is partCostCheck in part-cost-check.ts). Used by the Parts table and its saves, the
 * price memory, the parts desk for estimates, the advisor's "I have a price", the quotation's blockers, the LPO gate
 * and "Prices to fix".
 */

type Bought = PaidPrice & { partId: string | null };
let boughtCache: { at: number; map: Map<string, Bought[]> } | null = null;

/** Reads a whole result page by page (PostgREST answers 1,000 rows at most). */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data } = await page(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** A price that teaches nothing: a placeholder (AED 1.00 or less), a stand-in supplier, a stand-in part number. */
const realPurchase = (pn: string | null | undefined, cost: number, supplier: string | null | undefined) => !!realPartNumber(pn) && cost > 1 && !isPlaceholderSupplier(supplier);

/**
 * The stock items whose cost came from real purchases: a delivery on a stock order, or a part bought for a job and kept
 * in stock, above AED 1.00. Any other stock cost was only typed (the picker's "+ Add to the stock list", the stock
 * page's "Cost each"): it teaches nothing and a part taken from it is asked like any typed cost (2 November 2026).
 */
export async function deliveredStockItems(ids?: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (ids && !ids.length) return out;
  const admin = createAdminClient();
  const rows = await allRows<{ stock_item_id: string }>((a, b) => {
    let q = admin.from("stock_movements").select("stock_item_id").in("kind", ["in", "return"]).gt("unit_cost", 1).or("po_id.not.is.null,part_item_id.not.is.null");
    if (ids) q = q.in("stock_item_id", ids);
    return q.order("created_at").range(a, b);
  });
  for (const r of rows) out.add(r.stock_item_id);
  return out;
}

/** Every price each part number was really bought at, newest first, keyed by the compact part number. Kept a minute per server. */
export async function boughtPrices(): Promise<Map<string, Bought[]>> {
  if (boughtCache && Date.now() - boughtCache.at < 60_000) return boughtCache.map;
  const admin = createAdminClient();
  const [pos, lines, parts, { data: stock }, delivered] = await Promise.all([
    allRows<{ id: string; number: string; status: string; supplier_name: string | null; created_at: string; ordered_at: string | null }>((a, b) => admin.from("purchase_orders").select("id, number, status, supplier_name, created_at, ordered_at").eq("is_active", true).neq("status", "cancelled").order("created_at").range(a, b)),
    allRows<{ po_id: string; part_item_id: string | null; part_number: string | null; unit_cost: number | string | null; invoice_unit_cost: number | string | null; received_at: string | null; created_at: string }>((a, b) => admin.from("purchase_order_lines").select("po_id, part_item_id, part_number, unit_cost, invoice_unit_cost, received_at, created_at").eq("is_active", true).not("part_number", "is", null).order("created_at").range(a, b)),
    allRows<{ id: string; job_id: string; part_number: string | null; cost_aed: number | string | null; final_cost_aed: number | string | null; supplier: string | null; priced_at: string | null; created_at: string }>((a, b) => admin.from("part_items").select("id, job_id, part_number, cost_aed, final_cost_aed, supplier, priced_at, created_at").eq("is_active", true).in("order_status", ["ordered", "partly_received", "received"]).not("part_number", "is", null).order("created_at").range(a, b)),
    admin.from("stock_items").select("id, name, part_number, unit_cost, updated_at").eq("is_active", true).not("part_number", "is", null),
    deliveredStockItems(),
  ]);
  const poById = new Map(pos.map((p) => [p.id, p]));
  const jobIds = Array.from(new Set(parts.map((p) => p.job_id)));
  const { data: jobs } = jobIds.length ? await admin.from("jobs").select("id, job_number").in("id", jobIds) : { data: [] as { id: string; job_number: string }[] };
  const jobNo = new Map((jobs ?? []).map((j) => [j.id as string, j.job_number as string]));
  const map = new Map<string, Bought[]>();
  const add = (pn: string | null, b: Bought) => {
    const k = compactPartNumber(pn);
    if (k.length < 4) return;
    map.set(k, [...(map.get(k) ?? []), b]);
  };
  for (const l of lines) {
    const po = poById.get(l.po_id);
    if (!po) continue;
    const cost = Number(l.invoice_unit_cost ?? l.unit_cost);
    if (!realPurchase(l.part_number, cost, po.supplier_name) || isOurStock(po.supplier_name)) continue;
    add(l.part_number, { cost, where: po.number, on: l.received_at ?? po.ordered_at ?? po.created_at, partId: l.part_item_id });
  }
  for (const p of parts) {
    const cost = Number(p.final_cost_aed ?? p.cost_aed);
    if (!realPurchase(p.part_number, cost, p.supplier) || isOurStock(p.supplier)) continue;
    add(p.part_number, { cost, where: jobNo.get(p.job_id) ?? "an earlier job", on: p.priced_at ?? p.created_at, partId: p.id });
  }
  // The stock list counts only where its cost came from real purchases (a typed stock cost proves nothing).
  for (const s of (stock ?? []) as { id: string; name: string; part_number: string | null; unit_cost: number | string; updated_at: string }[]) {
    const cost = Number(s.unit_cost);
    if (!delivered.has(s.id) || !realPurchase(s.part_number, cost, null)) continue;
    add(s.part_number, { cost, where: "our stock list", on: s.updated_at, partId: null });
  }
  for (const [k, list] of map) map.set(k, list.sort((a, b) => String(b.on ?? "").localeCompare(String(a.on ?? ""))));
  boughtCache = { at: Date.now(), map };
  return map;
}

/** A purchase just recorded (an LPO, a received part): the next check reads afresh. */
export function forgetBoughtPrices() {
  boughtCache = null;
}

/** The fields of a part the check reads. */
export type PartForCheck = {
  id: string;
  job_id?: string | null;
  description: string;
  part_number: string | null;
  part_type?: string | null;
  option_group?: string | null;
  cost_aed: number | string | null;
  list_price_aed?: number | string | null;
  discount_percent?: number | string | null;
  supplier: string | null;
  stock_item_id?: string | null;
  cost_confirmed_aed?: number | string | null;
  is_active?: boolean;
  removed_at?: string | null;
  confirm_status?: string | null;
  /** Ordered or received parts are judged on the cost that really stands (final_cost_aed) when there is one. */
  order_status?: string | null;
  final_cost_aed?: number | string | null;
};

/** One part's cost check: the open question (if any), whether it holds the row (its answer can be stored), and the light note. */
export type CostCheck = { ask: CostVerdict | null; hold: boolean; confirmed: boolean; note: string | null; limits: CostLimits };

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

/** The same part elsewhere on the same car: the other side (sidelessName) or the same number, never an option of the same part or another type. */
function twinsOf(p: PartForCheck, jobParts: PartForCheck[]): { label: string; cost: number }[] {
  const name = sidelessName(p.description);
  const pn = compactPartNumber(realPartNumber(p.part_number));
  return jobParts
    .filter((o) => o.id !== p.id && (o.job_id ?? null) === (p.job_id ?? null) && o.is_active !== false && !o.removed_at && o.confirm_status !== "rejected")
    .filter((o) => !(p.option_group && (o.option_group === p.option_group || o.id === p.option_group)) && !(o.option_group && o.option_group === p.id))
    .filter((o) => !(p.part_type && o.part_type && p.part_type !== o.part_type))
    .filter((o) => (num(o.cost_aed) ?? 0) >= REAL_COST_MIN_AED && !isPlaceholderSupplier(o.supplier))
    .filter((o) => (name && sidelessName(o.description) === name) || (pn.length >= 4 && compactPartNumber(realPartNumber(o.part_number)) === pn))
    .map((o) => ({ label: `${String(o.description).toUpperCase()} on this job`, cost: Number(o.cost_aed) }));
}

/**
 * What a part's cost is compared with, as words and figures: the same part elsewhere on this job (its other side, or
 * the same number), then the last price its part number was BOUGHT at. ONE source for the cost question and the red
 * "check the Parts price" in the owner's revision box (quote-versions.ts).
 */
export async function costReferencesFor(jobId: string, p: Pick<PartForCheck, "id" | "description" | "part_number"> & { part_type?: string | null; option_group?: string | null }): Promise<{ label: string; cost: number }[]> {
  const { data } = await createAdminClient().from("part_items").select("id, job_id, description, part_number, part_type, option_group, cost_aed, supplier, is_active, removed_at, confirm_status").eq("job_id", jobId).eq("is_active", true);
  const twins = twinsOf({ ...p, job_id: jobId, cost_aed: null, supplier: null }, (data ?? []) as PartForCheck[]);
  const last = refsOf(p, await boughtPrices(), []).bought[0];
  return [...twins, ...(last ? [{ label: `the last price paid for ${realPartNumber(p.part_number)} (${last.where})`, cost: last.cost }] : [])];
}

/** What a cost is compared with: the purchases of its part number (never its own) and its twins on the car. */
export function refsOf(p: Pick<PartForCheck, "id" | "part_number">, bought: Map<string, Bought[]>, twins: { label: string; cost: number }[]): CostRefs {
  const k = compactPartNumber(realPartNumber(p.part_number));
  return { bought: k.length >= 4 ? (bought.get(k) ?? []).filter((b) => b.partId !== p.id) : [], twins };
}

/**
 * THE cost check of many parts at once (a job's table, many jobs' counts): each part with its purchases and the same
 * job's other parts as its twins. Before the database change the question is a warning only (hold false).
 */
export async function costChecksFor(parts: PartForCheck[], jobParts: PartForCheck[] = parts): Promise<Map<string, CostCheck>> {
  const out = new Map<string, CostCheck>();
  if (!parts.length) return out;
  const stockIds = Array.from(new Set(parts.map((p) => p.stock_item_id).filter((x): x is string => !!x && x !== "stock")));
  const [bought, settings, hold, delivered] = await Promise.all([boughtPrices(), getSettings(), costConfirmReady(), deliveredStockItems(stockIds)]);
  const limits = costLimitsOf(settings as unknown as Record<string, unknown>);
  for (const p of parts) {
    const cost = num(p.cost_aed);
    const confirmedCost = num(p.cost_confirmed_aed);
    const twins = twinsOf(p, jobParts);
    const refs = refsOf(p, bought, twins);
    // Ordered or received with a cost that really stands (the supplier's invoice, the stock average): it is real.
    const settledReal = isSettledStatus(p.order_status) && num(p.final_cost_aed) !== null;
    // A stock part is exempt only when its item's cost came from real purchases; a typed stock cost is asked.
    const fromStock = !!p.stock_item_id && delivered.has(p.stock_item_id);
    const ask = settledReal ? null : partCostCheck({ cost, confirmedCost, fromStock }, refs, limits);
    const seen = [...twins.map((t) => ({ label: t.label, net: t.cost })), ...refs.bought.slice(0, 5).map((b) => ({ label: `the same part number (${b.where})`, net: b.cost }))];
    const note = discountTwiceNote({ list: num(p.list_price_aed), discount: num(p.discount_percent) }, seen);
    out.set(p.id, { ask, hold, confirmed: cost !== null && confirmedCost !== null && Math.abs(cost - confirmedCost) < 0.005, note, limits });
  }
  return out;
}

/** The cost check of one priced estimate part (the parts desk, the advisor's own price): its purchases and the estimate's other parts. */
export async function costCheckForLine(line: { id: string; title: string; part_number: string | null; cost: number | null; supplier: string | null; confirmedCost?: number | null; /** The stock item the price comes from ("From our stock…"): exempt only when its cost came from deliveries. */ stockItemId?: string | null }, siblings: { id: string; title: string; part_number: string | null; unit_cost: number | string | null; supplier_text?: string | null }[] = []): Promise<CostCheck> {
  const as = (l: { id: string; title: string; part_number: string | null; unit_cost: number | string | null; supplier_text?: string | null }): PartForCheck => ({ id: l.id, job_id: null, description: l.title, part_number: l.part_number, cost_aed: l.unit_cost, supplier: l.supplier_text ?? null });
  const me: PartForCheck = { id: line.id, job_id: null, description: line.title, part_number: line.part_number, cost_aed: line.cost, supplier: line.supplier, cost_confirmed_aed: line.confirmedCost ?? null, stock_item_id: line.stockItemId ?? null };
  const checks = await costChecksFor([me], [me, ...siblings.filter((s) => s.id !== line.id).map(as)]);
  return checks.get(line.id)!;
}

/** The row fields of a check, for the Parts table (RowValues): the question, the cost it is about, and whether it holds the row. */
export function costCheckValues(check: CostCheck | null | undefined, cost: number | string | null): Pick<RowValues, "cost_ask" | "cost_ask_for" | "cost_ask_kind" | "cost_ask_hold" | "cost_note"> {
  return {
    cost_ask: check?.ask?.words ?? "",
    cost_ask_for: check?.ask ? String(cost ?? "") : "",
    cost_ask_kind: check?.ask?.kind ?? "",
    cost_ask_hold: check?.ask && check.hold ? "1" : "",
    cost_note: check?.note ?? "",
  };
}

/* ------------------------------------------------------------------------------------------------------------------
 * 2.4 "Prices to fix": every part or estimate part line with a placeholder price (AED 1.00 or less), a stand-in supplier
 * ("OFJ Additional") or an unanswered cost question, on open jobs and estimates still being prepared, for Parts and the
 * owner. Approved and invoiced ones are listed, never changed here.
 * ---------------------------------------------------------------------------------------------------------------- */

export type PriceToFix = {
  key: string;
  kind: "part" | "estimate";
  jobId: string | null;
  jobNumber: string;
  plate: string;
  car: string;
  part: string;
  partNumber: string | null;
  cost: number | null;
  supplier: string | null;
  lpo: string | null;
  quotation: string | null;
  selling: number | null;
  why: string;
  href: string;
  /** Ordered or received: listed for Parts and the owner, fixed with "Correct the cost…" on the Parts table (or the
   *  supplier invoice on its LPO). Never counted in Parts' Waiting on you. */
  settled: boolean;
};

type CarRow = PlateFields & { make: { name: string } | null; model: { name: string } | null };
const carWords = (v: CarRow | null) => [v?.make?.name, v?.model?.name].filter(Boolean).join(" ");

export async function pricesToFix(): Promise<PriceToFix[]> {
  const admin = createAdminClient();
  const confirmCol = (await costConfirmReady()) ? ", cost_confirmed_aed" : "";
  const { data: jobs } = await admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, make:vehicle_makes(name), model:vehicle_models(name))").eq("is_open", true);
  const jobById = new Map(((jobs ?? []) as unknown as { id: string; job_number: string; vehicle: CarRow | null }[]).map((j) => [j.id, j]));
  const out: PriceToFix[] = [];
  if (jobById.size) {
    const ids = Array.from(jobById.keys());
    const parts: (PartForCheck & { job_id: string; final_cost_aed: number | string | null; order_status: string | null; po_id: string | null; return_status: string | null; not_needed_at: string | null })[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin.from("part_items").select(`id, job_id, description, part_number, part_type, option_group, cost_aed, final_cost_aed, list_price_aed, discount_percent, supplier, stock_item_id, order_status, po_id, return_status, not_needed_at, removed_at, confirm_status, is_active${confirmCol}`).in("job_id", ids.slice(i, i + 200)).eq("is_active", true);
      parts.push(...((data ?? []) as unknown as typeof parts));
    }
    const live = parts.filter((p) => !p.removed_at && p.confirm_status !== "rejected" && p.return_status !== "returned" && !(p.not_needed_at && (p.order_status ?? "none") === "none"));
    const checks = await costChecksFor(live, live);
    // ONE rule per part: still being priced (or approved, not ordered yet) - a placeholder price, a stand-in supplier,
    // an open cost question, or "Our stock" with no stock item; ordered or received - the cost that really stands
    // (settledCostProblem) or an open question about it. A corrected or invoiced cost clears it.
    const whyOf = (p: (typeof live)[number]): string | null => {
      const ask = checks.get(p.id)?.ask ?? null;
      if (isSettledStatus(p.order_status)) return settledCostProblem(p) ?? ask?.words ?? null;
      const cost = num(p.cost_aed);
      if (isPlaceholderSupplier(p.supplier)) return `"${String(p.supplier).trim()}" is not a supplier`;
      if (cost !== null && cost <= 1 && !checks.get(p.id)?.confirmed) return `AED ${cost.toFixed(2)} is not a real price`;
      if (ask) return ask.words;
      if (isOurStock(p.supplier) && !p.stock_item_id) return "from our stock, but no stock item: pick it (From our stock…) so the cost is the stock list's";
      return null;
    };
    const flagged = live.filter((p) => !!whyOf(p));
    if (flagged.length) {
      const poIds = Array.from(new Set(flagged.map((p) => p.po_id).filter((x): x is string => !!x)));
      const [{ data: pos }, { data: qls }] = await Promise.all([
        poIds.length ? admin.from("purchase_orders").select("id, number").in("id", poIds) : Promise.resolve({ data: [] as { id: string; number: string }[] }),
        admin.from("quotation_lines").select("part_item_id, line_total, quotation:quotations!quotation_lines_quotation_id_fkey(number, version, status, created_at)").in("part_item_id", flagged.map((p) => p.id)).eq("is_active", true),
      ]);
      const poNo = new Map((pos ?? []).map((p) => [p.id as string, p.number as string]));
      const lineOf = new Map<string, { total: number; words: string; at: string }>();
      for (const l of (qls ?? []) as unknown as { part_item_id: string; line_total: number | string; quotation: { number: string; version: number; status: string; created_at: string } | null }[]) {
        if (!l.quotation || l.quotation.status === "superseded" || l.quotation.status === "cancelled") continue;
        const have = lineOf.get(l.part_item_id);
        if (have && have.at > l.quotation.created_at) continue;
        lineOf.set(l.part_item_id, { total: Number(l.line_total) || 0, words: `${l.quotation.number} v${l.quotation.version} · ${l.quotation.status.replace(/_/g, " ")}`, at: l.quotation.created_at });
      }
      for (const p of flagged) {
        const j = jobById.get(p.job_id)!;
        const cost = num(p.final_cost_aed) ?? num(p.cost_aed);
        const ql = lineOf.get(p.id);
        out.push({ key: `part:${p.id}`, kind: "part", jobId: p.job_id, jobNumber: j.job_number, plate: j.vehicle ? formatPlate(j.vehicle) : j.job_number, car: carWords(j.vehicle), part: String(p.description).toUpperCase(), partNumber: realPartNumber(p.part_number), cost, supplier: p.supplier, lpo: p.po_id ? (poNo.get(p.po_id) ?? null) : null, quotation: ql?.words ?? null, selling: ql ? ql.total : null, why: whyOf(p) ?? "price to check", href: `/parts/${p.job_id}#pricing`, settled: isSettledStatus(p.order_status) });
      }
    }
  }
  // Estimate parts priced by the desk or the advisor, on estimates still with us or with the customer (not carried over yet).
  const { data: estLines } = await admin
    .from("quotation_lines")
    .select("id, title, part_number, unit_cost, supplier_text, line_total, quotation:quotations!quotation_lines_quotation_id_fkey(id, number, version, status, kind, is_active, carried_job_id, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, make:vehicle_makes(name), model:vehicle_models(name)))")
    .eq("line_type", "part")
    .is("part_item_id", null)
    .eq("is_active", true)
    .not("unit_cost", "is", null);
  for (const l of (estLines ?? []) as unknown as { id: string; title: string; part_number: string | null; unit_cost: number | string | null; supplier_text: string | null; line_total: number | string; quotation: { id: string; number: string; version: number; status: string; kind: string; is_active: boolean; carried_job_id: string | null; vehicle: CarRow | null } | null }[]) {
    const q = l.quotation;
    if (!q || q.kind !== "estimate" || !q.is_active || q.carried_job_id || !["draft", "pending_owner", "sent", "opened"].includes(q.status)) continue;
    const cost = num(l.unit_cost);
    if (!((cost !== null && cost <= 1) || isPlaceholderSupplier(l.supplier_text))) continue;
    out.push({ key: `line:${l.id}`, kind: "estimate", jobId: null, jobNumber: `ESTIMATE ${q.number}`, plate: q.vehicle ? formatPlate(q.vehicle) : "", car: carWords(q.vehicle), part: String(l.title).toUpperCase(), partNumber: realPartNumber(l.part_number), cost, supplier: l.supplier_text, lpo: null, quotation: `${q.number} v${q.version} · ${q.status.replace(/_/g, " ")}`, selling: Number(l.line_total) || 0, why: isPlaceholderSupplier(l.supplier_text) ? `"${String(l.supplier_text).trim()}" is not a supplier` : `AED ${(cost ?? 0).toFixed(2)} is not a real price`, href: `/parts/estimate/${q.id}`, settled: false });
  }
  // Still to be priced first, then the ones already ordered or invoiced; within each, by job.
  return out.sort((a, b) => Number(a.settled) - Number(b.settled) || a.jobNumber.localeCompare(b.jobNumber) || a.part.localeCompare(b.part));
}
