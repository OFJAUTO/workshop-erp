import "server-only";
import { logAppError } from "./app-errors";
import { coverageOf, firstAfterSplit, firstRoom, invoiceVatOf, invoicesSummary, newInvoiceProblem, numberKey, waitingRoom, type CoveredLine, type FirstInvoice, type LineCoverage, type LpoLineFacts, type NumberUse } from "./lpo-invoice-rules";
import { schemaReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";
import { supplierChargesVat } from "./supplier-rules";

/**
 * ONE LPO, SEVERAL SUPPLIER INVOICES (10 November 2026, Section 3), the server half. The table arrives with
 * `20261212090000_lpo_invoices.sql`; until then `lpoInvoicesReady()` is false and every LPO keeps its one invoice.
 */
export const lpoInvoicesReady = () => schemaReady("lpo_invoices", "id, po_id, number, lines");

const fresh = () => new AbortController().signal;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type LpoInvoiceRow = {
  id: string;
  po_id: string;
  supplier_id: string | null;
  supplier_name: string;
  number: string;
  invoice_date: string;
  amount_aed: number;
  vat_aed: number | null;
  lines: CoveredLine[];
  origin: "added" | "split";
  remark: string | null;
  query: string | null;
  checked_at: string | null;
  checked_by: string | null;
  paid_at: string | null;
  zoho_bill_id: string | null;
  zoho_bill_taxed: boolean | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
};

const COLS = "id, po_id, supplier_id, supplier_name, number, invoice_date, amount_aed, vat_aed, lines, origin, remark, query, checked_at, checked_by, paid_at, zoho_bill_id, zoho_bill_taxed, is_active, created_at, created_by";

const toRow = (r: Record<string, unknown>): LpoInvoiceRow => ({
  ...(r as unknown as LpoInvoiceRow),
  amount_aed: Number(r.amount_aed) || 0,
  vat_aed: r.vat_aed === null || r.vat_aed === undefined ? null : Number(r.vat_aed),
  invoice_date: String(r.invoice_date ?? "").slice(0, 10),
  lines: Array.isArray(r.lines) ? (r.lines as CoveredLine[]).map((l) => ({ line_id: String(l.line_id), qty: Number(l.qty) || 0 })) : [],
});

/** The further invoices of these LPOs (active only), by LPO. */
export async function loadLpoInvoices(poIds: string[]): Promise<Map<string, LpoInvoiceRow[]>> {
  const out = new Map<string, LpoInvoiceRow[]>();
  if (!poIds.length || !(await lpoInvoicesReady())) return out;
  const { data, error } = await createAdminClient().from("lpo_invoices").select(COLS).in("po_id", poIds).eq("is_active", true).order("created_at").abortSignal(fresh());
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const row = toRow(r);
    out.set(row.po_id, [...(out.get(row.po_id) ?? []), row]);
  }
  return out;
}

export async function lpoInvoiceById(id: string): Promise<LpoInvoiceRow | null> {
  if (!(await lpoInvoicesReady())) return null;
  const { data } = await createAdminClient().from("lpo_invoices").select(COLS).eq("id", id).maybeSingle();
  return data ? toRow(data as Record<string, unknown>) : null;
}

type PoFacts = { id: string; number: string; kind: string; status: string; job_id: string | null; supplier_id: string | null; supplier_name: string; supplier_invoice_status: string | null; supplier_invoice_number: string | null; supplier_invoice_date: string | null; supplier_invoice_amount: number | null; supplier_invoice_vat_aed: number | null; supplier_invoice_lines: CoveredLine[] | null; supplier_paid_at: string | null; zoho_bill_id: string | null };

export type LpoInvoiceState = {
  po: PoFacts;
  lines: (LpoLineFacts & { unit_cost: number })[];
  first: FirstInvoice;
  extras: LpoInvoiceRow[];
  coverage: LineCoverage[];
  summary: string;
  /** The supplier charges VAT (THE supplier VAT rule). */
  chargesVat: boolean;
};

