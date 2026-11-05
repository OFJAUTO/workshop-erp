/**
 * SUPPLIER AMOUNTS WITH VAT (5 November 2026, Mathew): THE one calculation of what we owe a supplier, read by the LPO
 * list, the LPO page (lines box, totals, the approval screen, the pay box), the supplier LPO cards, Supplier invoices,
 * Parts accounts, the supplier balances and the supplier copy PDF - so every screen shows the same figures:
 * "AED 1,011.15 incl. VAT" with "963.00 + VAT 48.15" under it, each number once.
 *
 * - VAT only from a supplier that charges it (supplierChargesVat: VAT registered with a 15-digit TRN; never Our stock),
 *   5% of the LPO TOTAL, rounded half up to the fils (never line by line).
 * - An entered supplier invoice's own figures replace the estimate: its amount before VAT and its typed VAT.
 * - A cancelled LPO is shown at its ORIGINAL amount, struck through, and is never counted in any total or balance.
 * - Profit is unchanged: it counts costs before VAT.
 * Pure: imports only pure modules, so the browser, the PDF and the tests use it as it is.
 */
import { roundHalfUp } from "./bank-fees";
import { NO_VAT_WORDS } from "./supplier-rules";

export const SUPPLIER_VAT_PERCENT = 5;

export type SupplierMoney = {
  /** Before VAT. */
  net: number;
  vat: number;
  /** With VAT. */
  gross: number;
  /** Whether VAT is part of this amount at all (false = "No VAT – supplier not VAT-registered"). */
  vatCharged: boolean;
  /** Where the VAT comes from: the 5% estimate, the supplier's own invoice, or none. */
  vatFrom: "estimate" | "invoice" | "none";
};

/**
 * One supplier amount: `net` before VAT; `chargesVat` from supplierChargesVat; `typedVat` the VAT typed from the
 * supplier's invoice (replaces the 5% estimate, even 0). VAT only for VAT-registered suppliers: a supplier that does
 * not charge VAT by THE rule stays at 0 even with a typed VAT (add its TRN on Parts > Suppliers first).
 */
export function supplierMoney(net: number, opts: { chargesVat: boolean; typedVat?: number | null; vatPercent?: number }): SupplierMoney {
  const n = roundHalfUp(Number(net) || 0);
  if (!opts.chargesVat) return { net: n, vat: 0, gross: n, vatCharged: false, vatFrom: "none" };
  if (opts.typedVat !== null && opts.typedVat !== undefined && Number.isFinite(Number(opts.typedVat))) {
    const vat = roundHalfUp(Number(opts.typedVat));
    return { net: n, vat, gross: roundHalfUp(n + vat), vatCharged: true, vatFrom: "invoice" };
  }
  const vat = roundHalfUp((n * (opts.vatPercent ?? SUPPLIER_VAT_PERCENT)) / 100);
  return { net: n, vat, gross: roundHalfUp(n + vat), vatCharged: true, vatFrom: "estimate" };
}

/** Several amounts of the same kind added up (each already rounded; the sum is rounded again, never re-taxed). */
export function addSupplierMoney(items: SupplierMoney[]): SupplierMoney {
  const net = roundHalfUp(items.reduce((a, m) => a + m.net, 0));
  const vat = roundHalfUp(items.reduce((a, m) => a + m.vat, 0));
  const charged = items.some((m) => m.vatCharged);
  return { net, vat, gross: roundHalfUp(net + vat), vatCharged: charged, vatFrom: items.every((m) => m.vatFrom === "invoice") && items.length ? "invoice" : charged ? "estimate" : "none" };
}

/** "1,011.15" - two decimals with thousands. */
export const supplierFigure = (n: number) => roundHalfUp(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The two lines of THE display: "AED 1,011.15 incl. VAT" and "963.00 + VAT 48.15" (or the no-VAT words). */
export function supplierMoneyWords(m: SupplierMoney): { main: string; sub: string } {
  if (!m.vatCharged) return { main: `AED ${supplierFigure(m.net)}`, sub: NO_VAT_WORDS };
  return { main: `AED ${supplierFigure(m.gross)} incl. VAT`, sub: `${supplierFigure(m.net)} + VAT ${supplierFigure(m.vat)}` };
}

/** One line of text for copies and messages: "AED 1,011.15 incl. VAT (963.00 + VAT 48.15)" / "AED 963.00 (no VAT – …)". */
export function supplierMoneyText(m: SupplierMoney): string {
  const w = supplierMoneyWords(m);
  return m.vatCharged ? `${w.main} (${w.sub})` : `${w.main} (${w.sub.charAt(0).toLowerCase()}${w.sub.slice(1)})`;
}

export type LpoMoneyInput = {
  status: string;
  /** The LPO's stored total before VAT (parts and the supplier's charges). */
  total_cost_aed: number;
  supplier_invoice_status?: string | null;
  supplier_invoice_number?: string | null;
  supplier_invoice_amount?: number | null;
  supplier_invoice_vat_aed?: number | null;
};

/**
 * THE amount of one LPO: a cancelled one at its ORIGINAL amount (`originalNet`: every line it ever had, quantity ×
 * cost, whatever became of them - shown struck through and never counted); one with its supplier invoice entered at
 * the invoice's figures (its amount before VAT, its own VAT when typed); any other at its total with the 5% estimate.
 */
export function lpoMoney(po: LpoMoneyInput, chargesVat: boolean, originalNet?: number | null): SupplierMoney & { cancelled: boolean; fromInvoice: boolean } {
  if (po.status === "cancelled") {
    const net = originalNet !== null && originalNet !== undefined && originalNet > 0 ? originalNet : Number(po.total_cost_aed) || 0;
    return { ...supplierMoney(net, { chargesVat }), cancelled: true, fromInvoice: false };
  }
  const entered = po.supplier_invoice_status === "received" && !!po.supplier_invoice_number && po.supplier_invoice_amount !== null && po.supplier_invoice_amount !== undefined && Number(po.supplier_invoice_amount) > 0;
  if (entered) return { ...supplierMoney(Number(po.supplier_invoice_amount), { chargesVat, typedVat: po.supplier_invoice_vat_aed ?? null }), cancelled: false, fromInvoice: true };
  return { ...supplierMoney(Number(po.total_cost_aed) || 0, { chargesVat }), cancelled: false, fromInvoice: false };
}

/** Figures already worked out by THE rule elsewhere (a supplier invoice row, a balance) in the same shape. */
export function moneyFrom(net: number, vat: number, vatCharged: boolean): SupplierMoney {
  const n = roundHalfUp(net);
  const v = roundHalfUp(vat);
  return { net: n, vat: v, gross: roundHalfUp(n + v), vatCharged: vatCharged || v > 0.004, vatFrom: vatCharged || v > 0.004 ? "estimate" : "none" };
}

/** A supplier invoice row (supplier-invoice-rows.ts, built with THE rule) as THE money. */
export const rowMoney = (r: { beforeVat: number; vat: number; vatCharged?: boolean }) => moneyFrom(r.beforeVat, r.vat, r.vatCharged ?? r.vat > 0.004);

/** The original amount of an LPO from every line it ever had (inactive ones too): quantity × agreed cost. */
export function originalNetOf(lines: { quantity: number | string; unit_cost: number | string }[]): number {
  return roundHalfUp(lines.reduce((a, l) => a + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0));
}
