import "server-only";
import { loadChargeEntries } from "./charges";
import { customerName } from "./customer-view";
import { INVOICE_SELECT, PAYMENT_SELECT, buildInvoiceDraft, invoiceBalance, nextDocumentNumber, toInvoice, toPayment, type PaymentRow } from "./invoice-data";
import { round2 } from "./money";
import { notifyStaff, jobAdvisorIds } from "./notifications";
import { paymentsAnytimeReady } from "./schema-ready";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

/**
 * Record a payment any time (1 November 2026). THE money figures of a job and of a customer, for every screen that
 * offers "Record payment": what a job has paid so far and what is left (before the proforma: the approved total less
 * the advances; after it: the live invoice's balance), where a payment can go (the job, its proforma or invoice, or the
 * customer's account as an UNALLOCATED ADVANCE), the customer's credit not allocated, and allocating it later in one step.
 */

const VEH = "id, kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name)";
type Vehicle = Parameters<typeof formatPlate>[0] & { id: string; model_year: number | null; make: { name: string } | null; model: { name: string } | null };
const carOf = (v: Vehicle | null) => (v ? [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" ").toUpperCase() : "");
const aed = (n: number) => `AED ${round2(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type JobMoney = {
  jobId: string;
  jobNumber: string;
  status: string;
  isOpen: boolean;
  gatedOutAt: string | null;
  customerId: string;
  vehicleId: string;
  plate: string;
  car: string;
  /** The proforma or tax invoice the money goes against, when there is one. */
  live: { id: string; number: string; kind: "proforma" | "tax_invoice"; total: number } | null;
  /** The approved total incl. VAT (the live invoice's total once there is one); null while nothing is approved. */
  total: number | null;
  paid: number;
  /** What is still to pay; null while there is no total to measure against. */
  balance: number | null;
  pendingCheque: number;
};

/** A job's money now: the live invoice's figures, or (before the proforma) the approved total less every advance. */
export async function jobMoneyOf(jobId: string, settings: Settings): Promise<JobMoney | null> {
  const admin = createAdminClient();
  const [{ data: job }, { data: invs }, { data: pays }] = await Promise.all([
    admin.from("jobs").select(`id, job_number, status, is_open, gated_out_at, customer_id, vehicle_id, vehicle:vehicles(${VEH})`).eq("id", jobId).maybeSingle(),
    admin.from("invoices").select(INVOICE_SELECT).eq("job_id", jobId).in("kind", ["tax_invoice", "proforma"]).eq("status", "issued").eq("is_active", true).is("converted_to", null).order("issued_at", { ascending: false }),
    admin.from("payments").select(PAYMENT_SELECT).eq("job_id", jobId).eq("is_active", true),
  ]);
  if (!job) return null;
  const v = (job.vehicle as unknown as Vehicle | null) ?? null;
  const rows = ((invs ?? []) as Record<string, unknown>[]).map(toInvoice);
  const liveInv = rows.find((i) => i.kind === "tax_invoice" && !i.deposit_for_quotation_id) ?? rows.find((i) => i.kind === "proforma" && !i.deposit_for_quotation_id) ?? null;
  const payments = ((pays ?? []) as Record<string, unknown>[]).map(toPayment);
  const base = {
    jobId,
    jobNumber: String(job.job_number),
    status: String(job.status),
    isOpen: !!job.is_open,
    gatedOutAt: (job.gated_out_at as string | null) ?? null,
    customerId: String(job.customer_id),
    vehicleId: String(job.vehicle_id),
    plate: v ? formatPlate(v) : "",
    car: carOf(v),
  };
  if (liveInv) {
    const bal = invoiceBalance(liveInv, payments.filter((p) => p.invoice_id === liveInv.id));
    return { ...base, live: { id: liveInv.id, number: liveInv.number, kind: liveInv.kind as "proforma" | "tax_invoice", total: liveInv.total_aed }, total: liveInv.total_aed, paid: bal.paid, balance: bal.balance, pendingCheque: bal.pendingAmount };
  }
  const draft = await buildInvoiceDraft(jobId, settings);
  const total = draft.lines.length ? draft.totals.total : null;
  const live = payments.filter((p) => p.status === "recorded");
  const paid = round2(live.filter((p) => p.method !== "cheque" || p.cheque_status === "cleared").reduce((a, p) => a + p.amount_aed, 0));
  const pendingCheque = round2(live.filter((p) => p.method === "cheque" && p.cheque_status === "pending").reduce((a, p) => a + p.amount_aed, 0));
  return { ...base, live: null, total, paid, balance: total === null ? null : Math.max(0, round2(total - paid)), pendingCheque };
}

export type PayTarget = {
  /** "inv:<id>", "job:<id>" or "credit". */
  key: string;
  kind: "invoice" | "job" | "unallocated";
  jobId: string | null;
  invoiceId: string | null;
  vehicleId: string | null;
  /** "J-00969 · DUBAI W 64762 · MERCEDES-BENZ S 580" or "Customer's account". */
  title: string;
  /** "Proforma PF-00012 · balance AED 37,930.00" or "Not allocated: saved on the customer's account". */
  detail: string;
  total: number | null;
  paid: number;
  balance: number | null;
  invoiceNumber: string | null;
  isProforma: boolean;
  /** The car has left (the money is still welcome: credit terms, a late payment). */
  gone: boolean;
};

export type UnallocatedPayment = PaymentRow & { vehicle_id: string | null; plate: string | null; car: string | null; customerName: string; ageDays: number };

/** The customer's money not allocated to anything yet (newest first). Empty until the database change is applied. */
export async function unallocatedOf(opts: { customerId?: string; vehicleId?: string } = {}): Promise<UnallocatedPayment[]> {
  if (!(await paymentsAnytimeReady())) return [];
  const admin = createAdminClient();
  let q = admin.from("payments").select(`${PAYMENT_SELECT}, vehicle_id, vehicle:vehicles(${VEH}), customer:customers(full_name, company_name)`).is("job_id", null).is("invoice_id", null).eq("is_active", true).in("status", ["recorded", "pending_owner"]);
  if (opts.customerId) q = q.eq("customer_id", opts.customerId);
  if (opts.vehicleId) q = q.eq("vehicle_id", opts.vehicleId);
  const { data } = await q.order("received_at", { ascending: false }).limit(200);
  const now = Date.now();
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const v = (r.vehicle as Vehicle | null) ?? null;
    const c = (r.customer as { full_name: string | null; company_name: string | null } | null) ?? { full_name: null, company_name: null };
    const p = toPayment(r);
    return { ...p, vehicle_id: (r.vehicle_id as string | null) ?? null, plate: v ? formatPlate(v) : null, car: v ? carOf(v) : null, customerName: customerName(c), ageDays: Math.max(0, Math.floor((now - Date.parse(p.received_at)) / 86400000)) };
  });
}

/** "Credit AED X (not allocated)": recorded money only (a cheque still clearing counts, it is the customer's money). */
export async function customerCredit(customerId: string): Promise<number> {
  const rows = await unallocatedOf({ customerId });
  return round2(rows.filter((p) => p.status === "recorded").reduce((a, p) => a + p.amount_aed, 0));
}

export type PaymentChoices = {
  customer: { id: string; name: string; phone: string | null };
  targets: PayTarget[];
  /** The target the dialog opens on. */
  suggested: string;
  credit: number;
  cars: { id: string; plate: string; car: string }[];
  /** The number the tax invoice will get when a payment settles a proforma. */
  nextTaxNumber: string | null;
  unallocatedReady: boolean;
};

/**
 * Where a payment can go for this customer: every open job (that car first), jobs that left with money still owed,
 * the asked-for job always, and the customer's account. A job's live proforma or invoice is the target once it exists;
 * before that the job itself (an advance that comes off the invoice by itself).
 */
export async function paymentChoices(input: { customerId?: string | null; vehicleId?: string | null; jobId?: string | null }, settings: Settings): Promise<PaymentChoices | null> {
  const admin = createAdminClient();
  let customerId = input.customerId ?? null;
  let vehicleId = input.vehicleId ?? null;
  if (input.jobId) {
    const { data: j } = await admin.from("jobs").select("customer_id, vehicle_id").eq("id", input.jobId).maybeSingle();
    if (!j) return null;
    customerId = String(j.customer_id);
    vehicleId = vehicleId ?? String(j.vehicle_id);
  }
  if (!customerId && vehicleId) {
    const { data: v } = await admin.from("vehicles").select("customer_id").eq("id", vehicleId).maybeSingle();
    customerId = (v?.customer_id as string | null) ?? null;
  }
  if (!customerId) return null;
  const [{ data: c }, { data: jobs }, { data: cars }, ready] = await Promise.all([
    admin.from("customers").select("id, full_name, company_name, phone").eq("id", customerId).maybeSingle(),
    admin.from("jobs").select("id, vehicle_id, is_open, gated_in_at").eq("customer_id", customerId).order("gated_in_at", { ascending: false }).limit(40),
    admin.from("vehicles").select(VEH).eq("customer_id", customerId).eq("is_active", true),
    paymentsAnytimeReady(),
  ]);
  if (!c) return null;
  const jobRows = (jobs ?? []) as { id: string; vehicle_id: string; is_open: boolean }[];
  // Open jobs, plus the 12 newest that left (money may still be owed on them), plus the asked-for one.
  const pick = jobRows.filter((j) => j.is_open || j.id === input.jobId).concat(jobRows.filter((j) => !j.is_open && j.id !== input.jobId).slice(0, 12));
  const figures = (await Promise.all(pick.map((j) => jobMoneyOf(j.id, settings)))).filter((x): x is JobMoney => !!x);
  const targets: PayTarget[] = [];
  for (const m of figures) {
    const owed = m.balance === null || m.balance > 0.005;
    // A job paid in full, or one that left owing nothing, is no place for new money (unless asked for by name).
    if (!owed && m.jobId !== input.jobId) continue;
    if (!m.isOpen && m.balance === null && m.jobId !== input.jobId) continue;
    const title = [m.jobNumber, m.plate, m.car].filter(Boolean).join(" · ");
    const owedWords = m.balance === null ? "no approved total yet" : m.balance > 0.005 ? `balance ${aed(m.balance)}` : "paid in full";
    if (m.live) {
      targets.push({ key: `inv:${m.live.id}`, kind: "invoice", jobId: m.jobId, invoiceId: m.live.id, vehicleId: m.vehicleId, title, detail: `${m.live.kind === "proforma" ? "Proforma" : "Tax invoice"} ${m.live.number} · ${owedWords}${m.isOpen ? "" : " · the car has left"}`, total: m.total, paid: m.paid, balance: m.balance, invoiceNumber: m.live.number, isProforma: m.live.kind === "proforma", gone: !m.isOpen });
    } else {
      targets.push({ key: `job:${m.jobId}`, kind: "job", jobId: m.jobId, invoiceId: null, vehicleId: m.vehicleId, title, detail: `${m.paid > 0 ? `Paid so far ${aed(m.paid)} · ` : ""}${owedWords} · recorded as an advance, it comes off the invoice by itself${m.isOpen ? "" : " · the car has left"}`, total: m.total, paid: m.paid, balance: m.balance, invoiceNumber: null, isProforma: false, gone: !m.isOpen });
    }
  }
  // 1 November 2026: a pending charge (no gate-in) with its own proforma is a place for the money too.
  for (const e of await loadChargeEntries({ customerId, status: "pending" })) {
    if (!e.proforma_id || e.tax_invoice_id || e.balance <= 0.005) continue;
    targets.push({ key: `inv:${e.proforma_id}`, kind: "invoice", jobId: null, invoiceId: e.proforma_id, vehicleId: e.vehicle_id, title: `Pending charge · ${e.what}`, detail: `Proforma ${e.proformaNumber} · balance ${aed(e.balance)}${e.paid > 0 ? ` · AED ${e.paid.toLocaleString("en-GB", { minimumFractionDigits: 2 })} paid so far` : ""} · the tax invoice follows when it is paid in full`, total: e.total, paid: e.paid, balance: e.balance, invoiceNumber: e.proformaNumber, isProforma: true, gone: false });
  }
  // That car's jobs first, then the rest as they came (newest first).
  targets.sort((a, b) => Number(b.vehicleId === vehicleId) - Number(a.vehicleId === vehicleId));
  if (ready) targets.push({ key: "credit", kind: "unallocated", jobId: null, invoiceId: null, vehicleId, title: "Customer's account (not allocated)", detail: "Saved as an advance on the customer's account, with a note of what it is for. Allocated later in one step.", total: null, paid: 0, balance: null, invoiceNumber: null, isProforma: false, gone: false });
  const asked = input.jobId ? targets.find((t) => t.jobId === input.jobId) : null;
  const suggested = asked?.key ?? targets.find((t) => t.kind !== "unallocated" && t.vehicleId === vehicleId && (t.balance === null || t.balance > 0.005) && !t.gone)?.key ?? targets.find((t) => t.kind !== "unallocated" && (t.balance ?? 0) > 0.005)?.key ?? targets.at(-1)?.key ?? "";
  const nextTaxNumber = targets.some((t) => t.isProforma) ? await nextDocumentNumber("tax_invoice", settings) : null;
  return {
    customer: { id: String(c.id), name: customerName(c as { full_name: string | null; company_name: string | null }), phone: (c.phone as string | null) ?? null },
    targets,
    suggested,
    credit: await customerCredit(customerId),
    cars: ((cars ?? []) as unknown as Vehicle[]).map((v) => ({ id: v.id, plate: formatPlate(v), car: carOf(v) })),
    nextTaxNumber,
    unallocatedReady: ready,
  };
}

export type AllocateResult = { error?: string; ok?: boolean; message?: string; needsNote?: { balance: number } };

/**
 * An unallocated advance goes to a job, its proforma or its tax invoice (1.8): one step, logged on the job. More than
 * what is left needs a note (refund or credit). A payment already in Zoho is applied there when its row runs again.
 */
export async function allocatePayment(paymentId: string, target: { jobId?: string | null; invoiceId?: string | null }, actor: { id: string; display_name: string }, note: string | null, settings: Settings): Promise<AllocateResult> {
  if (!(await paymentsAnytimeReady())) return { error: "This needs the database update of 1 November. Ask the owner to apply it." };
  const admin = createAdminClient();
  const { data: raw } = await admin.from("payments").select(`${PAYMENT_SELECT}, zoho_payment_id`).eq("id", paymentId).eq("is_active", true).maybeSingle();
  if (!raw) return { error: "Payment not found." };
  const p = toPayment(raw as Record<string, unknown>);
  if (p.job_id || p.invoice_id) return { error: `${p.number} is already allocated.` };
  if (p.status !== "recorded") return { error: p.status === "pending_owner" ? `${p.number} is waiting for the owner.` : `${p.number} is ${p.status}.` };
  let jobId = target.jobId ?? null;
  let invoiceId = target.invoiceId ?? null;
  if (invoiceId) {
    const { data: inv } = await admin.from("invoices").select("id, job_id, customer_id, status, kind, converted_to, number").eq("id", invoiceId).maybeSingle();
    if (!inv || inv.status !== "issued" || inv.converted_to || !["proforma", "tax_invoice"].includes(String(inv.kind))) return { error: "That invoice can't take a payment." };
    if (inv.customer_id !== p.customer_id) return { error: "That invoice is for another customer." };
    jobId = (inv.job_id as string | null) ?? null;
  }
  if (!jobId) return { error: "Choose the job or invoice." };
  const m = await jobMoneyOf(jobId, settings);
  if (!m) return { error: "Job not found." };
  if (m.customerId !== p.customer_id) return { error: "That job is for another customer." };
  if (!invoiceId && m.live) invoiceId = m.live.id;
  const left = m.balance;
  const clean = note?.trim().slice(0, 500) || null;
  if (left !== null && p.amount_aed > left + 0.005 && !clean) return { needsNote: { balance: left }, error: `${p.number} (${aed(p.amount_aed)}) is more than what is left on ${m.jobNumber} (${aed(left)}). Write why (refund or credit) – it is logged.` };
  const now = new Date().toISOString();
  const notes = clean ? [p.notes, `Allocated above the balance: ${clean}`].filter(Boolean).join(" · ") : p.notes;
  const { data: moved, error } = await admin
    .from("payments")
    .update({ job_id: jobId, invoice_id: invoiceId, vehicle_id: m.vehicleId, allocated_at: now, allocated_by: actor.id, notes, updated_by: actor.id })
    .eq("id", paymentId)
    .is("job_id", null)
    .is("invoice_id", null)
    .select("id");
  if (error) return { error: "Couldn't allocate it – nothing changed. Try again." };
  if (!(moved ?? []).length) return { error: `${p.number} was allocated a moment ago.` };
  await admin.from("job_events").insert({ job_id: jobId, event_type: "payment", note: `${p.number}: ${aed(p.amount_aed)} by ${p.method} allocated from the customer's account${invoiceId ? ` to ${m.live?.number ?? "the invoice"}` : ""} by ${actor.display_name}${clean ? ` (above the balance: ${clean})` : ""}`, created_by: actor.id });
  // The invoice may now be settled (a proforma paid in full becomes the tax invoice); a deposit may now be covered.
  const { settleJob, tellDepositCovered } = await import("./payments");
  if (invoiceId) await settleJob(jobId, invoiceId, actor.id, settings);
  else await tellDepositCovered(jobId);
  // Already in Zoho as an unapplied advance: its row runs once more and applies it to the tax invoice when that is there.
  if ((raw as { zoho_payment_id?: string | null }).zoho_payment_id) {
    const { reopenZoho } = await import("./zoho-sync");
    await reopenZoho("deposit", paymentId).catch(() => null);
  }
  await notifyStaff(await jobAdvisorIds(jobId), { type: "payment_received", title: `Payment allocated · ${p.number}`, body: `${aed(p.amount_aed)} from the customer's account is now on ${m.jobNumber}.`, jobId, href: `/jobs/${jobId}` });
  return { ok: true, message: `${p.number} is now on ${m.jobNumber}${invoiceId && m.live ? ` (${m.live.number})` : ""}.` };
}
