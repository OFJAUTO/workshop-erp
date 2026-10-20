import "server-only";
import { depositsWaiting } from "./deposits";
import { PAYMENT_SELECT, toPayment } from "./invoice-data";
import { round2 } from "./money";
import type { ExtraWaiting } from "@/components/WaitingPanel";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

const PLATE_SELECT = "kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant";
type PlateRow = Parameters<typeof formatPlate>[0];

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Everything accounts must act on, for the WAITING ON YOU box (20 October 2026, part 2): cash taken that
 * still needs confirming and banking (deposits included), deposits requested and not yet received, LPOs
 * waiting for the one-tap approval, supplier invoices still to follow or to check, recovery trips to
 * approve and a month ready to pay. The proformas awaiting payment come from the base list already.
 */
export async function accountsWaitingExtra(): Promise<ExtraWaiting[]> {
  const admin = createAdminClient();
  const out: ExtraWaiting[] = [];

  // 1. Cash in the drawer: recorded, not yet confirmed and banked (deposits and payments alike).
  const { data: payRows } = await admin.from("payments").select(PAYMENT_SELECT + `, job:jobs(job_number, vehicle:vehicles(${PLATE_SELECT}))`).eq("is_active", true).eq("status", "recorded").is("verified_at", null).eq("method", "cash");
  for (const raw of (payRows ?? []) as unknown as Record<string, unknown>[]) {
    const p = toPayment(raw);
    const job = raw.job as { job_number: string; vehicle: PlateRow | null } | null;
    const plate = job?.vehicle ? formatPlate(job.vehicle) : (job?.job_number ?? p.number);
    out.push({
      jobId: p.job_id ?? `payment:${p.id}`,
      plate,
      car: null,
      what: `Cash ${p.invoice_id ? "payment" : "deposit"} ${p.number} to confirm and bank`,
      amount: aed(p.amount_aed),
      actionLabel: "Confirm & bank",
      href: p.job_id ? `/jobs/${p.job_id}/invoice` : p.invoice_id ? `/invoices/${p.invoice_id}` : "/invoices",
      always: true,
    });
  }

  // 2. Deposits asked for and not yet received.
  for (const d of await depositsWaiting()) {
    out.push({
      jobId: d.jobId,
      plate: d.plate,
      car: d.customer,
      what: `Deposit not received yet (${d.quotation}, approved ${d.hours} h ago)`,
      amount: aed(round2(d.required - d.received)),
      actionLabel: "Open the job",
      href: `/jobs/${d.jobId}/invoice`,
      always: true,
    });
  }

  // 3. LPOs waiting for the one-tap approval.
  const { data: lpos } = await admin.from("purchase_orders").select("id, number, supplier_name, total_cost_aed, kind").eq("status", "pending_approval").eq("is_active", true);
  for (const po of lpos ?? []) {
    out.push({
      jobId: `lpo:${po.id}`,
      plate: po.number as string,
      car: po.kind === "main" ? "every supplier" : (po.supplier_name as string),
      what: "LPO waiting for approval",
      amount: aed(Number(po.total_cost_aed) || 0),
      actionLabel: "Approve",
      href: `/parts/orders/${po.id}`,
      always: true,
    });
  }

  // 4. Supplier invoices: still to follow, or prices to check against the LPO.
  const { data: toFollow } = await admin.from("purchase_orders").select("id, number, supplier_name").eq("supplier_invoice_status", "to_follow").eq("is_active", true).neq("status", "cancelled");
  for (const po of toFollow ?? []) {
    out.push({ jobId: `inv:${po.id}`, plate: po.number as string, car: po.supplier_name as string, what: "Supplier invoice to follow: chase it and enter the number and date", amount: null, actionLabel: "Open the LPO", href: `/parts/orders/${po.id}`, always: true });
  }
  const { data: mismatch } = await admin.from("purchase_order_lines").select("po_id, po:purchase_orders(number, supplier_name, is_active)").eq("invoice_check", "mismatch");
  const seenPo = new Set<string>();
  for (const l of mismatch ?? []) {
    const po = l.po as unknown as { number: string; supplier_name: string; is_active: boolean } | null;
    if (!po?.is_active || seenPo.has(l.po_id as string)) continue;
    seenPo.add(l.po_id as string);
    out.push({ jobId: `chk:${l.po_id}`, plate: po.number, car: po.supplier_name, what: "Supplier invoice price differs from the LPO: accept or dispute", amount: null, actionLabel: "Check", href: `/parts/orders/${l.po_id}`, always: true });
  }

  // 5. Recovery: claimed trips to approve, and a month ready to pay.
  const { data: claimed } = await admin.from("recovery_trips").select("id").eq("status", "claimed").eq("is_active", true);
  if (claimed?.length) {
    out.push({ jobId: "recovery:claimed", plate: "Recovery", car: null, what: `${claimed.length} trip${claimed.length === 1 ? "" : "s"} claimed by the drivers: approve or query`, amount: null, actionLabel: "Open Recovery", href: "/recovery", always: true });
  }
  const month = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const { data: monthTrips } = await admin.from("recovery_trips").select("id, company, driver_name, price_aed, status, delivered_at, created_at").eq("is_active", true);
  const inMonth = (monthTrips ?? []).filter((t) => String(t.delivered_at ?? t.created_at).startsWith(month));
  const byWho = new Map<string, { total: number; open: number }>();
  for (const t of inMonth) {
    const who = (t.company as string | null) ?? (t.driver_name ? `Our truck · ${t.driver_name}` : "Our truck");
    const g = byWho.get(who) ?? { total: 0, open: 0 };
    g.total += Number(t.price_aed) || 0;
    if (t.status !== "approved" && t.status !== "paid") g.open++;
    byWho.set(who, g);
  }
  if (byWho.size) {
    const { data: paid } = await admin.from("recovery_payouts").select("who").eq("month", month);
    const paidSet = new Set((paid ?? []).map((p) => p.who as string));
    for (const [who, g] of byWho) {
      if (g.open || paidSet.has(who) || !(g.total > 0)) continue;
      out.push({ jobId: `payout:${who}`, plate: who, car: null, what: `Every trip approved: the month is ready to pay`, amount: aed(g.total), actionLabel: "Mark paid", href: "/recovery", always: true });
    }
  }
  return out;
}
