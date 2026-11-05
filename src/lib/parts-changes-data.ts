import "server-only";
import { pageAllIn } from "./page-all";
import { partsChangesOf, type ApprovedPartLine, type ChangePart, type PartsChanges } from "./parts-changes";
import { PAST_QUOTE } from "./parts-steps";
import { schemaReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";

/** The refused-line columns (migration 20261202110000, applied on live 2 November 2026). */
const refusalsReadyLocal = () => schemaReady("part_items", "refused_at");

type Res<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * The part ids on each job's APPROVED quotations (5 November 2026): every part line of an approved (or urgent-only)
 * version, left-off lines and unchosen options included - the customer saw them, so they are never "new". A part that
 * REPLACES one of them (another supplier, an exchange) inherits its approval.
 */
export async function approvedPartIds(jobIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!jobIds.length) return out;
  const admin = createAdminClient();
  const qs = await pageAllIn<{ id: string; job_id: string }>(jobIds, (ids, a, b) => admin.from("quotations").select("id, job_id").in("job_id", ids).eq("kind", "quotation").eq("is_active", true).in("status", ["approved", "urgent_requested"]).order("id").range(a, b) as unknown as Res<{ id: string; job_id: string }>);
  const jobOfQ = new Map(qs.map((q) => [q.id, q.job_id]));
  const lines = qs.length ? await pageAllIn<{ quotation_id: string; part_item_id: string }>(qs.map((q) => q.id), (ids, a, b) => admin.from("quotation_lines").select("quotation_id, part_item_id").in("quotation_id", ids).eq("line_type", "part").not("part_item_id", "is", null).order("id").range(a, b) as unknown as Res<{ quotation_id: string; part_item_id: string }>) : [];
  for (const l of lines) {
    const j = jobOfQ.get(l.quotation_id);
    if (!j) continue;
    if (!out.has(j)) out.set(j, new Set());
    out.get(j)!.add(l.part_item_id);
  }
  // Replacements inherit the approval of the part they replace (a chain of two at most in practice).
  const reps = await pageAllIn<{ id: string; job_id: string; replaced_part_id: string }>(jobIds, (ids, a, b) => admin.from("part_items").select("id, job_id, replaced_part_id").in("job_id", ids).not("replaced_part_id", "is", null).order("id").range(a, b) as unknown as Res<{ id: string; job_id: string; replaced_part_id: string }>);
  for (let pass = 0; pass < 3; pass++) {
    for (const r of reps) {
      const set = out.get(r.job_id);
      if (set?.has(r.replaced_part_id)) set.add(r.id);
    }
  }
  return out;
}

/**
 * The real cost of each job's LIVE, approved parts that no invoice line carries (5 November 2026, J-00985: parts added
 * after the customer's approval and resent never reach the invoice, which copies the approved quotation). A part
 * that replaces an invoiced one counts through that line, never again. The cost is the one that stands: the
 * supplier invoice's (final) when entered, else the priced cost.
 */
export async function partsOffInvoice(jobIds: string[], onInvoice: Set<string>): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!jobIds.length) return out;
  const admin = createAdminClient();
  type P = { id: string; job_id: string; cost_aed: number | string | null; final_cost_aed: number | string | null; confirmed_quantity: number | string | null; quantity: number | string | null; order_status: string | null; is_active: boolean; removed_at: string | null; disposition: string | null; replaced_part_id: string | null };
  const rows = await pageAllIn<P>(jobIds, (ids, a, b) => admin.from("part_items").select("id, job_id, cost_aed, final_cost_aed, confirmed_quantity, quantity, order_status, is_active, removed_at, disposition, replaced_part_id").in("job_id", ids).order("id").range(a, b) as unknown as Res<P>);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const coveredByInvoice = (p: P) => {
    let cur: P | undefined = p;
    for (let i = 0; i < 5 && cur; i++) {
      if (onInvoice.has(cur.id)) return true;
      cur = cur.replaced_part_id ? byId.get(cur.replaced_part_id) : undefined;
    }
    return false;
  };
  for (const p of rows) {
    const live = p.is_active !== false && !p.removed_at && !p.disposition;
    if (!live || (p.order_status ?? "none") === "none" || coveredByInvoice(p)) continue;
    const cost = Number(p.final_cost_aed ?? p.cost_aed) || 0;
    const qty = Number(p.confirmed_quantity ?? p.quantity) || 1;
    out.set(p.job_id, Math.round(((out.get(p.job_id) ?? 0) + cost * qty) * 100) / 100);
  }
  return out;
}

type ChangeRow = { id: string; job_id: string; description: string; cost_aed: number | string | null; confirmed_quantity: number | string | null; quantity: number | string | null; order_status: string | null; is_active: boolean; removed_at: string | null; removed_reason: string | null; disposition: string | null; disposition_note: string | null; not_needed_reason: string | null; replaced_part_id: string | null; refused_at?: string | null };
export type JobPartsChanges = PartsChanges & { approvedIds: Set<string>; quotationIds: string[] };

