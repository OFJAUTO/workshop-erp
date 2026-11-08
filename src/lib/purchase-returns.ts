import "server-only";
import { createAdminClient } from "./supabase/admin";
import { schemaReady } from "./schema-ready";
import { notifyRoles } from "./notifications";
import { logAppError } from "./app-errors";
import { round2 } from "./money";
import { realPartNumber } from "./parts-rows";
import { supplierChargesVat } from "./supplier-rules";
import { supplierMoney } from "./supplier-money";

/**
 * PURCHASE RETURNS (8 November 2026, Section 8). The 3 November flow stays THE flow (Return to supplier on the Parts
 * table, "credit note awaited", the Zoho vendor credit); this adds what was missing around it: the PR- note for the
 * supplier, the Sent back step (date, who took it, the signed slip), the four outcomes (credit received, refund
 * received, replaced, refused by the supplier), a restocking fee, "Credit expected" kept apart from the balance, the
 * Purchase returns list and the accounts' bells.
 *
 * Worst-case money: the supplier balance never moves on a request or a sending; only when accounts record the credit
 * note or the refund. A refused return or a restocking fee costs the job or overhead, as the owner chooses.
 */
export const purchaseReturnsReady = () => schemaReady("purchase_returns", "id, number, status");

import type { ReturnStatus } from "./purchase-returns-words";
export { RETURN_STATUS_WORDS, RETURN_TABS, type ReturnStatus } from "./purchase-returns-words";

export type PurchaseReturn = {
  id: string;
  number: string;
  partId: string;
  jobId: string | null;
  jobNumber: string | null;
  poId: string | null;
  poNumber: string | null;
  supplierId: string | null;
  supplier: string;
  description: string;
  partNumber: string | null;
  quantity: number;
  unitCost: number;
  invoiceNumber: string | null;
  reason: string;
  status: ReturnStatus;
  requestedAt: string;
  sentAt: string | null;
  sentWith: string | null;
  slipPath: string | null;
  creditNumber: string | null;
  creditDate: string | null;
  creditNet: number | null;
  creditVat: number | null;
  refundMethod: string | null;
  refundDate: string | null;
  refund: number | null;
  replacementPartId: string | null;
  refusedAction: string | null;
  writeOffStatus: string | null;
  restockFee: number;
  costTo: string | null;
  outcomeNote: string | null;
  /** What the supplier owes back while the credit is not recorded (incl. VAT when the supplier charges VAT). */
  expected: number;
  /** The LPO of this part was already paid: the credit becomes money the supplier owes us (an advance). */
  lpoPaid: boolean;
  daysWaiting: number;
};

