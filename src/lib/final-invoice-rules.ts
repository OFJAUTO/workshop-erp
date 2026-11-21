/**
 * THE final tax invoice after an advance tax invoice (21 November 2026, J-01013 / INV-00037). Pure: the PDF, the
 * customer page, the job's money page, the list and the tests read it.
 *
 * An advance paid before the work is finished gets its OWN tax invoice (VAT taken out of the advance). That advance
 * invoice is NEVER the job's final tax invoice. The final tax invoice carries the job's real lines and its whole value,
 * then takes off what was already invoiced in advance, so the VAT is charged once:
 *
 *   TOTAL VALUE OF THE WORK            9,523.81 + VAT 476.19 = 10,000.00
 *   LESS ADVANCE ALREADY INVOICED      7,619.05 + VAT 380.95 =  8,000.00   (TAX INVOICE INV-00037, 16 NOV 2026)
 *   THIS INVOICE                       1,904.76 + VAT  95.24 =  2,000.00
 *
 * advance VAT + this invoice's VAT = the VAT of the whole job, to the fils. When the advance is MORE than the work, the
 * difference is the customer's credit (refund or keep) and this invoice is 0.00 - never a negative invoice.
 */

export type Figures = { taxable: number; vat: number; total: number };
export type AdvanceInvoice = { id: string; number: string; issued_at: string; taxable_aed: number; vat_aed: number; total_aed: number };

export type FinalBlock = {
  work: Figures;
  advance: Figures & { invoices: { id: string; number: string; issuedAt: string; total: number }[] };
  thisInvoice: Figures;
  /** The advance above the work (incl. VAT): the customer's credit. 0 normally. */
  credit: number;
  /** The VAT of that credit (corrected by a credit note on the advance invoice). */
  creditVat: number;
};

const fils = (n: number) => Math.round(Number(((Number(n) || 0) * 100).toPrecision(12)));
const r2 = (n: number) => fils(n) / 100;

/** A live advance tax invoice: a tax invoice that carries a deposit link (deposit_for_quotation_id). */
export function isAdvanceTaxInvoice(i: { kind: string; deposit_for_quotation_id?: string | null; status?: string | null; is_active?: boolean | null }): boolean {
  return i.kind === "tax_invoice" && !!i.deposit_for_quotation_id && (i.status ?? "issued") === "issued" && i.is_active !== false;
}

