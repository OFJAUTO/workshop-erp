/**
 * The inspection fee, chosen per car (30 October 2026). Pure: the gate-in, the approval link, the job card, the
 * customer's approval page and the owner's report all read these rules.
 *
 *  - [Inspection fee]: the advisor sets the amount before VAT - quick buttons 500 · 1,000 · 2,500 or any amount from the
 *    minimum to the maximum (Settings, the owner's). Suggested from the old setting (750; 1,500 for premium brands).
 *    The customer's page shows it WITH VAT as already agreed.
 *  - [No inspection fee]: a reason from the list (a note for Other); the customer's page then says nothing about a fee.
 *    Then the inspection type: Full inspection (shown as "Free full inspection") or Quick job (no inspection stage:
 *    straight to the quotation, e.g. "change front right tyre").
 *  - Locked once the customer approves the job card; only the owner changes it afterwards, with a reason (logged).
 */
export type FeeChoice = "fee" | "none";
export type InspectionType = "full" | "quick";

export const FEE_CHIPS = [500, 1000, 2500] as const;

export const NO_FEE_REASONS: { key: string; label: string }[] = [
  { key: "simple_job", label: "Simple job (e.g. tyre change)" },
  { key: "regular_customer", label: "Regular customer" },
  { key: "warranty", label: "Warranty / PPF recheck" },
  { key: "company_contract", label: "Company contract" },
  { key: "other", label: "Other" },
];
export const noFeeReasonLabel = (key: string | null | undefined) => NO_FEE_REASONS.find((r) => r.key === key)?.label ?? (key || "No reason given");

export type FeeInput = { choice: FeeChoice | null; amount: number | null; reason: string | null; note: string | null; type: InspectionType };
export type FeeBounds = { min: number; max: number; suggested: number; vatPercent: number };

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });

/** The amount the customer pays, VAT included (to the fils). */
export function feeWithVat(amount: number, vatPercent: number): number {
  return Math.round(amount * (1 + vatPercent / 100) * 100) / 100;
}

/** Reads the choice from a form's fields (fee_choice, inspection_fee, no_fee_reason, no_fee_note, inspection_type). */
export function feeInputFrom(get: (k: string) => string): FeeInput {
  const c = get("fee_choice");
  const raw = get("inspection_fee").replace(/,/g, "").replace(/[^\d.]/g, "");
  return {
    choice: c === "fee" || c === "none" ? c : null,
    amount: raw === "" ? null : Math.round(Number(raw) * 100) / 100,
    reason: get("no_fee_reason") || null,
    note: get("no_fee_note").trim() || null,
    type: get("inspection_type") === "quick" ? "quick" : "full",
  };
}

/**
 * The one check, on the screen and on the server: a choice is required; a fee is between the minimum and the maximum
 * (the owner may go outside, written down); no fee needs a reason (and a note for Other).
 */
export function checkFee(input: FeeInput, bounds: Pick<FeeBounds, "min" | "max">, isOwner: boolean): { error: string } | { ok: true; outside: boolean } {
  if (!input.choice) return { error: "Choose Inspection fee or No inspection fee." };
  if (input.choice === "fee") {
    if (input.amount === null || !Number.isFinite(input.amount) || input.amount <= 0) return { error: "Enter the inspection fee in AED (before VAT)." };
    const outside = input.amount < bounds.min || input.amount > bounds.max;
    if (outside && !isOwner) return { error: `The inspection fee is AED ${whole(bounds.min)} to ${whole(bounds.max)}: AED ${whole(input.amount)} is ${input.amount > bounds.max ? "above the maximum" : "below the minimum"}. Only the owner can go outside it.` };
    return { ok: true, outside };
  }
  if (!input.reason || !NO_FEE_REASONS.some((r) => r.key === input.reason)) return { error: "Pick why there is no inspection fee." };
  if (input.reason === "other" && (input.note ?? "").length < 3) return { error: "Other: write why there is no inspection fee." };
  return { ok: true, outside: false };
}

/** The customer's notice, English and Arabic, from the Settings wording: [total] with VAT, [amount] before VAT. */
export function feeNoticeTexts(templates: { en: string | null | undefined; ar: string | null | undefined }, amount: number, vatPercent: number): { en: string; ar: string | null } {
  const total = feeWithVat(amount, vatPercent);
  const fill = (t: string) => t.replaceAll("[total]", money(total)).replaceAll("[amount]", whole(amount)).replaceAll("[vat]", whole(vatPercent));
  return { en: fill(String(templates.en ?? "")), ar: templates.ar ? fill(String(templates.ar)) : null };
}

/** The words on the job card, the lists and the owner's report. */
export function feeWords(job: { inspection_fee_choice?: string | null; inspection_fee_aed?: number | string | null; no_fee_reason?: string | null; inspection_type?: string | null }): string {
  if (job.inspection_fee_choice === "none") return job.inspection_type === "quick" ? `No inspection fee · quick job (${noFeeReasonLabel(job.no_fee_reason)})` : `Free full inspection (${noFeeReasonLabel(job.no_fee_reason)})`;
  const n = Number(job.inspection_fee_aed);
  if (job.inspection_fee_choice === "fee" || n > 0) return `Inspection fee AED ${whole(n || 0)} + VAT`;
  return "Inspection fee not chosen yet";
}

/** A quick job (no fee, no full inspection) skips the Inspection stage and goes straight to the quotation. */
export const isQuickJob = (job: { inspection_fee_choice?: string | null; inspection_type?: string | null }) => job.inspection_fee_choice === "none" && job.inspection_type === "quick";

/**
 * A fee the customer approved with the OLD wording ("an inspection fee of AED 750 will apply", VAT not mentioned) is
 * charged as that amount INCLUDING VAT (30 October 2026): 750.00 = 714.29 + VAT 35.71. The VAT takes the rounding, so
 * the two always add up to the amount the customer read.
 */
export function inclusiveSplit(total: number, vatPercent: number): { net: number; vat: number; total: number } {
  const net = Math.round((total / (1 + vatPercent / 100)) * 100) / 100;
  return { net, vat: Math.round((total - net) * 100) / 100, total };
}

/** The approved wording mentions no VAT: the old wording of before 30 October 2026. */
export const isOldFeeWording = (text: string | null | undefined) => !!text && !/\bVAT\b|ضريبة/i.test(text);
