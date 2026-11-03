/**
 * THE round-off rules (3 November 2026): one optional round-off on every money document - quotations,
 * estimates, additional quotations and estimates, proformas (pending charges included) and the tax
 * invoice they become. Pure: the screens, the server actions, quoteTotals, the invoice draft and the
 * unit tests all read the same rules.
 *
 * The one money rule: the round-off adjusts the amount BEFORE VAT and VAT is recalculated, so VAT is
 * exactly 5% of the taxable amount and the total lands on the chosen number (Q-00039: -8.13 ->
 * 36,123.81 + VAT 1,806.19 = 37,930.00). Never an adjustment after VAT.
 *
 * Limits (Settings > Money): advisors may round DOWN up to AED 100 per document; more needs the owner.
 * Rounding UP is capped at AED 10 for everyone. A tax invoice can never be higher than the approved
 * quotation total, so rounding a proforma UP is refused whenever the job has an approved quotation.
 */

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

export type VatFit = { total: number; taxable: number; vat: number };

/**
 * The taxable amount and VAT for a chosen total: taxable + VAT = total with VAT exactly the set
 * percentage of the taxable amount (rounded to the fils, half up like every amount). Not every total is
 * reachable (taxable steps of one fils move the total by one or two), so the nearest reachable total
 * wins - a whole-dirham total is practically always reachable as it is.
 */
export function fitTotal(target: number, vatFraction: number): VatFit {
  const t = r2(target);
  const pct = vatFraction > 0 ? vatFraction : 0;
  const tryFit = (total: number): VatFit | null => {
    const base = r2(total / (1 + pct));
    for (const step of [0, -0.01, 0.01, -0.02, 0.02]) {
      const taxable = r2(base + step);
      if (taxable <= 0) continue;
      const exact = taxable * pct;
      // VAT to the nearest fils. Exactly half a fils (4,038.10 × 5% = 201.905) is equally near both
      // neighbours, so either lands "exactly 5%" - the one that lands the chosen total wins.
      for (const vat of [r2(exact), r2(Math.floor(exact * 100 + 1e-9) / 100), r2(Math.ceil(exact * 100 - 1e-9) / 100)]) {
        if (Math.abs(vat - exact) <= 0.005 + 1e-9 && Math.abs(r2(taxable + vat) - total) < 0.005) return { total, taxable, vat };
      }
    }
    return null;
  };
  for (const shift of [0, -0.01, 0.01, -0.02, 0.02, -0.03, 0.03]) {
    const fit = tryFit(r2(t + shift));
    if (fit) return fit;
  }
  // Unreachable in theory only; fall back to the old split (VAT takes the last fils).
  const taxable = r2(t / (1 + pct));
  return { total: t, taxable, vat: r2(t - taxable) };
}

export const ROUND_STEPS = [1, 10, 50, 100] as const;

/** The nearest totals at a step: down (floor) and up (ceiling), never zero or below. */
export function roundTargets(total: number, step: number): { down: number | null; up: number | null } {
  const s = Math.max(1, step);
  const down = Math.floor((total + 0.004) / s) * s;
  const up = Math.ceil((total - 0.004) / s) * s;
  return {
    down: down > 0 && total - down > 0.004 ? down : null,
    up: up - total > 0.004 ? up : null,
  };
}

export type RoundoffLimits = { downMax: number; upMax: number };

/** Settings > Money: how far an advisor may round down, and the up cap for everyone. */
export function roundoffLimitsOf(settings: unknown): RoundoffLimits {
  const s = (settings ?? {}) as Record<string, unknown>;
  const n = (v: unknown, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : d;
  };
  return { downMax: n(s.roundoff_down_limit_aed, 100), upMax: n(s.roundoff_up_limit_aed, 10) };
}

export type RoundoffCheck = {
  /** target - current, to the fils; negative = down. */
  delta: number;
  /** Refused outright, in plain words. */
  error?: string;
  /** Allowed to store, but the quotation will wait for the owner at Send (the advisor is told now). */
  needsOwner?: boolean;
};

/**
 * May this person set this round-off? `current` is the document's total WITHOUT any round-off;
 * `approvedCap` is the approved quotation total an invoice may never exceed (null = no cap).
 */
export function roundoffCheck(input: { current: number; target: number; isOwner: boolean; limits: RoundoffLimits; approvedCap?: number | null; /** On an invoice an over-limit round-off is refused (no pending-owner flow there). */ refuseOverLimit?: boolean }): RoundoffCheck {
  const target = r2(input.target);
  const delta = r2(target - r2(input.current));
  if (!Number.isFinite(target) || target <= 0) return { delta, error: "Type the total the customer pays (above zero)." };
  if (Math.abs(delta) < 0.005) return { delta, error: "That is the total already - nothing to round." };
  if (delta > 0) {
    if (input.approvedCap !== null && input.approvedCap !== undefined && target > input.approvedCap + 0.004) {
      return { delta, error: `The invoice can never be higher than the approved quotation total (AED ${input.approvedCap.toLocaleString("en-GB", { minimumFractionDigits: 2 })}).` };
    }
    if (delta > input.limits.upMax + 0.004) {
      return { delta, error: `Rounding up is limited to AED ${input.limits.upMax.toLocaleString("en-GB")} (Settings > Money).` };
    }
    return { delta };
  }
  const down = Math.abs(delta);
  if (!input.isOwner && down > input.limits.downMax + 0.004) {
    if (input.refuseOverLimit) return { delta, error: `A round-off of AED ${down.toLocaleString("en-GB", { minimumFractionDigits: 2 })} is above your AED ${input.limits.downMax.toLocaleString("en-GB")} limit - only the owner can apply it here.` };
    return { delta, needsOwner: true };
  }
  return { delta };
}

/** "Round-off − AED 8.13" / "Round-off + AED 1.87": the one wording, minus = money off. */
export function roundoffWords(rounding: number): string {
  const n = r2(Math.abs(rounding));
  return `Round-off ${rounding < 0 ? "−" : "+"} AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The owner-approval reason for a round-off above the advisor's limit, and its reading for approvalCovers. */
export function roundoffReason(downAed: number, limit: number): string {
  return `round-off AED ${r2(downAed).toLocaleString("en-GB", { minimumFractionDigits: 2 })} (limit AED ${limit.toLocaleString("en-GB")})`;
}
export function roundoffReasonAmount(reason: string): number | null {
  const m = /^round-off AED ([\d,.]+) \(limit /.exec(reason);
  return m ? Number(m[1].replace(/,/g, "")) || 0 : null;
}
