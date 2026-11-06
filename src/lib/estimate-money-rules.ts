/**
 * Money from the estimate (4 November 2026) — the PURE rules, shared by the estimate page, the
 * Estimates list, the money list and the server. No server imports, so the unit test runs it directly.
 *
 * A customer (often a company) accepts an estimate and pays BEFORE the car arrives: a PROFORMA
 * INVOICE is issued from the estimate — COMPLETE (the whole bill) or PARTIAL (% or AED) — and the
 * moment it is paid the TAX INVOICE follows by itself. A partial payment's tax invoice is an
 * "Advance payment against estimate E-xxxxx" with the VAT inside the amount, marked as a deposit
 * document so the job's final invoice deducts it and Zoho never counts it twice.
 */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The bill-to block on the estimate, the proforma and the tax invoices. All fields optional; may differ from the car's owner. */
export type BillTo = { company: string; address: string; trn: string; attention: string; po_number: string };

/** Trimmed and capped; null when every field is empty (the documents then show the customer as today). */
export function cleanBillTo(raw: Partial<Record<keyof BillTo, unknown>> | null | undefined): BillTo | null {
  const take = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const b: BillTo = {
    company: take(raw?.company, 160),
    address: take(raw?.address, 300),
    trn: take(raw?.trn, 20).replace(/[^\d]/g, ""),
    attention: take(raw?.attention, 120),
    po_number: take(raw?.po_number, 60),
  };
  return b.company || b.address || b.trn || b.attention || b.po_number ? b : null;
}

/** A TRN, when given, is 15 digits (the customers rule). */
export function billToProblem(b: BillTo | null): string | null {
  if (b?.trn && !/^\d{15}$/.test(b.trn)) return "The TRN is 15 digits (leave it empty if the company is not VAT-registered).";
  return null;
}

/** The printable bill-to lines, in order, for pages and PDFs. */
export function billToWords(b: BillTo | null | undefined): string[] {
  if (!b) return [];
  return [
    b.company || null,
    b.attention ? `Attn: ${b.attention}` : null,
    b.address || null,
    b.trn ? `TRN ${b.trn}` : null,
    b.po_number ? `Your PO/ref: ${b.po_number}` : null,
  ].filter((x): x is string => !!x);
}

/** The bill-to prefill from the customer's record (company customers bring their name and TRN). */
export function billToFromCustomer(c: { customer_type?: string | null; company_name?: string | null; full_name?: string | null; trn?: string | null; area?: string | null } | null | undefined): BillTo {
  return {
    company: (c?.customer_type === "company" ? (c?.company_name ?? c?.full_name) : c?.company_name) ?? "",
    address: c?.area ?? "",
    trn: (c?.trn ?? "").replace(/[^\d]/g, ""),
    attention: "",
    po_number: "",
  };
}

/** A partial proforma's amount from the choice (% of the estimate's total, or a typed AED figure). */
export function partialOf(kind: "percent" | "aed", value: number, total: number): { amount: number } | { error: string } {
  if (!Number.isFinite(value) || value <= 0) return { error: "Enter the partial amount." };
  if (!(total > 0)) return { error: "The estimate has no total yet." };
  const amount = kind === "percent" ? r2((total * value) / 100) : r2(value);
  if (kind === "percent" && value > 100) return { error: "A percentage is at most 100." };
  if (amount > total + 0.005) return { error: `More than the estimate's total (AED ${total.toFixed(2)}). Use Complete instead.` };
  if (amount < 1) return { error: "The partial amount is too small." };
  return { amount };
}

/** VAT taken OUT of an advance amount, landing the total exactly (the VAT row takes the rounding). */
export function advanceSplit(amount: number, vatPercent: number): { taxable: number; vat: number; total: number } {
  // THE one VAT-out-of-a-total rule (audit M1, 6 November 2026): every deposit, advance and charge proforma splits its
  // amount here, half up to the fils (never floating-point down), and the VAT is what is left, so the parts add up.
  const fils = (n: number) => Math.round(Number((n * 100).toPrecision(12)));
  const total = fils(amount) / 100;
  const taxable = fils(total / (1 + (Number(vatPercent) || 0) / 100)) / 100;
  return { taxable, vat: (fils(total) - fils(taxable)) / 100, total };
}

/** The one line on an advance tax invoice ("VAT included in that amount"). */
export function advanceWordsOf(estimateNumber: string): string {
  return `ADVANCE PAYMENT AGAINST ESTIMATE ${estimateNumber}`;
}

/** What the money of one estimate adds up to (every version of its number counted once). */
export type EstimateMoneyState = {
  /** The estimate's own total (rounded total when the advisor rounded it). */
  total: number;
  /** Cleared money (a pending cheque is apart). */
  paid: number;
  pendingCheque: number;
  /** An open (unconverted, uncancelled) proforma is out. */
  proformaOpen: boolean;
  /** Its open proforma covers the whole bill (complete) rather than an advance. */
  proformaComplete: boolean;
  /** A tax invoice covering the WHOLE bill exists (complete pre-payment done). */
  fullyInvoiced: boolean;
  /** Advance tax invoices issued so far (their sum). */
  advanceInvoiced: number;
};

export type EstimateBadge = { key: "prepaid" | "part_paid" | "proforma_unpaid" | null; words: string | null; tone: "green" | "amber" | null };

/** The badge on the estimate page and the Estimates list ("Prepaid", "Part paid", "Proforma sent – unpaid"). */
export function estimateBadge(s: EstimateMoneyState): EstimateBadge {
  if (s.total > 0 && s.paid >= s.total - 0.005) return { key: "prepaid", words: "Prepaid", tone: "green" };
  if (s.paid > 0.005) return { key: "part_paid", words: `Part paid · ${aed(s.paid)} of ${aed(s.total)}`, tone: "amber" };
  if (s.proformaOpen) return { key: "proforma_unpaid", words: "Proforma sent – unpaid", tone: "amber" };
  return { key: null, words: null, tone: null };
}

/** "Paid AED X of Y" for the estimate page and list rows (null when nothing is paid and nothing sent). */
export function paidOfWords(s: EstimateMoneyState): string | null {
  if (s.paid <= 0.005 && !s.proformaOpen && !s.fullyInvoiced) return null;
  const parts = [`Paid ${aed(s.paid)} of ${aed(s.total)}`];
  if (s.pendingCheque > 0.005) parts.push(`cheque ${aed(s.pendingCheque)} clearing`);
  return parts.join(" · ");
}

/** The Estimates list filters this task adds. */
export const EM_FILTERS = [
  { key: "prepaid", label: "Prepaid" },
  { key: "part_paid", label: "Part paid" },
  { key: "proforma_unpaid", label: "Proforma sent – unpaid" },
] as const;

export function emFilterOf(s: EstimateMoneyState | null | undefined, key: string): boolean {
  if (!s) return false;
  return estimateBadge(s).key === key;
}

/** The proforma's "valid until": today in Dubai plus the days (the estimate's own validity by default). */
export function validUntilFrom(nowMs: number, days: number): string {
  const d = new Date(nowMs + 4 * 3600000 + Math.max(1, Math.round(days)) * 86400000);
  return d.toISOString().slice(0, 10);
}

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export { aed as emAed };
