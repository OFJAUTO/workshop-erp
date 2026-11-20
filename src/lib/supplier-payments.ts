import "server-only";
import { pageAllIn } from "./page-all";
import { createAdminClient } from "./supabase/admin";
import { lpoAmounts, supplierVatLookup } from "./supplier-vat";
import { loadLpoInvoices, lpoInvoiceGross, lpoInvoicesReady } from "./lpo-invoices";
import { payKeyOf, splitPayKey } from "./lpo-invoice-rules";
import { schemaReady } from "./schema-ready";
import { advanceLeft, checkAdvanceUses, checkAllocations, type AdvanceUse, type Allocation, type OpenInvoice, type SupplierPayMethod, SUPPLIER_PAY_METHOD_KEYS, SUPPLIER_PAY_METHOD_LABELS , checkDifference, DEFAULT_ROUNDING_LIMIT, type DifferenceKind } from "./supplier-payment-rules";

/**
 * SUPPLIER PAYMENTS, the server half (6 November 2026, Section 4). THE supplier balance and its open invoices, the
 * advances, and recording a payment. The tables arrive with `20261207110000_supplier_payments.sql`; until then
 * `supplierPaymentsReady()` is false and the old "Paid to supplier" (one LPO in full) stays.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Next memoizes identical reads within one request: a save that reads, writes and reads again must ask afresh. */
const fresh = () => new AbortController().signal;

type PoRow = { id: string; number: string; kind: string; status: string; supplier_id: string | null; supplier_name: string; total_cost_aed: number; supplier_invoice_status: string | null; supplier_invoice_number: string | null; supplier_invoice_date: string | null; supplier_invoice_amount: number | null; supplier_invoice_vat_aed?: number | null; supplier_paid_at: string | null; supplier_payment_id?: string | null; job_id: string | null };

/** 11 November 2026 (Section 6): a lathe bill is paid like any supplier invoice; its key in the box is "lathe:<id>". */
export const isLatheKey = (key: string) => key.startsWith("lathe:");
export const latheKeyOf = (billId: string) => `lathe:${billId}`;
const lathePayReady = () => schemaReady("supplier_payment_lines", "lathe_bill_id");
/** The columns of a payment line for one invoice key: an LPO (and its further invoice), or a lathe bill. */
function lineTarget(key: string, invReady: boolean): Record<string, unknown> {
  if (isLatheKey(key)) return { po_id: null, lathe_bill_id: key.slice(6) };
  const k = splitPayKey(key);
  return { po_id: k.poId, ...(invReady ? { lpo_invoice_id: k.invoiceId } : {}) };
}

/** The supplier's lathe bills still owed (not voided), each with what the supplier payments left on it. */
async function latheOpenOf(supplierId: string | null, supplierName: string): Promise<(OpenInvoice & { gross: number; paid: number; jobId: string | null })[]> {
  if (!(await lathePayReady())) return [];
  const admin = createAdminClient();
  let q = admin.from("lathe_bills").select("id, bill_number, bill_date, total_aed, paid_at, supplier_id, supplier_name").eq("is_active", true).is("voided_at", null).abortSignal(fresh());
  // 15 November 2026 (Section 4): a lathe bill is paid only once accounts checked it on Supplier invoices.
  if (await (await import("./lathe-invoices")).latheCheckReady()) q = q.not("checked_at", "is", null);
  q = supplierId ? q.eq("supplier_id", supplierId) : q.ilike("supplier_name", supplierName);
  const { data } = await q;
  const bills = (data ?? []) as { id: string; bill_number: string; bill_date: string; total_aed: number | string; paid_at: string | null }[];
  if (!bills.length) return [];
  const { data: lines } = await admin.from("supplier_payment_lines").select("lathe_bill_id, amount_aed, payment_id").in("lathe_bill_id", bills.map((b) => b.id)).eq("is_active", true).abortSignal(fresh());
  const payIds = Array.from(new Set(((lines ?? []) as { payment_id: string }[]).map((l) => l.payment_id)));
  const { data: pays } = payIds.length ? await admin.from("supplier_payments").select("id, status").in("id", payIds).abortSignal(fresh()) : { data: [] };
  const live = new Set(((pays ?? []) as { id: string; status: string }[]).filter((p) => p.status === "recorded").map((p) => p.id));
  const paid = new Map<string, number>();
  for (const l of (lines ?? []) as { lathe_bill_id: string; amount_aed: number | string; payment_id: string }[]) if (live.has(l.payment_id)) paid.set(l.lathe_bill_id, r2((paid.get(l.lathe_bill_id) ?? 0) + Number(l.amount_aed)));
  return bills
    .map((b) => {
      const gross = r2(Number(b.total_aed) || 0);
      // Paid by the old one-bill form (before the Supplier payments tab took lathe bills): paid in full.
      const p = b.paid_at && !(paid.get(b.id) ?? 0) ? gross : (paid.get(b.id) ?? 0);
      return { poId: latheKeyOf(b.id), label: `${b.bill_number} · Lathe`, date: String(b.bill_date).slice(0, 10), due: r2(gross - p), gross, paid: r2(p), jobId: null };
    })
    .filter((x) => x.due > 0.004);
}

/** The lathe bills still owed, per supplier, for the Supplier payments tab's "Due by supplier". */
export async function latheDueBySupplier(): Promise<{ supplierId: string | null; supplier: string; count: number; total: number; oldest: string | null }[]> {
  if (!(await lathePayReady())) return [];
  const { data } = await createAdminClient().from("lathe_bills").select("supplier_id, supplier_name").eq("is_active", true).is("voided_at", null).is("paid_at", null);
  const seen = new Map<string, { supplierId: string | null; supplier: string }>();
  for (const b of (data ?? []) as { supplier_id: string | null; supplier_name: string }[]) seen.set(b.supplier_id ?? b.supplier_name.toUpperCase(), { supplierId: b.supplier_id, supplier: b.supplier_name });
  const out = [];
  for (const v of seen.values()) {
    const open = await latheOpenOf(v.supplierId, v.supplier);
    if (open.length) out.push({ ...v, count: open.length, total: r2(open.reduce((a, o) => a + o.due, 0)), oldest: open.map((o) => o.date).filter(Boolean).sort()[0] ?? null });
  }
  return out;
}

