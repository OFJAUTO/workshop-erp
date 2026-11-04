import "server-only";
import { DEFAULT_UNDO_MINUTES, mayUndo } from "./money-undo";
import { afterPendingChargePayment } from "./charges";
import { afterEstimatePayment, estimateOfInvoice } from "./estimate-money";
import { SAVE_FAILED, logAppError } from "@/lib/app-errors";
import { jobAdvisorIds as advisorsInCharge } from "@/lib/notifications";
import { INVOICE_SELECT, PAYMENT_SELECT, creditsOnDocs, invoiceBalance, toInvoice, toPayment, type PaymentRow } from "./invoice-data";
import { round2 } from "./money";
import { notifyRoles, notifyStaff } from "./notifications";
import { bankFeesOf, getSettings, type Settings } from "./settings";
import { feesFor } from "./bank-fees";
import { convertProformaIfPaid, createDepositInvoice } from "./invoice-flow";
import { depositState } from "./deposits";
import { approvedQuotations } from "./quote-data";
import { formatPlate } from "./types";
import { createAdminClient } from "./supabase/admin";
import { flagZohoAttention, reopenZoho, tryEnqueueZoho, zohoPostedSomewhere } from "./zoho-sync";
import { AUTH_CODE_RE, authCodeMissing, authCodeProblem, authCodeRefusal, authCodeWhere, cleanAuthCode, isFakeAuthCode, needsAuthCode, realAuthCode } from "./auth-code";
import { jobMoneyOf } from "./customer-money";
import { newToken } from "./media";
import { paymentsAnytimeReady } from "./schema-ready";

