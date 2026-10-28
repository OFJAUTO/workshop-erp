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

/** A payment taken AFTER the settlement day cannot be in it (money cannot leave the clearing account before it came in). */
export function receivedAfter(receivedAtIso: string, settledOn: string): boolean {
  return new Date(Date.parse(receivedAtIso) + 4 * 3600 * 1000).toISOString().slice(0, 10) > settledOn;
}

/** Pre-ticked: payments received BEFORE the settlement day (the bank pays a day's batch out on a later day). */
export function preTicked(receivedAtIso: string, settledOn: string): boolean {
  const day = new Date(Date.parse(receivedAtIso) + 4 * 3600 * 1000).toISOString().slice(0, 10);
  return day < settledOn;
}

/* ---------- 29 October 2026, section 4: the settlement as the bank reports it (net + MSF + fee + VAT) ---------- */

export type SettlementFigures = { gross: number; net: number | null; msf: number | null; txn: number | null; vat: number | null };
export type FiguresCheck = {
  ok: boolean;
  /** ticked total − (net + MSF + fee + VAT), to the fils; 0 when the figures add up. */
  difference: number;
  /** MSF + fee + VAT: what the bank kept. */
  fees: number;
  /** MSF + fee: the jobs' cost (the VAT is reclaimable). */
  cost: number;
  feePercent: number;
  error?: string;
  askAgain?: string;
};

/** VAT on the bank's fees, as the screen pre-fills it: 5% (Settings) of MSF + fee, to the fils half up. */
export function vatOnFees(msf: number, txn: number, vatPercent: number): number {
  // To the fils, half up, as the bank rounds (the same rule as roundHalfUp in bank-fees.ts; this file stays import-free for the tests).
  const x = ((msf + txn) * vatPercent) / 100;
  return Math.round(Number((Math.abs(x) * 100).toPrecision(12))) / 100;
}

/** THE check of a settlement's figures: the ticked payments must equal what arrived plus everything the bank kept. */
export function checkFigures(f: SettlementFigures): FiguresCheck {
  const gross = r2(f.gross);
  const msf = r2(f.msf ?? 0);
  const txn = r2(f.txn ?? 0);
  const vat = r2(f.vat ?? 0);
  const fees = r2(msf + txn + vat);
  const cost = r2(msf + txn);
  const base = { fees, cost, feePercent: gross > 0 ? r2((fees / gross) * 100) : 0 };
  if (gross <= 0) return { ok: false, difference: 0, ...base, error: "Tick the payments this settlement paid out." };
  if (f.net === null || !Number.isFinite(f.net) || f.net <= 0) return { ok: false, difference: 0, ...base, error: "Type the net amount the bank actually paid in." };
  if (msf < 0 || txn < 0 || vat < 0) return { ok: false, difference: 0, ...base, error: "Type the bank's fees as plain amounts (no minus sign)." };
  const difference = r2(gross - (r2(f.net) + fees));
  if (Math.abs(difference) >= 0.005) return { ok: false, difference, ...base, error: `AED ${Math.abs(difference).toFixed(2)} difference: the ticked payments (AED ${gross.toFixed(2)}) are ${difference > 0 ? "more" : "less"} than net + MSF + fee + VAT (AED ${r2(r2(f.net) + fees).toFixed(2)}).` };
  const askAgain = base.feePercent > FEE_CHECK_PERCENT ? `The bank would have kept ${base.feePercent.toFixed(2)}% of the ticked payments. Check the figures and the ticks.` : undefined;
  return { ok: true, difference: 0, ...base, ...(askAgain ? { askAgain } : {}) };
}

export type PaymentFees = { msf: number; txn: number; vat: number };

/**
 * The settlement's MSF, fee and VAT onto each ticked payment: a payment the bank's report names gets its EXACT
 * figures; the rest share what is left - the MSF in proportion to their amounts, the fee per transaction equally, the
 * VAT in proportion to their fees - every remainder of a fils on the largest payment.
 */
export function splitFigures(payments: { id: string; amount: number }[], totals: PaymentFees, exact: Record<string, PaymentFees> = {}): Map<string, PaymentFees> {
  const out = new Map<string, PaymentFees>();
  for (const p of payments) if (exact[p.id]) out.set(p.id, { msf: r2(exact[p.id].msf), txn: r2(exact[p.id].txn), vat: r2(exact[p.id].vat) });
  const rest = payments.filter((p) => !out.has(p.id));
  if (!rest.length) return out;
  const given = [...out.values()].reduce((a, f) => ({ msf: a.msf + f.msf, txn: a.txn + f.txn, vat: a.vat + f.vat }), { msf: 0, txn: 0, vat: 0 });
  const left = { msf: r2(totals.msf - given.msf), txn: r2(totals.txn - given.txn), vat: r2(totals.vat - given.vat) };
  const msf = splitFee(rest, left.msf);
  const txn = splitFee(rest.map((p) => ({ id: p.id, amount: 1 })), left.txn);
  const feeBase = rest.map((p) => ({ id: p.id, amount: r2((msf.get(p.id) ?? 0) + (txn.get(p.id) ?? 0)) }));
  const vat = feeBase.some((p) => p.amount > 0) ? splitFee(feeBase, left.vat) : splitFee(rest, left.vat);
  for (const p of rest) out.set(p.id, { msf: msf.get(p.id) ?? 0, txn: txn.get(p.id) ?? 0, vat: vat.get(p.id) ?? 0 });
  return out;
}