const SELECT = "id, number, part_item_id, job_id, po_id, supplier_id, supplier_name, description, part_number, quantity, unit_cost, supplier_invoice_number, reason, status, requested_at, sent_at, sent_with, slip_path, credit_number, credit_date, credit_net_aed, credit_vat_aed, refund_method, refund_date, refund_aed, replacement_part_id, refused_action, write_off_status, restock_fee_aed, cost_to, outcome_note";
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Every return (or one tab of them), newest first, with its LPO, job, expected credit and days waiting. */
export async function loadPurchaseReturns(opts: { statuses?: readonly string[]; supplierId?: string | null; supplierName?: string | null; ids?: string[] } = {}): Promise<PurchaseReturn[]> {
  if (!(await purchaseReturnsReady())) return [];
  const admin = createAdminClient();
  let q = admin.from("purchase_returns").select(SELECT).eq("is_active", true).order("requested_at", { ascending: false }).limit(500);
  if (opts.statuses) q = q.in("status", opts.statuses as string[]);
  if (opts.ids) q = q.in("id", opts.ids);
  if (opts.supplierId) q = q.eq("supplier_id", opts.supplierId);
  else if (opts.supplierName) q = q.ilike("supplier_name", opts.supplierName);
  const { data, error } = await q;
  if (error) { await logAppError("purchase-returns: load", error); return []; }
  const rows = (data ?? []) as Record<string, unknown>[];
  const poIds = Array.from(new Set(rows.map((r) => r.po_id as string | null).filter((x): x is string => !!x)));
  const jobIds = Array.from(new Set(rows.map((r) => r.job_id as string | null).filter((x): x is string => !!x)));
  const supIds = Array.from(new Set(rows.map((r) => r.supplier_id as string | null).filter((x): x is string => !!x)));
  const [{ data: pos }, { data: jobs }, { data: sups }] = await Promise.all([
    poIds.length ? admin.from("purchase_orders").select("id, number, supplier_paid_at").in("id", poIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    jobIds.length ? admin.from("jobs").select("id, job_number").in("id", jobIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supIds.length ? admin.from("suppliers").select("id, name, trn, vat_registered").in("id", supIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const poOf = new Map((pos ?? []).map((p) => [p.id as string, p]));
  const jobOf = new Map((jobs ?? []).map((j) => [j.id as string, j.job_number as string]));
  const supOf = new Map((sups ?? []).map((s) => [s.id as string, s]));
  const now = Date.now();
  return rows.map((r) => {
    const sup = r.supplier_id ? supOf.get(r.supplier_id as string) : null;
    const vat = supplierChargesVat({ name: String(r.supplier_name), trn: (sup?.trn as string | null) ?? null, vat_registered: (sup?.vat_registered as boolean | null) ?? null });
    const qty = Number(r.quantity) || 0;
    const unit = Number(r.unit_cost) || 0;
    const status = r.status as ReturnStatus;
    const po = r.po_id ? poOf.get(r.po_id as string) : null;
    const open = status === "requested" || status === "sent";
    const expected = open ? round2(supplierMoney(round2(qty * unit) - (Number(r.restock_fee_aed) || 0), { chargesVat: vat }).gross) : 0;
    const since = (status === "sent" ? (r.sent_at as string | null) : (r.requested_at as string)) ?? (r.requested_at as string);
    return {
      id: r.id as string,
      number: r.number as string,
      partId: r.part_item_id as string,
      jobId: (r.job_id as string | null) ?? null,
      jobNumber: r.job_id ? (jobOf.get(r.job_id as string) ?? null) : null,
      poId: (r.po_id as string | null) ?? null,
      poNumber: (po?.number as string | undefined) ?? null,
      supplierId: (r.supplier_id as string | null) ?? null,
      supplier: String(r.supplier_name),
      description: String(r.description),
      partNumber: realPartNumber(r.part_number as string | null),
      quantity: qty,
      unitCost: unit,
      invoiceNumber: (r.supplier_invoice_number as string | null) ?? null,
      reason: String(r.reason ?? ""),
      status,
      requestedAt: r.requested_at as string,
      sentAt: (r.sent_at as string | null) ?? null,
      sentWith: (r.sent_with as string | null) ?? null,
      slipPath: (r.slip_path as string | null) ?? null,
      creditNumber: (r.credit_number as string | null) ?? null,
      creditDate: (r.credit_date as string | null) ?? null,
      creditNet: num(r.credit_net_aed),
      creditVat: num(r.credit_vat_aed),
      refundMethod: (r.refund_method as string | null) ?? null,
      refundDate: (r.refund_date as string | null) ?? null,
      refund: num(r.refund_aed),
      replacementPartId: (r.replacement_part_id as string | null) ?? null,
      refusedAction: (r.refused_action as string | null) ?? null,
      writeOffStatus: (r.write_off_status as string | null) ?? null,
      restockFee: Number(r.restock_fee_aed) || 0,
      costTo: (r.cost_to as string | null) ?? null,
      outcomeNote: (r.outcome_note as string | null) ?? null,
      expected,
      lpoPaid: !!po?.supplier_paid_at,
      daysWaiting: Math.max(0, Math.floor((now - Date.parse(since)) / 86400000)),
    };
  });
}

/** "Credit expected from <supplier>": the open returns' amounts by supplier (id, else name in capitals). Never in the balance. */
export async function creditExpectedBySupplier(): Promise<Map<string, { amount: number; count: number }>> {
  const out = new Map<string, { amount: number; count: number }>();
  for (const r of await loadPurchaseReturns({ statuses: ["requested", "sent"] })) {
    const key = r.supplierId ?? r.supplier.toUpperCase();
    const was = out.get(key) ?? { amount: 0, count: 0 };
    out.set(key, { amount: round2(was.amount + r.expected), count: was.count + 1 });
  }
  return out;
}

/** Credits recorded on returns whose LPO was already paid: money the supplier owes us (an advance to use). */
export async function returnCreditsToUse(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const r of await loadPurchaseReturns({ statuses: ["credited", "refunded"] })) {
    if (!r.lpoPaid || r.status === "refunded") continue;
    const key = r.supplierId ?? r.supplier.toUpperCase();
    out.set(key, round2((out.get(key) ?? 0) + (r.creditNet ?? 0) + (r.creditVat ?? 0)));
  }
  return out;
}

/** Open returns on an LPO (the invoice check warns when an invoice still charges a part that went back). */
export async function openReturnsOnPo(poId: string): Promise<PurchaseReturn[]> {
  if (!(await purchaseReturnsReady())) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("purchase_returns").select("id").eq("po_id", poId).eq("is_active", true).in("status", ["requested", "sent", "credited", "refunded"]);
  const ids = (data ?? []).map((r) => r.id as string);
  return ids.length ? loadPurchaseReturns({ ids }) : [];
}

/**
 * Opens the PR- record when a part is given "Return to supplier" (called after the ending is saved; a failure is
 * logged and never undoes the ending). One open return per part.
 */
export async function openPurchaseReturn(partId: string, reason: string, by: { id: string; display_name: string }): Promise<string | null> {
  if (!(await purchaseReturnsReady())) return null;
  const admin = createAdminClient();
  try {
    const { data: was } = await admin.from("purchase_returns").select("id, number").eq("part_item_id", partId).eq("is_active", true).in("status", ["requested", "sent"]).limit(1).maybeSingle();
    if (was) return was.number as string;
    const { data: p } = await admin.from("part_items").select("id, job_id, description, part_number, supplier, received_qty, returned_qty, quantity, confirmed_quantity, cost_aed, final_cost_aed, po_id, po_line_id").eq("id", partId).maybeSingle();
    if (!p) return null;
    const { data: line } = p.po_line_id ? await admin.from("purchase_order_lines").select("unit_cost, invoice_unit_cost").eq("id", p.po_line_id).maybeSingle() : { data: null };
    const { data: po } = p.po_id ? await admin.from("purchase_orders").select("id, supplier_id, supplier_name, supplier_invoice_number").eq("id", p.po_id).maybeSingle() : { data: null };
    const qty = Number(p.returned_qty) || Number(p.received_qty) || Number(p.confirmed_quantity ?? p.quantity) || 1;
    const unit = Number(line?.invoice_unit_cost ?? line?.unit_cost ?? p.cost_aed) || 0;
    const { data: made, error } = await admin
      .from("purchase_returns")
      .insert({ part_item_id: partId, job_id: p.job_id, po_id: p.po_id, po_line_id: p.po_line_id, supplier_id: po?.supplier_id ?? null, supplier_name: String(po?.supplier_name ?? p.supplier ?? "Supplier"), description: String(p.description), part_number: realPartNumber(p.part_number as string | null), quantity: qty, unit_cost: unit, supplier_invoice_number: (po?.supplier_invoice_number as string | null) ?? null, reason: reason.slice(0, 300) || "Not needed", requested_by: by.id, created_by: by.id, updated_by: by.id })
      .select("number")
      .single();
    if (error || !made) { await logAppError("purchase-returns: open", error ?? new Error("no row"), { staffId: by.id, jobId: (p.job_id as string | null) ?? null }); return null; }
    if (p.job_id) await admin.from("job_events").insert({ job_id: p.job_id, event_type: "purchase_return", note: `${made.number}: ${String(p.description).toUpperCase()} × ${qty} to go back to ${po?.supplier_name ?? p.supplier ?? "the supplier"} (${by.display_name})`, created_by: by.id });
    return made.number as string;
  } catch (e) {
    await logAppError("purchase-returns: open", e, { staffId: by.id });
    return null;
  }
}

/** The 7-day reminder: sent back, no credit or refund recorded after 7 days. One bell per return to accounts. */
export async function remindCreditsDue(): Promise<number> {
  if (!(await purchaseReturnsReady())) return 0;
  const admin = createAdminClient();
  const { data } = await admin.from("purchase_returns").select("id, number, supplier_name, description").eq("is_active", true).eq("status", "sent").is("credit_reminded_at", null).lt("sent_at", new Date(Date.now() - 7 * 86400000).toISOString());
  let n = 0;
  for (const r of data ?? []) {
    await notifyRoles(["accounts"], { type: "purchase_return", title: `No credit after 7 days: ${r.number} · ${r.supplier_name}`, body: `${String(r.description).toUpperCase()} went back a week ago and no credit note or refund is recorded. Chase ${r.supplier_name}.`, href: `/parts/returns?tab=credit#${r.number}` });
    await admin.from("purchase_returns").update({ credit_reminded_at: new Date().toISOString() }).eq("id", r.id);
    n++;
  }
  return n;
}

/** The job's share of returns that cost it (a restocking fee, or a refused part written off to the job). */
export async function returnCostsForJobs(jobIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!jobIds.length || !(await purchaseReturnsReady())) return out;
  const { data } = await createAdminClient().from("purchase_returns").select("job_id, status, quantity, unit_cost, restock_fee_aed, cost_to, refused_action, write_off_status").in("job_id", jobIds).eq("is_active", true).eq("cost_to", "job");
  for (const r of data ?? []) {
    const writeOff = r.status === "refused" && r.refused_action === "write_off" && r.write_off_status === "approved" ? (Number(r.quantity) || 0) * (Number(r.unit_cost) || 0) : 0;
    const add = round2((Number(r.restock_fee_aed) || 0) + writeOff);
    if (add > 0) out.set(r.job_id as string, round2((out.get(r.job_id as string) ?? 0) + add));
  }
  return out;
}
