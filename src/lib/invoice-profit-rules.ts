// THE words of the profit on an invoice (13 November 2026, evening list, Section 8; INV-00011, J-00989). Pure: the
// state (PROVISIONAL with the worst case, or FINAL), the margin, the lines where the actual cost differs from what the
// approved quotation expected, and who may see it. The figures themselves come from THE calculation (`jobProfits`).

const r2 = (n: number) => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;

/** Profit as a share of the selling price before VAT; null when nothing was sold. */
export function marginPercent(profit: number, revenue: number): number | null {
  return revenue > 0.005 ? Math.round((profit / revenue) * 1000) / 10 : null;
}

/** Who sees the profit: the owner, accounts, and the job's own advisor(s). Nobody else, ever. */
export function maySeeJobProfit(role: string, staffId: string, jobAdvisorIds: string[]): boolean {
  if (role === "owner" || role === "accounts") return true;
  return role === "service_advisor" && jobAdvisorIds.includes(staffId);
}
/** The lifetime figures (a car's or a customer's): owner and accounts only (they sum other advisors' jobs). */
export function maySeeLifetimeProfit(role: string): boolean {
  return role === "owner" || role === "accounts";
}

/**
 * PROVISIONAL or FINAL. While a cost is still estimated the box says PROVISIONAL and shows the worst case: every
 * still-unknown cost at its highest expected figure (today: the bank fee at the dearest way to pay when nothing is paid
 * yet). FINAL once nothing is estimated.
 */
export function profitState(p: { profit: number; provisional: boolean; feeEstimated: boolean; bankCharges: number; worstFee: number }): { state: "provisional" | "final"; worst: number } {
  if (!p.provisional) return { state: "final", worst: p.profit };
  const extra = p.feeEstimated ? Math.max(0, r2(p.worstFee - p.bankCharges)) : 0;
  return { state: "provisional", worst: r2(p.profit - extra) };
}

export type DifferLine = { what: string; expected: number; actual: number; words: string };
const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One "differs" line: "BRAKE PADS: quoted cost 400.00, actual 460.00 (+60.00)". Null when the two agree (within 50 fils). */
export function differLine(what: string, expected: number, actual: number): DifferLine | null {
  const d = r2(actual - expected);
  if (Math.abs(d) < 0.5) return null;
  return { what, expected: r2(expected), actual: r2(actual), words: `${what}: expected ${money(expected)}, actual ${money(actual)} (${d > 0 ? "+" : "−"}${money(Math.abs(d))})` };
}

/** "Expected 3,200.00 · actual 2,850.00 (−350.00)". */
export function expectedVsActualWords(expected: number | null, actual: number): string {
  if (expected === null) return "No approved quotation to compare with.";
  const d = r2(actual - expected);
  return `Expected ${money(expected)} · actual ${money(actual)}${Math.abs(d) >= 0.005 ? ` (${d > 0 ? "+" : "−"}${money(Math.abs(d))})` : " (as expected)"}`;
}