/** The supplier's invoices still owed (entered, not cancelled), each with what is left, oldest first. */
export async function openInvoicesOf(supplierId: string | null, supplierName: string): Promise<(OpenInvoice & { gross: number; paid: number; jobId: string | null })[]> {
  const admin = createAdminClient();
  let q = admin.from("purchase_orders").select("id, number, kind, status, supplier_id, supplier_name, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_vat_aed, supplier_paid_at, supplier_payment_id, job_id").eq("is_active", true).neq("status", "cancelled").in("kind", ["supplier", "stock"]).eq("supplier_invoice_status", "received").abortSignal(fresh());
  q = supplierId ? q.eq("supplier_id", supplierId) : q.ilike("supplier_name", supplierName);
  const { data } = await q;
  const pos = ((data ?? []) as PoRow[]).map((p) => ({ ...p, total_cost_aed: Number(p.total_cost_aed) || 0, supplier_invoice_amount: p.supplier_invoice_amount === null ? null : Number(p.supplier_invoice_amount) }));
  const lathe = await latheOpenOf(supplierId, supplierName);
  if (!pos.length) return lathe;
  const [amounts, paidMap, creditMap, offMap, roundMap] = await Promise.all([lpoAmounts(pos, { withFurther: false }), paidOnPos(pos.map((p) => p.id)), (await import("./purchase-returns")).creditedOnPos(pos.map((p) => p.id)), writtenOffOnPos(pos.map((p) => p.id)), invoiceRoundingOf(pos.map((p) => p.id))]);
  // 10 November 2026 (Section 3): each further supplier invoice on an LPO is paid on its own (key "<po>~<invoice>").
  const extrasMap = await loadLpoInvoices(pos.map((p) => p.id));
  const vatOf = extrasMap.size ? await supplierVatLookup() : null;
  const extraOpen = pos.flatMap((p) =>
    (extrasMap.get(p.id) ?? []).map((inv) => {
      const gross = lpoInvoiceGross(inv, vatOf ? vatOf(p.supplier_id, p.supplier_name) : true);
      const key = payKeyOf(p.id, inv.id);
      const paid = inv.paid_at && !(paidMap.get(key) ?? 0) ? gross : (paidMap.get(key) ?? 0);
      return { poId: key, label: `${inv.number} · ${p.number}`, date: inv.invoice_date, due: r2(gross - paid), gross, paid: r2(paid), jobId: p.job_id };
    }),
  );
  return [...pos
    .map((p) => {
      // 20 November 2026 (Section 3): the supplier's own rounding line on the invoice is part of what it asks.
      const gross = r2((amounts.get(p.id)?.gross ?? 0) + (roundMap.get(p.id) ?? 0));
      // The old one-LPO "Paid to supplier" (before payments were recorded with their amount) counts as paid in full.
      const paid = p.supplier_paid_at && !p.supplier_payment_id && !(paidMap.get(p.id) ?? 0) ? gross : (paidMap.get(p.id) ?? 0);
      // 19 November 2026 (Section 4): a supplier credit note against the invoice lowers what is still owed on it.
      const credit = creditMap.get(p.id) ?? 0;
      return { poId: p.id, label: `${p.supplier_invoice_number ?? p.number} · ${p.number}${credit > 0.004 ? ` · less credit AED ${credit.toFixed(2)}` : ""}`, date: p.supplier_invoice_date, due: r2(gross - paid - credit - (offMap.get(p.id) ?? 0)), gross, paid: r2(paid), jobId: p.job_id };
    }), ...extraOpen, ...lathe]
    .filter((i) => i.due > 0.004)
    .sort((a, b) => String(a.date ?? "9999").localeCompare(String(b.date ?? "9999")));
}

/** What the recorded payments put on each LPO. */
export async function paidOnPos(poIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!poIds.length || !(await supplierPaymentsReadyNow())) return out;
  const admin = createAdminClient();
  const invCol = (await schemaReady("supplier_payment_lines", "lpo_invoice_id")) ? ", lpo_invoice_id" : "";
  const lines = await pageAllIn<{ po_id: string; amount_aed: number; payment_id: string; lpo_invoice_id?: string | null }>(poIds, (chunk, a, b) => admin.from("supplier_payment_lines").select("po_id, amount_aed, payment_id" + invCol).in("po_id", chunk).eq("is_active", true).order("id").range(a, b).abortSignal(fresh()) as unknown as PromiseLike<{ data: { po_id: string; amount_aed: number; payment_id: string; lpo_invoice_id?: string | null }[] | null; error: { message: string } | null }>);
  const payIds = Array.from(new Set(lines.map((l) => l.payment_id)));
  const { data: pays } = payIds.length ? await admin.from("supplier_payments").select("id, status").in("id", payIds).abortSignal(fresh()) : { data: [] as { id: string; status: string }[] };
  const live = new Set((pays ?? []).filter((p) => p.status === "recorded").map((p) => p.id as string));
  for (const l of lines) {
    if (!live.has(l.payment_id)) continue;
    const key = payKeyOf(l.po_id, l.lpo_invoice_id ?? null);
    out.set(key, r2((out.get(key) ?? 0) + Number(l.amount_aed)));
  }
  return out;
}

/** 20 November 2026 (Section 3): ready once the rounding migration is applied. */
export const roundingReady = () => schemaReady("supplier_payment_lines", "write_off_aed,write_off_kind");
const invoiceRoundingReady = () => schemaReady("purchase_orders", "supplier_invoice_rounding_aed");

/** What recorded payments wrote off on each LPO (rounding, or a discount from the supplier): it closes the invoice. */
export async function writtenOffOnPos(poIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!poIds.length || !(await roundingReady())) return out;
  const admin = createAdminClient();
  const lines = await pageAllIn<{ po_id: string; write_off_aed: number; payment_id: string }>(poIds, (chunk, a, b) => admin.from("supplier_payment_lines").select("po_id, write_off_aed, payment_id").in("po_id", chunk).eq("is_active", true).gt("write_off_aed", 0).order("id").range(a, b).abortSignal(fresh()) as unknown as PromiseLike<{ data: { po_id: string; write_off_aed: number; payment_id: string }[] | null; error: { message: string } | null }>);
  if (!lines.length) return out;
  const { data: pays } = await admin.from("supplier_payments").select("id, status").in("id", Array.from(new Set(lines.map((l) => l.payment_id)))).abortSignal(fresh());
  const live = new Set((pays ?? []).filter((p) => p.status === "recorded").map((p) => p.id as string));
  for (const l of lines) if (live.has(l.payment_id)) out.set(l.po_id, r2((out.get(l.po_id) ?? 0) + Number(l.write_off_aed)));
  return out;
}

