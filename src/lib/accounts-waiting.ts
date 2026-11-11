import { lpoAmounts } from "./supplier-vat";
import { loadReviews, openReviewOf, reviewWords } from "@/lib/lpo-review";
import { supplierMoneyText } from "./supplier-money";
import "server-only";
import { loadSupplierInvoices } from "./supplier-invoices";
import { invWords } from "./supplier-invoice-rows";
import { depositsWaiting } from "./deposits";
import { payableCommissions, proofMissingPayments } from "./commissions";
import { PAYMENT_SELECT, toPayment } from "./invoice-data";
import { round2 } from "./money";
import type { ExtraWaiting } from "@/components/WaitingPanel";
import { createAdminClient } from "./supabase/admin";
import { loadUnsettled } from "./card-settlements";
import { formatPlate } from "./types";
import { formatDate } from "./format";
import { unallocatedOf } from "./customer-money";
import { kindWord } from "./zoho-sync-rules";
import { zohoWaitingExtra } from "./zoho-manual";

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
  const month = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  // 11 November 2026 (Section 16, speed): every section's reads start at once (they were one after another: about 35
  // database round trips in a row on the accounts dashboard); the lines are built in the same order as before.
  const [
    { data: payRows },
    { data: chequeRows },
    deposits,
    lpoLines,
    { data: toFollow },
    { data: mismatch },
    siLoad,
    payable,
    proofMissing,
    { data: claimed },
    { data: monthTrips },
    { data: paid },
    { data: zoho },
    zohoWaiting,
    unsettled,
    { data: redDays },
    unallocated,
  ] = await Promise.all([
    admin.from("payments").select(PAYMENT_SELECT + `, job:jobs(job_number, vehicle:vehicles(${PLATE_SELECT}))`).eq("is_active", true).eq("status", "recorded").is("verified_at", null).eq("method", "cash"),
    admin.from("payments").select(PAYMENT_SELECT + `, job:jobs(job_number, vehicle:vehicles(${PLATE_SELECT}))`).eq("is_active", true).eq("status", "recorded").in("method", ["cheque", "transfer"]).eq("cheque_status", "pending"),
    depositsWaiting(),
    lpoApprovalsWaiting(),
    admin.from("purchase_orders").select("id, number, supplier_name, received_at, created_at").eq("supplier_invoice_status", "to_follow").eq("is_active", true).neq("status", "cancelled"),
    admin.from("purchase_order_lines").select("po_id, po:purchase_orders(number, supplier_name, is_active)").eq("invoice_check", "mismatch"),
    loadSupplierInvoices(),
    payableCommissions(),
    proofMissingPayments(),
    admin.from("recovery_trips").select("id").eq("status", "claimed").eq("is_active", true),
    admin.from("recovery_trips").select("id, company, driver_name, price_aed, status, delivered_at, created_at").eq("is_active", true),
    admin.from("recovery_payouts").select("who").eq("month", month),
    admin.from("zoho_outbox").select("id, kind, last_error, enqueued_at").eq("status", "failed").order("enqueued_at").limit(20),
    zohoWaitingExtra(),
    loadUnsettled(),
    admin.from("zoho_reconciliation").select("day, checked_at").eq("status", "red").order("day", { ascending: false }).limit(5),
    unallocatedOf(),
  ]);

  // 1. Cash in the drawer: recorded, not yet confirmed and banked (deposits and payments alike).
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
      urgency: "amber",
      money: `cash ${aed(p.amount_aed)} taken, not banked yet`,
      since: p.received_at,
      hint: "Cash was taken: tick it once the money is counted and banked.",
      inline: { kind: "confirm_payment", paymentId: p.id },
    });
  }

  // 1b. Cheques and (from 9 November 2026) bank transfers still waiting for the bank: Accounts posting records the day
  // they reach the bank (no date is ever assumed), so the row opens its tab.
  for (const raw of (chequeRows ?? []) as unknown as Record<string, unknown>[]) {
    const p = toPayment(raw);
    const job = raw.job as { job_number: string; vehicle: PlateRow | null } | null;
    out.push({
      jobId: p.job_id ?? `cheque:${p.id}`,
      plate: job?.vehicle ? formatPlate(job.vehicle) : (job?.job_number ?? p.number),
      car: null,
      what: p.method === "cheque" ? `Cheque${p.cheque_number ? ` ${p.cheque_number}` : ""} (${p.number}) to deposit and clear` : `Bank transfer (${p.number}) to confirm in the bank`,
      amount: aed(p.amount_aed),
      actionLabel: p.method === "cheque" ? "Mark deposited / cleared" : "Confirm in bank",
      href: `/accounts-posting?tab=${p.method}`,
      always: true,
      replaces: true,
      urgency: "amber",
      since: p.cheque_date ?? p.received_at,
      hint: p.method === "cheque" ? "The cheque is recorded. Mark it deposited, then cleared on the day it shows on the statement; a bounced cheque reverses the payment." : "The transfer is recorded. Confirm it with the amount that reached the bank.",
    });
  }

  // 2. Deposits asked for and not yet received: one line per job, the Record deposit panel right there.
  for (const d of deposits) {
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
      urgency: "amber",
      since: d.approvedAt,
      hint: `The customer approved ${d.quotation} ${d.hours} h ago with a deposit of ${aed(d.required)}; ${aed(d.received)} received so far.`,
      inline: { kind: "record_deposit", deposit: { jobId: d.jobId, plate: d.plate, car: d.carTitle, customer: d.customer, quote: d.quotation, requested: d.required, received: d.received, outstanding: round2(Math.max(0, d.required - d.received)) } },
    });
  }

  // 3. LPOs waiting for the one-tap approval (the same lines as the owner sees).
  out.push(...lpoLines);

  // 4. Supplier invoices: still to follow, or prices to check against the LPO.
  for (const po of toFollow ?? []) {
    out.push({ jobId: `inv:${po.id}`, plate: po.number as string, car: po.supplier_name as string, what: "Supplier invoice missing", amount: null, actionLabel: "Open the LPO", href: `/parts/orders/${po.id}`, always: true, urgency: "amber", since: (po.received_at ?? po.created_at) as string, hint: "Chase the supplier and enter the invoice number and date; the LPO cannot be paid without them." });
  }
  const seenPo = new Set<string>();
  for (const l of mismatch ?? []) {
    const po = l.po as unknown as { number: string; supplier_name: string; is_active: boolean } | null;
    if (!po?.is_active || seenPo.has(l.po_id as string)) continue;
    seenPo.add(l.po_id as string);
    out.push({ jobId: `chk:${l.po_id}`, plate: po.number, car: po.supplier_name, what: "Invoice price differs from the LPO", amount: null, actionLabel: "Check", href: `/parts/orders/${l.po_id}`, always: true, urgency: "amber", hint: "Accept the new price or dispute it, line by line, on the LPO page." });
  }

  // 4a. Supplier invoices that arrived and are not checked yet (1 November 2026): one line each until accounts check them.
  {
    const { rows } = siLoad;
    for (const r of rows.filter((x) => x.status === "new")) {
      out.push({ jobId: `si:${r.key}`, plate: r.number ? invWords(r.number) : "Supplier invoice", car: r.supplier, what: `Supplier invoice to check · ${r.shares.map((x) => x.poNumber).join(", ")}${r.duplicateOf ? " · possible duplicate" : ""}`, amount: aed(r.total), actionLabel: "Check", href: `/supplier-invoices?open=${encodeURIComponent(r.key)}`, always: true, urgency: "amber", money: r.duplicateOf ? `possible duplicate of ${r.duplicateOf} – it could be paid twice` : null, since: r.at ?? undefined, hint: "Open it next to the parts it covers, then Mark checked (the bill goes to Zoho) or Query it with Parts." });
    }
    // 4 November 2026: parts received with the invoice still to come - ACCOUNTS collect the paper from Parts and scan it.
    for (const r of rows.filter((x) => x.status === "waiting" && !x.notReceived)) {
      const share = r.shares[0];
      out.push({ jobId: `sicollect:${r.key}`, plate: share ? share.poNumber : "LPO", car: r.supplier, what: `Parts received from ${r.supplier}${share?.jobNumber ? ` for ${share.jobNumber}` : ""}${share?.plate ? ` · ${share.plate}` : ""} – collect the supplier's invoice from Parts and scan it`, amount: aed(r.total), actionLabel: "Scan & enter", href: `/supplier-invoices?open=${encodeURIComponent(r.key)}`, always: true, urgency: "amber", since: r.at ?? undefined, hint: "The paper is at the parts desk. Open the row, Scan document (or attach the PDF), Read the scan, check the figures and save - then Mark checked." });
    }
    // Fix 4 (4 November 2026): a supplier paid without the proof of payment on file - one amber line until it is uploaded.
    for (const r of rows.filter((x) => x.proofMissing)) {
      out.push({ jobId: `siproof:${r.key}`, plate: r.number ? invWords(r.number) : "Supplier payment", car: r.supplier, what: `Paid to supplier – proof of payment missing (${r.shares.filter((s) => s.paidAt && !s.proofPath).map((s) => s.poNumber).join(", ")})`, amount: aed(r.paidAmount || r.total), actionLabel: "Upload proof", href: `/supplier-invoices?open=${encodeURIComponent(r.key)}`, always: true, urgency: "amber", since: r.paidAt ?? undefined, hint: "Open the invoice and upload the bank slip or card slip on the paid LPO's line." });
    }
  }

  // 4b. Commissions approved by the owner whose customer invoice is settled: payable today.
  {
    for (const c of payable) {
      out.push({ jobId: `comm:${c.quotationId}`, plate: c.plate, car: c.recipient, what: `Commission to pay (${c.quotation})`, amount: aed(c.amount), actionLabel: "Open Commissions", href: "/commissions", always: true, urgency: "amber", since: c.decidedAt ?? c.setAt, hint: `Approved by the owner; ${c.customerPaidWhy}. Pay it on the Commissions page (cash prints a voucher to sign).` });
    }
    // 4c. Paid without the signed voucher or the bank slip: amber until the proof is uploaded.
    for (const p of proofMissing) {
      out.push({ jobId: `comproof:${p.id}`, plate: p.number, car: p.recipient, what: `Commission paid – proof missing (${p.method === "cash" ? "signed voucher" : "bank slip"})`, amount: aed(p.amount), actionLabel: "Upload proof", href: "/commissions", always: true, urgency: "amber", hint: "Open Commissions and upload the signed voucher photo or the bank slip on the paid row." });
    }
  }

  // 5. Recovery: claimed trips to approve, and a month ready to pay.
  if (claimed?.length) {
    out.push({ jobId: "recovery:claimed", plate: "Recovery", car: null, what: `${claimed.length} trip${claimed.length === 1 ? "" : "s"} claimed by the drivers`, amount: null, actionLabel: "Open Recovery", href: "/recovery", always: true, urgency: "grey", hint: "Approve or query each claimed trip; the month is paid once every trip is settled." });
  }
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
    const paidSet = new Set((paid ?? []).map((p) => p.who as string));
    for (const [who, g] of byWho) {
      if (g.open || paidSet.has(who) || !(g.total > 0)) continue;
      out.push({ jobId: `payout:${who}`, plate: who, car: null, what: `Recovery month ready to pay`, amount: aed(g.total), actionLabel: "Mark paid", href: "/recovery", always: true, urgency: "grey", hint: "Every trip is approved: pay the month and it locks." });
    }
  }

  // 6. Zoho Books: a red row needs a human — some never posted, some posted and then changed in the ERP
  // (a void, a bounce, a credit note), so the reason itself carries the action, not a "did not post" prefix.
  for (const z of (zoho ?? []) as { id: string; kind: string; last_error: string | null; enqueued_at: string }[]) {
    out.push({ jobId: `zoho:${z.id}`, plate: "Zoho Books", car: null, what: `${kindWord(z.kind)}: ${(z.last_error ?? "see the sync page").slice(0, 140)}`, amount: null, actionLabel: "Open the sync page", href: "/zoho?show=failed", always: true, urgency: "amber", since: z.enqueued_at });
  }
  // 6b. Zoho Books on manual (3 November 2026): what waits for Sync to Zoho, one line with the button behind it.
  out.push(...zohoWaiting);

  // 8. Card and payment-link money still in the clearing account three working days after it was taken: the bank
  // should have paid it out; record the settlement (27 October 2026). One amber row per method.
  const late = unsettled.filter((p) => p.late);
  for (const method of ["card", "link"] as const) {
    const mine = late.filter((p) => p.method === method);
    if (!mine.length) continue;
    const total = round2(mine.reduce((a, p) => a + p.amount, 0));
    out.push({ jobId: `settle:${method}`, plate: method === "card" ? "Card machine" : "Payment link", car: null, what: `${mine.length} ${method === "card" ? "card" : "payment-link"} payment${mine.length === 1 ? "" : "s"} not settled after 3 working days`, amount: aed(total), actionLabel: "Record the settlement", href: `/accounts-posting?method=${method}`, always: true, urgency: "amber", since: mine[0].receivedAt, hint: "Match the bank's payout on the statement, then record what actually came in: the real fee replaces the estimate on each job." });
  }

  // 7. A red reconciliation day (phase 4): the books differ somewhere until someone looks.
  for (const d of (redDays ?? []) as { day: string; checked_at: string }[]) {
    out.push({ jobId: `recon:${d.day}`, plate: "Zoho Books", car: null, what: `Reconciliation differs on ${formatDate(`${String(d.day).slice(0, 10)}T12:00:00Z`)}`, amount: null, actionLabel: "Open the reconciliation", href: "/zoho/reconciliation", always: true, urgency: "amber", since: d.checked_at });
  }
  // 9. Money on a customer's account, not allocated to any job yet (1 November 2026): one line each, with its age.
  for (const p of unallocated) {
    if (p.status !== "recorded") continue;
    out.push({
      jobId: `unallocated:${p.id}`,
      plate: p.plate ?? p.customerName,
      car: p.car,
      what: `${p.number} not allocated – ${p.customerName}${p.notes ? ` (for: ${p.notes})` : ""}`,
      amount: aed(p.amount_aed),
      actionLabel: "Allocate",
      href: `/customers/${p.customer_id}`,
      always: true,
      urgency: p.ageDays >= 7 ? "red" : "amber",
      since: p.received_at,
      hint: "Money paid with no job to put it on yet. Allocate it to the job or invoice it is for.",
    });
  }
  return out;
}

