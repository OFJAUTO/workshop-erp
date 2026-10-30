import { hasPackageLine, isComplimentary, isHidden, isUnchosen, linePrice, profitLines, quoteTotals, type QuoteLine, type QuoteRow, type QuoteTotals } from "./quotes";
import { lineIsPpf } from "./ppf-cut";

/**
 * Complimentary work (30 October 2026, night batch section 5). Free is always a decision with a reason, approved by the
 * owner before the quotation can go out (and so before any work starts), and it always shows what it costs us - from
 * THE profit calculation (quoteTotals), never a materials figure of 0. Pure: the editor, the owner's box, the send
 * check, the documents and the reports read these rules.
 */

export const COMP_REASONS = ["our_mistake", "goodwill", "warranty"] as const;
export type CompReason = (typeof COMP_REASONS)[number];
export const COMP_REASON_LABELS: Record<CompReason, string> = {
  our_mistake: "Our mistake / rework",
  goodwill: "Goodwill gesture",
  warranty: "Warranty claim (our 6-month warranty)",
};
export const isCompReason = (v: unknown): v is CompReason => COMP_REASONS.includes(v as CompReason);
/** Our mistake and warranty point at the original job; goodwill needs a note saying why. */
export const needsOriginalJob = (r: CompReason | null | undefined) => r === "our_mistake" || r === "warranty";

type Line = QuoteLine;
type Q = Pick<QuoteRow, "discount_percent" | "vat_percent"> & Partial<QuoteRow> & { comp_reason?: string | null; comp_original_job_id?: string | null; comp_note?: string | null; comp_status?: string | null };

const counted = (l: Line) => l.is_active && !isUnchosen(l) && l.fee_kind !== "bank_charge";

/** A free recovery: we pay the truck and the customer pays nothing for it. */
export function isFreeRecovery(l: Line): boolean {
  return l.line_type === "recovery" && l.recovery_provider_kind !== "customer" && (l.recovery_paid_by === "us" || !!l.recovery_mention_free || isComplimentary(l) || (!isHidden(l) && !(Number(l.unit_price) > 0)));
}

/** A PPF package on the quotation: its free pick-up and drop-off is pre-approved (5.5). */
export function hasPpfPackage(lines: Line[]): boolean {
  return hasPackageLine(lines) && lines.some((l) => counted(l) && !!l.package_key && lineIsPpf(l));
}

/** Why one line is free, or null: Complimentary (not "Included", which is part of a paid line), a 100% discount, or a free recovery. */
export function compKindOf(l: Line): "complimentary" | "full_discount" | "free_recovery" | null {
  if (!counted(l)) return null;
  if (l.line_type === "recovery") return isFreeRecovery(l) ? "free_recovery" : null;
  if (l.price_display === "complimentary") return "complimentary";
  if ((Number(l.discount_percent) || 0) >= 100) return "full_discount";
  return null;
}

/** The lines the owner must approve as free. A free recovery is pre-approved with a PPF package; a quotation whose total is nothing counts whole. */
export function compLinesOf(lines: Line[], q: Q): Line[] {
  const ppf = hasPpfPackage(lines);
  const free = lines.filter((l) => { const k = compKindOf(l); return k === "free_recovery" ? !ppf : !!k; });
  const active = lines.filter((l) => counted(l) && !isHidden(l));
  if (active.length) {
    const t = quoteTotals(lines, q as QuoteRow, {});
    // Everything shown, nothing to pay: the whole job is complimentary, whatever words were used ("Included" too).
    if (t.total <= 0) return lines.filter((l) => counted(l) && (!isFreeRecovery(l) || !ppf));
  }
  return free;
}

/** The normal price of a free line: as if sold normally (no Complimentary, no discount), before VAT. */
export function normalPriceOf(l: Line): number {
  return Math.round(linePrice({ ...l, price_display: "normal", visible_to_customer: true }) * 100) / 100;
}

export type CompCost = { normal: number; cost: number; labour: number; parts: number; materials: number; film: number; recovery: number; other: number; detail: string };

/**
 * The cost to us of the free lines, from THE calculation (quoteTotals with the same costing as the profit): labour hours
 * at the cost rate, parts at cost, materials worked out (film, tint, ceramic, consumables - never 0 for film work),
 * recovery. "labour 50 · film 29 · recovery 150".
 */