/** The supplier's own rounding line on each LPO's invoice (signed, e.g. -0.10). */
export async function invoiceRoundingOf(poIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!poIds.length || !(await invoiceRoundingReady())) return out;
  const { data } = await createAdminClient().from("purchase_orders").select("id, supplier_invoice_rounding_aed").in("id", poIds).not("supplier_invoice_rounding_aed", "is", null).abortSignal(fresh());
  for (const p of (data ?? []) as { id: string; supplier_invoice_rounding_aed: number | string }[]) out.set(p.id, r2(Number(p.supplier_invoice_rounding_aed) || 0));
  return out;
}

/** The advances still unused with a supplier: each payment's excess kept as an advance, minus what was applied since. */
export async function advancesOf(supplierId: string | null, supplierName: string): Promise<{ paymentId: string; number: string; left: number; poIds: string[] }[]> {
  if (!(await supplierPaymentsReadyNow())) return [];
  const admin = createAdminClient();
  let q = admin.from("supplier_payments").select("id, number, amount_aed, excess_kind, fee_aed, status").eq("is_active", true).eq("status", "recorded").eq("excess_kind", "advance").abortSignal(fresh());
  q = supplierId ? q.eq("supplier_id", supplierId) : q.ilike("supplier_name", supplierName);
  const { data: pays } = await q;
  const list = (pays ?? []) as { id: string; number: string; amount_aed: number; excess_kind: string | null; fee_aed: number; status: string }[];
  if (!list.length) return [];
  const { data: lines } = await admin.from("supplier_payment_lines").select("payment_id, amount_aed, po_id").in("payment_id", list.map((p) => p.id)).eq("is_active", true).abortSignal(fresh());
  const used = new Map<string, number>();
  const pos = new Map<string, string[]>();
  for (const l of (lines ?? []) as { payment_id: string; amount_aed: number; po_id: string }[]) {
    used.set(l.payment_id, r2((used.get(l.payment_id) ?? 0) + Number(l.amount_aed)));
    pos.set(l.payment_id, [...(pos.get(l.payment_id) ?? []), l.po_id]);
  }
  return list
    .map((p) => ({ paymentId: p.id, number: p.number, poIds: pos.get(p.id) ?? [], left: advanceLeft({ amount: Number(p.amount_aed), excessKind: p.excess_kind, fee: Number(p.fee_aed) || 0, status: p.status }, used.get(p.id) ?? 0) }))
    .filter((a) => a.left > 0.004);
}

/** The advance with each supplier (by supplier id, else name), for the lists. */
export async function advancesBySupplier(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!(await supplierPaymentsReadyNow())) return out;
  const admin = createAdminClient();
  const { data: pays } = await admin.from("supplier_payments").select("id, supplier_id, supplier_name, amount_aed, excess_kind, fee_aed, status").eq("is_active", true).eq("status", "recorded").eq("excess_kind", "advance");
  const list = (pays ?? []) as { id: string; supplier_id: string | null; supplier_name: string; amount_aed: number; excess_kind: string | null; fee_aed: number; status: string }[];
  if (!list.length) return out;
  const { data: lines } = await admin.from("supplier_payment_lines").select("payment_id, amount_aed").in("payment_id", list.map((p) => p.id)).eq("is_active", true);
  const used = new Map<string, number>();
  for (const l of (lines ?? []) as { payment_id: string; amount_aed: number }[]) used.set(l.payment_id, r2((used.get(l.payment_id) ?? 0) + Number(l.amount_aed)));
  for (const p of list) {
    const left = advanceLeft({ amount: Number(p.amount_aed), excessKind: p.excess_kind, fee: Number(p.fee_aed) || 0, status: p.status }, used.get(p.id) ?? 0);
    if (left <= 0.004) continue;
    const key = p.supplier_id ?? p.supplier_name.toUpperCase();
    out.set(key, r2((out.get(key) ?? 0) + left));
  }
  return out;
}

/** The column an advance names its LPO with (13 November 2026). */
const lpoAdvanceColumnReady = () => schemaReady("supplier_payments", "advance_for_po_id");

let readyCache: { at: number; ok: boolean } | null = null;
/** The tables exist (asked again every minute until they do). */
/**
 * "Correct this payment" (20 November 2026, Section 3): what a recorded payment left owing on an invoice is closed as
 * ROUNDING (within the limit) or a DISCOUNT FROM THE SUPPLIER (with a reason). The invoice is never changed; the
 * payment's line keeps the written-off part, Zoho writes it off when the payment posts again.
 */
