import { createAdminClient } from "@/lib/supabase/admin";
import { loadSupplierInvoices } from "@/lib/supplier-invoices";
import { unpaidBySupplier, type InvoiceRow, type UnpaidSupplier } from "@/lib/supplier-invoice-rows";
import { advancesBySupplier, latheDueBySupplier, supplierPaymentsReadyNow } from "@/lib/supplier-payments";

/**
 * THE SUPPLIER PAYMENTS TAB (10 November 2026, Section 5): owner + accounts only. What is due by supplier (oldest
 * first), the advances per supplier and the payment history - one loader for the page and its Excel export.
 */
export type PaymentHistoryRow = {
  id: string;
  number: string;
  supplier: string;
  supplierId: string | null;
  paidOn: string;
  method: string;
  reference: string | null;
  amount: number;
  excessKind: string | null;
  fee: number;
  status: string;
  voidReason: string | null;
  lpos: string[];
  by: string | null;
  hasProof: boolean;
};

/** A supplier's LPOs still waiting for their invoice (ordered, or delivered with the invoice to follow), car or stock. */
export type AwaitingSupplier = { supplier: string; supplierId: string | null; count: number; notReceived: number; total: number; lpos: string[] };

/** THE "waiting for the invoice" list per supplier (11 November 2026, Section 1): nothing to pay yet, but on the tab. */
export function awaitingBySupplier(rows: InvoiceRow[]): AwaitingSupplier[] {
  const m = new Map<string, AwaitingSupplier>();
  for (const r of rows) {
    if (r.status !== "waiting") continue;
    const k = r.supplierId ?? `name:${r.supplier.trim().toLowerCase()}`;
    const cur = m.get(k) ?? { supplier: r.supplier, supplierId: r.supplierId, count: 0, notReceived: 0, total: 0, lpos: [] };
    cur.count++;
    if (r.notReceived) cur.notReceived++;
    cur.total = Math.round((cur.total + r.total) * 100) / 100;
    cur.lpos.push(...r.shares.map((x) => x.poNumber));
    m.set(k, cur);
  }
  return Array.from(m.values()).sort((a, b) => a.supplier.localeCompare(b.supplier));
}

export const METHOD_WORDS: Record<string, string> = { transfer: "Bank transfer", card: "Card", cash: "Cash", cheque: "Cheque", link: "Payment link" };

export async function loadPaymentsTab(opts: { from?: string | null; to?: string | null; supplier?: string | null } = {}): Promise<{ ready: boolean; due: UnpaidSupplier[]; advances: Map<string, number>; history: PaymentHistoryRow[]; read: boolean; awaiting: AwaitingSupplier[]; suppliers: { id: string; name: string }[] }> {
  const ready = await supplierPaymentsReadyNow();
  const inv = await loadSupplierInvoices({ strict: true }).catch(() => null);
  const awaiting = awaitingBySupplier(inv?.rows ?? []);
  const { data: supList } = await createAdminClient().from("suppliers").select("id, name").eq("is_active", true).order("name").limit(1000);
  const suppliers = ((supList ?? []) as { id: string; name: string }[]).filter((x) => !/^our stock$/i.test(x.name.trim()));
  const dueRaw = unpaidBySupplier(inv?.rows ?? []);
  // Lathe bills (11 November 2026, Section 6) are due like any supplier invoice (no VAT split: the total as printed).
  for (const l of await latheDueBySupplier()) {
    const cur = dueRaw.find((d) => (l.supplierId && d.supplierId === l.supplierId) || d.supplier.toUpperCase() === l.supplier.toUpperCase());
    if (cur) { cur.count += l.count; cur.total = Math.round((cur.total + l.total) * 100) / 100; cur.net = Math.round((cur.net + l.total) * 100) / 100; if (l.oldest && (!cur.oldest || l.oldest < cur.oldest)) cur.oldest = l.oldest; }
    else dueRaw.push({ supplier: l.supplier, supplierId: l.supplierId, count: l.count, total: l.total, net: l.total, vat: 0, vatCharged: false, oldest: l.oldest });
  }
  const due = dueRaw.sort((a, b) => (a.oldest ?? "9999").localeCompare(b.oldest ?? "9999") || b.total - a.total);
  if (!ready) return { ready, due, advances: new Map(), history: [], read: !!inv, awaiting, suppliers };
  const admin = createAdminClient();
  const advances = await advancesBySupplier();
  let q = admin.from("supplier_payments").select("id, number, supplier_id, supplier_name, paid_on, method, reference, amount_aed, excess_kind, fee_aed, status, void_reason, created_by, proof_path").eq("is_active", true).order("paid_on", { ascending: false }).order("created_at", { ascending: false }).limit(500);
  if (opts.from) q = q.gte("paid_on", opts.from);
  if (opts.to) q = q.lte("paid_on", opts.to);
  if (opts.supplier) q = /^[0-9a-f-]{36}$/.test(opts.supplier) ? q.eq("supplier_id", opts.supplier) : q.ilike("supplier_name", opts.supplier);
  const { data: pays } = await q;
  const list = (pays ?? []) as { id: string; number: string; supplier_id: string | null; supplier_name: string; paid_on: string; method: string; reference: string | null; amount_aed: number; excess_kind: string | null; fee_aed: number; status: string; void_reason: string | null; created_by: string | null; proof_path: string | null }[];
  const ids = list.map((p) => p.id);
  const { data: lines } = ids.length ? await admin.from("supplier_payment_lines").select("payment_id, po_id").in("payment_id", ids).eq("is_active", true) : { data: [] };
  const poIds = Array.from(new Set((lines ?? []).map((l) => l.po_id as string)));
  const { data: pos } = poIds.length ? await admin.from("purchase_orders").select("id, number").in("id", poIds) : { data: [] };
  const poNum = new Map((pos ?? []).map((p) => [p.id as string, p.number as string]));
  const staffIds = Array.from(new Set(list.map((p) => p.created_by).filter((x): x is string => !!x)));
  const { data: staff } = staffIds.length ? await admin.from("staff").select("id, display_name").in("id", staffIds) : { data: [] };
  const who = new Map((staff ?? []).map((s) => [s.id as string, s.display_name as string]));
  const history = list.map((p) => ({
    id: p.id,
    number: p.number,
    supplier: p.supplier_name,
    supplierId: p.supplier_id,
    paidOn: p.paid_on,
    method: p.method,
    reference: p.reference,
    amount: Number(p.amount_aed) || 0,
    excessKind: p.excess_kind,
    fee: Number(p.fee_aed) || 0,
    status: p.status,
    voidReason: p.void_reason,
    lpos: Array.from(new Set((lines ?? []).filter((l) => l.payment_id === p.id).map((l) => poNum.get(l.po_id as string) ?? ""))).filter(Boolean),
    by: p.created_by ? who.get(p.created_by) ?? null : null,
    hasProof: !!p.proof_path,
  }));
  return { ready, due, advances, history, read: !!inv, awaiting, suppliers };
}
