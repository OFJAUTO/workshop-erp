import "server-only";
import { pageAllIn } from "./page-all";
import { createAdminClient } from "./supabase/admin";
import { lpoAmounts, supplierVatLookup } from "./supplier-vat";
import { loadLpoInvoices, lpoInvoiceGross, lpoInvoicesReady } from "./lpo-invoices";
import { payKeyOf, splitPayKey } from "./lpo-invoice-rules";
import { schemaReady } from "./schema-ready";
import { advanceLeft, checkAdvanceUses, checkAllocations, type AdvanceUse, type Allocation, type OpenInvoice, type SupplierPayMethod, SUPPLIER_PAY_METHOD_KEYS } from "./supplier-payment-rules";

/**
 * SUPPLIER PAYMENTS, the server half (6 November 2026, Section 4). THE supplier balance and its open invoices, the
 * advances, and recording a payment. The tables arrive with `20261207110000_supplier_payments.sql`; until then
 * `supplierPaymentsReady()` is false and the old "Paid to supplier" (one LPO in full) stays.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Next memoizes identical reads within one request: a save that reads, writes and reads again must ask afresh. */
const fresh = () => new AbortController().signal;

type PoRow = { id: string; number: string; kind: string; status: string; supplier_id: string | null; supplier_name: string; total_cost_aed: number; supplier_invoice_status: string | null; supplier_invoice_number: string | null; supplier_invoice_date: string | null; supplier_invoice_amount: number | null; supplier_invoice_vat_aed?: number | null; supplier_paid_at: string | null; supplier_payment_id?: string | null; job_id: string | null };

/** The supplier's invoices still owed (entered, not cancelled), each with what is left, oldest first. */
export async function openInvoicesOf(supplierId: string | null, supplierName: string): Promise<(OpenInvoice & { gross: number; paid: number; jobId: string | null })[]> {
  const admin = createAdminClient();
  let q = admin.from("purchase_orders").select("id, number, kind, status, supplier_id, supplier_name, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_vat_aed, supplier_paid_at, supplier_payment_id, job_id").eq("is_active", true).neq("status", "cancelled").in("kind", ["supplier", "stock"]).eq("supplier_invoice_status", "received").abortSignal(fresh());
  q = supplierId ? q.eq("supplier_id", supplierId) : q.ilike("supplier_name", supplierName);
  const { data } = await q;
  const pos = ((data ?? []) as PoRow[]).map((p) => ({ ...p, total_cost_aed: Number(p.total_cost_aed) || 0, supplier_invoice_amount: p.supplier_invoice_amount === null ? null : Number(p.supplier_invoice_amount) }));
  if (!pos.length) return [];
  const [amounts, paidMap] = await Promise.all([lpoAmounts(pos, { withFurther: false }), paidOnPos(pos.map((p) => p.id))]);
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
      const gross = amounts.get(p.id)?.gross ?? 0;
      // The old one-LPO "Paid to supplier" (before payments were recorded with their amount) counts as paid in full.
      const paid = p.supplier_paid_at && !p.supplier_payment_id && !(paidMap.get(p.id) ?? 0) ? gross : (paidMap.get(p.id) ?? 0);
      return { poId: p.id, label: `${p.supplier_invoice_number ?? p.number} · ${p.number}`, date: p.supplier_invoice_date, due: r2(gross - paid), gross, paid: r2(paid), jobId: p.job_id };
    }), ...extraOpen]
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

let readyCache: { at: number; ok: boolean } | null = null;
/** The tables exist (asked again every minute until they do). */
export async function supplierPaymentsReadyNow(): Promise<boolean> {
  if (readyCache && (readyCache.ok || Date.now() - readyCache.at < 60_000)) return readyCache.ok;
  const { error } = await createAdminClient().from("supplier_payments").select("id").limit(1);
  readyCache = { at: Date.now(), ok: !error };
  return readyCache.ok;
}