/** The money block of a final document (tax invoice or its proforma) after the advance tax invoices. */
export function finalBlock(work: Figures, advances: AdvanceInvoice[]): FinalBlock | null {
  if (!advances.length) return null;
  const sorted = [...advances].sort((a, b) => (a.issued_at < b.issued_at ? -1 : a.issued_at > b.issued_at ? 1 : 0));
  const adv = {
    taxable: sorted.reduce((a, i) => a + fils(i.taxable_aed), 0) / 100,
    vat: sorted.reduce((a, i) => a + fils(i.vat_aed), 0) / 100,
    total: sorted.reduce((a, i) => a + fils(i.total_aed), 0) / 100,
  };
  const w = { taxable: r2(work.taxable), vat: r2(work.vat), total: r2(work.total) };
  const over = fils(adv.total) > fils(w.total);
  const thisInvoice = over
    ? { taxable: 0, vat: 0, total: 0 }
    : { taxable: (fils(w.taxable) - fils(adv.taxable)) / 100, vat: (fils(w.vat) - fils(adv.vat)) / 100, total: (fils(w.total) - fils(adv.total)) / 100 };
  return {
    work: w,
    advance: { ...adv, invoices: sorted.map((i) => ({ id: i.id, number: i.number, issuedAt: i.issued_at, total: r2(i.total_aed) })) },
    thisInvoice,
    credit: over ? (fils(adv.total) - fils(w.total)) / 100 : 0,
    creditVat: over ? Math.max(0, fils(adv.vat) - fils(w.vat)) / 100 : 0,
  };
}

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => new Date(new Date(iso).getTime() + 4 * 3600000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase();

/** "TAX INVOICE INV-00037 (16 NOV 2026)" (several: joined with " + "). */
export function advanceInvoiceWords(b: FinalBlock): string {
  return b.advance.invoices.map((i) => `TAX INVOICE ${i.number} (${day(i.issuedAt)})`).join(" + ");
}

/** The three rows, each number once: label, the "taxable + VAT" part, and the amount incl. VAT. */
export function finalRows(b: FinalBlock, vatPercent = 5): { key: "work" | "advance" | "this" | "credit"; label: string; split: string; value: number }[] {
  const pct = Number.isInteger(vatPercent) ? String(vatPercent) : vatPercent.toFixed(2);
  const rows: { key: "work" | "advance" | "this" | "credit"; label: string; split: string; value: number }[] = [
    { key: "work", label: "TOTAL VALUE OF THE WORK", split: `${money(b.work.taxable)} + VAT ${pct}% ${money(b.work.vat)}`, value: b.work.total },
    { key: "advance", label: `LESS ADVANCE ALREADY INVOICED – ${advanceInvoiceWords(b)}`, split: `${money(b.advance.taxable)} + VAT ${money(b.advance.vat)}`, value: b.advance.total },
    { key: "this", label: "THIS INVOICE", split: `TAXABLE ${money(b.thisInvoice.taxable)} + VAT ${money(b.thisInvoice.vat)}`, value: b.thisInvoice.total },
  ];
  if (b.credit > 0.004) rows.push({ key: "credit", label: "ADVANCE ABOVE THE WORK – CUSTOMER CREDIT (REFUND OR KEEP)", split: `incl. VAT ${money(b.creditVat)}`, value: b.credit });
  return rows;
}

/** A payment that is the advance invoice's own money (it is paid there, never counted again on the final invoice). */
export function isAdvanceMoney(p: { deposit_invoice_number?: string | null }, b: FinalBlock | null): boolean {
  return !!b && !!p.deposit_invoice_number && b.advance.invoices.some((i) => i.number === p.deposit_invoice_number);
}

/** What this invoice still asks: THIS INVOICE less the money paid on it (never the advance's own money twice). */
export function finalBalance(b: FinalBlock, paidOnThis: number, credited = 0): number {
  return Math.max(0, (fils(b.thisInvoice.total) - fils(paidOnThis) - fils(credited)) / 100);
}

/** The steps of a job with an advance tax invoice (the owner's order of 21 November 2026). */
export type AdvanceStepKey = "proforma" | "advance_payment" | "advance_invoice" | "job_done" | "final_invoice" | "balance" | "gate_out";
export const ADVANCE_STEPS: { key: AdvanceStepKey; label: string }[] = [
  { key: "proforma", label: "Proforma" },
  { key: "advance_payment", label: "Advance payment" },
  { key: "advance_invoice", label: "Advance tax invoice" },
  { key: "job_done", label: "Job done" },
  { key: "final_invoice", label: "Final tax invoice" },
  { key: "balance", label: "Balance payment" },
  { key: "gate_out", label: "Gate-out" },
];

/** Done / current / later for each step: the first step not done is current. "Tax invoice" is done only with the FINAL one. */
export function advanceSteps(f: { advancePaid: boolean; advanceInvoiced: boolean; jobDone: boolean; finalInvoice: boolean; balancePaid: boolean; gatedOut: boolean }): { key: AdvanceStepKey; label: string; state: "done" | "current" | "later" }[] {
  const done: Record<AdvanceStepKey, boolean> = {
    proforma: true,
    advance_payment: f.advancePaid,
    advance_invoice: f.advanceInvoiced,
    job_done: f.jobDone || f.gatedOut,
    final_invoice: f.finalInvoice,
    balance: f.finalInvoice && f.balancePaid,
    gate_out: f.gatedOut,
  };
  let current = false;
  return ADVANCE_STEPS.map((s) => {
    if (done[s.key]) return { ...s, state: "done" as const };
    if (!current) {
      current = true;
      return { ...s, state: "current" as const };
    }
    return { ...s, state: "later" as const };
  });
}

/** Job statuses at which the work is done (the final tax invoice may be generated). */
export const JOB_DONE_STATUSES = ["ready", "pending_payment", "in_delivery", "closed", "gated_out"];

/** The false "VAT included" remark on an advance line: the line's amount is BEFORE VAT (never printed). */
export function cleanAdvanceDetails(details: string | null | undefined): string | null {
  const t = String(details ?? "").replace(/VAT included in (this|that) amount\.?/gi, "").trim();
  return t || null;
}