export function compCost(free: Line[], q: Q, opts: Parameters<typeof quoteTotals>[2] = {}, rates: { technician: number; bodyshop: number } = { technician: 0, bodyshop: 0 }): CompCost {
  const bare = { ...(q as QuoteRow), discount_percent: 0, discount_kind: null, discount_value: null, commission_kind: null, commission_value: null, materials_cost_aed: 0, deposit_mode: null, deposit_value: null, rounded_total_aed: null } as QuoteRow;
  const t: QuoteTotals = quoteTotals(free, bare, { ...opts, bankChargePercent: 0, bankChargeFixed: 0, supplierCharges: 0, clockedHours: opts.clockedHours ?? null });
  const lines = profitLines(t, rates);
  const amount = (k: string) => lines.find((x) => x.key === k)?.amount ?? 0;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const film = r2(t.packageMaterials.film + t.packageMaterials.tint);
  const materials = r2(amount("materials"));
  const parts = r2(amount("parts"));
  const labour = r2(amount("labour"));
  const recovery = r2(amount("recovery"));
  const other = r2(amount("outside") + amount("other"));
  const cost = r2(parts + labour + materials + recovery + other);
  const n = (x: number) => Math.round(x).toLocaleString("en-GB");
  const detail = [labour ? `labour ${n(labour)}` : null, parts ? `parts ${n(parts)}` : null, film ? `film ${n(film)}` : null, materials - film > 0.5 ? `materials ${n(materials - film)}` : null, recovery ? `recovery ${n(recovery)}` : null, other ? `other ${n(other)}` : null].filter(Boolean).join(" · ");
  return { normal: r2(free.reduce((a, l) => a + normalPriceOf(l), 0)), cost, labour, parts, materials, film, recovery, other, detail };
}

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "Normal price AED 350.00 · Cost to us AED 229.00 (labour 50 · film 29 · recovery 150)". */
export const compCostWords = (c: CompCost) => `Normal price ${aed(c.normal)} · Cost to us ${aed(c.cost)}${c.detail ? ` (${c.detail})` : ""}`;

/** What is missing before the free part can go to the owner: the reason, and the original job or the note it needs. */
export function compProblem(q: Q): string | null {
  if (!isCompReason(q.comp_reason)) return "Complimentary needs a reason: our mistake, goodwill or warranty";
  if (needsOriginalJob(q.comp_reason) && !q.comp_original_job_id) return "Complimentary (our mistake or warranty): pick the original job";
  if (q.comp_reason === "goodwill" && !(q.comp_note ?? "").trim()) return "Complimentary (goodwill): write why";
  return null;
}

/**
 * The owner-approval reason for the free part (joined with the other reasons by "; "): the lines, the reason and the
 * normal price - figures that only change when the free part itself changes, so an approval is never undone by the
 * clock (the cost to us is shown next to it, from today's figures).
 */
export function compApprovalReason(lines: Line[], q: Q, originalJobNumber?: string | null): string | null {
  const free = compLinesOf(lines, q);
  if (!free.length) return null;
  const why = isCompReason(q.comp_reason) ? COMP_REASON_LABELS[q.comp_reason] : "no reason yet";
  const extra = needsOriginalJob(isCompReason(q.comp_reason) ? q.comp_reason : null) && originalJobNumber ? ` of ${originalJobNumber}` : q.comp_reason === "goodwill" && q.comp_note ? `: ${q.comp_note.trim()}` : "";
  const what = free.map((l) => (l.title || "line").trim()).join(", ");
  return `complimentary (${why}${extra}): ${what} · normal price ${aed(free.reduce((a, l) => a + normalPriceOf(l), 0))}`;
}

/**
 * The customer's word for a free line (5.6): goodwill "COMPLIMENTARY (value AED 350.00)", our mistake or warranty
 * "NO CHARGE", "Included" stays Included. Never our cost.
 */
export function customerCompWord(l: Pick<Line, "price_display"> & Partial<Line>, reason: string | null | undefined, value?: number | null): string {
  if (l.price_display === "included") return "Included";
  if (reason === "our_mistake" || reason === "warranty") return "NO CHARGE";
  // A quotation from before the reasons (or none chosen yet) keeps its old word.
  if (reason !== "goodwill") return "Complimentary";
  const v = value ?? (l.line_type ? normalPriceOf(l as Line) : 0);
  return v > 0 ? `COMPLIMENTARY (value ${aed(v)})` : "COMPLIMENTARY";
}
