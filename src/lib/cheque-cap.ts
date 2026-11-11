/**
 * ONE CHEQUE, NEVER MORE THAN ITS AMOUNT (11 November 2026, Section 5, AL ALI cheque 019383). Pure.
 * The receipts taken from one cheque number (live ones: recorded or waiting for the owner) can never total more than
 * the cheque. Entering the same cheque again shows what is already recorded on it and asks for the cheque's full amount;
 * splitting one cheque across cars stays the ONE action that replaces the receipts ("Replace with combined payment").
 */
export type ChequeSibling = { number: string; amount: number; jobNumber: string | null; cleared: boolean; chequeTotal: number | null };

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** "Cheque 019383 is already recorded: RCT-00057 AED 2,236.50 (J-00860, cleared) + RCT-00058 … = AED 4,368.00." */
export function chequeAlreadyWords(chequeNumber: string, siblings: ChequeSibling[]): string | null {
  if (!siblings.length) return null;
  const sum = r2(siblings.reduce((a, s) => a + s.amount, 0));
  const list = siblings.map((s) => `${s.number} ${aed(s.amount)}${s.jobNumber || s.cleared ? ` (${[s.jobNumber, s.cleared ? "cleared" : null].filter(Boolean).join(", ")})` : ""}`).join(" + ");
  return `Cheque ${chequeNumber} is already recorded: ${list}${siblings.length > 1 ? ` = ${aed(sum)}` : ""}.`;
}

/**
 * THE check when a receipt takes money from a cheque: none on it yet = fine; already on others = the cheque's full
 * amount is needed (typed now, or kept on an earlier receipt), and all the receipts together never go above it.
 */
export function chequeCapProblem(input: { chequeNumber: string; amount: number; siblings: ChequeSibling[]; typedTotal: number | null }): { error: string; needsTotal?: boolean } | null {
  const { siblings } = input;
  if (!siblings.length) {
    if (input.typedTotal !== null && input.amount > input.typedTotal + 0.004) return { error: `This receipt (${aed(input.amount)}) is more than the cheque (${aed(input.typedTotal)}).` };
    return null;
  }
  const known = siblings.map((s) => s.chequeTotal).filter((x): x is number => x !== null && x > 0);
  const total = input.typedTotal ?? (known.length ? Math.max(...known) : null);
  const words = chequeAlreadyWords(input.chequeNumber, siblings) ?? "";
  if (total === null) return { error: `${words} If this cheque pays for more than one car, type the cheque's full amount; if it is the same payment entered again, do not record it - void the duplicate instead.`, needsTotal: true };
  const already = r2(siblings.reduce((a, s) => a + s.amount, 0));
  if (r2(already + input.amount) > total + 0.004) {
    return { error: `${words} The cheque is ${aed(total)}: this receipt would make ${aed(r2(already + input.amount))}, more than the cheque. Void the duplicate, or use "Replace with combined payment" to split one cheque across cars.` };
  }
  return null;
}
