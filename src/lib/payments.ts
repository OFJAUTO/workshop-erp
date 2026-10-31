import "server-only";
import { SAVE_FAILED, logAppError } from "@/lib/app-errors";
import { jobAdvisorIds as advisorsInCharge } from "@/lib/notifications";
import { INVOICE_SELECT, PAYMENT_SELECT, invoiceBalance, toInvoice, toPayment, type PaymentRow } from "./invoice-data";
import { round2 } from "./money";
import { notifyRoles, notifyStaff } from "./notifications";
import { bankFeesOf, getSettings, type Settings } from "./settings";
import { feesFor } from "./bank-fees";
import { convertProformaIfPaid, createDepositInvoice } from "./invoice-flow";
import { depositState } from "./deposits";
import { approvedQuotations } from "./quote-data";
import { formatPlate } from "./types";
import { createAdminClient } from "./supabase/admin";
import { flagZohoAttention, tryEnqueueZoho, zohoPostedSomewhere } from "./zoho-sync";
import { AUTH_CODE_RE, authCodeProblem, cleanAuthCode, needsAuthCode } from "./auth-code";

/** Who records: a staff member, or the payment gateway (no id). */
export type Actor = { id: string | null; display_name: string; role_id: string; is_head_accountant?: boolean };
export type PaymentInput = { invoiceId: string | null; jobId: string | null; method: string; amount: number; reference?: string | null; /** The bank's 6-character auth code (card machine and payment link): required when staff record one. */ authCode?: string | null; cheque?: { number: string | null; bank: string | null; date: string | null } | null; notes?: string | null; clientKey?: string | null };
export type PaymentResult = { error?: string; ok?: boolean; number?: string; paymentId?: string; pendingOwner?: boolean; message?: string; /** The same client key was already used: this is that earlier receipt (its amount and method). */ repeat?: { amount: number; method: string } };