/** One LPO's invoices: the first, the further ones, and what each line has on which (and what still waits). */
export async function lpoInvoiceState(poId: string): Promise<LpoInvoiceState | null> {
  const admin = createAdminClient();
  const ready = await lpoInvoicesReady();
  const vatCol = (await schemaReady("purchase_orders", "supplier_invoice_vat_aed")) ? ", supplier_invoice_vat_aed" : "";
  const { data: raw } = await admin.from("purchase_orders").select(`id, number, kind, status, job_id, supplier_id, supplier_name, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_paid_at, zoho_bill_id${vatCol}${ready ? ", supplier_invoice_lines" : ""}`).eq("id", poId).abortSignal(fresh()).maybeSingle();
  if (!raw) return null;
  const r = raw as unknown as Record<string, unknown>;
  const po: PoFacts = {
    ...(r as unknown as PoFacts),
    supplier_invoice_amount: r.supplier_invoice_amount == null ? null : Number(r.supplier_invoice_amount),
    supplier_invoice_vat_aed: r.supplier_invoice_vat_aed == null ? null : Number(r.supplier_invoice_vat_aed),
    supplier_invoice_lines: Array.isArray(r.supplier_invoice_lines) ? (r.supplier_invoice_lines as CoveredLine[]) : null,
  };
  const [{ data: lineRows }, extrasMap, { data: sup }] = await Promise.all([
    admin.from("purchase_order_lines").select("id, description, quantity, received_qty, unit_cost").eq("po_id", poId).eq("is_active", true).order("created_at").abortSignal(fresh()),
    loadLpoInvoices([poId]),
    po.supplier_id ? admin.from("suppliers").select("name, trn, vat_registered").eq("id", po.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map((l) => ({ id: String(l.id), description: String(l.description ?? ""), quantity: Number(l.quantity) || 0, received_qty: l.received_qty == null ? null : Number(l.received_qty), unit_cost: Number(l.unit_cost) || 0 }));
  const first: FirstInvoice = { entered: po.supplier_invoice_status === "received" && !!po.supplier_invoice_number, number: po.supplier_invoice_number, date: po.supplier_invoice_date, lines: po.supplier_invoice_lines };
  const extras = extrasMap.get(poId) ?? [];
  const coverage = coverageOf(lines, first, extras.map((e) => ({ id: e.id, number: e.number, date: e.invoice_date, lines: e.lines })));
  const s = sup as { name: string; trn: string | null; vat_registered: boolean | null } | null;
  const chargesVat = supplierChargesVat(s ? { ...s, name: po.supplier_name || s.name } : { name: po.supplier_name, trn: null, vat_registered: null });
  return { po, lines, first, extras, coverage, summary: invoicesSummary(first, extras.map((e) => ({ id: e.id, number: e.number, date: e.invoice_date, lines: e.lines })), coverage), chargesVat };
}

/** Where this supplier has already used an invoice number (the first invoices and the further ones). */
async function numberUses(state: LpoInvoiceState, number: string, exceptId: string | null): Promise<NumberUse[]> {
  const admin = createAdminClient();
  const key = numberKey(number);
  const sid = state.po.supplier_id;
  const posQ = admin.from("purchase_orders").select("id, number, supplier_invoice_number, supplier_invoice_date").eq("is_active", true).not("supplier_invoice_number", "is", null);
  const extQ = admin.from("lpo_invoices").select("id, po_id, number, invoice_date").eq("is_active", true);
  const [{ data: pos }, { data: extras }] = await Promise.all([
    (sid ? posQ.eq("supplier_id", sid) : posQ.ilike("supplier_name", state.po.supplier_name)).abortSignal(fresh()),
    (sid ? extQ.eq("supplier_id", sid) : extQ.ilike("supplier_name", state.po.supplier_name)).abortSignal(fresh()),
  ]);
  const poNumber = new Map(((pos ?? []) as { id: string; number: string }[]).map((p) => [p.id, p.number]));
  const out: NumberUse[] = [];
  for (const p of (pos ?? []) as { id: string; number: string; supplier_invoice_number: string | null; supplier_invoice_date: string | null }[]) {
    if (numberKey(p.supplier_invoice_number) === key) out.push({ number: String(p.supplier_invoice_number), date: p.supplier_invoice_date ? String(p.supplier_invoice_date).slice(0, 10) : null, poNumber: p.number, samePo: p.id === state.po.id });
  }
  for (const e of (extras ?? []) as { id: string; po_id: string; number: string; invoice_date: string }[]) {
    if (e.id === exceptId || numberKey(e.number) !== key) continue;
    out.push({ number: e.number, date: String(e.invoice_date).slice(0, 10), poNumber: poNumber.get(e.po_id) ?? "another LPO", samePo: e.po_id === state.po.id });
  }
  return out;
}

export type NewInvoiceInput = { number: string; date: string; amount: number | null; vat: number | null; lines: CoveredLine[]; remark?: string | null; /** The browser's own id for the invoice (its scan is filed under it before the save). */ id?: string | null };
type Actor = { id: string; display_name: string };

/** "Add another invoice": a further supplier invoice for lines still waiting for one. */
export async function addLpoInvoice(poId: string, input: NewInvoiceInput, by: Actor): Promise<{ id?: string; error?: string; words?: string }> {
  if (!(await lpoInvoicesReady())) return { error: "Several invoices per LPO switch on once the database change is applied." };
  const state = await lpoInvoiceState(poId);
  if (!state) return { error: "LPO not found." };
  if (state.po.kind === "main") return { error: "A main LPO has no supplier invoices: they sit on its supplier LPOs." };
  if (!state.first.entered) return { error: "Enter the first supplier invoice first (with the lines it covers)." };
  const problem = newInvoiceProblem(input, waitingRoom(state.coverage), await numberUses(state, input.number, null));
  if (problem) return { error: problem };
  return insertInvoice(state, input, "added", by);
}

async function insertInvoice(state: LpoInvoiceState, input: NewInvoiceInput, origin: "added" | "split", by: Actor): Promise<{ id?: string; error?: string; words?: string }> {
  const admin = createAdminClient();
  const vat = input.vat === null ? null : r2(input.vat);
  const { data, error } = await admin
    .from("lpo_invoices")
    .insert({ ...(input.id && /^[0-9a-f-]{36}$/i.test(input.id) ? { id: input.id } : {}), po_id: state.po.id, supplier_id: state.po.supplier_id, supplier_name: state.po.supplier_name, number: input.number.trim().toUpperCase(), invoice_date: input.date, amount_aed: r2(input.amount ?? 0), vat_aed: vat, lines: input.lines.filter((l) => l.qty > 0), origin, remark: input.remark?.trim() || null, created_by: by.id, updated_by: by.id })
    .select("id")
    .single();
  if (error || !data) {
    await logAppError("lpo-invoices.insert", error ?? "no row", { detail: { po: state.po.id } });
    return { error: "Couldn't save – nothing was recorded. Try again or tell the owner." };
  }
  const total = r2((input.amount ?? 0) + invoiceVatOf(input.amount ?? 0, vat, state.chargesVat));
  const words = `${state.po.number}: invoice ${input.number.trim().toUpperCase()} ${origin === "split" ? "split off" : "added"} by ${by.display_name} (AED ${total.toFixed(2)} with VAT, ${input.lines.length} line${input.lines.length === 1 ? "" : "s"})`;
  if (state.po.job_id) await admin.from("job_events").insert({ job_id: state.po.job_id, event_type: "supplier_invoice", note: words, created_by: by.id });
  return { id: data.id as string, words };
}

export type SplitInput = NewInvoiceInput & { firstAmount: number | null; firstVat: number | null };

/**
 * "Split this invoice": lines (and quantities) move off the LPO's first invoice onto a new invoice number, each with its
 * own amounts as printed. When the first invoice is already in Zoho its bill is corrected too (OFJ TEST until go-live).
 */
export async function splitLpoInvoice(poId: string, input: SplitInput, by: Actor): Promise<{ id?: string; error?: string; words?: string }> {
  if (!(await lpoInvoicesReady())) return { error: "Several invoices per LPO switch on once the database change is applied." };
  const state = await lpoInvoiceState(poId);
  if (!state) return { error: "LPO not found." };
  if (!state.first.entered) return { error: "There is no entered invoice to split yet." };
  if (state.po.supplier_paid_at) return { error: `${state.po.number} is already paid to the supplier: reverse the payment first, then split the invoice.` };
  if (input.firstAmount === null || !(input.firstAmount >= 0)) return { error: `Type what is left on invoice ${state.first.number}: its amount before VAT, as printed.` };
  const problem = newInvoiceProblem(input, firstRoom(state.coverage), await numberUses(state, input.number, null));
  if (problem) return { error: problem };
  const remaining = firstAfterSplit(state.coverage, input.lines);
  if (!remaining.length) return { error: `Every line would leave invoice ${state.first.number}: change its number instead (Edit).` };
  const admin = createAdminClient();
  const made = await insertInvoice(state, input, "split", by);
  if (made.error || !made.id) return made;
  const vatReady = await schemaReady("purchase_orders", "supplier_invoice_vat_aed");
  const { error } = await admin.from("purchase_orders").update({ supplier_invoice_lines: remaining, supplier_invoice_amount: r2(input.firstAmount), ...(vatReady ? { supplier_invoice_vat_aed: input.firstVat === null ? null : r2(input.firstVat) } : {}), updated_by: by.id }).eq("id", poId);
  if (error) {
    await admin.from("lpo_invoices").update({ is_active: false, remark: "Split undone: the first invoice could not be updated", updated_by: by.id }).eq("id", made.id);
    await logAppError("lpo-invoices.split", error, { detail: { po: poId } });
    return { error: "Couldn't save – nothing was recorded. Try again or tell the owner." };
  }
  await recordEdit(poId, null, by, input.remark ?? "Split into two invoices", [
    { field: "Split", old: `${state.first.number}: AED ${(state.po.supplier_invoice_amount ?? 0).toFixed(2)}`, new: `${state.first.number}: AED ${r2(input.firstAmount).toFixed(2)} + ${input.number.trim().toUpperCase()}: AED ${r2(input.amount ?? 0).toFixed(2)}` },
  ]);
  // The first invoice's bill (if it already went to Zoho) is corrected by the next Sync to Zoho; the new one queues once checked.
  if (state.po.zoho_bill_id) {
    const { reopenZoho } = await import("./zoho-sync");
    await reopenZoho("bill", poId);
  }
  return { id: made.id, words: `${made.words}; ${state.first.number} now AED ${r2(input.firstAmount).toFixed(2)} before VAT${state.po.zoho_bill_id ? " (its Zoho bill is corrected at the next Sync to Zoho)" : ""}` };
}

/** The first invoice's lines when it is entered for only some of the LPO's lines (null = all of them). */
export async function setFirstInvoiceLines(poId: string, lines: CoveredLine[] | null, by: Actor): Promise<{ error?: string }> {
  if (!(await lpoInvoicesReady())) return {};
  const { error } = await createAdminClient().from("purchase_orders").update({ supplier_invoice_lines: lines && lines.length ? lines : null, updated_by: by.id }).eq("id", poId);
  if (error) {
    await logAppError("lpo-invoices.first-lines", error, { detail: { po: poId } });
    return { error: "Couldn't save – nothing was recorded. Try again or tell the owner." };
  }
  return {};
}

/** Accounts check a further invoice: it then goes to Zoho as its own bill (Sync to Zoho). */
export async function checkLpoInvoice(id: string, by: Actor): Promise<{ error?: string; words?: string }> {
  const inv = await lpoInvoiceById(id);
  if (!inv || !inv.is_active) return { error: "This invoice is no longer on the LPO." };
  if (inv.checked_at) return { words: `Invoice ${inv.number} was already checked.` };
  const admin = createAdminClient();
  const { error } = await admin.from("lpo_invoices").update({ checked_at: new Date().toISOString(), checked_by: by.id, query: null, updated_by: by.id }).eq("id", id).is("checked_at", null);
  if (error) return { error: "Couldn't save – nothing was recorded. Try again or tell the owner." };
  const { tryEnqueueZoho } = await import("./zoho-sync");
  await tryEnqueueZoho("lpoinvoice", id, null, by.id);
  return { words: `Invoice ${inv.number} checked by ${by.display_name}; it goes to Zoho as its own bill at the next Sync to Zoho.` };
}

/** Edit a further invoice (number, date, amounts, VAT, lines) with a compulsory remark; kept in the edit history. */
export async function editLpoInvoice(id: string, input: NewInvoiceInput, remark: string, by: Actor): Promise<{ error?: string; words?: string }> {
  const inv = await lpoInvoiceById(id);
  if (!inv || !inv.is_active) return { error: "This invoice is no longer on the LPO." };
  if (remark.trim().length < 5) return { error: "Write why it is changed (at least 5 characters)." };
  if (inv.paid_at) return { error: `Invoice ${inv.number} is already paid: reverse the payment first.` };
  const state = await lpoInvoiceState(inv.po_id);
  if (!state) return { error: "LPO not found." };
  // Its own lines are free again for itself.
  const room = waitingRoom(state.coverage);
  for (const l of inv.lines) room.set(l.line_id, r2((room.get(l.line_id) ?? 0) + l.qty));
  const problem = newInvoiceProblem(input, room, await numberUses(state, input.number, id));
  if (problem) return { error: problem };
  const admin = createAdminClient();
  const number = input.number.trim().toUpperCase();
  const { error } = await admin.from("lpo_invoices").update({ number, invoice_date: input.date, amount_aed: r2(input.amount ?? 0), vat_aed: input.vat === null ? null : r2(input.vat), lines: input.lines.filter((l) => l.qty > 0), checked_at: null, checked_by: null, updated_by: by.id }).eq("id", id);
  if (error) return { error: "Couldn't save – nothing was recorded. Try again or tell the owner." };
  const changes = [
    ...(inv.number !== number ? [{ field: "Invoice number", old: inv.number, new: number }] : []),
    ...(inv.invoice_date !== input.date ? [{ field: "Date", old: inv.invoice_date, new: input.date }] : []),
    ...(Math.abs(inv.amount_aed - r2(input.amount ?? 0)) > 0.004 ? [{ field: "Before VAT", old: inv.amount_aed.toFixed(2), new: r2(input.amount ?? 0).toFixed(2) }] : []),
    ...((inv.vat_aed ?? -1) !== (input.vat ?? -1) ? [{ field: "VAT", old: inv.vat_aed === null ? "5%" : inv.vat_aed.toFixed(2), new: input.vat === null ? "5%" : r2(input.vat).toFixed(2) }] : []),
  ];
  await recordEdit(inv.po_id, id, by, remark.trim(), changes);
  if (inv.zoho_bill_id) {
    const { reopenZoho } = await import("./zoho-sync");
    await reopenZoho("lpoinvoice", id);
  }
  return { words: `Invoice ${number} changed by ${by.display_name}${changes.length ? `: ${changes.map((c) => `${c.field} ${c.old} → ${c.new}`).join("; ")}` : ""}. Check it again.` };
}

async function recordEdit(poId: string, invoiceId: string | null, by: Actor, remark: string, changes: { field: string; old: string; new: string }[]): Promise<void> {
  if (!(await schemaReady("supplier_invoice_edits", "id, po_id, remark, changes"))) return;
  const { error } = await createAdminClient().from("supplier_invoice_edits").insert({ po_id: poId, ...(invoiceId ? { lpo_invoice_id: invoiceId } : {}), remark, changes, paid_difference_aed: 0, created_by: by.id, updated_by: by.id });
  if (error) await logAppError("lpo-invoices.edit-history", error, { detail: { po: poId } });
}

/** A further invoice's gross (with VAT): what a payment can settle on it. */
export function lpoInvoiceGross(inv: Pick<LpoInvoiceRow, "amount_aed" | "vat_aed">, chargesVat: boolean): number {
  return r2(inv.amount_aed + invoiceVatOf(inv.amount_aed, inv.vat_aed, chargesVat));
}
