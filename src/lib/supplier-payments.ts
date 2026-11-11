import "server-only";
import { pageAllIn } from "./page-all";
import { createAdminClient } from "./supabase/admin";
import { lpoAmounts, supplierVatLookup } from "./supplier-vat";
import { loadLpoInvoices, lpoInvoiceGross, lpoInvoicesReady } from "./lpo-invoices";
import { payKeyOf, splitPayKey } from "./lpo-invoice-rules";
import { schemaReady } from "./schema-ready";
import { advanceLeft, checkAllocations, type Allocation, type OpenInvoice, type SupplierPayMethod, SUPPLIER_PAY_METHOD_KEYS } from "./supplier-payment-rules";

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
export async function advancesOf(supplierId: string | null, supplierName: string): Promise<{ paymentId: string; number: string; left: number }[]> {
  if (!(await supplierPaymentsReadyNow())) return [];
  const admin = createAdminClient();
  let q = admin.from("supplier_payments").select("id, number, amount_aed, excess_kind, fee_aed, status").eq("is_active", true).eq("status", "recorded").eq("excess_kind", "advance").abortSignal(fresh());
  q = supplierId ? q.eq("supplier_id", supplierId) : q.ilike("supplier_name", supplierName);
  const { data: pays } = await q;
  const list = (pays ?? []) as { id: string; number: string; amount_aed: number; excess_kind: string | null; fee_aed: number; status: string }[];
  if (!list.length) return [];
  const { data: lines } = await admin.from("supplier_payment_lines").select("payment_id, amount_aed").in("payment_id", list.map((p) => p.id)).eq("is_active", true).abortSignal(fresh());
  const used = new Map<string, number>();
  for (const l of (lines ?? []) as { payment_id: string; amount_aed: number }[]) used.set(l.payment_id, r2((used.get(l.payment_id) ?? 0) + Number(l.amount_aed)));
  return list
    .map((p) => ({ paymentId: p.id, number: p.number, left: advanceLeft({ amount: Number(p.amount_aed), excessKind: p.excess_kind, fee: Number(p.fee_aed) || 0, status: p.status }, used.get(p.id) ?? 0) }))
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
  /** Advances to apply to these invoices (accounts confirmed): payment id → amount. */
  useAdvances?: { paymentId: string; amount: number }[];
};

/**
 * Records ONE payment to a supplier: the amount, how it is spread, what happens to any excess. LPOs it settles in full
 * are marked paid (the lists and the old badges keep working). Returns the payment number, or the refusal in plain words.
 */
export async function recordSupplierPayment(input: SupplierPaymentInput, by: { id: string; display_name: string }): Promise<{ id?: string; number?: string; error?: string; words?: string }> {
  if (!(await supplierPaymentsReadyNow())) return { error: "Supplier payments switch on once the database change is applied." };
  if (!SUPPLIER_PAY_METHOD_KEYS.includes(input.method as SupplierPayMethod)) return { error: "Pick how it was paid." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) return { error: "Pick the payment date." };
  const amount = r2(input.amount);
  const open = await openInvoicesOf(input.supplierId, input.supplierName);
  const lines = input.lines.filter((l) => l.amount > 0.004).map((l) => ({ poId: l.poId, amount: r2(l.amount) }));
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
  // Advances from earlier payments, applied to these invoices (each a line on the payment it came from).
  const applied: string[] = [];
  const appliedPos: string[] = [];
  for (const a of input.useAdvances ?? []) {
    const left = (await advancesOf(input.supplierId, input.supplierName)).find((x) => x.paymentId === a.paymentId)?.left ?? 0;
    let take = r2(Math.min(a.amount, left));
    for (const inv of await openInvoicesOf(input.supplierId, input.supplierName)) {
      if (take <= 0.004) break;
      const amt = r2(Math.min(take, inv.due));
      if (amt <= 0.004) continue;
      const k = splitPayKey(inv.poId);
      await admin.from("supplier_payment_lines").insert({ payment_id: a.paymentId, po_id: k.poId, ...(k.invoiceId ? { lpo_invoice_id: k.invoiceId } : {}), amount_aed: amt, applied_later: true, created_by: by.id, updated_by: by.id });
      applied.push(`AED ${amt.toFixed(2)} of the advance on ${inv.label}`);
      appliedPos.push(inv.poId);
      take = r2(take - amt);
    }
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
  return { id: pay.id as string, number: pay.number as string, words };
}

/** The payments that put money on one LPO (its history on the LPO page), newest first. */
export async function paymentsOnPo(poId: string): Promise<{ id: string; number: string; paidOn: string; method: string; reference: string | null; amount: number; onThis: number; status: string; voidReason: string | null; laterAdvance: boolean }[]> {
  if (!(await supplierPaymentsReadyNow())) return [];
  const admin = createAdminClient();
  const { data: lines } = await admin.from("supplier_payment_lines").select("payment_id, amount_aed, applied_later").eq("po_id", poId).eq("is_active", true);
  const rows = (lines ?? []) as { payment_id: string; amount_aed: number; applied_later: boolean }[];
  if (!rows.length) return [];
  const { data: pays } = await admin.from("supplier_payments").select("id, number, paid_on, method, reference, amount_aed, status, void_reason").in("id", Array.from(new Set(rows.map((r) => r.payment_id))));
  const byId = new Map(((pays ?? []) as { id: string; number: string; paid_on: string; method: string; reference: string | null; amount_aed: number; status: string; void_reason: string | null }[]).map((p) => [p.id, p]));
  return rows
    .map((r) => {
      const p = byId.get(r.payment_id);
      return p ? { id: p.id, number: p.number, paidOn: p.paid_on, method: p.method, reference: p.reference, amount: Number(p.amount_aed), onThis: Number(r.amount_aed), status: p.status, voidReason: p.void_reason, laterAdvance: !!r.applied_later } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.paidOn.localeCompare(a.paidOn));
}
