import "server-only";
import { createAdminClient } from "./supabase/admin";
import { logAppError } from "./app-errors";
import { chunks } from "./page-all";

/*
 * CANCELLED DOCUMENTS LEAVE THE ZOHO QUEUE (19 November 2026, Section 2; RCT-00091, a duplicate of AED 12,600.00
 * voided on 17 November, still waited in the queue). ONE rule for every document type:
 *  - cancelled or voided BEFORE it reached Zoho: withdrawn from the queue at once, kept in the history as
 *    "NOT SENT – CANCELLED BEFORE SYNC" (status synced with result.skipped, so the main Sync button never sends it);
 *  - cancelled or voided AFTER it reached Zoho: left to its handler, which takes it back out of Zoho (the reversal).
 * Called by every void / cancel / undo, by the Zoho page, the preview and the five-minute tick, and by the row runner
 * itself before any document is sent.
 */

export const CANCELLED_WORDS = "NOT SENT – CANCELLED BEFORE SYNC";

type Check = { table: string; select: string; why: (row: Record<string, unknown>) => string | null };

/** Per kind: where the source document lives and when it counts as cancelled (the words say why). */
const CHECKS: Record<string, Check> = {
  payment: { table: "payments", select: "id, number, status, is_active", why: (r) => (r.status === "voided" ? `${r.number} was voided` : r.status === "reversed" ? `${r.number} was reversed (bounced or never arrived)` : r.is_active === false ? `${r.number} was removed` : null) },
  deposit: { table: "payments", select: "id, number, status, is_active", why: (r) => (r.status === "voided" ? `${r.number} was voided` : r.status === "reversed" ? `${r.number} was reversed` : r.is_active === false ? `${r.number} was removed` : null) },
  supplierpay: { table: "supplier_payments", select: "id, number, status, is_active", why: (r) => (r.status === "void" ? `${r.number} was voided` : r.is_active === false ? `${r.number} was removed` : null) },
  invoice: { table: "invoices", select: "id, number, status, is_active", why: (r) => (r.status === "cancelled" ? `${r.number} was cancelled` : r.is_active === false ? `${r.number} was removed` : null) },
  creditnote: { table: "invoices", select: "id, number, status, is_active", why: (r) => (r.status === "cancelled" ? `${r.number} was cancelled` : null) },
  bill: { table: "purchase_orders", select: "id, number, status, is_active", why: (r) => (r.status === "cancelled" ? `${r.number} was cancelled` : r.is_active === false ? `${r.number} was removed` : null) },
  billpayment: { table: "purchase_orders", select: "id, number, supplier_paid_at", why: (r) => (!r.supplier_paid_at ? `"Paid to supplier" on ${r.number} was taken back` : null) },
  jv: { table: "journal_vouchers", select: "id, number, status, is_active", why: (r) => (r.status === "void" || r.status === "voided" ? `${r.number} was voided` : r.is_active === false ? `${r.number} was removed` : null) },
  settlement: { table: "card_settlements", select: "id, number, is_active", why: (r) => (r.is_active === false ? `${r.number} was undone` : null) },
  lathebill: { table: "lathe_bills", select: "id, bill_number, voided_at, is_active", why: (r) => (r.voided_at ? `lathe bill ${r.bill_number} was voided` : r.is_active === false ? `lathe bill ${r.bill_number} was removed` : null) },
  paygroup: { table: "payment_groups", select: "id, number, is_active", why: (r) => (r.is_active === false ? `${r.number} was voided` : null) },
  commission: { table: "commission_payments", select: "id, number, is_active", why: (r) => (r.is_active === false ? `${r.number} was voided` : null) },
};

/** Why the source of these queue rows is cancelled (key "<kind>:<id>"), only for the cancelled ones. */
export async function cancelledSources(rows: { kind: string; record_id: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const admin = createAdminClient();
  const byKind = new Map<string, string[]>();
  for (const r of rows) if (CHECKS[r.kind]) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.record_id]);
  for (const [kind, ids] of byKind) {
    const c = CHECKS[kind];
    for (const part of chunks(Array.from(new Set(ids)))) {
      const { data, error } = await admin.from(c.table).select(c.select).in("id", part);
      if (error) {
        await logAppError("zoho-cancelled: read", error);
        continue;
      }
      for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
        const w = c.why(row);
        if (w) out.set(`${kind}:${row.id}`, w);
      }
    }
  }
  return out;
}

/**
 * Withdraw the queue rows (not yet in Zoho) whose source is cancelled: "NOT SENT – CANCELLED BEFORE SYNC", kept in the
 * history. A row already in Zoho is left alone: its handler reverses it. Returns how many were withdrawn.
 */
export async function withdrawCancelled(filter: { kind?: string; recordId?: string } = {}, by: { id?: string | null; name?: string | null } = {}): Promise<number> {
  const admin = createAdminClient();
  let q = admin.from("zoho_outbox").select("id, kind, record_id, zoho_id, status").in("status", ["pending", "failed"]).is("zoho_id", null).limit(2000);
  if (filter.kind) q = q.eq("kind", filter.kind);
  if (filter.recordId) q = q.eq("record_id", filter.recordId);
  const { data, error } = await q;
  if (error) {
    await logAppError("zoho-cancelled: queue", error);
    return 0;
  }
  const rows = ((data ?? []) as { id: string; kind: string; record_id: string }[]).filter((r) => CHECKS[r.kind]);
  if (!rows.length) return 0;
  const why = await cancelledSources(rows);
  let n = 0;
  const now = new Date().toISOString();
  for (const r of rows) {
    const reason = why.get(`${r.kind}:${r.record_id}`);
    if (!reason) continue;
    const { data: done } = await admin
      .from("zoho_outbox")
      .update({ status: "synced", synced_at: now, last_error: null, claimed_at: null, zoho_result: { skipped: `${CANCELLED_WORDS}: ${reason} before it reached Zoho. Nothing was sent.`, cancelled_before_sync: { at: now, why: reason, by: by.name ?? null } }, updated_at: now })
      .eq("id", r.id)
      .in("status", ["pending", "failed"])
      .is("zoho_id", null)
      .is("claimed_at", null)
      .select("id");
    if (done?.length) n++;
  }
  return n;
}

/** The queue rows of documents cancelled AFTER they reached Zoho and not reversed yet (the read-only check). */
export async function cancelledInZoho(): Promise<{ id: string; kind: string; record_id: string; why: string }[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("zoho_outbox").select("id, kind, record_id, zoho_id, zoho_result").not("zoho_id", "is", null).limit(5000);
  const rows = ((data ?? []) as { id: string; kind: string; record_id: string; zoho_result: Record<string, unknown> | null }[]).filter((r) => CHECKS[r.kind] && !(r.zoho_result && (r.zoho_result.reversed || r.zoho_result.manual)));
  const why = await cancelledSources(rows);
  return rows.filter((r) => why.has(`${r.kind}:${r.record_id}`)).map((r) => ({ id: r.id, kind: r.kind, record_id: r.record_id, why: why.get(`${r.kind}:${r.record_id}`)! }));
}