export async function closePaymentDifference(paymentId: string, poId: string, kind: string, reason: string, by: { id: string; display_name: string; role_id: string }): Promise<{ error?: string; words?: string }> {
  if (!["owner", "accounts"].includes(by.role_id)) return { error: "Only accounts or the owner close a difference." };
  if (!(await roundingReady())) return { error: "Rounding and supplier discounts switch on once the database change is applied (WAITING FOR APPLY)." };
  if (kind !== "rounding" && kind !== "discount") return { error: "Pick rounding or a discount from the supplier." };
  const admin = createAdminClient();
  const { data: pay } = await admin.from("supplier_payments").select("id, number, supplier_id, supplier_name, status, method, edit_history").eq("id", paymentId).maybeSingle();
  if (!pay || pay.status !== "recorded") return { error: "That payment is not recorded any more." };
  const { data: line } = await admin.from("supplier_payment_lines").select("id, write_off_aed").eq("payment_id", paymentId).eq("po_id", poId).eq("is_active", true).limit(1).maybeSingle();
  if (!line) return { error: "This payment is not on that invoice." };
  const inv = (await openInvoicesOf(pay.supplier_id as string | null, String(pay.supplier_name))).find((i) => i.poId === poId);
  if (!inv) return { error: "Nothing is owed on that invoice any more." };
  const diff = r2(inv.due);
  const bad = checkDifference(kind, diff, await roundingLimit(), reason);
  if (bad) return { error: bad };
  const now = new Date().toISOString();
  const { error } = await admin.from("supplier_payment_lines").update({ write_off_aed: r2((Number(line.write_off_aed) || 0) + diff), write_off_kind: kind, write_off_reason: reason.trim() || null, write_off_at: now, write_off_by: by.id, updated_by: by.id }).eq("id", line.id);
  if (error) {
    const { logAppError, SAVE_FAILED } = await import("./app-errors");
    await logAppError("supplier-payments: close difference", error, { staffId: by.id });
    return { error: SAVE_FAILED };
  }
  const label = kind === "rounding" ? "rounding" : "discount from the supplier";
  const hist = [...(Array.isArray(pay.edit_history) ? pay.edit_history : []), { at: now, by: by.display_name, remark: reason.trim() || label, changes: [{ field: label, old: `AED ${diff.toFixed(2)} owed on ${inv.label}`, new: "closed" }] }];
  await admin.from("supplier_payments").update({ edit_history: hist, updated_by: by.id }).eq("id", paymentId);
  await markSettled(pay.supplier_id as string | null, String(pay.supplier_name), [poId], paymentId, String(pay.method ?? "transfer"), by);
  return { words: `${pay.number}: AED ${diff.toFixed(2)} ${label} on ${inv.label} – the invoice is closed.` };
}

/** The most a payment may write off as rounding (owner and accounts set it; default AED 1.00). */
export async function roundingLimit(): Promise<number> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", "supplier_rounding_limit_aed").maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_ROUNDING_LIMIT;
}

export async function supplierPaymentsReadyNow(): Promise<boolean> {
  if (readyCache && (readyCache.ok || Date.now() - readyCache.at < 60_000)) return readyCache.ok;
  const { error } = await createAdminClient().from("supplier_payments").select("id").limit(1);
  readyCache = { at: Date.now(), ok: !error };
  return readyCache.ok;
}

export type SupplierPaymentInput = {
  /** The id the form made (17 November 2026): the payment is saved under it, so its proof joins it whenever it lands. */
  id?: string | null;
  /** An advance MAY name the LPO it is for (always optional): it shows on that LPO, and follows it when revised. */
  advanceForPoId?: string | null;
  supplierId: string | null;
  supplierName: string;
  paidOn: string;
  method: string;
  reference: string | null;
  amount: number;
  lines: Allocation[];
  excessKind: "advance" | "fee" | null;
  proofPath: string | null;
  note: string | null;
  /** Advances to apply (11 November 2026, Section 3): which advance, on which invoice, how much - as accounts typed it. */
  advanceUses?: AdvanceUse[];
  /** 20 November 2026 (Section 3): a payment that pays less than an invoice says what the difference is. */
  difference?: { poId: string; kind: DifferenceKind; reason: string } | null;
};

/**
 * Records ONE payment to a supplier: the amount, how it is spread, what happens to any excess. LPOs it settles in full
 * are marked paid (the lists and the old badges keep working). Returns the payment number, or the refusal in plain words.
 */
