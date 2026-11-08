/**
 * THE rules of "Send LPO for selected" (8 November 2026, Peter): the parts desk ticks only the parts it is ordering
 * now; the rest stay "Approved – to order" for a later LPO. Pure (no imports), so the page, the server action and
 * the tests read exactly the same rule.
 */

/** A part number with spaces, dashes, dots and slashes taken out, in capitals ("A 167 330 68 00" = "A1673306800"). */
export function compactNumber(pn: string | null | undefined): string {
  return String(pn ?? "").replace(/[\s\-._/]/g, "").toUpperCase();
}

const NOT_A_NUMBER = /^(NONUMBER|NO|NA|N\/A|TBC|TBA|\d{1,3}|OFJ\d{0,3})$/;

/** A part's name without its left/right side or case ("FRONT LH LIGHT" = "front light"), for "the same part". */
export function sameNameKey(name: string | null | undefined): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\b(fl|fr)\b/g, "front")
    .replace(/\b(rl|rr)\b/g, "rear")
    .replace(/\b(left|right|lh|rh|l\/h|r\/h|pair|both)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export type NumberedPart = { id: string; name: string; partNumber: string | null };

/**
 * Item 5: the same part number on DIFFERENT parts of one job (1234AA on the air filter, the battery, the oil filter and
 * the wiper blades). Every such part is flagged, by id, with the words naming the others. The same part split over
 * several rows (left and right, two positions) is never a repeat. "No part number" never counts.
 */
export function repeatedPartNumbers(parts: NumberedPart[]): Map<string, string> {
  const groups = new Map<string, NumberedPart[]>();
  for (const p of parts) {
    const n = compactNumber(p.partNumber);
    if (!n || NOT_A_NUMBER.test(n)) continue;
    groups.set(n, [...(groups.get(n) ?? []), p]);
  }
  const out = new Map<string, string>();
  for (const [, list] of groups) {
    const names = new Set(list.map((p) => sameNameKey(p.name)));
    if (names.size < 2) continue;
    for (const p of list) {
      const others = list.filter((o) => sameNameKey(o.name) !== sameNameKey(p.name)).map((o) => o.name.toUpperCase());
      out.set(p.id, `Part number ${String(p.partNumber).trim()} is also on ${Array.from(new Set(others)).join(", ")} – fix it or set "No part number"`);
    }
  }
  return out;
}

export type SelectInput = {
  id: string;
  name: string;
  supplier: string | null;
  quantity: number;
  /** Net cost per unit, before VAT. */
  cost: number | null;
  orderStatus: string | null;
  onLpo: boolean;
  inStock: boolean;
  received: boolean;
  removed: boolean;
  /** What the row still needs ("tyre size and brand needed"), from THE row rule (parts-rows rowMissing). */
  missing: string[];
  /** The LPO cost gate (no real price, AED 1.00 not confirmed): part-cost-check lpoLineProblem's words. */
  costProblem: string | null;
  /** The repeated-part-number words for this part, or null. */
  repeated: string | null;
};

export type SelectRow = { id: string; name: string; supplier: string; quantity: number; cost: number; eligible: boolean; why: string | null; red: boolean };

/** Item 2: may this line be ticked, and if not, why (in the order the desk fixes it). */
export function selectRowOf(p: SelectInput): SelectRow {
  const base = { id: p.id, name: p.name, supplier: (p.supplier ?? "").trim(), quantity: p.quantity || 1, cost: Number(p.cost) || 0 };
  const no = (why: string, red = false): SelectRow => ({ ...base, eligible: false, why, red });
  if (p.removed) return no("Removed");
  if (p.orderStatus !== "to_order") return no(p.orderStatus === "none" || !p.orderStatus ? "Not approved yet" : "Already ordered");
  if (p.onLpo) return no("Already on an LPO");
  if (p.received) return no("Already received");
  if (p.inStock) return no("From our stock – no LPO");
  if (p.repeated) return no(p.repeated, true);
  if (p.missing.length) return no(`Not finished: ${p.missing.join(", ")}`, true);
  if (p.costProblem) return no(p.costProblem, true);
  if (!base.supplier) return no("No supplier", true);
  return { ...base, eligible: true, why: null, red: false };
}

export type SupplierPreview = { supplier: string; parts: { id: string; name: string; quantity: number; net: number }[]; net: number };

/** Item 3: the preview per supplier before sending: parts and the net before VAT (the screen adds VAT by THE rule). */
export function previewBySupplier(rows: SelectRow[], ticked: Set<string>): SupplierPreview[] {
  const out = new Map<string, SupplierPreview>();
  for (const r of rows) {
    if (!r.eligible || !ticked.has(r.id)) continue;
    const net = Math.round(r.cost * r.quantity * 100) / 100;
    const s = out.get(r.supplier) ?? { supplier: r.supplier, parts: [], net: 0 };
    s.parts.push({ id: r.id, name: r.name, quantity: r.quantity, net });
    s.net = Math.round((s.net + net) * 100) / 100;
    out.set(r.supplier, s);
  }
  return Array.from(out.values()).sort((a, b) => a.supplier.localeCompare(b.supplier));
}

/** Why a ticked set cannot be sent (the server checks the same), or null. */
export function selectionProblem(rows: SelectRow[], ids: string[]): string | null {
  if (!ids.length) return "Tick the parts to order now.";
  const byId = new Map(rows.map((r) => [r.id, r]));
  const bad = ids.map((id) => byId.get(id)).filter((r) => !r || !r.eligible);
  if (bad.length) return `${bad.length} ticked part${bad.length === 1 ? "" : "s"} cannot go on an LPO: ${bad.map((r) => (r ? `${r.name.toUpperCase()} (${r.why})` : "a part that changed")).join("; ")}`;
  return null;
}

/** The marker in a main LPO's notes: it carries only the parts the desk ticked, so nothing is swept onto it later. */
export const SELECTED_MARKER = "Selected parts only";