export type SupplierPaymentInput = {
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
  const put = r2(lines.reduce((a, l) => a + l.amount, 0));
  const excess = r2(amount - put);
  if (excess > 0.004 && !input.excessKind) return { error: `AED ${excess.toFixed(2)} is more than the invoices: choose "Advance with the supplier" or "Fee / charge".` };
  const admin = createAdminClient();
  const { data: pay, error } = await admin
    .from("supplier_payments")
    .insert({ supplier_id: input.supplierId, supplier_name: input.supplierName, paid_on: input.paidOn, method: input.method, reference: input.reference, amount_aed: amount, excess_kind: excess > 0.004 ? input.excessKind : null, fee_aed: excess > 0.004 && input.excessKind === "fee" ? excess : 0, proof_path: input.proofPath, note: input.note, created_by: by.id, updated_by: by.id })
    .select("id, number")
    .single();
  if (error || !pay) return { error: error?.message ?? "Couldn't save – nothing was recorded." };
  if (lines.length) {
    const invReady = await lpoInvoicesReady();
    const { error: lErr } = await admin.from("supplier_payment_lines").insert(lines.map((l) => { const k = splitPayKey(l.poId); return { payment_id: pay.id, po_id: k.poId, ...(invReady ? { lpo_invoice_id: k.invoiceId } : {}), amount_aed: l.amount, created_by: by.id, updated_by: by.id }; }), { defaultToNull: false });
    if (lErr) {
      await admin.from("supplier_payments").update({ status: "void", void_reason: "Its invoices could not be saved", updated_by: by.id }).eq("id", pay.id);
      return { error: lErr.message };
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
  for (const poId of Array.from(new Set(touched.map((k) => splitPayKey(k).poId))).filter((id) => !owingPos.has(id))) {
    await admin.from("purchase_orders").update({ supplier_paid_at: now, supplier_paid_by: by.id, supplier_paid_method: input.method === "link" ? "card" : input.method, supplier_paid_reference: [pay.number, input.reference].filter(Boolean).join(" · ").slice(0, 120), supplier_payment_id: pay.id, ...(input.proofPath ? { supplier_paid_proof_path: input.proofPath, supplier_paid_proof_at: now, supplier_paid_proof_by: by.id } : {}), updated_by: by.id }).eq("id", poId).is("supplier_paid_at", null);
  }
  const words = [`${pay.number}: AED ${amount.toFixed(2)} to ${input.supplierName}`, lines.length ? `on ${lines.length} invoice${lines.length === 1 ? "" : "s"}` : null, excess > 0.004 ? (input.excessKind === "fee" ? `AED ${excess.toFixed(2)} as a fee` : `AED ${excess.toFixed(2)} kept as an advance`) : null, applied.length ? applied.join("; ") : null].filter(Boolean).join(" · ");
  return { id: pay.id as string, number: pay.number as string, words, advancesUsed: Array.from(new Set(uses.map((u) => u.paymentId))) };
}

/** The payments that put money on one LPO (its history on the LPO page), newest first. */
export async function paymentsOnPo(poId: string): Promise<{ id: string; number: string; paidOn: string; method: string; reference: string | null; amount: number; onThis: number; status: string; voidReason: string | null; laterAdvance: boolean; lineId: string }[]> {
  if (!(await supplierPaymentsReadyNow())) return [];
  const admin = createAdminClient();
  const { data: lines } = await admin.from("supplier_payment_lines").select("id, payment_id, amount_aed, applied_later").eq("po_id", poId).eq("is_active", true);
  const rows = (lines ?? []) as { id: string; payment_id: string; amount_aed: number; applied_later: boolean }[];
  if (!rows.length) return [];
  const { data: pays } = await admin.from("supplier_payments").select("id, number, paid_on, method, reference, amount_aed, status, void_reason").in("id", Array.from(new Set(rows.map((r) => r.payment_id))));
  const byId = new Map(((pays ?? []) as { id: string; number: string; paid_on: string; method: string; reference: string | null; amount_aed: number; status: string; void_reason: string | null }[]).map((p) => [p.id, p]));
  return rows
    .map((r) => {
      const p = byId.get(r.payment_id);
      return p ? { id: p.id, number: p.number, paidOn: p.paid_on, method: p.method, reference: p.reference, amount: Number(p.amount_aed), onThis: Number(r.amount_aed), status: p.status, voidReason: p.void_reason, laterAdvance: !!r.applied_later, lineId: r.id } : null;
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
  const rows = uses.map((u) => { const k = splitPayKey(u.poId); return { payment_id: u.paymentId, po_id: k.poId, ...(invReady ? { lpo_invoice_id: k.invoiceId } : {}), amount_aed: r2(u.amount), applied_later: true, created_by: by.id, updated_by: by.id }; });
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
  const owingPos = new Set(stillOwing.map((k) => splitPayKey(k).poId));
  const { data: pay } = paymentId ? await admin.from("supplier_payments").select("number").eq("id", paymentId).maybeSingle() : { data: null };
  for (const poId of Array.from(new Set(touchedKeys.map((k) => splitPayKey(k).poId))).filter((id) => !owingPos.has(id))) {
    await admin.from("purchase_orders").update({ supplier_paid_at: now, supplier_paid_by: by.id, supplier_paid_method: method === "link" ? "card" : method, supplier_paid_reference: (pay?.number as string | undefined) ?? null, supplier_payment_id: paymentId, updated_by: by.id }).eq("id", poId).is("supplier_paid_at", null);
  }
}

/** Undo one applied advance line (owner and accounts, with a remark): the line is turned off, the invoice owes again. */
export async function undoAdvanceUse(lineId: string, remark: string, by: { id: string; display_name: string }): Promise<{ error?: string; words?: string; paymentId?: string }> {
  const admin = createAdminClient();
  const { data: line } = await admin.from("supplier_payment_lines").select("id, payment_id, po_id, amount_aed, applied_later, is_active").eq("id", lineId).maybeSingle();
  if (!line || !line.is_active) return { error: "That advance line is already undone." };
  if (!line.applied_later) return { error: "Only an advance applied later can be undone here (void the payment itself instead)." };
  const { error } = await admin.from("supplier_payment_lines").update({ is_active: false, updated_by: by.id }).eq("id", lineId).eq("is_active", true);
  if (error) return { error: error.message };
  const { data: p } = await admin.from("supplier_payments").select("number, edit_history").eq("id", line.payment_id).maybeSingle();
  const hist = [...((p?.edit_history as unknown[]) ?? []), { at: new Date().toISOString(), by: by.display_name, remark, changes: [{ field: "applied", old: `AED ${Number(line.amount_aed).toFixed(2)}`, new: "undone" }] }];
  await admin.from("supplier_payments").update({ edit_history: hist, updated_by: by.id }).eq("id", line.payment_id);
  // The LPO owes again: its paid stamp comes off.
  await admin.from("purchase_orders").update({ supplier_paid_at: null, supplier_paid_by: null, supplier_paid_reference: null, supplier_payment_id: null, updated_by: by.id }).eq("id", line.po_id).not("supplier_paid_at", "is", null);
  return { words: `AED ${Number(line.amount_aed).toFixed(2)} of ${p?.number ?? "the advance"} undone. The invoice owes it again; the advance holds it again.`, paymentId: line.payment_id as string };
}