/**
 * Every LPO waiting for approval, one line each, for the owner and accounts (1 November 2026: additions to an LPO that
 * waits, and the new approval request for parts added after an approval, included). A job LPO names the job.
 */
export async function lpoApprovalsWaiting(viewer: "owner" | "accounts" = "accounts"): Promise<ExtraWaiting[]> {
  const admin = createAdminClient();
  // The job number is read on its own: an unhinted purchase_orders → jobs embed is ambiguous and fails silently.
  const { data: lpos } = await admin.from("purchase_orders").select("id, number, supplier_id, supplier_name, total_cost_aed, kind, created_at, job_id").eq("status", "pending_approval").eq("is_active", true).order("created_at");
  const jobIds = Array.from(new Set((lpos ?? []).map((p) => p.job_id as string | null).filter((x): x is string => !!x)));
  // Supplier amounts with VAT (5 November 2026): the amount being approved, exactly as the approval screen shows it.
  const rows = (lpos ?? []) as { id: string; number: string; supplier_id?: string | null; supplier_name: string; total_cost_aed: number | string; kind: string; created_at: string; job_id: string | null }[];
  // Send for owner approval (10 November 2026, Section 4): the owner's line carries the accounts note.
  // 11 November 2026 (Section 16): the three reads at the same time.
  const [{ data: jobs }, amounts, reviews] = await Promise.all([
    jobIds.length ? admin.from("jobs").select("id, job_number").in("id", jobIds) : Promise.resolve({ data: [] as { id: string; job_number: string }[] }),
    lpoAmounts(rows.map((p) => ({ id: p.id, kind: p.kind, status: "pending_approval", supplier_id: p.supplier_id ?? null, supplier_name: p.supplier_name, total_cost_aed: Number(p.total_cost_aed) || 0 }))),
    loadReviews(rows.map((p) => p.id)),
  ]);
  const numberOf = new Map((jobs ?? []).map((j) => [j.id as string, j.job_number as string]));
  return rows.map((po) => {
    const r = openReviewOf(reviews, po.id);
    if (r) return {
      jobId: `lpo:${po.id}`,
      plate: po.number,
      car: [po.job_id ? numberOf.get(po.job_id) : null, r.supplier ?? po.supplier_name].filter(Boolean).join(" · "),
      what: reviewWords(r),
      amount: amounts.get(po.id) ? supplierMoneyText(amounts.get(po.id)!) : aed(Number(po.total_cost_aed) || 0),
      actionLabel: r.status === "waiting" ? (viewer === "owner" ? "Decide" : "Open") : (viewer === "owner" ? "Open" : "Decide"),
      href: `/parts/orders/${po.id}#owner-review`,
      always: true,
      urgency: (r.reminded_at ? "red" : "amber") as "red" | "amber",
      since: r.created_at,
      hint: r.status === "waiting" ? `Accounts: ${r.note}` : `The owner replied: ${r.reply ?? ""}`,
    };
    return {
    jobId: `lpo:${po.id}`,
    plate: po.number,
    car: [po.job_id ? numberOf.get(po.job_id) : null, po.supplier_name].filter(Boolean).join(" · "),
    what: "LPO waiting for approval",
    amount: amounts.get(po.id) ? supplierMoneyText(amounts.get(po.id)!) : aed(Number(po.total_cost_aed) || 0),
    actionLabel: "Approve",
    href: `/parts/orders/${po.id}`,
    always: true,
    urgency: "amber" as const,
    since: po.created_at,
    hint: "One tap approves it on the LPO page (or refuse one line with its reason); Parts then order from each supplier.",
  };
  });
}
