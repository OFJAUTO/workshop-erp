/**
 * The words of the owner's month card (C3, 1 November 2026). On the first day of a month that is a Sunday there is no
 * working day yet, so the target so far is 0: the card says "Month just started" over an empty bar (it said "100% of
 * target (AED 0 by today)" and "AED −0 above"). Pure: no database.
 */

/** "AED 1,234"; a figure that rounds to nothing is 0, never "−0". */
export const aedWhole = (n: number) => `AED ${(Math.round(n) || 0).toLocaleString("en-GB")}`;

export type MonthCardIn = { targetSoFar: number; percent: number; daysPassed: number; breakEvenSoFar: number };

export function monthCard(m: MonthCardIn, monthProfit: number): { empty: boolean; words: string; barPercent: number; costs: { kind: "short" | "above"; amount: number } | null } {
  const empty = m.targetSoFar <= 0;
  const words = m.daysPassed === 0 ? "Month just started" : empty ? "No daily target set" : `${m.percent}% of target (${aedWhole(m.targetSoFar)} by today)`;
  const short = Math.round(m.breakEvenSoFar - monthProfit) || 0;
  const costs = empty && short === 0 ? null : short > 0 ? { kind: "short" as const, amount: short } : { kind: "above" as const, amount: -short || 0 };
  return { empty, words, barPercent: empty ? 0 : Math.max(0, Math.min(100, m.percent)), costs };
}
