import "server-only";
import { createAdminClient } from "./supabase/admin";
import { schemaReady } from "./schema-ready";
import { notifyRoles, notifyStaff } from "./notifications";
import { formatDate } from "./format";
import { recordSupplierPayment, applyAdvanceUses, advancesOf, openInvoicesOf } from "./supplier-payments";
import type { ExtraWaiting } from "@/components/WaitingPanel";

/*
 * 13 November 2026, Section 4: pay a supplier IN ADVANCE against an LPO (special orders: LPO-00058-2, TRADING
 * ENTERPRISES, the TRANSMISSION MOUNT for J-00317, AED 1,251.60 incl. VAT, waiting for its invoice).
 *  - The advance is ONE supplier payment with no invoice yet (the excess kept as an advance), naming its LPO.
 *  - The LPO shows "ADVANCE PAID AED … – date"; when the invoice is entered, accounts apply it with one tap
 *    (THE 11 November apply-advance step: applyAdvanceUses).
 *  - The parts desk may mark an LPO "Supplier needs payment first": accounts get the task, and once paid the parts
 *    desk is told "Paid: confirm the order with the supplier".
 *  - Zoho: the payment posts as a vendor payment with nothing applied (an advance), OFJ TEST only.
 */

export type LpoAdvance = { id: string; number: string; amount: number; paidOn: string; method: string; left: number };

export async function lpoAdvanceReady(): Promise<boolean> {
  return schemaReady("supplier_payments", "advance_for_po_id");
}

/** The advances paid for this LPO, with what is still unused of each. */
export async function advancesForPo(poId: string): Promise<LpoAdvance[]> {
  if (!(await lpoAdvanceReady())) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("supplier_payments").select("id, number, amount_aed, paid_on, method, supplier_id, supplier_name").eq("advance_for_po_id", poId).eq("status", "recorded").eq("is_active", true).order("paid_on");
  const rows = (data ?? []) as { id: string; number: string; amount_aed: number; paid_on: string; method: string; supplier_id: string | null; supplier_name: string }[];
  if (!rows.length) return [];
  const held = await advancesOf(rows[0].supplier_id, rows[0].supplier_name);
  return rows.map((r) => ({ id: r.id, number: r.number, amount: Number(r.amount_aed), paidOn: r.paid_on, method: r.method, left: held.find((h) => h.paymentId === r.id)?.left ?? 0 }));
}

/** "Customer deposit on this job: none received" / "… AED 2,000.00 received" (the pay window shows it). */
export async function customerDepositWords(jobId: string | null): Promise<string> {
  if (!jobId) return "Stock order: no customer.";
  const { data } = await createAdminClient().from("payments").select("amount_aed").eq("job_id", jobId).eq("status", "recorded").eq("is_active", true);
  const paid = ((data ?? []) as { amount_aed: number }[]).reduce((a, p) => a + Number(p.amount_aed || 0), 0);
  return paid > 0.004 ? `Customer deposit on this job: AED ${paid.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} received` : "Customer deposit on this job: none received";
}

type PayIn = { amount: number; method: string; paidOn: string; reference: string | null; proofPath: string | null; note: string | null };
type Actor = { id: string; display_name: string; role_id: string };

