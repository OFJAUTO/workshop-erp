/**
 * ONE LPO, SEVERAL SUPPLIER INVOICES (10 November 2026, Section 3). THE rules, pure (no server imports).
 *
 * The LPO's own invoice columns stay THE first invoice. Every further invoice on the same LPO names the LPO lines and
 * the quantity of each it covers. The first invoice covers its own named lines (`supplier_invoice_lines`), or - while
 * nothing is named - every quantity no other invoice covers. A line is "waiting for an invoice" for any quantity no
 * invoice covers. The LPO counts as fully invoiced only when nothing waits.
 */

export type CoveredLine = { line_id: string; qty: number };
export type LpoLineFacts = { id: string; description: string; quantity: number; received_qty?: number | null };
export type FirstInvoice = { entered: boolean; number: string | null; date: string | null; lines: CoveredLine[] | null };
export type ExtraInvoice = { id: string; number: string; date: string; lines: CoveredLine[]; is_active?: boolean };

const q3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

/** What counts on a line: what was delivered once anything was received, else what was ordered. */
export const billableQty = (l: LpoLineFacts) => q3(l.received_qty != null && Number(l.received_qty) > 0 ? Number(l.received_qty) : l.quantity);

export type LineCoverage = { lineId: string; description: string; qty: number; onFirst: number; onOthers: number; waiting: number };

/** Per line: how much the first invoice, the other invoices and nothing (waiting) cover. */
export function coverageOf(lines: LpoLineFacts[], first: FirstInvoice, extras: ExtraInvoice[]): LineCoverage[] {
  const live = extras.filter((e) => e.is_active !== false);
  return lines.map((l) => {
    const qty = billableQty(l);
    const onOthers = q3(live.reduce((a, e) => a + e.lines.filter((c) => c.line_id === l.id).reduce((b, c) => b + (Number(c.qty) || 0), 0), 0));
    let onFirst = 0;
    if (first.entered) {
      if (first.lines) onFirst = q3(first.lines.filter((c) => c.line_id === l.id).reduce((b, c) => b + (Number(c.qty) || 0), 0));
      else onFirst = q3(Math.max(0, qty - onOthers));
    }
    return { lineId: l.id, description: l.description, qty, onFirst, onOthers, waiting: q3(Math.max(0, qty - onFirst - onOthers)) };
  });
}

/** "2 invoices · 1 line still waiting for an invoice" (or "fully invoiced"). */
export function invoicesSummary(first: FirstInvoice, extras: ExtraInvoice[], coverage: LineCoverage[]): string {
  const n = (first.entered ? 1 : 0) + extras.filter((e) => e.is_active !== false).length;
  const waiting = coverage.filter((c) => c.waiting > 0.0005).length;
  const head = n === 0 ? "No supplier invoice yet" : `${n} invoice${n === 1 ? "" : "s"}`;
  if (n === 0) return head;
  return waiting ? `${head} · ${waiting} line${waiting === 1 ? "" : "s"} still waiting for an invoice` : `${head} · fully invoiced`;
}

export const fullyInvoiced = (coverage: LineCoverage[]) => coverage.every((c) => c.waiting <= 0.0005);