/** The one job's parts as the rule reads them: a live replacement stands in for the approved line it replaces. */
function changesFor(approved: ApprovedPartLine[], rows: ChangeRow[]): PartsChanges {
  const onLine = new Set(approved.map((l) => l.part_item_id));
  const toChange = (p: ChangeRow, asId?: string): ChangePart => ({
    id: asId ?? p.id,
    description: p.description,
    cost: p.cost_aed === null || p.cost_aed === undefined ? null : Number(p.cost_aed),
    qty: Number(p.confirmed_quantity ?? p.quantity) || 1,
    order_status: p.order_status,
    live: p.is_active !== false && !p.removed_at && !p.disposition && !p.refused_at,
    reason: p.disposition_note ?? p.not_needed_reason ?? p.removed_reason ?? null,
  });
  // A live replacement (another supplier for a refused line, an exchange) is compared with the line it replaces
  // ("changed"), never "added" + "removed".
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rootOf = (p: ChangeRow): string | null => {
    let cur: ChangeRow | undefined = p;
    for (let i = 0; i < 4 && cur?.replaced_part_id; i++) {
      if (onLine.has(cur.replaced_part_id)) return cur.replaced_part_id;
      cur = byId.get(cur.replaced_part_id);
    }
    return null;
  };
  const standIn = new Map<string, ChangeRow>();
  for (const p of rows) {
    const root = rootOf(p);
    if (root && toChange(p).live) standIn.set(root, p);
  }
  const parts: ChangePart[] = [];
  for (const p of rows) {
    if (standIn.has(p.id)) continue; // its live replacement speaks for it
    const root = rootOf(p);
    if (root) {
      if (standIn.get(root) === p) parts.push(toChange(p, root));
      continue; // a replacement that is no longer live counts for nothing
    }
    parts.push(toChange(p));
  }
  return partsChangesOf(approved, parts);
}

/** What changed on each job's parts since its quotation was approved (jobs before the customer's approval are left out). */
export async function loadPartsChangesMany(jobIds: string[]): Promise<Map<string, JobPartsChanges>> {
  const out = new Map<string, JobPartsChanges>();
  if (!jobIds.length) return out;
  const admin = createAdminClient();
  const jobs = await pageAllIn<{ id: string; status: string }>(jobIds, (ids, a, b) => admin.from("jobs").select("id, status").in("id", ids).order("id").range(a, b) as unknown as Res<{ id: string; status: string }>);
  const past = jobs.filter((j) => PAST_QUOTE.includes(String(j.status))).map((j) => j.id);
  if (!past.length) return out;
  const qs = await pageAllIn<{ id: string; job_id: string }>(past, (ids, a, b) => admin.from("quotations").select("id, job_id").in("job_id", ids).eq("kind", "quotation").eq("is_active", true).in("status", ["approved", "urgent_requested"]).order("id").range(a, b) as unknown as Res<{ id: string; job_id: string }>);
  const jobOfQ = new Map(qs.map((q) => [q.id, q.job_id]));
  const refusals = await refusalsReadyLocal();
  const [lineRows, partRows, approvedMap] = await Promise.all([
    qs.length ? pageAllIn<{ quotation_id: string; part_item_id: string; unit_cost: number | string | null; quantity: number | string }>(qs.map((q) => q.id), (ids, a, b) => admin.from("quotation_lines").select("quotation_id, part_item_id, unit_cost, quantity").in("quotation_id", ids).eq("line_type", "part").not("part_item_id", "is", null).order("id").range(a, b) as unknown as Res<{ quotation_id: string; part_item_id: string; unit_cost: number | string | null; quantity: number | string }>) : Promise.resolve([]),
    pageAllIn<ChangeRow>(past, (ids, a, b) => admin.from("part_items").select(`id, job_id, description, cost_aed, confirmed_quantity, quantity, order_status, is_active, removed_at, removed_reason, disposition, disposition_note, not_needed_reason, replaced_part_id${refusals ? ", refused_at" : ""}`).in("job_id", ids).order("id").range(a, b) as unknown as Res<ChangeRow>),
    approvedPartIds(past),
  ]);
  for (const jobId of past) {
    const approved: ApprovedPartLine[] = lineRows.filter((l) => jobOfQ.get(l.quotation_id) === jobId).map((l) => ({ part_item_id: l.part_item_id, unit_cost: l.unit_cost === null ? null : Number(l.unit_cost), quantity: Number(l.quantity) || 1 }));
    const c = changesFor(approved, partRows.filter((p) => p.job_id === jobId));
    out.set(jobId, { ...c, approvedIds: approvedMap.get(jobId) ?? new Set<string>(), quotationIds: qs.filter((q) => q.job_id === jobId).map((q) => q.id) });
  }
  return out;
}

/** What changed on one job's parts since its quotation was approved, or null before the customer's approval. */
export async function loadPartsChanges(jobId: string): Promise<JobPartsChanges | null> {
  return (await loadPartsChangesMany([jobId])).get(jobId) ?? null;
}