/** Records the advance for one LPO (owner and accounts). */
export async function payInAdvance(poId: string, input: PayIn, by: Actor): Promise<{ error?: string; words?: string; paymentId?: string }> {
  if (!(await lpoAdvanceReady())) return { error: "Paying in advance switches on once the database change is applied." };
  if (!["owner", "accounts"].includes(by.role_id)) return { error: "Only the owner or accounts pay a supplier." };
  const admin = createAdminClient();
  const { data: po } = await admin.from("purchase_orders").select("id, number, kind, status, job_id, supplier_id, supplier_name, supplier_invoice_status, pay_first_at, pay_first_by").eq("id", poId).maybeSingle();
  if (!po) return { error: "LPO not found." };
  if (po.kind === "main") return { error: "Pay against the supplier's own LPO (this one splits into one LPO per supplier)." };
  if (po.status === "cancelled") return { error: `${po.number} is cancelled.` };
  if (po.supplier_invoice_status === "received") return { error: `${po.number} already has its invoice: pay it in the payment box below (an advance is for before the invoice).` };
  if (!(input.amount > 0)) return { error: "Enter the amount paid." };
  const r = await recordSupplierPayment({ supplierId: po.supplier_id ?? null, supplierName: String(po.supplier_name), paidOn: input.paidOn, method: input.method, reference: input.reference, amount: input.amount, lines: [], excessKind: "advance", proofPath: input.proofPath, note: input.note ?? `Advance for ${po.number}` }, by);
  if (r.error || !r.id) return { error: r.error ?? "Couldn't save – nothing was recorded." };
  await admin.from("supplier_payments").update({ advance_for_po_id: po.id, updated_by: by.id }).eq("id", r.id);
  const words = `${r.number}: advance AED ${input.amount.toFixed(2)} paid to ${po.supplier_name} for ${po.number} on ${formatDate(input.paidOn)}`;
  if (po.job_id) await admin.from("job_events").insert({ job_id: po.job_id, event_type: "supplier_advance", note: `${words} (${by.display_name}).`, created_by: by.id });
  // The parts desk confirms the order with the supplier now (always told; the one who asked first is told by name).
  const notice = { type: "po_decided", title: `Paid: confirm the order with ${po.supplier_name}`, body: `${words}. Confirm the order with the supplier.`, href: `/parts/orders/${po.id}`, jobId: po.job_id ?? null };
  await notifyRoles(["parts"], notice);
  if (po.pay_first_by) await notifyStaff([String(po.pay_first_by)], notice).catch(() => null);
  return { words, paymentId: r.id };
}

/** The parts desk marks an LPO "Supplier needs payment first": accounts get the task. */
export async function markPayFirst(poId: string, note: string, by: Actor): Promise<{ error?: string; words?: string }> {
  if (!(await lpoAdvanceReady())) return { error: "This switches on once the database change is applied." };
  if (!["owner", "parts", "accounts"].includes(by.role_id)) return { error: "Only the parts desk, accounts or the owner can say the supplier needs payment first." };
  const admin = createAdminClient();
  const { data: po } = await admin.from("purchase_orders").select("id, number, job_id, supplier_name, total_cost_aed, pay_first_at").eq("id", poId).maybeSingle();
  if (!po) return { error: "LPO not found." };
  if (po.pay_first_at) return { words: `${po.number} is already marked: accounts have the task.` };
  await admin.from("purchase_orders").update({ pay_first_at: new Date().toISOString(), pay_first_by: by.id, pay_first_note: note.trim() || null, updated_by: by.id }).eq("id", poId);
  if (po.job_id) await admin.from("job_events").insert({ job_id: po.job_id, event_type: "supplier_pay_first", note: `${po.number}: ${po.supplier_name} needs payment first (${by.display_name})${note.trim() ? `: ${note.trim()}` : ""}.`, created_by: by.id });
  await notifyRoles(["accounts"], { type: "po_decided", title: `Pay first: ${po.number} · ${po.supplier_name}`, body: `The supplier wants payment before the order. ${note.trim()}`.trim(), href: `/parts/orders/${po.id}#advance`, jobId: po.job_id ?? null });
  return { words: `Accounts are told: ${po.supplier_name} needs payment first.` };
}

/** One tap once the invoice is entered: the advance pays this LPO's invoice (as much as it covers). */
export async function applyLpoAdvance(poId: string, by: Actor): Promise<{ error?: string; words?: string; paymentIds?: string[] }> {
  if (!["owner", "accounts"].includes(by.role_id)) return { error: "Only the owner or accounts apply an advance." };
  const admin = createAdminClient();
  const { data: po } = await admin.from("purchase_orders").select("id, number, supplier_id, supplier_name").eq("id", poId).maybeSingle();
  if (!po) return { error: "LPO not found." };
  const advances = (await advancesForPo(poId)).filter((a) => a.left > 0.004);
  if (!advances.length) return { error: "No advance left for this LPO." };
  const open = (await openInvoicesOf(po.supplier_id ?? null, String(po.supplier_name))).filter((i) => i.poId === poId || i.poId.startsWith(`${poId}`));
  const inv = open[0];
  if (!inv) return { error: `${po.number} has no invoice to pay yet (enter the supplier's invoice first).` };
  let due = Math.round(inv.due * 100) / 100;
  const uses: { paymentId: string; poId: string; amount: number }[] = [];
  for (const a of advances) {
    if (due <= 0.004) break;
    const amount = Math.min(a.left, due);
    uses.push({ paymentId: a.id, poId: inv.poId, amount: Math.round(amount * 100) / 100 });
    due = Math.round((due - amount) * 100) / 100;
  }
  const r = await applyAdvanceUses(po.supplier_id ?? null, String(po.supplier_name), uses, by);
  if (r.error) return { error: r.error };
  const used = uses.reduce((x, u) => x + u.amount, 0);
  return { words: due > 0.004 ? `Advance AED ${used.toFixed(2)} applied to ${po.number}: AED ${due.toFixed(2)} is still due.` : `Advance AED ${used.toFixed(2)} applied: ${po.number} is paid${advances.some((a) => a.left - used > 0.004) ? "; the rest stays as an advance with the supplier" : ""}.`, paymentIds: uses.map((u) => u.paymentId) };
}