/** The invoice number as a key: no spaces, dashes or case ("INV-4512" = "inv 4512"). */
export const numberKey = (n: string | null | undefined) => String(n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** An invoice number already used by the same supplier elsewhere: the LPO it is on and its date. */
export type NumberUse = { number: string; date: string | null; poNumber: string; samePo: boolean };

/**
 * THE safety check of a new (or split-off) invoice. The same line quantity is never invoiced twice; a number is
 * never used twice on the same LPO; on another LPO of the same supplier it is accepted only as the same paper (same
 * date: one supplier invoice may cover two LPOs), otherwise refused.
 */
export function newInvoiceProblem(input: { number: string; date: string; amount: number | null; vat: number | null; lines: CoveredLine[] }, room: Map<string, number>, uses: NumberUse[]): string | null {
  const number = input.number.trim();
  if (!number) return "Type the supplier's invoice number.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Pick the invoice date.";
  if (input.amount === null || !(input.amount >= 0)) return "Type the amount before VAT, as printed on the invoice.";
  if (input.vat !== null && input.vat < 0) return "The VAT cannot be below zero.";
  const picked = input.lines.filter((l) => (Number(l.qty) || 0) > 0);
  if (!picked.length) return "Tick the LPO lines this invoice covers.";
  for (const l of picked) {
    const free = room.get(l.line_id);
    if (free === undefined) return "One of the lines is no longer on this LPO.";
    if (q3(l.qty) > q3(free) + 0.0005) return free <= 0.0005 ? "A line you ticked is already on another invoice: the same line is never invoiced twice." : `A line you ticked has only ${q3(free)} left to invoice: the same quantity is never invoiced twice.`;
  }
  const key = numberKey(number);
  for (const u of uses) {
    if (numberKey(u.number) !== key) continue;
    if (u.samePo) return `Invoice ${number} is already on this LPO: an invoice number is used once per supplier.`;
    if ((u.date ?? "") !== input.date) return `Invoice ${number} is already used for this supplier on ${u.poNumber}${u.date ? ` (dated ${u.date})` : ""}: an invoice number is used once per supplier.`;
  }
  return null;
}

/** What each line can still take on a new invoice: its waiting quantity (Add another invoice). */
export function waitingRoom(coverage: LineCoverage[]): Map<string, number> {
  return new Map(coverage.map((c) => [c.lineId, c.waiting]));
}

/** What each line can be moved off the first invoice (Split this invoice). */
export function firstRoom(coverage: LineCoverage[]): Map<string, number> {
  return new Map(coverage.map((c) => [c.lineId, c.onFirst]));
}

/** The first invoice's lines after moving `moved` off it (always named once the LPO has more than one invoice). */
export function firstAfterSplit(coverage: LineCoverage[], moved: CoveredLine[]): CoveredLine[] {
  const off = new Map<string, number>();
  for (const m of moved) off.set(m.line_id, q3((off.get(m.line_id) ?? 0) + (Number(m.qty) || 0)));
  return coverage.map((c) => ({ line_id: c.lineId, qty: q3(Math.max(0, c.onFirst - (off.get(c.lineId) ?? 0))) })).filter((c) => c.qty > 0.0005);
}

/** The key of one invoice in the payment box: the LPO, plus the further invoice when it is not the first. */
export const payKeyOf = (poId: string, invoiceId: string | null | undefined) => (invoiceId ? `${poId}~${invoiceId}` : poId);
export function splitPayKey(key: string): { poId: string; invoiceId: string | null } {
  const [poId, invoiceId] = key.split("~");
  return { poId, invoiceId: invoiceId || null };
}

/** The VAT of an invoice: as printed when typed, else 5% of the amount (rounded half up); 0 when the supplier charges none. */
export function invoiceVatOf(amount: number, typedVat: number | null, chargesVat: boolean): number {
  if (!chargesVat && (typedVat === null || typedVat <= 0)) return 0;
  if (typedVat !== null) return Math.round(typedVat * 100) / 100;
  return Math.round((amount * 0.05 + Number.EPSILON) * 100) / 100;
}

/** Read the lines a form sent: "line__<id>" ticked with "qty__<id>". */
export function linesFromForm(get: (name: string) => string | null, lineIds: string[]): CoveredLine[] {
  const out: CoveredLine[] = [];
  for (const id of lineIds) {
    if (get(`line__${id}`) !== "on" && get(`line__${id}`) !== "1") continue;
    const qty = Number(String(get(`qty__${id}`) ?? "").replace(/,/g, "."));
    out.push({ line_id: id, qty: Number.isFinite(qty) && qty > 0 ? q3(qty) : 0 });
  }
  return out;
}

/*
 * 15 November 2026 (Section 2): EACH PART ON EXACTLY ONE INVOICE. The value of a line on an invoice, the running check
 * of an LPO ("Invoices total AED … of the LPO's AED …", a part on two invoices or on none), a line moved from one
 * invoice of the LPO to another (its amount goes with it), and the block on paying a part twice.
 */

/** What a quantity of a line is worth on an invoice: the invoice price when entered, else the LPO price. */
export const lineValue = (qty: number, unit: number) => Math.round((q3(qty) * (Number(unit) || 0) + Number.EPSILON) * 100) / 100;

/** The lines (and quantities) on one invoice of the LPO: "first" or a further invoice's own lines. */
export function linesOnInvoice(coverage: LineCoverage[], which: "first" | CoveredLine[]): { lineId: string; description: string; qty: number }[] {
  if (which === "first") return coverage.filter((c) => c.onFirst > 0.0005).map((c) => ({ lineId: c.lineId, description: c.description, qty: c.onFirst }));
  return which.filter((l) => l.qty > 0.0005).map((l) => ({ lineId: l.line_id, description: coverage.find((c) => c.lineId === l.line_id)?.description ?? "", qty: q3(l.qty) }));
}

/** Lines on more than one invoice (more quantity invoiced than delivered) and lines on none. */
export function coverageProblems(coverage: LineCoverage[]): { twice: LineCoverage[]; none: LineCoverage[] } {
  return { twice: coverage.filter((c) => c.onFirst + c.onOthers > c.qty + 0.0005), none: coverage.filter((c) => c.waiting > 0.0005) };
}

export type InvoicesCheck = { invoicesTotal: number; lpoTotal: number; words: string; warnings: string[]; ok: boolean };

/** THE running check of an LPO with several invoices (all figures with VAT). */
export function invoicesCheck(coverage: LineCoverage[], invoicesGross: number[], lpoGross: number): InvoicesCheck {
  const invoicesTotal = Math.round(invoicesGross.reduce((a, x) => a + x, 0) * 100) / 100;
  const lpoTotal = Math.round(lpoGross * 100) / 100;
  const { twice, none } = coverageProblems(coverage);
  const warnings = [
    ...twice.map((c) => `${c.description.toUpperCase()} is on two invoices (${q3(c.onFirst + c.onOthers)} invoiced of ${q3(c.qty)}): move it so it sits on one.`),
    ...none.map((c) => `${c.description.toUpperCase()} is on no invoice yet${c.waiting < c.qty ? ` (${q3(c.waiting)} of ${q3(c.qty)})` : ""}.`),
  ];
  const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const over = invoicesTotal > lpoTotal + 0.05;
  if (over) warnings.unshift(`The invoices add up to AED ${fmt(invoicesTotal - lpoTotal)} more than the LPO: check that no part is invoiced twice.`);
  return { invoicesTotal, lpoTotal, words: `Invoices total AED ${fmt(invoicesTotal)} of the LPO's AED ${fmt(lpoTotal)}`, warnings, ok: !warnings.length };
}

export type MoveInput = { lineId: string; qty: number; from: string; to: string };

/** May this quantity of a line move from one invoice of the LPO to another? ("first" or a further invoice's id.) */
export function moveProblem(m: MoveInput, coverage: LineCoverage[], extras: { id: string; number: string; lines: CoveredLine[]; paid: boolean }[], firstPaid: boolean, firstNumber: string | null): string | null {
  if (m.from === m.to) return "Pick another invoice to move it to.";
  if (!(m.qty > 0)) return "Type how many to move.";
  const c = coverage.find((x) => x.lineId === m.lineId);
  if (!c) return "That line is no longer on this LPO.";
  const nameOf = (id: string) => (id === "first" ? firstNumber ?? "the first invoice" : extras.find((e) => e.id === id)?.number ?? "");
  const has = m.from === "first" ? c.onFirst : q3((extras.find((e) => e.id === m.from)?.lines ?? []).filter((l) => l.line_id === m.lineId).reduce((a, l) => a + l.qty, 0));
  if (m.from !== "first" && !extras.some((e) => e.id === m.from)) return "That invoice is no longer on this LPO.";
  if (m.to !== "first" && !extras.some((e) => e.id === m.to)) return "That invoice is no longer on this LPO.";
  if (q3(m.qty) > q3(has) + 0.0005) return `Invoice ${nameOf(m.from)} has only ${q3(has)} of ${c.description.toUpperCase()}.`;
  const paidOne = [m.from, m.to].find((id) => (id === "first" ? firstPaid : extras.find((e) => e.id === id)?.paid));
  if (paidOne) return `Invoice ${nameOf(paidOne)} is already paid to the supplier: reverse the payment first, then move the part.`;
  // An invoice is never left with no line at all (change or remove the invoice itself instead).
  const left = m.from === "first" ? coverage.reduce((a, x) => a + (x.lineId === m.lineId ? Math.max(0, x.onFirst - m.qty) : x.onFirst), 0) : (extras.find((e) => e.id === m.from)?.lines ?? []).reduce((a, l) => a + (l.line_id === m.lineId ? Math.max(0, l.qty - m.qty) : l.qty), 0);
  if (left <= 0.0005) return `Every part would leave invoice ${nameOf(m.from)}: change that invoice itself instead (Edit).`;
  return null;
}

/** Add (or take away) a quantity of a line in an invoice's own line list. */
export function shiftLines(lines: CoveredLine[], lineId: string, delta: number): CoveredLine[] {
  const out = lines.map((l) => ({ ...l }));
  const at = out.findIndex((l) => l.line_id === lineId);
  if (at >= 0) out[at].qty = q3(out[at].qty + delta);
  else if (delta > 0) out.push({ line_id: lineId, qty: q3(delta) });
  return out.filter((l) => l.qty > 0.0005);
}

/**
 * The block on paying a part twice: an invoice being paid that shares a part (sitting on two invoices) with another
 * invoice already paid, or paid in the same payment, is refused with the part's name.
 */
export function doublePayProblem(coverage: LineCoverage[], invoices: { key: string; number: string; lineIds: string[]; paid: boolean }[], paying: Set<string>): string | null {
  const { twice } = coverageProblems(coverage);
  for (const c of twice) {
    const on = invoices.filter((i) => i.lineIds.includes(c.lineId));
    const pay = on.filter((i) => paying.has(i.key));
    if (!pay.length) continue;
    const other = on.find((i) => i.paid && !paying.has(i.key)) ?? (pay.length > 1 ? pay[1] : null);
    if (other) return `${c.description.toUpperCase()} is on invoice ${pay[0].number} and invoice ${other.number}${other.paid ? " (already paid)" : ""}: it would be paid twice. Move it to one invoice first (LPO page > Supplier invoices on this LPO).`;
  }
  return null;
}
