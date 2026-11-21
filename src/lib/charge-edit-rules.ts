/**
 * EDIT A CHARGE AFTER IT IS SAVED (21 November 2026, Section 1; real case J-01030 "DELIVERY CHARGES - SHANGAI GLOBAL AUTO
 * PARTS"). Pure: the job card's Edit window, the server and the tests read it.
 *
 * What may change depends on where the charge stands:
 *  - internal only (never shown to the customer): everything, at any time;
 *  - agreed on the vehicle check-in, in a quotation, or on an invoice: the customer's wording and price are locked (a
 *    revision or a credit note changes them); the internal cost, provider, note and bill can still be corrected;
 *  - recorded in a Journal Voucher: only accounts and the owner change the cost; the job's cost and the voucher move
 *    together.
 */

export type ChargeEditFacts = {
  invoiceNumber: string | null;
  agreed: boolean;
  /** The quotation the charge is on (its number and status), if any. */
  quote: { number: string; status: string } | null;
  /** The live Journal Voucher the charge is on, if any. */
  voucher: { number: string; status: string } | null;
  role: string;
};

export type ChargeEditState = {
  /** Why the customer's wording and price cannot change here (null = they can). */
  customerLocked: string | null;
  /** Why the cost cannot change for this person (null = it can). */
  costLocked: string | null;
  /** Never shown to the customer. */
  internal: boolean;
};

const SENT = ["sent", "opened", "approved", "urgent_requested", "superseded"];

export function chargeEditState(f: ChargeEditFacts): ChargeEditState {
  let customerLocked: string | null = null;
  if (f.invoiceNumber) customerLocked = `On invoice ${f.invoiceNumber}: the customer's wording and price are locked (a credit note changes them).`;
  else if (f.quote && SENT.includes(f.quote.status)) customerLocked = `On ${f.quote.number} (${f.quote.status === "approved" ? "approved" : "sent"}): the customer's wording and price change only with a revision of the quotation.`;
  else if (f.quote) customerLocked = `In the draft ${f.quote.number}: change the customer's wording and price in the quotation itself.`;
  else if (f.agreed) customerLocked = "Agreed by the customer on the vehicle check-in: the wording and price are locked.";
  const costLocked = f.voucher && f.voucher.status !== "void" && f.role !== "owner" && f.role !== "accounts" ? `Recorded in ${f.voucher.number}: only accounts or the owner change the cost (the voucher changes with it).` : null;
  return { customerLocked, costLocked, internal: !f.invoiceNumber && !f.quote && !f.agreed };
}

export type ChargeEditable = { description: string; kind: string; trips: number | null; charge: number; free: boolean; provider: string | null; cost: number; note: string | null };
export const CUSTOMER_FIELDS: (keyof ChargeEditable)[] = ["description", "kind", "trips", "charge", "free"];
export const FIELD_LABEL: Record<keyof ChargeEditable, string> = { description: "Description", kind: "Type", trips: "Trips", charge: "Customer pays", free: "Free", provider: "Provider", cost: "Cost (we pay)", note: "Note" };

const show = (k: keyof ChargeEditable, v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (k === "free") return v ? "yes" : "no";
  if (k === "charge" || k === "cost") return `AED ${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return String(v);
};
const same = (k: keyof ChargeEditable, a: unknown, b: unknown) => (k === "charge" || k === "cost" ? Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005 : (a ?? null) === (b ?? null) || String(a ?? "").trim() === String(b ?? "").trim());

/** Every field that really changed: label, old words, new words. */
export function chargeChanges(before: ChargeEditable, after: ChargeEditable): { field: keyof ChargeEditable; label: string; old: string; new: string }[] {
  return (Object.keys(FIELD_LABEL) as (keyof ChargeEditable)[]).filter((k) => !same(k, before[k], after[k])).map((k) => ({ field: k, label: FIELD_LABEL[k], old: show(k, before[k]), new: show(k, after[k]) }));
}

/** A change that touches a locked part: the words that refuse it (null = allowed). */
export function editRefusal(state: ChargeEditState, changes: { field: keyof ChargeEditable }[]): string | null {
  if (state.customerLocked && changes.some((c) => CUSTOMER_FIELDS.includes(c.field))) return state.customerLocked;
  if (state.costLocked && changes.some((c) => c.field === "cost")) return state.costLocked;
  return null;
}

/** "Description SHANGAI → SHANGHAI; Provider — → …" for the job's history. */
export function changeWords(changes: { label: string; old: string; new: string }[]): string {
  return changes.map((c) => `${c.label} ${c.old} → ${c.new}`).join("; ");
}

/** 5% VAT check for a voucher line: null when it matches (within a fils per line), else the warning words. */
export function vatCheckWords(net: number, vat: number, pct = 5): string | null {
  if (!(vat > 0)) return null;
  const expected = Math.round(net * pct) / 100;
  return Math.abs(expected - vat) <= 0.011 ? null : `VAT ${vat.toFixed(2)} is not ${pct}% of ${net.toFixed(2)} (that would be ${expected.toFixed(2)}). Check the tax invoice.`;
}

/** A 15-digit TRN (spaces and dashes ignored), or null. */
export function cleanTrn(t: string | null | undefined): string | null {
  const d = String(t ?? "").replace(/[\s-]/g, "");
  return /^\d{15}$/.test(d) ? d : null;
}
