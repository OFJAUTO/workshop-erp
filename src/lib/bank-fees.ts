/**
 * Bank fees per payment method (29 October 2026), the ONE rule shared by payments, quotations, settlements, the
 * report import, profit and the tests. Pure: no imports, so the browser and the tests use it as it is.
 *
 * Network International charges, per transaction:
 *   MSF   = amount × MSF %            (card machine 2.15%, payment link 1.75%)
 *   fee   = a fixed fee per transaction (payment link AED 1.00, card machine none)
 *   VAT   = 5% of (MSF + fee)         (input VAT: reclaimable, so NOT a cost to the job)
 * each rounded to the fils, half up (31.605 → 31.61), the VAT worked out on the rounded fees. A job's cost is
 * MSF + fee (without VAT); the bank keeps MSF + fee + VAT.
 */

export type FeeRule = {
  /** The merchant service fee in percent, before VAT. */
  msfPercent: number;
  /** A fixed fee per transaction (AED), before VAT. */
  txnFee: number;
  /** VAT on the fees in percent (5); 0 for methods the bank charges no VAT on. */
  vatPercent: number;
  /** The terminal IDs of this method on the bank's reports (to recognise the method in an imported report). */
  terminals: string[];
};
export type BankFees = Record<string, FeeRule>;

export type FeeSplit = {
  msf: number;
  txn: number;
  vat: number;
  /** MSF + transaction fee: the job's cost (VAT is reclaimable). */
  cost: number;
  /** What the bank keeps: MSF + fee + VAT. */
  total: number;
  /** What reaches the bank: amount − total. */
  net: number;
};

/** The methods with a fee rule of their own; the card machine and the payment link carry VAT and terminals. */
export const FEE_METHODS = ["card", "link", "cash", "cheque", "transfer"] as const;
export const VAT_METHODS = ["card", "link"] as const;

/** To the fils, half up, as the bank rounds (31.605 → 31.61; floating point never rounds it down). */
export function roundHalfUp(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const sign = x < 0 ? -1 : 1;
  const cents = Math.round(Number((Math.abs(x) * 100).toPrecision(12)));
  return (sign * cents) / 100;
}

const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** "AB12 3456, 7890" → ["AB12", "3456", "7890"]: terminal IDs as typed, upper-case, no blanks. */
export function terminalList(text: unknown): string[] {
  return String(Array.isArray(text) ? text.join(" ") : (text ?? ""))
    .split(/[\s,;]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
}

/** The fee rules out of the settings (keys bank_charge_<method>_percent, bank_fee_<method>_txn_aed, bank_fee_vat_percent, bank_terminal_ids_<method>). */
export function bankFeesFrom(settings: Record<string, unknown>): BankFees {
  const vat = num(settings.bank_fee_vat_percent, 5);
  const out: BankFees = {};
  for (const m of FEE_METHODS) {
    const withVat = (VAT_METHODS as readonly string[]).includes(m);
    out[m] = {
      msfPercent: num(settings[`bank_charge_${m}_percent`], 0),
      txnFee: withVat ? num(settings[`bank_fee_${m}_txn_aed`], 0) : 0,
      vatPercent: withVat ? vat : 0,
      terminals: withVat ? terminalList(settings[`bank_terminal_ids_${m}`]) : [],
    };
  }
  return out;
}

/** The fees on one payment of `amount` (count = how many transactions it took; one unless split on the machine). */
export function feesFor(amount: number, rule: FeeRule | null | undefined, count = 1): FeeSplit {
  const a = roundHalfUp(Number(amount) || 0);
  if (!rule || a <= 0) return { msf: 0, txn: 0, vat: 0, cost: 0, total: 0, net: a };
  const msf = roundHalfUp((a * rule.msfPercent) / 100);
  const txn = roundHalfUp(rule.txnFee * Math.max(1, count));
  const vat = roundHalfUp(((msf + txn) * rule.vatPercent) / 100);
  const cost = roundHalfUp(msf + txn);
  const total = roundHalfUp(cost + vat);
  return { msf, txn, vat, cost, total, net: roundHalfUp(a - total) };
}

/** "2.15% + VAT 5%" / "1.75% + AED 1.00 + VAT 5%" / "0%": the rule in the words the screens use. */
export function feeRuleWords(rule: FeeRule | null | undefined): string {
  if (!rule || (rule.msfPercent <= 0 && rule.txnFee <= 0)) return "no bank fee";
  const parts = [`${rule.msfPercent}%`];
  if (rule.txnFee > 0) parts.push(`AED ${rule.txnFee.toFixed(2)}`);
  if (rule.vatPercent > 0) parts.push(`VAT ${rule.vatPercent}%`);
  return parts.join(" + ");
}

/** Which method a terminal ID on a bank report belongs to, by the IDs in Settings (null when unknown). */
export function methodOfTerminal(fees: BankFees, terminalId: string | null | undefined): "card" | "link" | null {
  const t = String(terminalId ?? "").trim().toUpperCase();
  if (!t) return null;
  for (const m of VAT_METHODS) if (fees[m]?.terminals.includes(t)) return m;
  return null;
}
