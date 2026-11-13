// THE lines of a supplier bill in Zoho (13 November 2026, evening list, Section 7; bill 1260925425, LPO-00076-2).
// Pure, so the sync, the preview for accounts and the unit tests share it.
//
// One line per part as the supplier invoiced it: the name, the part number, the quantity and the unit cost before VAT,
// with the LPO, the job and the plate in the line's description, each line on its own account (parts or stock; courier
// and freight on the courier account). An invoice discount or round-off between the lines and the total typed from the
// supplier's paper is its own line, so nothing hides inside a unit price. VAT is 5% per line (Zoho works it out); the
// fils between that and the VAT printed on the paper ride as the bill's adjustment, so the bill's total is the paper's.

export type BillPartLine = { description: string; partNumber: string | null; quantity: number; unit: number; listPrice?: number | null; discountPercent?: number | null };
export type BillLinesInput = {
  lines: BillPartLine[];
  charges: { description: string; amount: number }[];
  /** Before VAT, the paper's (or the lines' sum when nothing was typed). */
  expectedNet: number;
  /** The VAT printed on the paper (or 5% of the net); 0 when the supplier charges none. */
  expectedVat: number;
  taxed: boolean;
  ref: { lpo: string; job: string | null; plate: string | null };
  accounts: { parts: string; courier: string };
  taxId: string | null;
};
export type ZohoLine = { name: string; description: string; quantity: number; rate: number; account_id: string; tax_id?: string };
export type BillLines = { items: ZohoLine[]; roundOff: number; zohoNet: number; zohoVat: number; adjustment: number };

const r2 = (n: number) => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The words under a part's name: part number, LPO, job and plate, and the list price less the discount when known. */
export function lineDescription(l: BillPartLine, ref: BillLinesInput["ref"]): string {
  const bits = [
    l.partNumber ? `Part no. ${l.partNumber}` : null,
    ref.lpo,
    ref.job,
    ref.plate,
    l.listPrice && l.discountPercent && l.discountPercent > 0 && Math.abs(r2(l.listPrice * (1 - l.discountPercent / 100)) - l.unit) < 0.011 ? `list ${money(l.listPrice)} less ${l.discountPercent}%` : null,
  ].filter(Boolean);
  return cut(bits.join(" · "), 2000);
}

export function billLines(input: BillLinesInput): BillLines {
  const tax = input.taxed && input.taxId ? { tax_id: input.taxId } : {};
  const items: ZohoLine[] = [];
  for (const l of input.lines) {
    if (!(l.quantity > 0)) continue; // not delivered: not billed
    items.push({ name: cut(l.description.trim() || "Part", 100), description: lineDescription(l, input.ref), quantity: l.quantity, rate: r2(l.unit), account_id: input.accounts.parts, ...tax });
  }
  for (const c of input.charges) items.push({ name: cut(c.description.trim() || "Delivery charge", 100), description: [input.ref.lpo, input.ref.job].filter(Boolean).join(" · "), quantity: 1, rate: r2(c.amount), account_id: input.accounts.courier, ...tax });
  const sum = r2(items.reduce((a, i) => a + r2(i.quantity * i.rate), 0));
  const roundOff = r2(input.expectedNet - sum);
  if (Math.abs(roundOff) > 0.004) {
    items.push({ name: roundOff < 0 ? "Invoice discount / round-off" : "Invoice round-off", description: `As printed on the supplier's invoice · ${input.ref.lpo}`, quantity: 1, rate: roundOff, account_id: input.accounts.parts, ...tax });
  }
  const zohoNet = r2(items.reduce((a, i) => a + r2(i.quantity * i.rate), 0));
  const zohoVat = input.taxed ? r2(items.reduce((a, i) => a + r2(r2(i.quantity * i.rate) * 0.05), 0)) : 0;
  const adjustment = input.taxed ? r2(input.expectedVat - zohoVat) : 0;
  return { items, roundOff: Math.abs(roundOff) > 0.004 ? roundOff : 0, zohoNet, zohoVat, adjustment };
}

/** Does the bill in Zoho already carry these lines (same count, names and amounts)? If not, it is re-posted in place. */
export function sameLayout(zohoLines: { name?: string; rate?: number; quantity?: number }[] | undefined, ours: ZohoLine[]): boolean {
  if (!zohoLines || zohoLines.length !== ours.length) return false;
  return ours.every((o, i) => {
    const z = zohoLines[i];
    return (z.name ?? "").trim() === o.name.trim() && Math.abs((Number(z.rate) || 0) - o.rate) < 0.005 && Math.abs((Number(z.quantity) || 0) - o.quantity) < 0.005;
  });
}
