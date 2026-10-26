import "server-only";
import { depositsWaiting } from "./deposits";
import { payableCommissions, proofMissingPayments } from "./commissions";
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
      urgency: "red",
      since: p.received_at,
      hint: "Cash was taken: tick it once the money is counted and banked.",
      inline: { kind: "confirm_payment", paymentId: p.id },
    });
  }

  // 1b. Cheques recorded and still clearing (deposits and payments): "Cleared" right on the row (26 October 2026).
  const { data: chequeRows } = await admin.from("payments").select(PAYMENT_SELECT + `, job:jobs(job_number, vehicle:vehicles(${PLATE_SELECT}))`).eq("is_active", true).eq("status", "recorded").eq("method", "cheque").eq("cheque_status", "pending");
  for (const raw of (chequeRows ?? []) as unknown as Record<string, unknown>[]) {
    const p = toPayment(raw);
    const job = raw.job as { job_number: string; vehicle: PlateRow | null } | null;
    out.push({
      jobId: p.job_id ?? `cheque:${p.id}`,
      plate: job?.vehicle ? formatPlate(job.vehicle) : (job?.job_number ?? p.number),
      car: null,
      what: `Cheque${p.cheque_number ? ` ${p.cheque_number}` : ""} (${p.number}) to clear when the bank confirms`,
      amount: aed(p.amount_aed),
      actionLabel: "Cleared",
      href: p.job_id ? `/jobs/${p.job_id}/invoice` : p.invoice_id ? `/invoices/${p.invoice_id}` : "/invoices",
      always: true,
      replaces: true,
      urgency: "amber",
      since: p.cheque_date ?? p.received_at,
      hint: "The cheque is recorded. Tap Cleared once the bank confirms the money; a bounced cheque is reversed from the money page.",
      inline: { kind: "cheque_clear", paymentId: p.id },
    });
  }

  // 2. Deposits asked for and not yet received: one line per job, the Record deposit panel right there.
  for (const d of await depositsWaiting()) {
    out.push({
      jobId: d.jobId,
      plate: d.plate,
      car: [d.carTitle, d.customer].filter(Boolean).join(" · ") || null,
      what: `Deposit to record (${d.quotation})`,
      amount: aed(round2(d.required - d.received)),
      actionLabel: "Record the deposit",
      href: `/jobs/${d.jobId}/invoice`,
      always: true,
      replaces: true,
      urgency: "red",
      since: d.approvedAt,
      hint: `The customer approved ${d.quotation} ${d.hours} h ago with a deposit of ${aed(d.required)}; ${aed(d.received)} received so far.`,
      inline: { kind: "record_deposit", deposit: { jobId: d.jobId, plate: d.plate, car: d.carTitle, customer: d.customer, quote: d.quotation, requested: d.required, received: d.received, outstanding: round2(Math.max(0, d.required - d.received)) } },
    });
  }

  // 3. LPOs waiting for the one-tap approval.
  const { data: lpos } = await admin.from("purchase_orders").select("id, number, supplier_name, total_cost_aed, kind, created_at").eq("status", "pending_approval").eq("is_active", true);
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
      urgency: "amber",
      since: po.created_at as string,
      hint: "One tap approves it on the LPO page; Parts then order from each supplier.",
    });
  }

  // 4. Supplier invoices: still to follow, or prices to check against the LPO.
  const { data: toFollow } = await admin.from("purchase_orders").select("id, number, supplier_name, received_at, created_at").eq("supplier_invoice_status", "to_follow").eq("is_active", true).neq("status", "cancelled");
  for (const po of toFollow ?? []) {
    out.push({ jobId: `inv:${po.id}`, plate: po.number as string, car: po.supplier_name as string, what: "Supplier invoice missing", amount: null, actionLabel: "Open the LPO", href: `/parts/orders/${po.id}`, always: true, urgency: "amber", since: (po.received_at ?? po.created_at) as string, hint: "Chase the supplier and enter the invoice number and date; the LPO cannot be paid without them." });
  }
  const { data: mismatch } = await admin.from("purchase_order_lines").select("po_id, po:purchase_orders(number, supplier_name, is_active)").eq("invoice_check", "mismatch");
  const seenPo = new Set<string>();
  for (const l of mismatch ?? []) {
    const po = l.po as unknown as { number: string; supplier_name: string; is_active: boolean } | null;
    if (!po?.is_active || seenPo.has(l.po_id as string)) continue;
    seenPo.add(l.po_id as string);
    out.push({ jobId: `chk:${l.po_id}`, plate: po.number, car: po.supplier_name, what: "Invoice price differs from the LPO", amount: null, actionLabel: "Check", href: `/parts/orders/${l.po_id}`, always: true, urgency: "amber", hint: "Accept the new price or dispute it, line by line, on the LPO page." });
  }

  // 4b. Commissions approved by the owner whose customer invoice is settled: payable today.
  {
    const payable = await payableCommissions();
    for (const c of payable) {
      out.push({ jobId: `comm:${c.quotationId}`, plate: c.plate, car: c.recipient, what: `Commission to pay (${c.quotation})`, amount: aed(c.amount), actionLabel: "Open Commissions", href: "/commissions", always: true, urgency: "amber", since: c.decidedAt ?? c.setAt, hint: `Approved by the owner; ${c.customerPaidWhy}. Pay it on the Commissions page (cash prints a voucher to sign).` });
    }
    // 4c. Paid without the signed voucher or the bank slip: amber until the proof is uploaded.
    for (const p of await proofMissingPayments()) {
      out.push({ jobId: `comproof:${p.id}`, plate: p.number, car: p.recipient, what: `Commission paid – proof missing (${p.method === "cash" ? "signed voucher" : "bank slip"})`, amount: aed(p.amount), actionLabel: "Upload proof", href: "/commissions", always: true, urgency: "amber", hint: "Open Commissions and upload the signed voucher photo or the bank slip on the paid row." });
    }
  }

  // 5. Recovery: claimed trips to approve, and a month ready to pay.
  const { data: claimed } = await admin.from("recovery_trips").select("id").eq("status", "claimed").eq("is_active", true);
  if (claimed?.length) {
    out.push({ jobId: "recovery:claimed", plate: "Recovery", car: null, what: `${claimed.length} trip${claimed.length === 1 ? "" : "s"} claimed by the drivers`, amount: null, actionLabel: "Open Recovery", href: "/recovery", always: true, urgency: "grey", hint: "Approve or query each claimed trip; the month is paid once every trip is settled." });
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
      out.push({ jobId: `payout:${who}`, plate: who, car: null, what: `Recovery month ready to pay`, amount: aed(g.total), actionLabel: "Mark paid", href: "/recovery", always: true, urgency: "grey", hint: "Every trip is approved: pay the month and it locks." });
    }
  }

  // 6. Zoho Books: a document that failed to post needs a human (phase 1, 26 October 2026).
  const { data: zoho } = await admin.from("zoho_outbox").select("id, kind, last_error, enqueued_at").eq("status", "failed").order("enqueued_at").limit(20);
  for (const z of (zoho ?? []) as { id: string; kind: string; last_error: string | null; enqueued_at: string }[]) {
    const kindWord = z.kind === "invoice" ? "Tax invoice" : z.kind === "contact" ? "Customer" : z.kind === "deposit" ? "Deposit" : "Payment";
    out.push({ jobId: `zoho:${z.id}`, plate: "Zoho Books", car: null, what: `${kindWord} did not post: ${(z.last_error ?? "see the sync page").slice(0, 140)}`, amount: null, actionLabel: "Open the sync page", href: "/zoho?show=failed", always: true, urgency: "amber", since: z.enqueued_at });
  }
  return out;
}
