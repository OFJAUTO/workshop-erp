/**
 * RECEIVING NEVER BLOCKS THE MECHANIC (15 November 2026, URGENT). Pure rules, no server imports.
 *
 * A delivery is recorded with ONE reference from the supplier's paper - an invoice number, a pre-payment parts invoice
 * number, a WIP number, or any type the owner or accounts add - or as "ARRIVED - PAPERWORK PENDING" with no reference at
 * all. The parts go to the technician either way. Each type says whether it COUNTS as the supplier's invoice: when it
 * does not (a WIP number), or when nothing was typed, the real invoice is still due and the receipt stays on "Invoices
 * not received": by the end of the same working day for a normal supplier, within its own days (at most 5) for one
 * marked "Invoice later allowed".
 */

export type RefType = { key: string; label: string; counts: boolean; builtin?: boolean };
export type Ref = { type: string; number: string };

export const DEFAULT_REF_TYPES: RefType[] = [
  { key: "invoice", label: "Invoice number", counts: true, builtin: true },
  { key: "prepay", label: "Pre-payment parts invoice number", counts: true, builtin: true },
  { key: "wip", label: "WIP number", counts: false, builtin: true },
];

/** The stored setting, tidied: the three built-in types always there (their "counts" may be changed), keys unique. */
export function refTypesOf(stored: unknown): RefType[] {
  const list = Array.isArray(stored) ? (stored as Partial<RefType>[]) : [];
  const out: RefType[] = [];
  const seen = new Set<string>();
  for (const d of DEFAULT_REF_TYPES) {
    const s = list.find((x) => x && x.key === d.key);
    out.push({ key: d.key, label: d.label, counts: typeof s?.counts === "boolean" ? s.counts : d.counts, builtin: true });
    seen.add(d.key);
  }
  for (const s of list) {
    if (!s || typeof s.key !== "string" || seen.has(s.key) || !String(s.label ?? "").trim()) continue;
    seen.add(s.key);
    out.push({ key: s.key, label: String(s.label).trim().slice(0, 60), counts: !!s.counts });
  }
  return out;
}

/** A new type's key from its words ("Delivery note number" -> "delivery_note_number"). */
export const refKeyOf = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "other";

export const refLabel = (types: RefType[], key: string) => types.find((t) => t.key === key)?.label ?? key;
export const refCounts = (types: RefType[], key: string) => !!types.find((t) => t.key === key)?.counts;

/** The references of a stored receipt (older receipts carry only invoice_number). */
export function refsOfRow(r: { refs?: unknown; invoice_number?: string | null }): Ref[] {
  const refs = Array.isArray(r.refs) ? (r.refs as Ref[]).filter((x) => x && typeof x.number === "string" && x.number.trim()) : [];
  if (refs.length) return refs.map((x) => ({ type: String(x.type || "invoice"), number: x.number.trim() }));
  return r.invoice_number ? [{ type: "invoice", number: r.invoice_number }] : [];
}

/** THE number that counts as the supplier's invoice (the first reference of a counting type), or null. */
export function countingNumber(refs: Ref[], types: RefType[]): string | null {
  return refs.find((x) => refCounts(types, x.type))?.number ?? null;
}

/** "Pre-payment parts invoice number 1260925542 · WIP number W-77". */
export function refWords(refs: Ref[], types: RefType[]): string {
  return refs.map((x) => `${refLabel(types, x.type)} ${x.number}`).join(" · ");
}

/** The three list columns: INVOICE NO. / PRE-PAYMENT PARTS INVOICE NO. / WIP NO. (other types go with the invoice). */
export function refColumns(refs: Ref[]): { invoice: string | null; prepay: string | null; wip: string | null; other: Ref[] } {
  const of = (k: string) => refs.filter((x) => x.type === k).map((x) => x.number).join(", ") || null;
  return { invoice: of("invoice"), prepay: of("prepay"), wip: of("wip"), other: refs.filter((x) => !["invoice", "prepay", "wip"].includes(x.type)) };
}

/** What a typed reference must look like (the same rule as the invoice box: digits, no repeated single character). */
export function refNumberProblem(raw: string, label = "reference"): string | null {
  const n = raw.trim();
  if (!n) return `Type the ${label.toLowerCase()} (it is on the supplier's paper).`;
  if (n.length < 2 || n.length > 80 || !/^[A-Za-z0-9 /\-._#]+$/.test(n) || !/\d/.test(n)) return `"${n}" does not look like a ${label.toLowerCase()}: type it as printed on the supplier's paper.`;
  const compact = n.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (/^(.)\1+$/.test(compact)) return `"${n}" does not look like a ${label.toLowerCase()}: type it as printed on the supplier's paper.`;
  return null;
}

/** The day the paperwork is due: the same day for a normal supplier, its own days (at most 5) for "invoice later". */
export function paperworkDue(receivedDay: string, laterAllowed: boolean, laterDays: number): string {
  const days = laterAllowed ? Math.min(5, Math.max(1, Math.round(laterDays) || 5)) : 0;
  return new Date(Date.parse(`${receivedDay.slice(0, 10)}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const dayWords = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split("-").map(Number);
  return `${String(dd).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
};

/** The receipt's tag while the invoice is still due. */
export function pendingTag(o: { refs: Ref[]; due: string | null; today: string }): string {
  const what = o.refs.length ? "INVOICE" : "PAPERWORK";
  if (!o.due) return `${what} PENDING`;
  if (o.due === o.today) return `ARRIVED - ${what} DUE TODAY`;
  if (o.due < o.today) return `${what} OVERDUE (DUE ${dayWords(o.due)})`;
  return `${what} DUE BY ${dayWords(o.due)}`;
}

/** Live check (15 Nov): an "invoice number" typed at receiving that looks like a WIP or a pre-payment number. */
export function looksLikeOtherRef(number: string | null | undefined): "wip" | "prepay" | null {
  const n = String(number ?? "").trim();
  if (!n) return null;
  if (/^\s*w\.?\s*i\.?\s*p\b|^wip|\bwip\b|^w[-/ ]?\d/i.test(n)) return "wip";
  if (/^(pp|pre|ppi|prepay|pre-?pay|advance|adv)[-/ ]?\d|pre[- ]?pay|prepayment|advance/i.test(n)) return "prepay";
  return null;
}

/**
 * May an LPO be closed (its invoice checked) or paid? Not while a delivery on it was recorded "Arrived - paperwork pending"
 * and still carries no reference: the paper that came with THAT delivery must be typed on its receipt (an invoice entered
 * on the LPO is never assumed to cover it - a late part often comes on its own paper).
 */
export function paperworkBlock(receipts: { poNumber: string; refs: Ref[]; pending: boolean }[]): string | null {
  const open = receipts.filter((r) => r.pending && !r.refs.length);
  if (!open.length) return null;
  const pos = Array.from(new Set(open.map((r) => r.poNumber))).join(", ");
  return `${pos} has ${open.length === 1 ? "a delivery" : `${open.length} deliveries`} recorded as "Arrived - paperwork pending": type the supplier's reference on the receipt first (LPO page > Receipts).`;
}
