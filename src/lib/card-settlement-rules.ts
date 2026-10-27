/**
 * Card and payment-link settlements (27 October 2026): the pure rules, shared by the screen, the server and the tests.
 * A card or link payment is recorded with an ESTIMATED fee (the Settings percentage). When the bank pays the batch
 * out, accounts enter the amount actually received; the real fee (ticked total minus received) is split over the
 * payments in proportion to their amounts, and each job's profit switches from the estimate to that actual share.
 */

export const CLEARING_METHODS = ["card", "link"] as const;
export type ClearingMethod = (typeof CLEARING_METHODS)[number];
export const CLEARING_LABEL: Record<ClearingMethod, string> = { card: "Card machine", link: "Payment link" };
/** A card/link payment not settled after this many working days turns amber on accounts' Waiting on you. */
export const SETTLE_AFTER_WORKING_DAYS = 3;
/** A fee above this share of the ticked total is almost always a typing slip: the save asks for a second look. */
export const FEE_CHECK_PERCENT = 6;

export function isClearing(method: string): method is ClearingMethod {
  return method === "card" || method === "link";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The fee a payment counts in profit: its share of the ACTUAL fee once settled, else the estimate taken at recording. */
export function feeOf(p: { method: string; bank_charge_aed: number; actual_fee_aed?: number | null; settlement_id?: string | null }): { fee: number; actual: boolean } {
  if (isClearing(p.method) && p.settlement_id && p.actual_fee_aed !== null && p.actual_fee_aed !== undefined) return { fee: r2(Number(p.actual_fee_aed) || 0), actual: true };
  return { fee: r2(Number(p.bank_charge_aed) || 0), actual: !isClearing(p.method) };
}

/** The fee split in proportion to the amounts, to the fils; the rounding remainder goes to the largest payment. */
export function splitFee(payments: { id: string; amount: number }[], fee: number): Map<string, number> {
  const out = new Map<string, number>();
  const gross = r2(payments.reduce((a, p) => a + p.amount, 0));
  if (!payments.length || gross <= 0) return out;
  let given = 0;
  for (const p of payments) {
    const share = r2((fee * p.amount) / gross);
    out.set(p.id, share);
    given = r2(given + share);
  }
  const rest = r2(fee - given);
  if (Math.abs(rest) >= 0.005) {
    const largest = [...payments].sort((a, b) => b.amount - a.amount)[0];
    out.set(largest.id, r2((out.get(largest.id) ?? 0) + rest));
  }
  return out;
}

export type SettlementCheck = { ok: boolean; error?: string; gross: number; fee: number; feePercent: number; askAgain?: string };

/** The one check for a settlement: the screen shows it live, the server enforces it. */
export function checkSettlement(gross: number, received: number | null): SettlementCheck {
  const g = r2(gross);
  if (g <= 0) return { ok: false, error: "Tick the payments this settlement paid out.", gross: g, fee: 0, feePercent: 0 };
  if (received === null || !Number.isFinite(received) || received <= 0) return { ok: false, error: "Type the amount the bank actually paid in.", gross: g, fee: 0, feePercent: 0 };
  const rec = r2(received);
  if (rec > g + 0.004) return { ok: false, error: `The bank paid in more (AED ${rec.toFixed(2)}) than the ticked payments (AED ${g.toFixed(2)}). Tick the missing payments, or check the figure.`, gross: g, fee: 0, feePercent: 0 };
  const fee = r2(g - rec);
  const feePercent = r2((fee / g) * 100);
  const askAgain = feePercent > FEE_CHECK_PERCENT ? `The fee would be ${feePercent.toFixed(2)}% of the ticked payments. Check the amount received and the ticks.` : undefined;
  return { ok: true, gross: g, fee, feePercent, ...(askAgain ? { askAgain } : {}) };
}

/** Pre-ticked: payments received BEFORE the settlement day (the bank pays a day's batch out on a later day). */
export function preTicked(receivedAtIso: string, settledOn: string): boolean {
  const day = new Date(Date.parse(receivedAtIso) + 4 * 3600 * 1000).toISOString().slice(0, 10);
  return day < settledOn;
}