/** Who records: a staff member, or the payment gateway (no id). */
export type Actor = { id: string | null; display_name: string; role_id: string; is_head_accountant?: boolean };
export type PaymentInput = {
  invoiceId: string | null;
  jobId: string | null;
  method: string;
  amount: number;
  reference?: string | null;
  /**
   * The bank's 6-character auth code (card machine and payment link). Optional since 3 November 2026: left empty or made
   * up ("111111"), the payment is saved with no code and flagged "Auth code missing"; a wrong length is refused.
   */
  authCode?: string | null;
  cheque?: { number: string | null; bank: string | null; date: string | null } | null;
  notes?: string | null;
  clientKey?: string | null;
  /** 1 November 2026: no job and no invoice - an UNALLOCATED ADVANCE on this customer's account (`notes` says what it is for). */
  unallocated?: { customerId: string; vehicleId?: string | null } | null;
  /** Why the payment is more than what is left (refund or credit). Required above the balance; logged. */
  overNote?: string | null;
  /** Measure an advance on a job against the approved total (the Record payment forms). The deposit panel keeps its own rule. */
  overCheck?: boolean;
  /** Recorded from an advisor's payment report (2 November 2026, section 3): the report is closed by this receipt. */
  reportId?: string | null;
};
export type PaymentResult = { error?: string; ok?: boolean; number?: string; paymentId?: string; pendingOwner?: boolean; message?: string; /** The same client key was already used: this is that earlier receipt (its amount and method). */ repeat?: { amount: number; method: string }; /** More than what is left and no note yet: the form asks for one. */ needsOverNote?: { balance: number }; token?: string | null };

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
  // 3 November 2026: credit notes on a tax invoice lower what is owed (the one money rule).
  const credit = invoice.kind === "tax_invoice" ? ((await creditsOnDocs([invoice.id])).get(invoice.id) ?? 0) : 0;
  const bal = invoiceBalance(invoice, ((pays ?? []) as Record<string, unknown>[]).map(toPayment), credit);
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
  // Optional since 3 November 2026 (RCT-00040 "111111"): empty or made up is stored as no code ("Auth code missing",
  // flagged); only a typed code of the wrong length is refused.
  const typedCode = cleanAuthCode(input.authCode);
  if (typedCode && !AUTH_CODE_RE.test(typedCode)) return { error: authCodeProblem(method, typedCode) ?? "Check the auth code: 6 letters or digits." };
  const authCode = needsAuthCode(method) ? realAuthCode(typedCode) : null;
  const codeMissing = needsAuthCode(method) && !authCode;
  // The same tap twice: the second one is the same payment.
  if (input.clientKey) {
    const { data: same } = await admin.from("payments").select("id, number, amount_aed, method").eq("client_key", input.clientKey).maybeSingle();
    if (same) return { ok: true, number: same.number, paymentId: same.id, message: `${same.number} was already recorded.`, repeat: { amount: Number(same.amount_aed), method: String(same.method) } };
  }
  let jobId = input.jobId;
  let customerId: string | null = null;
  let balance: number | null = null;
  let vehicleId: string | null = null;
  const anytime = await paymentsAnytimeReady();
  if (input.invoiceId) {
    const { data: inv } = await admin.from("invoices").select(INVOICE_SELECT).eq("id", input.invoiceId).maybeSingle();
    if (!inv || inv.status !== "issued" || !["tax_invoice", "proforma"].includes(String(inv.kind))) return { error: "Invoice not found." };
    const invoice = toInvoice(inv as Record<string, unknown>);
    if (invoice.converted_to) return { error: `${invoice.number} became a tax invoice. Record the payment against the tax invoice.` };
    jobId = invoice.job_id;
    customerId = invoice.customer_id;
    // The receipt names the car for a job-less invoice too (estimate proformas, pending charges).
    vehicleId = (invoice.vehicle_id as string | null) ?? null;
    const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", invoice.id).eq("is_active", true);
    const rows = ((pays ?? []) as Record<string, unknown>[]).map(toPayment);
    const credit = invoice.kind === "tax_invoice" ? ((await creditsOnDocs([invoice.id])).get(invoice.id) ?? 0) : 0;
    balance = invoiceBalance(invoice, rows, credit).balance;
    // Recorded twice: same amount and method on this invoice within a minute.
    const dup = rows.find((p) => p.status === "recorded" && p.method === method && Math.abs(p.amount_aed - amount) < 0.005 && Date.now() - Date.parse(p.received_at) < 60000);
    if (dup) return { error: `${dup.number} for ${money(amount)} by ${method} was recorded a moment ago. Not recorded twice.` };
  } else if (jobId) {
    const { data: job } = await admin.from("jobs").select("customer_id, vehicle_id").eq("id", jobId).maybeSingle();
    customerId = job?.customer_id ?? null;
    vehicleId = (job?.vehicle_id as string | null) ?? null;
    const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).eq("job_id", jobId).is("invoice_id", null).eq("is_active", true);
    const dup = ((pays ?? []) as Record<string, unknown>[]).map(toPayment).find((p) => p.status === "recorded" && p.method === method && Math.abs(p.amount_aed - amount) < 0.005 && Date.now() - Date.parse(p.received_at) < 60000);
    if (dup) return { error: `${dup.number} for ${money(amount)} by ${method} was recorded a moment ago. Not recorded twice.` };
    // Before the proforma: what is left is the approved total less every advance already in (null while nothing is approved).
    if (input.overCheck) balance = (await jobMoneyOf(jobId, settings))?.balance ?? null;
  } else if (input.unallocated?.customerId) {
    // 1 November 2026: no job to attach it to - saved on the customer's account with a note of what it is for.
    if (!anytime) return { error: "Saving a payment on the customer's account needs the database update of 1 November. Ask the owner to apply it." };
    const { data: cust } = await admin.from("customers").select("id").eq("id", input.unallocated.customerId).maybeSingle();
    if (!cust) return { error: "Customer not found." };
    customerId = String(cust.id);
    if (input.unallocated.vehicleId) {
      const { data: car } = await admin.from("vehicles").select("id, customer_id").eq("id", input.unallocated.vehicleId).maybeSingle();
      if (!car || car.customer_id !== customerId) return { error: "That car is not this customer's." };
      vehicleId = String(car.id);
    }
    if (!input.notes || input.notes.trim().length < 3) return { error: "Write what the payment is for (it is kept with the payment until it is allocated)." };
    const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).eq("customer_id", customerId).is("job_id", null).is("invoice_id", null).eq("is_active", true);
    const dup = ((pays ?? []) as Record<string, unknown>[]).map(toPayment).find((p) => p.status === "recorded" && p.method === method && Math.abs(p.amount_aed - amount) < 0.005 && Date.now() - Date.parse(p.received_at) < 60000);
    if (dup) return { error: `${dup.number} for ${money(amount)} by ${method} was recorded a moment ago. Not recorded twice.` };
  }
  if (!customerId) return { error: "Choose where the payment goes: a job, its invoice, or the customer's account." };
  // One transaction, one auth code: the same REAL code on another live receipt of this method (last 60 days) is a slip.
  if (authCode && !input.clientKey?.startsWith("ngenius:")) {
    const twin = await authCodeTwin(authCode, method, null);
    if (twin) return { error: twin };
  }
  const cheque = method === "cheque" ? { cheque_number: input.cheque?.number ?? null, cheque_bank: input.cheque?.bank ?? null, cheque_date: input.cheque?.date ?? null, cheque_status: "pending" as const } : {};
  if (method === "cheque" && (!cheque.cheque_number || !cheque.cheque_date)) return { error: "A cheque needs its number and date." };
  // A payment with no invoice is a deposit on the job: it points at the approved quotation it was asked for on.
  const depositQuoteId = input.invoiceId || !jobId ? null : ((await approvedQuotations(jobId))[0]?.id ?? null);
  const over = balance !== null && amount > balance + 0.005;
  const isOwner = actor.role_id === "owner";
  // More than what is left (1.7, 1 November 2026): allowed with a note of why (a refund to make, credit to keep), logged
  // and told to the owner. The gateway (no person) never waits: its money is real.
  const overNote = input.overNote?.trim().slice(0, 500) || (over && !actor.id ? "Paid online above the balance" : null);
  if (over && !overNote) return { error: `More than what is left (${money(balance ?? 0)}). Write why – a refund to make or credit to keep. It is logged.`, needsOverNote: { balance: balance ?? 0 } };
  const notes = [input.notes?.trim() || null, over ? `Above the balance of ${money(balance ?? 0)}: ${overNote}` : null].filter(Boolean).join(" · ") || null;
  // The bank's fee as estimated at recording (bank-fees.ts): MSF, fee per transaction and VAT apart; the job's cost is MSF + fee.
  const fees = feesFor(amount, bankFeesOf(settings)[method]);
  const verifies = actor.role_id === "owner" || actor.role_id === "accounts";
  const now = new Date().toISOString();
  // Every receipt carries its own link token, so a receipt with no invoice or quotation still reaches the customer.
  const token = newToken();
  const { data: created, error } = await admin.from("payments").insert({ job_id: jobId, invoice_id: input.invoiceId, customer_id: customerId, method, amount_aed: amount, deposit_quotation_id: depositQuoteId, reference: input.reference ?? null, auth_code: needsAuthCode(method) ? authCode : null, ...cheque, bank_charge_aed: fees.cost, fee_msf_aed: fees.msf, fee_txn_aed: fees.txn, fee_vat_aed: fees.vat, is_deposit: !input.invoiceId, received_by: actor.id, notes, status: "recorded", client_key: input.clientKey ?? null, token, verified_at: verifies ? now : null, verified_by: verifies ? actor.id : null, ...(over ? { approved_by: actor.id, approved_at: now } : {}), ...(anytime ? { vehicle_id: vehicleId } : {}), created_by: actor.id, updated_by: actor.id }).select("id, number").single();
  if (error || !created) {
    await logAppError("record payment: insert", error ?? new Error("no row"), { staffId: actor.id, jobId, detail: { method, amount } });
    return { error: SAVE_FAILED };
  }
  // The receipt is written: what follows never turns it into a "failed" save for staff (logged instead).
  try {
    const codeWords = codeMissing ? ` · auth code missing${isFakeAuthCode(typedCode) ? ` (${typedCode} typed, not a real code)` : ""}` : "";
    if (jobId) await admin.from("job_events").insert({ job_id: jobId, event_type: "payment", note: `${created.number}: ${money(amount)} by ${method}${method === "cheque" ? " (pending clearance)" : ""}${input.invoiceId ? "" : " as an advance"} received by ${actor.display_name}${over ? ` (above the balance of ${money(balance ?? 0)}: ${overNote})` : ""}${codeWords}`, created_by: actor.id });
    // Money arrived: "Customer says paid" is answered.
    if (input.invoiceId) await admin.from("invoices").update({ customer_says_paid_at: null, updated_by: actor.id }).eq("id", input.invoiceId).not("customer_says_paid_at", "is", null);
    if (input.invoiceId && jobId) await settleJob(jobId, input.invoiceId, actor.id, settings);
    if (input.invoiceId && !jobId) await afterPendingChargePayment(input.invoiceId, actor.id ? { id: actor.id, display_name: actor.display_name, role_id: actor.role_id } : null, settings);
    // An estimate's proforma paid before the car arrives: the tax invoice follows by itself (4 November 2026).
    // A pending cheque never converts (invoiceBalance counts cleared money only); the cheque-clear action re-checks.
    if (input.invoiceId && !jobId) await afterEstimatePayment(input.invoiceId, actor.id ? { id: actor.id, display_name: actor.display_name } : null, settings);
    if (!input.invoiceId && jobId) await afterDepositRecorded(jobId, String(created.id), amount, actor, settings);
    // Zoho Books (one-way): the recorded money joins the outbox; a cheque waits until it clears.
    if (method !== "cheque") await tryEnqueueZoho(input.invoiceId ? "payment" : "deposit", String(created.id), jobId ?? null, actor.id);
    if (jobId) await notifyStaff(await advisorsOf(jobId), { type: "payment_received", title: `Payment received · ${created.number}`, body: `${money(amount)} by ${method}${input.invoiceId ? "" : " (deposit)"}`, jobId, href: input.invoiceId ? `/invoices/${input.invoiceId}` : `/jobs/${jobId}` });
    if (!verifies) await notifyRoles(["accounts"], { type: "payment_verify", title: `Payment to verify · ${created.number}`, body: `${actor.display_name} recorded ${money(amount)} by ${method}. Tick it once the money is confirmed.`, jobId, href: input.invoiceId ? `/invoices/${input.invoiceId}` : "/invoices" });
    // An advisor's payment report is answered by its receipt: the one it was recorded from, or one waiting on this job for
    // the same amount and method (recorded another way). Its advisor hears "Recorded ✓ RCT-…".
    if (jobId) {
      const { afterReceiptForReports } = await import("./payment-reports");
      await afterReceiptForReports({ id: String(created.id), number: String(created.number), amount, method, jobId, authCode, reference: input.reference ?? (method === "cheque" ? (input.cheque?.number ?? null) : null) }, input.reportId ?? null, { id: actor.id, display_name: actor.display_name }).catch((e) => logAppError(`record payment: report after ${created.number}`, e, { staffId: actor.id, jobId }));
    } else if (input.invoiceId) {
      // A payment on an ESTIMATE's proforma (car not here yet, 4 November 2026) answers the advisor's report too.
      const est = await estimateOfInvoice(input.invoiceId).catch(() => null);
      if (est) {
        const { afterReceiptForReports } = await import("./payment-reports");
        await afterReceiptForReports({ id: String(created.id), number: String(created.number), amount, method, estimateId: est.estimateId, authCode, reference: input.reference ?? (method === "cheque" ? (input.cheque?.number ?? null) : null) }, input.reportId ?? null, { id: actor.id, display_name: actor.display_name }).catch((e) => logAppError(`record payment: report after ${created.number}`, e, { staffId: actor.id }));
      }
    }
    if (over && !isOwner) await notifyRoles(["owner"], { type: "payment_void", title: `Payment above the balance recorded · ${created.number}`, body: `${money(amount)} by ${method} against a balance of ${money(balance ?? 0)}, by ${actor.display_name}: ${overNote}`, jobId, href: input.invoiceId ? `/invoices/${input.invoiceId}` : jobId ? `/jobs/${jobId}/invoice` : "/invoices" });
  } catch (err) {
    await logAppError(`record payment: after ${created.number}`, err, { staffId: actor.id, jobId, detail: { paymentId: created.id } });
  }
  return { ok: true, number: created.number, paymentId: created.id, token, message: `${created.number} recorded${jobId ? "" : " on the customer's account (not allocated)"}.${method === "cheque" ? " The cheque counts as unpaid until it clears." : ""}${codeMissing ? " Auth code missing: it is flagged until it is added." : ""}` };
}

