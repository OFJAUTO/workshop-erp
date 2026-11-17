/*
 * JOURNAL VOUCHERS (17 November 2026, Section 6): THE rules, pure (no server imports; the unit tests run them).
 * A charge's cost entered on a job ("Cost (we pay)") arrives as TO RECORD; accounts record it as a voucher (JV-00001…)
 * saying who paid it, when, the reference and the proof, or "pay later" against the provider's monthly invoice.
 */

/** The four kinds of cost and the Zoho account each goes to by default (changed on Settings > Zoho Books > Mapping). */
export const JV_TYPES = [
  { key: "fuel", label: "Fuel charges", account: "Automobile Expense" },
  { key: "recovery", label: "Recovery charges", account: "Recovery and transport" },
  { key: "other", label: "Other charges", account: "Other Expenses" },
  { key: "delivery", label: "Delivery charges", account: "Postage" },
] as const;
export type JvType = (typeof JV_TYPES)[number]["key"];
/** What a voucher paid by a staff member's own money is owed through until he is reimbursed. */
export const JV_STAFF_ACCOUNT = "Employee Reimbursements";

export const JV_PAID_BY = [
  { key: "cash", label: "Company cash" },
  { key: "card", label: "Company card" },
  { key: "transfer", label: "Bank transfer" },
  { key: "staff", label: "A staff member's own money (to reimburse)" },
] as const;
export type JvPaidBy = (typeof JV_PAID_BY)[number]["key"];
export const JV_PAID_BY_KEYS: string[] = JV_PAID_BY.map((p) => p.key);

/** A charge's type (recovery, fuel, delivery, other) as the voucher's expense type. */
export function jvTypeOfKind(kind: string | null | undefined): JvType {
  return kind === "fuel" || kind === "recovery" || kind === "delivery" ? kind : "other";
}

export const jvTypeLabel = (t: string) => JV_TYPES.find((x) => x.key === t)?.label ?? "Other charges";
export const jvPaidByLabel = (p: string | null | undefined) => JV_PAID_BY.find((x) => x.key === p)?.label ?? "Not paid yet";

/** The checks before a voucher is recorded as PAID; null = fine. Nothing about money is pre-selected. */
export function checkJvPay(p: { paidBy: string | null; staffId: string | null; paidOn: string | null; today: string }): string | null {
  if (!p.paidBy || !JV_PAID_BY_KEYS.includes(p.paidBy)) return "Choose who paid it: company cash, company card, bank transfer, or a staff member's own money.";
  if (p.paidBy === "staff" && !p.staffId) return "Pick the staff member who paid it (he is reimbursed later).";
  if (!p.paidOn || !/^\d{4}-\d{2}-\d{2}$/.test(p.paidOn)) return "Pick the payment date.";
  if (p.paidOn > p.today) return "The payment date cannot be in the future.";
  return null;
}

/** The checks before "pay later" (a provider who bills monthly): one supplier invoice for every ticked charge. */
export function checkPayLater(p: { provider: string; invoiceNumber: string; invoiceDate: string | null; today: string; count: number }): string | null {
  if (p.count < 1) return "Tick the charges on this invoice.";
  if (!p.provider.trim()) return "Type the provider (who sent the invoice).";
  if (!p.invoiceNumber.trim()) return "Type the provider's invoice number.";
  if (!p.invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(p.invoiceDate)) return "Pick the invoice date.";
  if (p.invoiceDate > p.today) return "The invoice date cannot be in the future.";
  return null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "Cost corrected from the receipt: 400.00 → 380.00" when accounts change a charge's amount (null when it is the same). */
export function correctionWords(oldAmount: number, newAmount: number): string | null {
  if (Math.abs(r2(oldAmount) - r2(newAmount)) < 0.005) return null;
  const f = (n: number) => r2(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Cost corrected from the receipt: ${f(oldAmount)} → ${f(newAmount)}`;
}

/** The total of a voucher's lines with VAT. */
export function jvTotal(lines: { amount: number; vat: number }[]): number {
  return r2(lines.reduce((a, l) => a + (Number(l.amount) || 0) + (Number(l.vat) || 0), 0));
}

/** The staff members still to reimburse, with what each is owed (vouchers paid by them, not yet reimbursed). */
export function toReimburse(rows: { staffId: string | null; staffName: string; amount: number; vat: number; status: string; reimbursedAt: string | null; paidBy: string | null }[]): { staffId: string; staffName: string; total: number; count: number }[] {
  const by = new Map<string, { staffId: string; staffName: string; total: number; count: number }>();
  for (const r of rows) {
    if (r.paidBy !== "staff" || !r.staffId || r.reimbursedAt || r.status !== "paid") continue;
    const cur = by.get(r.staffId) ?? { staffId: r.staffId, staffName: r.staffName, total: 0, count: 0 };
    cur.total = r2(cur.total + r.amount + r.vat);
    cur.count += 1;
    by.set(r.staffId, cur);
  }
  return Array.from(by.values()).sort((a, b) => b.total - a.total);
}