export async function recordSupplierPayment(input: SupplierPaymentInput, by: { id: string; display_name: string }): Promise<{ id?: string; number?: string; error?: string; words?: string; /** Advances applied with no new payment: the advance payments to post again in Zoho. */ appliedOnly?: string[]; /** Advance payments used alongside a new payment. */ advancesUsed?: string[] }> {
  if (!(await supplierPaymentsReadyNow())) return { error: "Supplier payments switch on once the database change is applied." };
  if (!SUPPLIER_PAY_METHOD_KEYS.includes(input.method as SupplierPayMethod)) return { error: "Pick how it was paid." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) return { error: "Pick the payment date." };
  const amount = r2(input.amount);
  const open = await openInvoicesOf(input.supplierId, input.supplierName);
  const lines = input.lines.filter((l) => l.amount > 0.004).map((l) => ({ poId: l.poId, amount: r2(l.amount) }));
  const uses = (input.advanceUses ?? []).filter((u) => u.amount > 0.004).map((u) => ({ ...u, amount: r2(u.amount) }));
  if (uses.length) {
    const held = await advancesOf(input.supplierId, input.supplierName);
    const bad = checkAdvanceUses(uses, held, open, lines);
    if (bad) return { error: bad };
  }
  // The advances alone settle what was ticked: no new payment at all (no amount, no method).
  if (!(amount > 0) && uses.length && !lines.length) {
    const r = await applyAdvanceUses(input.supplierId, input.supplierName, uses, by, input.method);
    return r.error ? { error: r.error } : { words: r.words, appliedOnly: r.paymentIds };
  }
  const problem = checkAllocations(amount, lines, open);
  if (problem) return { error: problem };
  // 15 November 2026: never pay an LPO with a delivery still "Arrived - paperwork pending".
  const payingKeys = [...lines.map((l) => l.poId), ...uses.map((u) => u.poId)].filter((k) => k && !isLatheKey(k));
  const payingPos = Array.from(new Set(payingKeys.map((k) => splitPayKey(k).poId)));
  const paperwork = await (await import("./receipts")).paperworkBlockFor(payingPos);
  if (paperwork) return { error: `Not recorded: ${paperwork}` };
  // 15 November 2026 (Section 2): a part sitting on two invoices of an LPO is never paid twice.
  const twice = await doublePayFor(payingPos, new Set(payingKeys));
  if (twice) return { error: `Not recorded: ${twice}` };
  const put = r2(lines.reduce((a, l) => a + l.amount, 0));
  const excess = r2(amount - put);
  // The difference on an invoice paid short: rounding (within the limit) or a discount closes it; still owed leaves it open.
  let writeOff: { poId: string; amount: number; kind: "rounding" | "discount"; reason: string } | null = null;
  let owedNote: string | null = null;
  if (input.difference) {
    const d = input.difference;
    const inv = open.find((o) => o.poId === d.poId);
    const line = lines.find((l) => l.poId === d.poId);
    if (!inv || !line) return { error: "Tick the invoice the difference is on." };
    const diff = r2(inv.due - line.amount);
    const limit = await roundingLimit();
    const bad = checkDifference(d.kind, diff, limit, d.reason);
    if (bad) return { error: bad };
    if (d.kind === "owed") owedNote = `Still owed AED ${diff.toFixed(2)} on ${inv.label}${d.reason.trim() ? `: ${d.reason.trim()}` : ""}`;
    else {
      if (!(await roundingReady())) return { error: "Rounding and supplier discounts switch on once the database change is applied (WAITING FOR APPLY). Record it as still owed for now." };
      writeOff = { poId: d.poId, amount: diff, kind: d.kind, reason: d.reason.trim() };
    }
  }
  if (excess > 0.004 && !input.excessKind) return { error: `AED ${excess.toFixed(2)} is more than the invoices: choose "Advance with the supplier" or "Fee / charge".` };
  const admin = createAdminClient();
  const { data: pay, error } = await admin
    .from("supplier_payments")
    .insert({ ...(input.id ? { id: input.id } : {}), supplier_id: input.supplierId, supplier_name: input.supplierName, paid_on: input.paidOn, method: input.method, reference: input.reference, amount_aed: amount, excess_kind: excess > 0.004 ? input.excessKind : null, fee_aed: excess > 0.004 && input.excessKind === "fee" ? excess : 0, proof_path: input.proofPath, note: [input.note, owedNote].filter(Boolean).join(" · ") || null, created_by: by.id, updated_by: by.id })
    .select("id, number")
    .single();
  if (error || !pay) return { error: error?.message ?? "Couldn't save – nothing was recorded." };
  // A proof that reached the server BEFORE the payment was saved (same id) joins it now.
  if (!input.proofPath && input.id) {
    const { data: files } = await admin.storage.from("job-files").list(`supplier-payments/pay/${input.id}`, { limit: 5, sortBy: { column: "created_at", order: "desc" } });
    const f = (files ?? []).find((x) => /\.(jpg|png|webp|pdf)$/i.test(x.name));
    if (f) await admin.from("supplier_payments").update({ proof_path: `supplier-payments/pay/${input.id}/${f.name}`, updated_by: by.id }).eq("id", pay.id).is("proof_path", null);
  }
  if (input.advanceForPoId && excess > 0.004 && input.excessKind === "advance") {
    const { data: lpo } = await admin.from("purchase_orders").select("id, supplier_id, supplier_name, status, kind").eq("id", input.advanceForPoId).maybeSingle();
    const same = !!lpo && lpo.kind !== "main" && lpo.status !== "cancelled" && ((!!input.supplierId && lpo.supplier_id === input.supplierId) || String(lpo.supplier_name).toUpperCase() === input.supplierName.toUpperCase());
    if (same && (await lpoAdvanceColumnReady())) await admin.from("supplier_payments").update({ advance_for_po_id: lpo!.id, updated_by: by.id }).eq("id", pay.id);
  }
  if (lines.length) {
    const invReady = await lpoInvoicesReady();
    const { error: lErr } = await admin.from("supplier_payment_lines").insert(lines.map((l) => ({ payment_id: pay.id, ...lineTarget(l.poId, invReady), amount_aed: l.amount, created_by: by.id, updated_by: by.id })), { defaultToNull: false });
    if (lErr) {
      await admin.from("supplier_payments").update({ status: "void", void_reason: "Its invoices could not be saved", updated_by: by.id }).eq("id", pay.id);
      return { error: lErr.message };
    }
  }
  if (writeOff) {
    const { error: wErr } = await admin.from("supplier_payment_lines").update({ write_off_aed: writeOff.amount, write_off_kind: writeOff.kind, write_off_reason: writeOff.reason || null, write_off_at: new Date().toISOString(), write_off_by: by.id, updated_by: by.id }).eq("payment_id", pay.id).eq("po_id", splitPayKey(writeOff.poId).poId).eq("is_active", true);
    if (wErr) {
      const { logAppError } = await import("./app-errors");
      await logAppError("supplier-payments: write-off", wErr, { staffId: by.id });
    }
  }
  // Advances from earlier payments, applied exactly as accounts typed them (each a line on the advance it came from).
  const applied: string[] = [];
  const appliedPos: string[] = [];
  if (uses.length) {
    const r = await applyAdvanceUses(input.supplierId, input.supplierName, uses, by, input.method, { skipMarkPaid: true });
    if (r.error) applied.push(`advances NOT applied: ${r.error}`);
    else { applied.push(r.words); appliedPos.push(...uses.map((u) => u.poId)); }
  }
  // LPOs now settled in full: marked paid (the old badges, the lists and the reconciliation keep reading this).
  const stillOwing = (await openInvoicesOf(input.supplierId, input.supplierName)).map((i) => i.poId);
  const touched = Array.from(new Set([...lines.map((l) => l.poId), ...appliedPos]));
  const now = new Date().toISOString();
  for (const key of touched.filter((id) => !stillOwing.includes(id) && splitPayKey(id).invoiceId)) {
    await admin.from("lpo_invoices").update({ paid_at: now, paid_by: by.id, updated_by: by.id }).eq("id", splitPayKey(key).invoiceId!).is("paid_at", null);
  }
  const owingPos = new Set(stillOwing.map((k) => splitPayKey(k).poId));
  for (const key of touched.filter((k) => isLatheKey(k) && !stillOwing.includes(k))) {
    await admin.from("lathe_bills").update({ paid_at: now, paid_method: input.method === "link" ? "card" : input.method, paid_reference: [pay.number, input.reference].filter(Boolean).join(" · ").slice(0, 120), paid_by: by.id, updated_by: by.id }).eq("id", key.slice(6)).is("paid_at", null);
  }
  for (const poId of Array.from(new Set(touched.filter((k) => !isLatheKey(k)).map((k) => splitPayKey(k).poId))).filter((id) => !owingPos.has(id))) {
    await admin.from("purchase_orders").update({ supplier_paid_at: now, supplier_paid_by: by.id, supplier_paid_method: input.method === "link" ? "card" : input.method, supplier_paid_reference: [pay.number, input.reference].filter(Boolean).join(" · ").slice(0, 120), supplier_payment_id: pay.id, ...(input.proofPath ? { supplier_paid_proof_path: input.proofPath, supplier_paid_proof_at: now, supplier_paid_proof_by: by.id } : {}), updated_by: by.id }).eq("id", poId).is("supplier_paid_at", null);
  }
  const words = [`${pay.number}: AED ${amount.toFixed(2)} to ${input.supplierName}`, lines.length ? `on ${lines.length} invoice${lines.length === 1 ? "" : "s"}` : null, writeOff ? `AED ${writeOff.amount.toFixed(2)} ${writeOff.kind === "rounding" ? "rounding" : "discount from the supplier"}: invoice closed` : null, owedNote, excess > 0.004 ? (input.excessKind === "fee" ? `AED ${excess.toFixed(2)} as a fee` : `AED ${excess.toFixed(2)} kept as an advance`) : null, applied.length ? applied.join("; ") : null].filter(Boolean).join(" · ");
  return { id: pay.id as string, number: pay.number as string, words, advancesUsed: Array.from(new Set(uses.map((u) => u.paymentId))) };
}

