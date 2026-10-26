/**
 * ONE rulebook for the supplier invoice (2.5, 21 October 2026), shared by every screen that takes it
 * (the receiving panel, the LPO page) and enforced again on the server. Pure: no imports, usable on
 * both sides.
 */

export type SupplierInvoiceInput = {
  toFollow: boolean;
  number: string | null;
  date: string | null;
  /** Before VAT; null when not typed. */
  amount: number | null;
  /** The LPO's own total before VAT, for the 5% cross-check. */
  poTotal: number | null;
  /** The person ticked "the amount is right" after the 5% warning. */
  amountConfirmed: boolean;
  /** Dubai's date, YYYY-MM-DD. */
  today: string;
};

export type SupplierInvoiceCheck = { ok: true } | { ok: false; error: string; needsAmountConfirm?: boolean };

/** "wdwdwdw" is not an invoice number: 3+ characters, letters/digits/-/, at least one digit, not one or two characters repeated. */
export function invoiceNumberLooksReal(raw: string): boolean {
  const n = raw.trim();
  if (n.length < 3 || n.length > 80) return false;
  if (!/^[A-Za-z0-9 /\-._#]+$/.test(n)) return false;
  if (!/\d/.test(n)) return false;
  const compact = n.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (/^(.)\1+$/.test(compact)) return false;
  if (compact.length >= 4 && /^(..)\1+$/.test(compact)) return false;
  return true;
}

export function checkSupplierInvoice(i: SupplierInvoiceInput): SupplierInvoiceCheck {
  if (i.toFollow) return { ok: true };
  const number = (i.number ?? "").trim();
  if (!number) return { ok: false, error: "Enter the supplier invoice number, or tick Invoice to follow." };
  if (!invoiceNumberLooksReal(number)) return { ok: false, error: "That doesn't look like a real invoice number (letters and digits, at least 3 characters, at least one digit)." };
  const date = (i.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Enter the date printed on the supplier invoice." };
  if (date > i.today) return { ok: false, error: "The invoice date cannot be in the future." };
  if (i.amount !== null && i.amount > 0 && i.poTotal !== null && i.poTotal > 0) {
    // The single most likely slip: typing the WITH-VAT total into the before-VAT box lands at exactly +5%,
    // which the 5% band would otherwise wave through without a word (27 October 2026).
    const vatLike = Math.abs(i.amount - i.poTotal * 1.05) <= Math.max(1, i.poTotal * 0.002);
    if (vatLike && !i.amountConfirmed) {
      return { ok: false, needsAmountConfirm: true, error: `AED ${i.amount.toLocaleString("en-GB")} is exactly the order plus 5% VAT — this box wants the BEFORE-VAT figure. If the invoice really says ${i.amount.toLocaleString("en-GB")} before VAT, tick "the amount is right" to save it.` };
    }
    const off = Math.abs(i.amount - i.poTotal) / i.poTotal;
    if (off > 0.05 && !i.amountConfirmed) {
      return { ok: false, needsAmountConfirm: true, error: `Invoice AED ${i.amount.toLocaleString("en-GB")} vs order AED ${i.poTotal.toLocaleString("en-GB")} – check the figure, then tick "the amount is right" to save it.` };
    }
  }
  return { ok: true };
}

export function dubaiToday(): string {
  return new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
}