/** Accounts' Waiting on you: "Pay first" tasks, and advances paid whose parts are late. */
export async function lpoAdvanceWaiting(): Promise<ExtraWaiting[]> {
  if (!(await lpoAdvanceReady())) return [];
  const admin = createAdminClient();
  const out: ExtraWaiting[] = [];
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const [{ data: firsts }, { data: adv }] = await Promise.all([
    admin.from("purchase_orders").select("id, number, supplier_name, total_cost_aed, pay_first_at, pay_first_note, status").not("pay_first_at", "is", null).neq("status", "cancelled"),
    admin.from("supplier_payments").select("id, number, amount_aed, paid_on, advance_for_po_id").not("advance_for_po_id", "is", null).eq("status", "recorded").eq("is_active", true),
  ]);
  const advRows = (adv ?? []) as { id: string; number: string; amount_aed: number; paid_on: string; advance_for_po_id: string }[];
  const paidPos = new Set(advRows.map((a) => a.advance_for_po_id));
  for (const po of (firsts ?? []) as { id: string; number: string; supplier_name: string; total_cost_aed: number; pay_first_at: string; pay_first_note: string | null }[]) {
    if (paidPos.has(po.id)) continue;
    out.push({ jobId: `payfirst:${po.id}`, plate: po.number, car: po.supplier_name, what: `Supplier needs payment first${po.pay_first_note ? ` – ${po.pay_first_note}` : ""}`, amount: null, actionLabel: "Pay in advance", href: `/parts/orders/${po.id}#advance`, always: true, urgency: "amber", money: "the supplier waits for payment before the order", since: po.pay_first_at, hint: "The parts desk cannot confirm the order until the supplier is paid." });
  }
  if (advRows.length) {
    const ids = Array.from(paidPos);
    const [{ data: pos }, { data: parts }] = await Promise.all([
      admin.from("purchase_orders").select("id, number, supplier_name, status, supplier_invoice_status").in("id", ids),
      admin.from("part_items").select("po_id, expected_date, order_status, is_active").in("po_id", ids).eq("is_active", true),
    ]);
    for (const po of (pos ?? []) as { id: string; number: string; supplier_name: string; status: string }[]) {
      if (po.status === "received" || po.status === "cancelled") continue;
      const ps = ((parts ?? []) as { po_id: string; expected_date: string | null; order_status: string }[]).filter((p) => p.po_id === po.id && !["received"].includes(p.order_status));
      const late = ps.filter((p) => p.expected_date && p.expected_date < today);
      if (!late.length) continue;
      const a = advRows.filter((x) => x.advance_for_po_id === po.id);
      const amount = a.reduce((x, y) => x + Number(y.amount_aed), 0);
      out.push({ jobId: `advlate:${po.id}`, plate: po.number, car: po.supplier_name, what: `Advance paid, part not received (expected ${formatDate(late.map((p) => p.expected_date!).sort()[0])})`, amount: `AED ${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, actionLabel: "Open the LPO", href: `/parts/orders/${po.id}#advance`, always: true, urgency: "amber", money: `advance AED ${amount.toFixed(2)} paid, part late`, since: a[0]?.paid_on ?? null, hint: "Ask the parts desk to chase the supplier, or ask for the money back." });
    }
  }
  return out;
}
