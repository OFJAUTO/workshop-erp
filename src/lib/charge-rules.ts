/**
 * EARLY CHARGES and PENDING CHARGES (1 November 2026, B2): one charge line has a COST (what we pay the provider) and a
 * CHARGE (what the customer pays, or free). The words on the vehicle check-in show the VAT the agreed way:
 * "Recovery – full down, two ways: AED 630.00 including VAT (AED 600 + VAT)". Pure: no database.
 */

export type ChargeKind = "recovery" | "fuel" | "other";
export const CHARGE_KINDS: { key: ChargeKind; label: string }[] = [
  { key: "recovery", label: "Recovery" },
  { key: "fuel", label: "Fuel" },
  { key: "other", label: "Other" },
];

export type ChargeInput = {
  kind: ChargeKind;
  description: string;
  provider?: string | null;
  recovery_type?: string | null;
  trips?: number | null;
  litres?: number | null;
  cost_aed: number;
  supplier_trn?: string | null;
  charge_aed: number;
  free?: boolean;
  service_date?: string | null;
};

export type ChargeLineRow = ChargeInput & {
  id: string;
  job_id: string | null;
  entry_id: string | null;
  bill_path: string | null;
  free_status: string | null;
  agreed_at: string | null;
  quotation_line_id: string | null;
  invoice_id: string | null;
  created_at: string;
  is_active: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => r2(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plainMoney = (n: number) => (Number.isInteger(r2(n)) ? String(r2(n)) : money(n));

/** "Recovery – full down, two ways", "Fuel – 40 L", or what was typed. */
export function chargeTitle(c: Pick<ChargeInput, "kind" | "description" | "recovery_type" | "litres">, recoveryLabel?: string | null): string {
  if (c.kind === "recovery") {
    const what = (recoveryLabel || c.description || "").trim().replace(/^recovery\s*[–-]?\s*/i, "");
    return what ? `Recovery – ${what}` : "Recovery";
  }
  if (c.kind === "fuel") return c.litres ? `Fuel – ${c.litres} L` : c.description?.trim() || "Fuel";
  return c.description.trim();
}

/** What the customer pays for one line, before VAT (0 when free). */
export const chargeNet = (c: Pick<ChargeInput, "charge_aed" | "free">) => (c.free ? 0 : r2(Number(c.charge_aed) || 0));

/** The VAT the agreed way, in English: "Recovery – full down, two ways: AED 630.00 including VAT (AED 600 + VAT)". */
export function chargeWordsEn(title: string, c: Pick<ChargeInput, "charge_aed" | "free">, vatPercent = 5): string {
  if (c.free) return `${title}: complimentary`;
  const net = chargeNet(c);
  return `${title}: AED ${money(net * (1 + vatPercent / 100))} including VAT (AED ${plainMoney(net)} + VAT)`;
}

/** The same in Arabic. */
export function chargeWordsAr(title: string, c: Pick<ChargeInput, "charge_aed" | "free">, vatPercent = 5): string {
  if (c.free) return `${title}: مجاناً`;
  const net = chargeNet(c);
  return `${title}: ${money(net * (1 + vatPercent / 100))} درهم شاملة ضريبة القيمة المضافة (${plainMoney(net)} درهم + الضريبة)`;
}

/** The words added to the check-in approval when charges are listed on it. */
export const CHARGES_AGREE_EN = "…and agree to pay the charges listed above, even if no further work is approved.";
export const CHARGES_AGREE_AR = "…وأوافق على دفع الرسوم المذكورة أعلاه، حتى لو لم تتم الموافقة على أي عمل إضافي.";

/** Totals of a set of lines: what we pay, what the customer pays before VAT, the VAT and the total. */
export function chargeTotals(lines: Pick<ChargeInput, "cost_aed" | "charge_aed" | "free">[], vatPercent = 5) {
  const cost = r2(lines.reduce((a, l) => a + (Number(l.cost_aed) || 0), 0));
  const net = r2(lines.reduce((a, l) => a + chargeNet(l), 0));
  const vat = r2((net * vatPercent) / 100);
  return { cost, net, vat, total: r2(net + vat), profit: r2(net - cost) };
}

/** A line's own check: a description (or a recovery type), a cost of 0 or more, a charge above 0 unless free. */
export function chargeProblem(c: ChargeInput): string | null {
  if (!["recovery", "fuel", "other"].includes(c.kind)) return "Pick Recovery, Fuel or Other.";
  if (c.kind === "other" && !c.description.trim()) return "Write what the charge is for.";
  if (c.kind === "recovery" && !(c.recovery_type || c.description).trim()) return "Pick the recovery type.";
  if (c.kind === "fuel" && !(Number(c.litres) > 0) && !c.description.trim()) return "Type the litres.";
  if (!(Number(c.cost_aed) >= 0)) return "The cost must be a number (0 or more).";
  if (!c.free && !(Number(c.charge_aed) > 0)) return "Type what the customer pays, or tick Free.";
  if (c.description.length > 3000) return "The description is too long.";
  return null;
}

/** "pending 9 days". */
export function pendingDays(since: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(since)) / 86400000));
}

/** "Pending charge: AED 630.00 (recovery 12 Oct) – collect it": the note on the gate-in, quotation and customer panel. */
export function pendingChargeNote(p: { total: number; what: string; date: string | null }): string {
  const day = p.date ? new Date(`${p.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "";
  return `Pending charge: AED ${money(p.total)} (${[p.what.toLowerCase(), day].filter(Boolean).join(" ")}) – collect it`;
}