const money = (n: number) => `AED ${round2(n).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

async function advisorsOf(jobId: string) {
  return advisorsInCharge(jobId);
}

/** After a payment, a void or a cheque change: the job is Ready when the invoice is settled, pending payment otherwise. */
export async function settleJob(jobId: string, invoiceId: string, by: string | null, settings?: Settings) {
  const admin = createAdminClient();
  const [{ data: inv }, { data: pays }, { data: job }] = await Promise.all([
    admin.from("invoices").select(INVOICE_SELECT).eq("id", invoiceId).maybeSingle(),
    admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", invoiceId).eq("is_active", true),
    admin.from("jobs").select("status, is_open").eq("id", jobId).maybeSingle(),
  ]);
  if (!inv || !job || !job.is_open) return;
  const invoice = toInvoice(inv as Record<string, unknown>);
  const bal = invoiceBalance(invoice, ((pays ?? []) as Record<string, unknown>[]).map(toPayment));
  // A proforma paid in full becomes the tax invoice; the job is Ready.
  if (invoice.kind === "proforma" && !invoice.converted_to && bal.balance <= 0.005) {
    const tax = await convertProformaIfPaid(jobId, by, settings ?? (await getSettings()));
    if (tax) {
      if (job.status === "pending_payment") await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: "pending_payment", to_status: "ready", note: "Proforma paid in full", created_by: by });
      return;
    }
  }
  if (job.status === "pending_payment" && bal.balance <= 0) {
    await admin.from("jobs").update({ status: "ready" }).eq("id", jobId);
    await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: "pending_payment", to_status: "ready", note: "Invoice paid in full", created_by: by });
  } else if (job.status === "ready" && bal.balance > 0) {
    await admin.from("jobs").update({ status: "pending_payment" }).eq("id", jobId);
  }
}

/**
 * One payment, one receipt. The same payment sent twice within a minute is refused; a payment above
 * the balance waits for the owner (who may record it himself); a payment recorded by an advisor waits
 * for accounts to verify it, which never holds up the car.
 */
export async function recordPaymentCore(actor: Actor, input: PaymentInput, settings: Settings): Promise<PaymentResult> {
  const admin = createAdminClient();
  const method = input.method;
  if (!["cash", "card", "link", "cheque", "transfer"].includes(method)) return { error: "Choose the payment method." };
  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter the amount received." };
  // The auth code (29 October 2026): staff type it from the slip or the confirmation; the gateway may send its own.
  const authCode = input.authCode ? cleanAuthCode(input.authCode) : null;
  if (needsAuthCode(method) && actor.id) {
    const problem = authCodeProblem(method, authCode ?? "");
    if (problem) return { error: problem };
  } else if (authCode && !AUTH_CODE_RE.test(authCode)) return { error: authCodeProblem(method, authCode) ?? "Check the auth code." };
  // The same tap twice: the second one is the same payment.
  if (input.clientKey) {
    const { data: same } = await admin.from("payments").select("id, number, amount_aed, method").eq("client_key", input.clientKey).maybeSingle();
    if (same) return { ok: true, number: same.number, paymentId: same.id, message: `${same.number} was already recorded.`, repeat: { amount: Number(same.amount_aed), method: String(same.method) } };
  }
  let jobId = input.jobId;
  let customerId: string | null = null;
  let balance: number | null = null;
  if (input.invoiceId) {
    const { data: inv } = await admin.from("invoices").select(INVOICE_SELECT).eq("id", input.invoiceId).maybeSingle();
    if (!inv || inv.status !== "issued" || !["tax_invoice", "proforma"].includes(String(inv.kind))) return { error: "Invoice not found." };
    const invoice = toInvoice(inv as Record<string, unknown>);
    if (invoice.converted_to) return { error: `${invoice.number} became a tax invoice. Record the payment against the tax invoice.` };
    jobId = invoice.job_id;
    customerId = invoice.customer_id;
    const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", invoice.id).eq("is_active", true);
    const rows = ((pays ?? []) as Record<string, unknown>[]).map(toPayment);
    balance = invoiceBalance(invoice, rows).balance;
    // Recorded twice: same amount and method on this invoice within a minute.
    const dup = rows.find((p) => p.status === "recorded" && p.method === method && Math.abs(p.amount_aed - amount) < 0.005 && Date.now() - Date.parse(p.received_at) < 60000);
    if (dup) return { error: `${dup.number} for ${money(amount)} by ${method} was recorded a moment ago. Not recorded twice.` };
    if (balance <= 0.005) return { error: "This invoice is paid in full." };
  } else if (jobId) {
    const { data: job } = await admin.from("jobs").select("customer_id").eq("id", jobId).maybeSingle();
    customerId = job?.customer_id ?? null;
    const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).eq("job_id", jobId).is("invoice_id", null).eq("is_active", true);
    const dup = ((pays ?? []) as Record<string, unknown>[]).map(toPayment).find((p) => p.status === "recorded" && p.method === method && Math.abs(p.amount_aed - amount) < 0.005 && Date.now() - Date.parse(p.received_at) < 60000);
    if (dup) return { error: `${dup.number} for ${money(amount)} by ${method} was recorded a moment ago. Not recorded twice.` };
  }
  if (!customerId) return { error: "Choose the invoice or the job." };
  // One transaction, one auth code: the same code on another live receipt of this method (last 60 days) is a slip.
  if (authCode && needsAuthCode(method) && !input.clientKey?.startsWith("ngenius:")) {
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    const { data: twin } = await admin.from("payments").select("number, amount_aed, received_at").eq("auth_code", authCode).eq("method", method).eq("is_active", true).neq("status", "voided").gte("received_at", since).limit(1).maybeSingle();
    if (twin) return { error: `Auth code ${authCode} is already on ${twin.number} (${money(Number(twin.amount_aed) || 0)}). Check the ${method === "link" ? "payment confirmation" : "card slip"}.` };
  }
  const cheque = method === "cheque" ? { cheque_number: input.cheque?.number ?? null, cheque_bank: input.cheque?.bank ?? null, cheque_date: input.cheque?.date ?? null, cheque_status: "pending" as const } : {};
  if (method === "cheque" && (!cheque.cheque_number || !cheque.cheque_date)) return { error: "A cheque needs its number and date." };
  // A payment with no invoice is a deposit on the job: it points at the approved quotation it was asked for on.
  const depositQuoteId = input.invoiceId || !jobId ? null : ((await approvedQuotations(jobId))[0]?.id ?? null);
  const over = balance !== null && amount > balance + 0.005;
  const isOwner = actor.role_id === "owner";
  if (over && !isOwner) {
    // Staff cannot record more than the balance: it waits for the owner.
    const fees = feesFor(amount, bankFeesOf(settings)[method]);
    const { data: created, error } = await admin.from("payments").insert({ job_id: jobId, invoice_id: input.invoiceId, customer_id: customerId, method, amount_aed: amount, deposit_quotation_id: depositQuoteId, reference: input.reference ?? null, auth_code: needsAuthCode(method) ? authCode : null, ...cheque, bank_charge_aed: fees.cost, fee_msf_aed: fees.msf, fee_txn_aed: fees.txn, fee_vat_aed: fees.vat, is_deposit: !input.invoiceId, received_by: actor.id, notes: input.notes ?? null, status: "pending_owner", approval_requested_by: actor.id, client_key: input.clientKey ?? null, created_by: actor.id, updated_by: actor.id }).select("id, number").single();
    if (error || !created) {
      await logAppError("record payment: insert (above balance)", error ?? new Error("no row"), { staffId: actor.id, jobId, detail: { method, amount } });
      return { error: SAVE_FAILED };
    }
    await notifyRoles(["owner"], { type: "overpayment_approval", title: `Payment above the balance needs your approval · ${created.number}`, body: `${actor.display_name} wants to record ${money(amount)} by ${method}; the balance is ${money(balance ?? 0)}.`, jobId, href: input.invoiceId ? `/invoices/${input.invoiceId}` : jobId ? `/jobs/${jobId}/invoice` : "/invoices" });
    if (jobId) await admin.from("job_events").insert({ job_id: jobId, event_type: "payment", note: `${created.number}: ${money(amount)} by ${method} is above the balance of ${money(balance ?? 0)}; waiting for the owner's approval (asked by ${actor.display_name})`, created_by: actor.id });
    return { ok: true, pendingOwner: true, number: created.number, paymentId: created.id, message: `${created.number} is above the balance. The owner has been asked to approve it.` };
  }
  // The bank's fee as estimated at recording (bank-fees.ts): MSF, fee per transaction and VAT apart; the job's cost is MSF + fee.
  const fees = feesFor(amount, bankFeesOf(settings)[method]);
  const verifies = actor.role_id === "owner" || actor.role_id === "accounts";
  const now = new Date().toISOString();
  const { data: created, error } = await admin.from("payments").insert({ job_id: jobId, invoice_id: input.invoiceId, customer_id: customerId, method, amount_aed: amount, deposit_quotation_id: depositQuoteId, reference: input.reference ?? null, auth_code: needsAuthCode(method) ? authCode : null, ...cheque, bank_charge_aed: fees.cost, fee_msf_aed: fees.msf, fee_txn_aed: fees.txn, fee_vat_aed: fees.vat, is_deposit: !input.invoiceId, received_by: actor.id, notes: input.notes ?? null, status: "recorded", client_key: input.clientKey ?? null, verified_at: verifies ? now : null, verified_by: verifies ? actor.id : null, ...(over ? { approved_by: actor.id, approved_at: now } : {}), created_by: actor.id, updated_by: actor.id }).select("id, number").single();
  if (error || !created) {
    await logAppError("record payment: insert", error ?? new Error("no row"), { staffId: actor.id, jobId, detail: { method, amount } });
    return { error: SAVE_FAILED };
  }
  // The receipt is written: what follows never turns it into a "failed" save for staff (logged instead).
  try {
    if (jobId) await admin.from("job_events").insert({ job_id: jobId, event_type: "payment", note: `${created.number}: ${money(amount)} by ${method}${method === "cheque" ? " (pending clearance)" : ""}${input.invoiceId ? "" : " as a deposit"} received by ${actor.display_name}${over ? " (above the balance, owner)" : ""}`, created_by: actor.id });
    // Money arrived: "Customer says paid" is answered.
    if (input.invoiceId) await admin.from("invoices").update({ customer_says_paid_at: null, updated_by: actor.id }).eq("id", input.invoiceId).not("customer_says_paid_at", "is", null);
    if (input.invoiceId && jobId) await settleJob(jobId, input.invoiceId, actor.id, settings);
    if (!input.invoiceId && jobId) await afterDepositRecorded(jobId, String(created.id), amount, actor, settings);
    // Zoho Books (one-way): the recorded money joins the outbox; a cheque waits until it clears.
    if (method !== "cheque") await tryEnqueueZoho(input.invoiceId ? "payment" : "deposit", String(created.id), jobId ?? null, actor.id);
    if (jobId) await notifyStaff(await advisorsOf(jobId), { type: "payment_received", title: `Payment received · ${created.number}`, body: `${money(amount)} by ${method}${input.invoiceId ? "" : " (deposit)"}`, jobId, href: input.invoiceId ? `/invoices/${input.invoiceId}` : `/jobs/${jobId}` });
    if (!verifies) await notifyRoles(["accounts"], { type: "payment_verify", title: `Payment to verify · ${created.number}`, body: `${actor.display_name} recorded ${money(amount)} by ${method}. Tick it once the money is confirmed.`, jobId, href: input.invoiceId ? `/invoices/${input.invoiceId}` : "/invoices" });
    if (over) await notifyRoles(["owner"], { type: "payment_void", title: `Payment above the balance recorded · ${created.number}`, body: `${money(amount)} by ${method} against a balance of ${money(balance ?? 0)}.`, jobId, href: input.invoiceId ? `/invoices/${input.invoiceId}` : "/invoices" });
  } catch (err) {
    await logAppError(`record payment: after ${created.number}`, err, { staffId: actor.id, jobId, detail: { paymentId: created.id } });
  }
  return { ok: true, number: created.number, paymentId: created.id, message: `${created.number} recorded.${method === "cheque" ? " The cheque counts as unpaid until it clears." : ""}` };
}

