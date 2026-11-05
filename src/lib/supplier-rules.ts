/**
 * Suppliers (3 November 2026, section 12): the one rule of "VAT registered but no TRN" and the one search of the
 * suppliers list. Pure: no database, no imports, so the suppliers page, the LPO page, Parts accounts and the tests
 * read the same answer.
 */

export type SupplierLike = {
  name: string;
  trn?: string | null;
  vat_registered?: boolean | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  payment_terms?: string | null;
  /** The person we deal with there (suppliers.contact_name, from migration 20261203190000). */
  contact_name?: string | null;
};

/** Our own shelf is never a supplier we pay ("Our stock"; the tidy trigger stores "Our Stock"). */
const isOurStockName = (name: string | null | undefined) => String(name ?? "").trim().toLowerCase() === "our stock";

/** Only the digits of a figure ("+971 4 123 4567" → "97141234567", "100-200-300" → "100200300"). */
export const digitsOf = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "");

/**
 * VAT registered but without a real TRN (15 digits): its bills cannot go to Zoho Books (the same test as Zoho's own
 * vendor check). Never for "Our stock" (internal, never billed) or a supplier marked not VAT registered.
 */
export function supplierNeedsTrn(s: Pick<SupplierLike, "name" | "trn" | "vat_registered">): boolean {
  if (s.vat_registered === false) return false;
  if (isOurStockName(s.name)) return false;
  return digitsOf(s.trn).length !== 15;
}

/** The words next to such a supplier, on the list, the LPO and Parts accounts. */
export const NO_TRN_WORDS = "VAT registered but no TRN: no VAT counted and its bills cannot go to Zoho";

/** "Our stock" by name: our own shelf, never a supplier we pay, never VAT. */
export const isOurStockSupplier = (name: string | null | undefined) => isOurStockName(name);

/**
 * THE supplier VAT rule (5 November 2026, Mathew): VAT is counted only for a supplier that is VAT registered AND whose
 * 15-digit TRN we hold - no TRN, no VAT (a supplier without a TRN cannot charge it, and we could not reclaim it).
 * Never for "Our stock". An entered invoice's own VAT always wins over this estimate (supplier-money.ts).
 */
export function supplierChargesVat(s: Pick<SupplierLike, "name" | "trn" | "vat_registered"> | null | undefined): boolean {
  if (!s) return false;
  if (isOurStockName(s.name)) return false;
  if (s.vat_registered === false) return false;
  return digitsOf(s.trn).length === 15;
}

/** The words where a supplier amount carries no VAT. */
export const NO_VAT_WORDS = "No VAT – supplier not VAT-registered";

/**
 * A UAE phone number as dialled inside the country, without its leading 0: the international "00" or "+", the 971 and
 * one trunk 0 come off, so "+971 4 555 1212", "00971 4 555 1212" and "04 555 1212" all read "45551212", and
 * "+971 52 956 2232" / "052 956 2232" read "529562232". Landlines (eight digits after 971) and mobiles (nine) alike.
 */
export function nationalNumber(v: string | null | undefined): string {
  let d = digitsOf(v);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("971")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return d;
}

/**
 * The suppliers search: the name, email, contact person, address, notes and payment terms by their letters (any case),
 * the phone however it is written (both sides as the national number, so "04 555 1212" finds "+971 4 555 1212" and
 * "052 956 2232" finds "+971 52 956 2232", either way round), and the TRN by its digits. Empty search = every supplier.
 */
export function supplierSearchHit(s: SupplierLike, q: string | null | undefined): boolean {
  const needle = String(q ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!needle) return true;
  const words = [s.name, s.email, s.contact_name, s.address, s.notes, s.payment_terms].map((x) => String(x ?? "").toLowerCase().replace(/\s+/g, " "));
  if (words.some((w) => w.includes(needle))) return true;
  const typedDigits = digitsOf(needle);
  // A figure: at least four digits typed and nothing but digits, spaces, dashes, dots, brackets or a plus.
  if (typedDigits.length >= 4 && /^[\d\s\-+().]+$/.test(needle)) {
    const phone = nationalNumber(s.phone);
    const key = nationalNumber(needle);
    if (phone && key && phone.includes(key)) return true;
    if (digitsOf(s.trn).includes(typedDigits)) return true;
  }
  return false;
}

/** The quick filters of the suppliers list. */
export type SupplierFilter = "no_trn" | "unpaid";
export const SUPPLIER_FILTER_WORDS: Record<SupplierFilter, string> = {
  no_trn: "VAT registered but no TRN",
  unpaid: "Unpaid balance",
};
export const asSupplierFilter = (v: string | null | undefined): SupplierFilter | null => (v === "no_trn" || v === "unpaid" ? v : null);