/** The payments that put money on one LPO (its history on the LPO page), newest first. */
export async function paymentsOnPo(poId: string): Promise<{ id: string; number: string; paidOn: string; method: string; reference: string | null; amount: number; onThis: number; status: string; voidReason: string | null; laterAdvance: boolean; lineId: string; edits: { at: string; by: string; remark: string; changes: { field: string; old: string; new: string }[] }[] }[]> {
  if (!(await supplierPaymentsReadyNow())) return [];
  const admin = createAdminClient();
  const { data: lines } = await admin.from("supplier_payment_lines").select("id, payment_id, amount_aed, applied_later").eq("po_id", poId).eq("is_active", true);
  const rows = (lines ?? []) as { id: string; payment_id: string; amount_aed: number; applied_later: boolean }[];
  if (!rows.length) return [];
  const { data: pays } = await admin.from("supplier_payments").select("id, number, paid_on, method, reference, amount_aed, status, void_reason, edit_history").in("id", Array.from(new Set(rows.map((r) => r.payment_id))));
  type Edit = { at: string; by: string; remark: string; changes: { field: string; old: string; new: string }[] };
  const byId = new Map(((pays ?? []) as { id: string; number: string; paid_on: string; method: string; reference: string | null; amount_aed: number; status: string; void_reason: string | null; edit_history: Edit[] | null }[]).map((p) => [p.id, p]));
  return rows
    .map((r) => {
      const p = byId.get(r.payment_id);
      return p ? { id: p.id, number: p.number, paidOn: p.paid_on, method: p.method, reference: p.reference, amount: Number(p.amount_aed), onThis: Number(r.amount_aed), status: p.status, voidReason: p.void_reason, laterAdvance: !!r.applied_later, lineId: r.id, edits: (p.edit_history ?? []).filter((e) => e && Array.isArray(e.changes) && !e.changes.some((c) => c.field === "status")) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.paidOn.localeCompare(a.paidOn));
}

/**
 * APPLY ADVANCES WITHOUT A NEW PAYMENT (11 November 2026, Section 3). Each use is a line on the ADVANCE's own payment
 * (applied_later), so the advance's Zoho vendor payment is applied to the bill. Invoices settled in full are marked paid.
 * One advance may be split across invoices; several advances may go on one invoice. Nothing is deleted: an undo turns
 * the line off with a remark in the advance's history.
 */
export async function applyAdvanceUses(supplierId: string | null, supplierName: string, uses: AdvanceUse[], by: { id: string; display_name: string }, method = "transfer", opts: { skipMarkPaid?: boolean } = {}): Promise<{ error?: string; words: string; paymentIds: string[] }> {
  const admin = createAdminClient();
  const held = await advancesOf(supplierId, supplierName);
  const open = await openInvoicesOf(supplierId, supplierName);
  const bad = checkAdvanceUses(uses, held, open);
  if (bad) return { error: bad, words: "", paymentIds: [] };
  const invReady = await lpoInvoicesReady();
  const rows = uses.map((u) => ({ payment_id: u.paymentId, ...lineTarget(u.poId, invReady), amount_aed: r2(u.amount), applied_later: true, created_by: by.id, updated_by: by.id }));
  const { error } = await admin.from("supplier_payment_lines").insert(rows, { defaultToNull: false });
  if (error) return { error: error.message, words: "", paymentIds: [] };
  const numberOf = new Map(held.map((h) => [h.paymentId, h.number]));
  const labelOf = new Map(open.map((o) => [o.poId, o.label]));
  const now = new Date().toISOString();
  for (const pid of Array.from(new Set(uses.map((u) => u.paymentId)))) {
    const { data: p } = await admin.from("supplier_payments").select("edit_history").eq("id", pid).maybeSingle();
    const mine = uses.filter((u) => u.paymentId === pid);
    const hist = [...((p?.edit_history as unknown[]) ?? []), { at: now, by: by.display_name, remark: "Advance applied", changes: mine.map((u) => ({ field: "applied", old: null, new: `AED ${u.amount.toFixed(2)} on ${labelOf.get(u.poId) ?? u.poId}` })) }];
    await admin.from("supplier_payments").update({ edit_history: hist, updated_by: by.id }).eq("id", pid);
  }
  if (!opts.skipMarkPaid) await markSettled(supplierId, supplierName, uses.map((u) => u.poId), uses[0]?.paymentId ?? null, method, by);
  const words = uses.map((u) => `AED ${u.amount.toFixed(2)} of ${numberOf.get(u.paymentId) ?? "the advance"} on ${labelOf.get(u.poId) ?? "an invoice"}`).join("; ");
  return { words, paymentIds: Array.from(new Set(uses.map((u) => u.paymentId))) };
}

/** LPOs (and further invoices) now owing nothing are marked paid - the old badges and lists read this. */
async function markSettled(supplierId: string | null, supplierName: string, touchedKeys: string[], paymentId: string | null, method: string, by: { id: string }): Promise<void> {
  const admin = createAdminClient();
  const stillOwing = (await openInvoicesOf(supplierId, supplierName)).filter((i) => i.due > 0.004).map((i) => i.poId);
  const now = new Date().toISOString();
  for (const key of touchedKeys.filter((id) => !stillOwing.includes(id) && splitPayKey(id).invoiceId)) {
    await admin.from("lpo_invoices").update({ paid_at: now, paid_by: by.id, updated_by: by.id }).eq("id", splitPayKey(key).invoiceId!).is("paid_at", null);
  }
  for (const key of touchedKeys.filter((k) => isLatheKey(k) && !stillOwing.includes(k))) {
    await admin.from("lathe_bills").update({ paid_at: now, paid_method: method === "link" ? "card" : method, paid_by: by.id, updated_by: by.id }).eq("id", key.slice(6)).is("paid_at", null);
  }
  const owingPos = new Set(stillOwing.map((k) => splitPayKey(k).poId));
  const { data: pay } = paymentId ? await admin.from("supplier_payments").select("number").eq("id", paymentId).maybeSingle() : { data: null };
  for (const poId of Array.from(new Set(touchedKeys.filter((k) => !isLatheKey(k)).map((k) => splitPayKey(k).poId))).filter((id) => !owingPos.has(id))) {
    await admin.from("purchase_orders").update({ supplier_paid_at: now, supplier_paid_by: by.id, supplier_paid_method: method === "link" ? "card" : method, supplier_paid_reference: (pay?.number as string | undefined) ?? null, supplier_payment_id: paymentId, updated_by: by.id }).eq("id", poId).is("supplier_paid_at", null);
  }
}

/** Undo one applied advance line (owner and accounts, with a remark): the line is turned off, the invoice owes again. */
export async function undoAdvanceUse(lineId: string, remark: string, by: { id: string; display_name: string }): Promise<{ error?: string; words?: string; paymentId?: string }> {
  const admin = createAdminClient();
  const { data: line } = await admin.from("supplier_payment_lines").select(`id, payment_id, po_id, amount_aed, applied_later, is_active${(await lathePayReady()) ? ", lathe_bill_id" : ""}`).eq("id", lineId).maybeSingle() as unknown as { data: { id: string; payment_id: string; po_id: string | null; amount_aed: number; applied_later: boolean; is_active: boolean; lathe_bill_id?: string | null } | null };
  if (!line || !line.is_active) return { error: "That advance line is already undone." };
  if (!line.applied_later) return { error: "Only an advance applied later can be undone here (void the payment itself instead)." };
  const { error } = await admin.from("supplier_payment_lines").update({ is_active: false, updated_by: by.id }).eq("id", lineId).eq("is_active", true);
  if (error) return { error: error.message };
  const { data: p } = await admin.from("supplier_payments").select("number, edit_history").eq("id", line.payment_id).maybeSingle();
  const hist = [...((p?.edit_history as unknown[]) ?? []), { at: new Date().toISOString(), by: by.display_name, remark, changes: [{ field: "applied", old: `AED ${Number(line.amount_aed).toFixed(2)}`, new: "undone" }] }];
  await admin.from("supplier_payments").update({ edit_history: hist, updated_by: by.id }).eq("id", line.payment_id);
  // The LPO owes again: its paid stamp comes off.
  if (line.po_id) await admin.from("purchase_orders").update({ supplier_paid_at: null, supplier_paid_by: null, supplier_paid_reference: null, supplier_payment_id: null, updated_by: by.id }).eq("id", line.po_id).not("supplier_paid_at", "is", null);
  if (line.lathe_bill_id) await admin.from("lathe_bills").update({ paid_at: null, paid_by: null, paid_reference: null, updated_by: by.id }).eq("id", line.lathe_bill_id);
  return { words: `AED ${Number(line.amount_aed).toFixed(2)} of ${p?.number ?? "the advance"} undone. The invoice owes it again; the advance holds it again.`, paymentId: line.payment_id as string };
}

/** The block on paying one part twice (15 November 2026): per LPO, its invoices and which of them are paid. */
export async function doublePayFor(poIds: string[], paying: Set<string>): Promise<string | null> {
  if (!poIds.length || !(await lpoInvoicesReady())) return null;
  const { lpoInvoiceState } = await import("./lpo-invoices");
  const { doublePayProblem } = await import("./lpo-invoice-rules");
  const paidMap = await paidOnPos(poIds);
  for (const poId of poIds) {
    const st = await lpoInvoiceState(poId);
    if (!st || !st.extras.length) continue;
    const invoices = [
      { key: poId, number: st.first.number ?? st.po.number, lineIds: st.coverage.filter((c) => c.onFirst > 0.0005).map((c) => c.lineId), paid: !!st.po.supplier_paid_at || (paidMap.get(poId) ?? 0) > 0.004 },
      ...st.extras.map((e) => ({ key: payKeyOf(poId, e.id), number: e.number, lineIds: e.lines.map((l) => l.line_id), paid: !!e.paid_at || (paidMap.get(payKeyOf(poId, e.id)) ?? 0) > 0.004 })),
    ];
    const problem = doublePayProblem(st.coverage, invoices, paying);
    if (problem) return problem;
  }
  return null;
}

/**
 * THE "has proof of payment" source (15 November 2026, Section 3): per invoice key (the LPO, or "<LPO>~<further invoice>"),
 * the proof file that paid it. A proof attached to a recorded payment covers EVERY invoice and LPO that payment paid; an
 * LPO's own "Paid to supplier" proof covers that LPO. Used by the list tag, the "Paid without proof" filter, the opened
 * invoice and Parts accounts.
 */
export async function proofsByInvoiceKey(poIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!poIds.length) return out;
  const admin = createAdminClient();
  const own = await pageAllIn<{ id: string; supplier_paid_proof_path: string | null }>(poIds, (chunk, a, b) => admin.from("purchase_orders").select("id, supplier_paid_proof_path").in("id", chunk).not("supplier_paid_proof_path", "is", null).order("id").range(a, b).abortSignal(fresh()) as unknown as PromiseLike<{ data: { id: string; supplier_paid_proof_path: string | null }[] | null; error: { message: string } | null }>);
  for (const p of own) if (p.supplier_paid_proof_path) out.set(p.id, p.supplier_paid_proof_path);
  if (!(await supplierPaymentsReadyNow())) return out;
  const invCol = (await schemaReady("supplier_payment_lines", "lpo_invoice_id")) ? ", lpo_invoice_id" : "";
  const lines = await pageAllIn<{ po_id: string; payment_id: string; lpo_invoice_id?: string | null }>(poIds, (chunk, a, b) => admin.from("supplier_payment_lines").select("po_id, payment_id" + invCol).in("po_id", chunk).eq("is_active", true).order("id").range(a, b).abortSignal(fresh()) as unknown as PromiseLike<{ data: { po_id: string; payment_id: string; lpo_invoice_id?: string | null }[] | null; error: { message: string } | null }>);
  const payIds = Array.from(new Set(lines.map((l) => l.payment_id)));
  if (!payIds.length) return out;
  const pays = await pageAllIn<{ id: string; status: string; proof_path: string | null }>(payIds, (chunk, a, b) => admin.from("supplier_payments").select("id, status, proof_path").in("id", chunk).order("id").range(a, b).abortSignal(fresh()) as unknown as PromiseLike<{ data: { id: string; status: string; proof_path: string | null }[] | null; error: { message: string } | null }>);
  const proofOf = new Map(pays.filter((p) => p.status === "recorded" && p.proof_path).map((p) => [p.id, p.proof_path as string]));
  for (const l of lines) {
    const proof = proofOf.get(l.payment_id);
    if (!proof) continue;
    const key = payKeyOf(l.po_id, l.lpo_invoice_id ?? null);
    if (!out.has(key)) out.set(key, proof);
  }
  return out;
}

export type PaymentCorrection = { method: string; paidOn: string; reference: string | null; proofPath: string | null; reason: string };

/**
 * "Correct this payment" (15 November 2026, Section 5): accounts or the owner change a recorded supplier payment's
 * METHOD, DATE, REFERENCE or PROOF with a reason. The old values stay in its history (who, when, old, new). The amount
 * and the supplier never change this way (void it and record a new payment). A payment already in Zoho is taken back
 * and posted again at the next Sync to Zoho, so the cash and bank accounts follow (OFJ TEST until go-live).
 */
export async function correctSupplierPayment(paymentId: string, c: PaymentCorrection, by: { id: string; display_name: string; role_id: string }): Promise<{ error?: string; words?: string }> {
  if (!(by.role_id === "owner" || by.role_id === "accounts")) return { error: "Only the owner or accounts correct a supplier payment." };
  const reason = c.reason.trim();
  if (reason.length < 5) return { error: "Write why it is corrected (a few words) – it stays in the history." };
  if (!SUPPLIER_PAY_METHOD_KEYS.includes(c.method as SupplierPayMethod)) return { error: "Choose how it was really paid." };
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.paidOn) || c.paidOn > today) return { error: "Pick the real payment date (not in the future)." };
  const admin = createAdminClient();
  const { data: raw } = await admin.from("supplier_payments").select("id, number, status, method, paid_on, reference, proof_path, edit_history, zoho_payment_id").eq("id", paymentId).maybeSingle();
  const pay = raw as { id: string; number: string; status: string; method: string; paid_on: string; reference: string | null; proof_path: string | null; edit_history: unknown[] | null; zoho_payment_id: string | null } | null;
  if (!pay || pay.status !== "recorded") return { error: "This payment is voided or gone: nothing to correct." };
  const label = (k: string) => (SUPPLIER_PAY_METHOD_LABELS as Record<string, string>)[k] ?? k;
  const ref = c.reference?.trim() || null;
  const changes: { field: string; old: string; new: string }[] = [];
  if (pay.method !== c.method) changes.push({ field: "Method", old: label(pay.method), new: label(c.method) });
  if (String(pay.paid_on).slice(0, 10) !== c.paidOn) changes.push({ field: "Date", old: String(pay.paid_on).slice(0, 10), new: c.paidOn });
  if ((pay.reference ?? "") !== (ref ?? "")) changes.push({ field: "Reference", old: pay.reference ?? "", new: ref ?? "" });
  if (c.proofPath && c.proofPath !== pay.proof_path) changes.push({ field: "Proof", old: pay.proof_path ? "a proof" : "none", new: "new proof" });
  if (!changes.length) return { words: "Nothing changed." };
  const repost = !!pay.zoho_payment_id && changes.some((x) => x.field !== "Proof");
  const entry = { at: new Date().toISOString(), by: by.display_name, by_id: by.id, remark: reason, changes, ...(repost ? { zoho: "repost" } : {}) };
  const { error } = await admin.from("supplier_payments").update({ method: c.method, paid_on: c.paidOn, reference: ref, ...(c.proofPath ? { proof_path: c.proofPath } : {}), edit_history: [...(pay.edit_history ?? []), entry], updated_by: by.id }).eq("id", paymentId).eq("status", "recorded");
  if (error) return { error: "Couldn't save – nothing was changed. Try again or tell the owner." };
  // The LPOs it paid carry the same facts on their "Paid to supplier" line.
  await admin.from("purchase_orders").update({ supplier_paid_method: c.method === "link" ? "card" : c.method, supplier_paid_reference: [pay.number, ref].filter(Boolean).join(" · ").slice(0, 120), ...(c.proofPath ? { supplier_paid_proof_path: c.proofPath, supplier_paid_proof_at: new Date().toISOString(), supplier_paid_proof_by: by.id } : {}), updated_by: by.id }).eq("supplier_payment_id", paymentId);
  if (repost) {
    const { reopenZoho } = await import("./zoho-sync");
    await reopenZoho("supplierpay", paymentId);
  }
  return { words: `${pay.number} corrected (${changes.map((x) => `${x.field}: ${x.old || "—"} → ${x.new || "—"}`).join("; ")}).${repost ? " Its Zoho payment is taken back and posted again at the next Sync to Zoho." : ""}` };
}

/** The LPOs an advance to this supplier MAY name (17 November 2026): theirs, not cancelled, invoice not entered yet. */
export async function linkableLposOf(supplierId: string | null, supplierName: string): Promise<{ id: string; number: string }[]> {
  if (!(await lpoAdvanceColumnReady())) return [];
  let q = createAdminClient().from("purchase_orders").select("id, number, kind, status, supplier_invoice_status").neq("status", "cancelled").neq("supplier_invoice_status", "received").eq("is_active", true).order("created_at", { ascending: false }).limit(50);
  q = supplierId ? q.eq("supplier_id", supplierId) : q.ilike("supplier_name", supplierName);
  const { data } = await q;
  return ((data ?? []) as { id: string; number: string; kind: string | null }[]).filter((p) => p.kind !== "main").map((p) => ({ id: p.id, number: p.number }));
}