/**
 * A deposit arrived: once it covers what the quotation asked for, Parts and the owner hear that the LPO can be
 * approved. Settings may ask for a tax invoice for the deposit as well (the receipt is always there).
 */
async function afterDepositRecorded(jobId: string, paymentId: string, amount: number, actor: Actor, settings: Settings) {
  await tellDepositCovered(jobId);
  if (settings.deposit_document === "tax_invoice") await createDepositInvoice(jobId, paymentId, amount, { id: actor.id, display_name: actor.display_name }, settings).catch(() => null);
}

/**
 * Once the deposit is covered (a cheque only once it has cleared), Parts and the owner hear that the LPO can be
 * approved. Called when a deposit is recorded and when a deposit cheque clears (26 October 2026).
 */
export async function tellDepositCovered(jobId: string) {
  const admin = createAdminClient();
  const st = await depositState(jobId);
  if (st.required > 0 && !st.short) {
    const [{ data: pending }, { data: job }] = await Promise.all([
      admin.from("purchase_orders").select("id, number").eq("job_id", jobId).eq("status", "pending_approval").eq("is_active", true).order("created_at").limit(1).maybeSingle(),
      admin.from("jobs").select("job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant)").eq("id", jobId).maybeSingle(),
    ]);
    const vehicle = (job?.vehicle as unknown as Parameters<typeof formatPlate>[0] | null) ?? null;
    const plate = vehicle ? formatPlate(vehicle) : (job?.job_number ?? "");
    await notifyRoles(["parts", "owner"], { type: "deposit_received", title: `Deposit received: LPO can be approved · ${plate}`, body: `${money(st.received)} received of ${money(st.required)} asked on ${st.quotationNumbers.join(", ")}.${pending ? ` ${pending.number} is waiting for approval.` : ""}`, jobId, href: pending ? `/parts/orders/${pending.id}` : `/parts/${jobId}` });
  }
}