/**
 * THE duplicate rule of a real auth code (one transaction, one code): the same code on another live receipt of the same
 * method in the last 60 days is a slip. Used when a payment is recorded and when a missing code is added later. Null =
 * no twin; otherwise the refusal in words.
 */
export async function authCodeTwin(code: string, method: string, exceptId: string | null): Promise<string | null> {
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  let q = createAdminClient().from("payments").select("number, amount_aed").eq("auth_code", code).eq("method", method).eq("is_active", true).neq("status", "voided").gte("received_at", since);
  if (exceptId) q = q.neq("id", exceptId);
  const { data: twin } = await q.limit(1).maybeSingle();
  return twin ? `Auth code ${code} is already on ${twin.number} (${money(Number(twin.amount_aed) || 0)}). Check ${authCodeWhere(method)}.` : null;
}

/** Where an added auth code came from: typed by hand, or the bank's settlement report (its file and line). */
export type AuthCodeSource = { kind: "hand" } | { kind: "report"; reportId: string; fileName: string; line: number };

/**
 * "Add auth code" (3 November 2026, section 5): a card or payment-link payment saved with its code missing gets the real
 * one later - typed by the owner or accounts, or confirmed from the bank's settlement report - WITHOUT recording it
 * again. Only the code moves: the receipt number, the settlement, the bank fees, the balances and Zoho (which never
 * receives auth codes) stay as they are. Logged in the change log (who, what it was, where it came from) and on the job.
 */
