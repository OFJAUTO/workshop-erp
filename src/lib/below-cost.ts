import "server-only";
import { notifyRoles, notifyStaff } from "./notifications";
import { LINE_SELECT, attachBelowCost, logQuoteEvent, packageCostingForQuote, toLine } from "./quote-data";
import { quoteLeadIds } from "./quote-lead";
import { belowCostAll, belowCostWords, needsPackageCosting, type BelowCost, type BelowCostOpts, type QuoteHeaderForTotals, type QuoteLine } from "./quotes";
import { belowCostReady } from "./schema-ready";
import { getSettings, type Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";

/*
 * Nothing below cost (2 November 2026), the server side. THE rule is belowCostOf / belowCostAll in quotes.ts; this file
 * only reads a quotation's lines with the owner's approvals and what they are judged with (the package costing, the
 * bodyshop rate, the header discount), writes his approval on a line, and tells the people in charge when a line went
 * below its cost without anyone typing a price (Parts changed the cost, a typed cost, a discount share).
 */

type QuoteRef = { id: string; number: string; version: number; kind: "quotation" | "estimate"; job_id: string | null; created_by: string | null; vehicle_id: string | null; film_rolls_est?: number | string | null; tint_spec?: unknown; discount_percent?: number | string | null; vat_percent?: number | string | null; discount_kind?: "percent" | "aed" | null; discount_value?: number | string | null; discount_scope?: "labour" | "labour_services" | null };

/** The quotation columns the below-cost check reads (the header discount and the package costing). */
export const BELOW_COST_Q_COLS = "id, number, version, kind, job_id, created_by, vehicle_id, film_rolls_est, tint_spec, discount_percent, vat_percent, discount_kind, discount_value, discount_scope";

/** The header discount fields of a quotation row, as the price rule reads them. */
export function headerOf(q: Pick<QuoteRef, "discount_percent" | "vat_percent" | "discount_kind" | "discount_value" | "discount_scope">): QuoteHeaderForTotals {
  return { discount_percent: Number(q.discount_percent) || 0, vat_percent: q.vat_percent === null || q.vat_percent === undefined ? 5 : Number(q.vat_percent), discount_kind: q.discount_kind ?? null, discount_value: q.discount_value === null || q.discount_value === undefined ? null : Number(q.discount_value), discount_scope: q.discount_scope ?? null };
}

/** What a quotation's lines are judged with: the package costing (only when a line needs it) and the bodyshop rate. ONE place on the server. */
export async function belowCostOptsFor(settings: Settings, q: Pick<QuoteRef, "vehicle_id" | "film_rolls_est" | "tint_spec">, lines: QuoteLine[]): Promise<Omit<BelowCostOpts, "headerDiscount">> {
  return { packageCosting: await packageCostingForQuote(settings, q, needsPackageCosting(lines)), bodyshopRate: Number(settings.bodyshop_cost_rate_aed) || 50 };
}

/** A quotation's active lines with the owner's approvals, its header discount, and what the lines are judged with. */
export async function linesForBelowCost(quotationId: string): Promise<{ q: QuoteRef | null; header: QuoteHeaderForTotals | null; lines: QuoteLine[]; opts: Omit<BelowCostOpts, "headerDiscount"> }> {
  const admin = createAdminClient();
  const [{ data: q }, { data: rows }] = await Promise.all([
    admin.from("quotations").select(BELOW_COST_Q_COLS).eq("id", quotationId).maybeSingle(),
    admin.from("quotation_lines").select(LINE_SELECT).eq("quotation_id", quotationId).eq("is_active", true),
  ]);
  const lines = await attachBelowCost(((rows ?? []) as Record<string, unknown>[]).map(toLine));
  const opts = q ? await belowCostOptsFor(await getSettings(), q as QuoteRef, lines) : {};
  return { q: (q as QuoteRef | null) ?? null, header: q ? headerOf(q as QuoteRef) : null, lines, opts };
}

/** The lines of a quotation below their cost with no approval covering them (the ones "Before sending" stops). */
export async function unapprovedBelowCost(quotationId: string): Promise<{ line: QuoteLine; below: BelowCost }[]> {
  const { lines, header, opts } = await linesForBelowCost(quotationId);
  const all = belowCostAll(lines, header, opts);
  return lines.map((line) => ({ line, below: all.get(line.id) ?? null })).filter((x): x is { line: QuoteLine; below: BelowCost } => !!x.below && !x.below.approved);
}

/**
 * The owner's approval of one line below its cost: the reason and the figures he saw (a lower price or a higher cost
 * later is not covered), logged on the quotation and the job with the figures. False before the migration.
 */
export async function stampBelowCost(q: { id: string; number: string; version: number; job_id: string | null }, line: Pick<QuoteLine, "id" | "title">, b: Pick<BelowCost, "cost" | "sell" | "short">, reason: string, by: { id: string; display_name: string }): Promise<boolean> {
  if (!(await belowCostReady())) return false;
  const { error } = await createAdminClient().from("quotation_lines").update({ below_cost_reason: reason.trim().slice(0, 500), below_cost_by: by.id, below_cost_at: new Date().toISOString(), below_cost_sell_aed: b.sell, below_cost_cost_aed: b.cost, updated_by: by.id }).eq("id", line.id);
  if (error) return false;
  await logQuoteEvent(q.id, q.job_id, by.id, "below_cost_approved", `${q.number} v${q.version}: ${by.display_name} approved ${belowCostWords(line.title, b).replace(" would sell ", " selling ")}: ${reason.trim()}`);
  return true;
}

/**
 * After a cost changed without anyone typing a price (Parts priced or re-priced a part, the parts desk priced an
 * estimate part, a typed cost, a discount share that moved): a line that now sells below its cost is written on the
 * quotation and the people in charge are told once per change. Nothing is refused - the cost is a fact; "Before
 * sending" stops it until the price is raised or the owner approves it. The person who made the change is not told
 * about his own change (the owner neither).
 */
export async function flagBelowCost(quotationId: string, lineIds: string[], by: string | null, why: string): Promise<number> {
  if (!lineIds.length) return 0;
  const { q, header, lines, opts } = await linesForBelowCost(quotationId);
  if (!q) return 0;
  const all = belowCostAll(lines, header, opts);
  const hits = lines.filter((l) => lineIds.includes(l.id)).map((line) => ({ line, below: all.get(line.id) ?? null })).filter((x): x is { line: QuoteLine; below: BelowCost } => !!x.below && !x.below.approved);
  if (!hits.length) return 0;
  const words = hits.map((h) => belowCostWords(h.line.title, h.below)).join("; ");
  await logQuoteEvent(q.id, q.job_id, by, "below_cost", `${q.number} v${q.version}: ${words} (${why}). It cannot be sent until the price is raised or the owner approves it.`);
  const href = q.job_id ? `/jobs/${q.job_id}/quote/${q.id}` : `/estimates/${q.id}`;
  const leads = (await quoteLeadIds(q)).filter((x) => x !== by);
  const title = `Below cost on ${q.kind === "estimate" ? "ESTIMATE " : ""}${q.number}: ${hits[0].line.title}${hits.length > 1 ? ` +${hits.length - 1}` : ""}`;
  if (leads.length) await notifyStaff(leads, { type: "quote_below_cost", title, body: `${words}. Raise the price, or ask the owner to approve it.`, jobId: q.job_id, href });
  const { data: who } = by ? await createAdminClient().from("staff").select("role_id").eq("id", by).maybeSingle() : { data: null };
  if (who?.role_id !== "owner") await notifyRoles(["owner"], { type: "quote_below_cost", title, body: `${words} (${why}).`, jobId: q.job_id, href });
  return hits.length;
}