/** A wrong receipt is never deleted: the owner or the head accountant voids it with a reason; it stays visible, struck through. */
export async function voidPayment(paymentId: string, actor: Actor, reason: string): Promise<PaymentResult> {
  const admin = createAdminClient();
  if (!actor.id || !(actor.role_id === "owner" || (actor.role_id === "accounts" && actor.is_head_accountant))) return { error: "Only the owner or the head accountant can void a receipt." };
  const clean = reason.trim().slice(0, 300);
  if (clean.length < 3) return { error: "Write the reason for the void." };
  const { data: raw } = await admin.from("payments").select(`${PAYMENT_SELECT}, zoho_payment_id`).eq("id", paymentId).maybeSingle();
  if (!raw) return { error: "Receipt not found." };
  const p = toPayment(raw as Record<string, unknown>);
  if (p.status === "voided") return { error: "Already voided." };
  if (p.settlement_id) {
    const { data: st } = await admin.from("card_settlements").select("number").eq("id", p.settlement_id).maybeSingle();
    return { error: `${p.number} is part of the bank settlement ${(st as { number: string } | null)?.number ?? ""}. Undo that settlement on Card settlements first, then void the receipt.` };
  }
  await admin.from("payments").update({ status: "voided", void_reason: clean, voided_by: actor.id, voided_at: new Date().toISOString(), updated_by: actor.id }).eq("id", paymentId);
  // A receipt that already reached a Zoho book cannot be unposted from here: the row turns red for accounts to fix
  // by hand — including, after go-live, one that sits in the REAL book's opening balances.
  const where = (raw as Record<string, unknown>).zoho_payment_id ? "current" : await zohoPostedSomewhere(["deposit", "payment"], paymentId, p.method === "cheque" ? (p.cleared_at ?? p.received_at) : p.received_at);
  if (where) {
    await flagZohoAttention(
      p.is_deposit ? "deposit" : "payment",
      paymentId,
      where === "opening"
        ? `${p.number} was voided after go-live; it reached OFJ TEST before the start date and sits in the REAL book's opening balances: reverse it there by hand, then press "Done by hand". Reason: ${clean}`
        : `${p.number} was voided in the ERP after it reached Zoho: remove the payment in Zoho by hand, then press "Done by hand". Reason: ${clean}`,
      { handOnly: where === "opening" },
    );
  }
  if (p.job_id) await admin.from("job_events").insert({ job_id: p.job_id, event_type: "payment_void", note: `${p.number} (${money(p.amount_aed)}) voided by ${actor.display_name}: ${clean}`, created_by: actor.id });
  if (p.job_id && p.invoice_id) await settleJob(p.job_id, p.invoice_id, actor.id);
  await notifyRoles(["owner"], { type: "payment_void", title: `Receipt voided · ${p.number}`, body: `${money(p.amount_aed)} voided by ${actor.display_name}: ${clean}`, jobId: p.job_id, href: p.invoice_id ? `/invoices/${p.invoice_id}` : "/invoices" });
  return { ok: true, number: p.number, message: `${p.number} voided.` };
}