export async function addAuthCode(paymentId: string, raw: string, actor: Actor, source: AuthCodeSource): Promise<PaymentResult> {
  if (!actor.id || !(actor.role_id === "owner" || actor.role_id === "accounts")) return { error: "Only the owner or accounts add an auth code." };
  const code = cleanAuthCode(raw);
  if (!AUTH_CODE_RE.test(code)) return { error: `The auth code is 6 letters or digits${code ? `; "${code}" has ${code.length}` : ""}.` };
  const admin = createAdminClient();
  const { data: raw2 } = await admin.from("payments").select("id, number, method, status, is_active, auth_code, job_id, amount_aed").eq("id", paymentId).maybeSingle();
  const p = raw2 as { id: string; number: string; method: string; status: string; is_active: boolean; auth_code: string | null; job_id: string | null; amount_aed: number | string } | null;
  if (!p || !p.is_active) return { error: "Receipt not found." };
  if (!needsAuthCode(p.method)) return { error: `${p.number} is not a card or payment-link payment: it has no auth code.` };
  if (!(p.status === "recorded" || p.status === "pending_owner")) return { error: `${p.number} is ${p.status === "voided" ? "voided" : p.status}: nothing to add.` };
  // A code typed by hand must be a real one; the bank's own code is the truth even when it looks made up.
  const refused = source.kind === "hand" ? authCodeRefusal(p.method, code) : null;
  if (refused) return { error: refused };
  if (!authCodeMissing(p)) return { error: `${p.number} already has auth ${p.auth_code}.` };
  const twin = await authCodeTwin(code, p.method, p.id);
  if (twin) return { error: twin };
  // Compare and swap: only while the code is still what was read (two people adding at once: the second is told).
  let upd = admin.from("payments").update({ auth_code: code, updated_by: actor.id }).eq("id", p.id);
  upd = p.auth_code === null ? upd.is("auth_code", null) : upd.eq("auth_code", p.auth_code);
  const { data: changed, error } = await upd.select("id");
  if (error) {
    await logAppError("add auth code", error, { staffId: actor.id, jobId: p.job_id, detail: { paymentId } });
    return { error: SAVE_FAILED };
  }
  if (!changed?.length) return { error: `Someone else changed ${p.number} a moment ago – reload the page.` };
  const from = source.kind === "report" ? `from the bank report ${source.fileName}, line ${source.line}` : "by hand";
  const was = p.auth_code ? `was missing: ${p.auth_code} typed` : "was missing";
  try {
    await admin.from("audit_log").insert({ table_name: "payments", record_id: p.id, action: "update", old_data: { auth_code: p.auth_code }, new_data: { auth_code_added: code, was: p.auth_code, number: p.number, job_id: p.job_id, source: source.kind === "report" ? { kind: "report", report_id: source.reportId, file: source.fileName, line: source.line } : { kind: "hand" }, by: actor.display_name }, changed_by: actor.id });
    if (p.job_id) await admin.from("job_events").insert({ job_id: p.job_id, event_type: "payment", note: `${p.number}: auth code ${code} added ${from} by ${actor.display_name} (${was})`, created_by: actor.id });
  } catch (e) {
    await logAppError("add auth code: log", e, { staffId: actor.id, jobId: p.job_id, detail: { paymentId } });
  }
  return { ok: true, number: p.number, paymentId: p.id, message: `Auth ${code} saved on ${p.number}.` };
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
  // In the current book the worker takes it back itself (reverseZohoPayment deletes it there, 1 November 2026, B3);
  // one in the REAL book's opening balances is reversed by hand.
  if (where === "opening") {
    await flagZohoAttention(
      p.is_deposit ? "deposit" : "payment",
      paymentId,
      `${p.number} was voided after go-live; it reached OFJ TEST before the start date and sits in the REAL book's opening balances: reverse it there by hand, then press "Done by hand". Reason: ${clean}`,
      { handOnly: true },
    );
  } else if (where) await reopenZoho(p.is_deposit ? "deposit" : "payment", paymentId);
  if (p.job_id) await admin.from("job_events").insert({ job_id: p.job_id, event_type: "payment_void", note: `${p.number} (${money(p.amount_aed)}) voided by ${actor.display_name}: ${clean}`, created_by: actor.id });
  if (p.job_id && p.invoice_id) await settleJob(p.job_id, p.invoice_id, actor.id);
  // A receipt that answered an advisor's payment report: the report waits for accounts again (never "Recorded ✓" on a voided receipt).
  const { reopenReportsOfPayment } = await import("./payment-reports");
  await reopenReportsOfPayment(paymentId, { id: actor.id, display_name: actor.display_name }, { word: "voided", reason: clean }).catch((e) => logAppError(`void payment: report after ${p.number}`, e, { staffId: actor.id, jobId: p.job_id }));
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

/**
 * UNDO a receipt inside the undo window (1 November 2026, B3): the person who recorded it, or the owner. It is voided
 * with "Undone" as the reason (logged), and its Zoho row - held back during the window - is dropped before it posts.
 * A payment that completed the bill and made the tax invoice is not undone here: reverse it with a reason instead.
 */
export async function undoPayment(paymentId: string, actor: Actor, settings: Settings): Promise<PaymentResult> {
  const admin = createAdminClient();
  if (!actor.id) return { error: "Please sign in again." };
  const { data: raw } = await admin.from("payments").select(`${PAYMENT_SELECT}, created_at, created_by`).eq("id", paymentId).maybeSingle();
  if (!raw) return { error: "Receipt not found." };
  const p = toPayment(raw as Record<string, unknown>);
  const minutes = Number((settings as unknown as Record<string, unknown>).money_undo_minutes) || DEFAULT_UNDO_MINUTES;
  const createdAt = String((raw as Record<string, unknown>).created_at ?? p.received_at);
  const doneBy = ((raw as Record<string, unknown>).created_by as string | null) ?? null;
  if (p.status === "voided") return { error: "Already undone." };
  if (!mayUndo(doneBy, { id: actor.id, role_id: actor.role_id }, createdAt, minutes)) return { error: `The ${minutes} minutes to undo are over (or it was recorded by someone else): the owner or the head accountant reverse it with a reason.` };
  if (p.invoice_id) {
    const { data: inv } = await admin.from("invoices").select("kind, number, converted_from, created_at").eq("id", p.invoice_id).maybeSingle();
    if (inv?.kind === "tax_invoice" && inv.converted_from && String(inv.created_at) >= createdAt) return { error: `${p.number} completed the payment and made tax invoice ${inv.number}: it cannot be undone. The owner or the head accountant reverse it with a reason.` };
  }
  await admin.from("payments").update({ status: "voided", void_reason: `Undone within ${minutes} minutes by ${actor.display_name}`, voided_by: actor.id, voided_at: new Date().toISOString(), updated_by: actor.id }).eq("id", paymentId);
  // Held back during the window: the Zoho row never left, so it is simply dropped.
  await admin.from("zoho_outbox").delete().in("kind", ["payment", "deposit"]).eq("record_id", paymentId).eq("status", "pending").is("zoho_id", null);
  if (p.job_id) await admin.from("job_events").insert({ job_id: p.job_id, event_type: "payment_void", note: `${p.number} (${money(p.amount_aed)}) undone by ${actor.display_name} within ${minutes} minutes`, created_by: actor.id });
  if (p.job_id && p.invoice_id) await settleJob(p.job_id, p.invoice_id, actor.id);
  // A receipt made from an advisor's payment report: the report waits for accounts again (2 November 2026, section 3).
  const { reopenReportsOfPayment } = await import("./payment-reports");
  await reopenReportsOfPayment(paymentId, { id: actor.id, display_name: actor.display_name }).catch(() => null);
  return { ok: true, number: p.number, message: `${p.number} undone.` };
}