/** Accounts tick a payment once the money is confirmed. */
export async function verifyPayment(paymentId: string, actor: Actor): Promise<PaymentResult> {
  if (!actor.id || !(actor.role_id === "owner" || actor.role_id === "accounts")) return { error: "Only accounts verify payments." };
  const admin = createAdminClient();
  const { error } = await admin.from("payments").update({ verified_at: new Date().toISOString(), verified_by: actor.id, updated_by: actor.id }).eq("id", paymentId).is("verified_at", null);
  return error ? { error: error.message } : { ok: true, message: "Verified." };
}

/** The owner approves a payment above the balance (it becomes a recorded receipt) or refuses it (voided). */
export async function decideOverpayment(paymentId: string, actor: Actor, approve: boolean, note: string | null): Promise<PaymentResult> {
  if (!actor.id || actor.role_id !== "owner") return { error: "Only the owner approves a payment above the balance." };
  const admin = createAdminClient();
  const { data: raw } = await admin.from("payments").select(PAYMENT_SELECT).eq("id", paymentId).maybeSingle();
  if (!raw) return { error: "Payment not found." };
  const p = toPayment(raw as Record<string, unknown>) as PaymentRow;
  if (p.status !== "pending_owner") return { error: "This payment is not waiting for approval." };
  const now = new Date().toISOString();
  if (approve) {
    await admin.from("payments").update({ status: "recorded", approved_by: actor.id, approved_at: now, verified_at: now, verified_by: actor.id, updated_by: actor.id }).eq("id", paymentId);
    if (p.job_id) await admin.from("job_events").insert({ job_id: p.job_id, event_type: "payment", note: `${p.number}: ${money(p.amount_aed)} above the balance approved by ${actor.display_name}${note ? `: ${note}` : ""}`, created_by: actor.id });
    if (p.job_id && p.invoice_id) await settleJob(p.job_id, p.invoice_id, actor.id);
    if (p.method !== "cheque" || p.cheque_status === "cleared") await tryEnqueueZoho(p.is_deposit ? "deposit" : "payment", paymentId, p.job_id, actor.id);
    if (p.approval_requested_by) await notifyStaff([p.approval_requested_by], { type: "payment_void", title: `Payment approved · ${p.number}`, body: `${money(p.amount_aed)} is recorded.`, jobId: p.job_id, href: p.invoice_id ? `/invoices/${p.invoice_id}` : "/invoices" });
    return { ok: true, message: `${p.number} recorded.` };
  }
  await admin.from("payments").update({ status: "voided", void_reason: `Not approved by the owner${note ? `: ${note}` : ""}`, voided_by: actor.id, voided_at: now, updated_by: actor.id }).eq("id", paymentId);
  if (p.job_id) await admin.from("job_events").insert({ job_id: p.job_id, event_type: "payment_void", note: `${p.number}: ${money(p.amount_aed)} above the balance refused by ${actor.display_name}${note ? `: ${note}` : ""}`, created_by: actor.id });
  if (p.approval_requested_by) await notifyStaff([p.approval_requested_by], { type: "payment_void", title: `Payment not approved · ${p.number}`, body: note ?? "The owner did not approve the amount above the balance.", jobId: p.job_id, href: p.invoice_id ? `/invoices/${p.invoice_id}` : "/invoices" });
  return { ok: true, message: `${p.number} refused and voided.` };
}
