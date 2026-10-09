"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission, requireStaff } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { PAYMENT_SELECT, buildInvoiceDraft, invoiceBalance, loadInvoice, nextDocumentNumber, toPayment, type InvoiceKind, type LabourMode } from "@/lib/invoice-data";
import { newToken } from "@/lib/media";
import { round2 } from "@/lib/money";
import { notifyRoles, notifyStaff } from "@/lib/notifications";
import { decideOverpayment, recordPaymentCore, settleJob, verifyPayment, voidPayment, type Actor } from "@/lib/payments";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

function refresh(jobId: string | null, invoiceId?: string) {
  revalidatePath("/invoices");
  if (invoiceId) revalidatePath(`/invoices/${invoiceId}`);
  if (jobId) {
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/invoice`);
    revalidatePath(`/jobs/${jobId}/gate-out`);
  }
  revalidatePath("/dashboard");
  revalidatePath("/profit");
}

async function advisorsOf(jobId: string) {
  const admin = createAdminClient();
  const [{ data: job }, { data: appr }] = await Promise.all([admin.from("jobs").select("gated_in_by").eq("id", jobId).maybeSingle(), admin.from("approval_requests").select("sent_by").eq("job_id", jobId)]);
  return Array.from(new Set([job?.gated_in_by, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
}
const actorOf = (s: { id: string; display_name: string; role_id: string; is_head_accountant?: boolean }): Actor => ({ id: s.id, display_name: s.display_name, role_id: s.role_id, is_head_accountant: s.is_head_accountant });

/** The advisor marks the car ready to invoice; accounts are told. */
export async function markReadyToInvoice(jobId: string) {
  const staff = await requirePermission("markReadyToInvoice");
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, status, is_open, ready_to_invoice_at").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) redirect(`/jobs/${jobId}?error=${encodeURIComponent("This job is closed.")}`);
  if (!["ready", "pending_wash", "pending_qc"].includes(job.status)) redirect(`/jobs/${jobId}?error=${encodeURIComponent("The car is not ready yet.")}`);
  await admin.from("jobs").update({ ready_to_invoice_at: new Date().toISOString(), ready_to_invoice_by: staff.id }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "ready_to_invoice", note: `Marked ready to invoice by ${staff.display_name}`, created_by: staff.id });
  await notifyRoles(["accounts", "owner"], { type: "ready_to_invoice", title: `Ready to invoice · ${job.job_number}`, body: `${staff.display_name} marked the car ready. Issue the invoice.`, jobId, href: `/jobs/${jobId}/invoice` });
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent("Accounts have been told to issue the invoice.")}`);
}

function readOptions(formData: FormData) {
  const labourMode: LabourMode = String(formData.get("labour_mode") ?? "itemised") === "combined" ? "combined" : "itemised";
  const consumables = formData.get("consumables") === "on" ? Number(String(formData.get("consumables_aed") ?? "").replace(/[^\d.]/g, "")) || 0 : 0;
  const agreedText = String(formData.get("agreed_total") ?? "").replace(/[^\d.]/g, "");
  const agreedTotal = agreedText ? Number(agreedText) : null;
  const discountText = String(formData.get("discount_percent") ?? "").trim();
  const discountPercent = discountText === "" ? null : Math.max(0, Number(discountText) || 0);
  return { labourMode, consumables, agreedTotal, discountPercent };
}

/** Accounts issue the tax invoice (or a proforma) from the approved quotations. Prices come from the quotation and cannot change. */
export async function issueInvoice(jobId: string, formData: FormData) {
  const staff = await requirePermission("issueInvoices");
  const back = `/jobs/${jobId}/invoice`;
  const kind: InvoiceKind = String(formData.get("kind") ?? "tax_invoice") === "proforma" ? "proforma" : "tax_invoice";
  const admin = createAdminClient();
  const settings = await getSettings();
  const { data: job } = await admin.from("jobs").select("id, job_number, status, is_open, customer_id, vehicle_id, gated_in_by, inspection_fee_due").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) redirect(`${back}?error=${encodeURIComponent("This job is closed.")}`);
  const { data: existing } = await admin.from("invoices").select("id, number").eq("job_id", jobId).eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true).maybeSingle();
  if (kind === "tax_invoice" && existing) redirect(`/invoices/${existing.id}?error=${encodeURIComponent(`${existing.number} is already issued for this job. Corrections are by credit note.`)}`);
  const opts = readOptions(formData);
  const draft = await buildInvoiceDraft(jobId, settings, opts);
  if (!draft.lines.length) redirect(`${back}?error=${encodeURIComponent("Nothing to invoice: no approved quotation and no inspection fee.")}`);
  if (opts.agreedTotal && draft.totals.agreedTotalProblem) redirect(`${back}?error=${encodeURIComponent(draft.totals.agreedTotalProblem)}`);
  const [{ data: customer }, { data: vehicle }] = await Promise.all([
    admin.from("customers").select("full_name, company_name, phone, email, trn").eq("id", job.customer_id).maybeSingle(),
    admin.from("vehicles").select("has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", job.vehicle_id).maybeSingle(),
  ]);
  const v = vehicle as unknown as { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
  const number = await nextDocumentNumber(kind, settings);
  const token = newToken();
  const { data: inv, error } = await admin
    .from("invoices")
    .insert({
      number,
      kind,
      job_id: jobId,
      customer_id: job.customer_id,
      vehicle_id: job.vehicle_id,
      token,
      labour_mode: opts.labourMode,
      subtotal_aed: draft.totals.gross,
      discount_aed: draft.totals.discount,
      taxable_aed: draft.totals.taxable,
      vat_aed: draft.totals.vat,
      total_aed: draft.totals.total,
      agreed_total_aed: draft.totals.agreedTotalApplied ? opts.agreedTotal : null,
      warranty_credit_aed: draft.totals.warrantyCredit,
      discount_note: draft.totals.warrantyCredit ? "Warranty repair, no charge" : draft.totals.discount ? `${draft.totals.discountPercent}% on labour and services${draft.totals.agreedTotalApplied ? " (agreed total)" : ""}` : null,
      prepared_by: job.gated_in_by,
      issued_by: staff.id,
      notes: blankToNull(formData.get("notes")),
      customer_snapshot: customer ?? null,
      vehicle_snapshot: v ? { title: [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" "), variant: v.variant, plate: formatPlate(v), vin: v.vin } : null,
      created_by: staff.id,
      updated_by: staff.id,
    })
    .select("id")
    .single();
  if (error || !inv) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Could not issue the invoice.")}`);
  await admin.from("invoice_lines").insert(
    draft.lines.map((l, i) => ({ invoice_id: inv.id, position: i, section: l.section, description: l.description, details: l.details, part_number: l.part_number, quantity: l.quantity, unit_price: l.unit_price, amount_aed: l.amount_aed, vat_aed: round2(l.amount_aed * (draft.vatPercent / 100)), total_aed: round2(l.amount_aed * (1 + draft.vatPercent / 100)), cost_aed: l.cost_aed, quotation_line_id: l.quotation_line_id, part_item_id: l.part_item_id, created_by: staff.id, updated_by: staff.id })),
  );
  if (kind === "tax_invoice") {
    // Deposits recorded earlier apply to the invoice.
    await admin.from("payments").update({ invoice_id: inv.id, updated_by: staff.id }).eq("job_id", jobId).is("invoice_id", null).eq("is_active", true);
    const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", inv.id).eq("is_active", true);
    const bal = invoiceBalance({ total_aed: draft.totals.total }, ((pays ?? []) as Record<string, unknown>[]).map(toPayment));
    if (["ready", "pending_wash", "pending_qc"].includes(job.status) || job.status === "pending_payment") {
      await admin.from("jobs").update({ status: bal.balance > 0 ? "pending_payment" : "ready", stage: "ready", ready_token: token }).eq("id", jobId);
    }
    await admin.from("job_events").insert({ job_id: jobId, event_type: "invoice_issued", from_status: job.status, to_status: bal.balance > 0 ? "pending_payment" : "ready", note: `${number} issued by ${staff.display_name}: AED ${draft.totals.total.toLocaleString("en-GB", { minimumFractionDigits: 2 })} with VAT${draft.totals.warrantyCredit ? " (warranty repair, no charge)" : ""}${bal.paid ? `, AED ${bal.paid.toLocaleString("en-GB")} already received` : ""}`, created_by: staff.id });
    await notifyStaff(await advisorsOf(jobId), { type: "invoice_issued", title: `Invoice issued · ${job.job_number}`, body: `${number}, AED ${draft.totals.total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}. Send the tax invoice to the customer on WhatsApp from the job card.`, jobId, href: `/jobs/${jobId}` });
  } else {
    await admin.from("job_events").insert({ job_id: jobId, event_type: "proforma_issued", note: `${number} issued by ${staff.display_name}`, created_by: staff.id });
  }
  refresh(jobId, inv.id);
  redirect(`/invoices/${inv.id}?message=${encodeURIComponent(`${number} issued.`)}`);
}

/**
 * A payment: cash, card, link or cheque, against an invoice or as a deposit on the job. One tap, one
 * receipt: the same tap twice records nothing twice; more than the balance waits for the owner.
 */
export async function recordPayment(formData: FormData) {
  const staff = await requirePermission("recordPayments");
  const settings = await getSettings();
  const invoiceId = blankToNull(formData.get("invoice_id"));
  const jobIdIn = blankToNull(formData.get("job_id"));
  const returnTo = blankToNull(formData.get("return_to"));
  const base = invoiceId ? `/invoices/${invoiceId}` : jobIdIn ? `/jobs/${jobIdIn}/invoice` : "/invoices";
  const back = returnTo && returnTo.startsWith(base) && !returnTo.includes("message=") && !returnTo.includes("error=") ? returnTo : base;
  const sep = back.includes("?") ? "&" : "?";
  const amount = Number(String(formData.get("amount") ?? "").replace(/[^\d.]/g, ""));
  const r = await recordPaymentCore(actorOf(staff), {
    invoiceId,
    jobId: jobIdIn,
    method: String(formData.get("method") ?? ""),
    amount,
    reference: blankToNull(formData.get("reference")),
    cheque: { number: blankToNull(formData.get("cheque_number")), bank: blankToNull(formData.get("cheque_bank")), date: blankToNull(formData.get("cheque_date")) },
    notes: blankToNull(formData.get("notes")),
    clientKey: blankToNull(formData.get("client_key")),
  }, settings);
  const jobId = jobIdIn ?? (invoiceId ? (await loadInvoice(invoiceId))?.invoice.job_id ?? null : null);
  refresh(jobId, invoiceId ?? undefined);
  redirect(`${back}${sep}${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? r.message ?? "Recorded.")}`);
}

/** A wrong receipt is never deleted: the owner or the head accountant voids it with a reason. */
export async function voidPaymentAction(paymentId: string, formData: FormData) {
  const staff = await requireStaff();
  const r = await voidPayment(paymentId, actorOf(staff), String(formData.get("reason") ?? ""));
  const { data: p } = await createAdminClient().from("payments").select("job_id, invoice_id").eq("id", paymentId).maybeSingle();
  refresh(p?.job_id ?? null, p?.invoice_id ?? undefined);
  const back = p?.invoice_id ? `/invoices/${p.invoice_id}` : "/invoices";
  redirect(`${back}?${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? r.message ?? "Voided.")}`);
}

/** Accounts tick a payment once the money is confirmed. */
export async function verifyPaymentAction(paymentId: string, formData: FormData) {
  const staff = await requirePermission("verifyPayments");
  const r = await verifyPayment(paymentId, actorOf(staff));
  const { data: p } = await createAdminClient().from("payments").select("job_id, invoice_id").eq("id", paymentId).maybeSingle();
  refresh(p?.job_id ?? null, p?.invoice_id ?? undefined);
  const to = blankToNull(formData.get("return_to")) ?? (p?.invoice_id ? `/invoices/${p.invoice_id}` : "/invoices");
  redirect(`${to}${to.includes("?") ? "&" : "?"}${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? r.message ?? "Verified.")}`);
}

/** The owner approves or refuses a payment above the balance. */
export async function decideOverpaymentAction(paymentId: string, formData: FormData) {
  const staff = await requirePermission("moveJobs");
  const approve = String(formData.get("decision") ?? "") === "approve";
  const r = await decideOverpayment(paymentId, actorOf(staff), approve, blankToNull(formData.get("note")));
  const { data: p } = await createAdminClient().from("payments").select("job_id, invoice_id").eq("id", paymentId).maybeSingle();
  refresh(p?.job_id ?? null, p?.invoice_id ?? undefined);
  const back = p?.invoice_id ? `/invoices/${p.invoice_id}` : "/invoices";
  redirect(`${back}?${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? r.message ?? "Done.")}`);
}

/** The owner or accounts paste the bank's payment link; the customer's invoice page shows "Pay now". */
export async function setPaymentLink(invoiceId: string, formData: FormData) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!can(role, "issueInvoices")) redirect(`/invoices/${invoiceId}`);
  const url = blankToNull(formData.get("payment_link_url"));
  if (url && !/^https:\/\/\S+$/.test(url)) redirect(`/invoices/${invoiceId}?error=${encodeURIComponent("Paste the full https:// link.")}`);
  const admin = createAdminClient();
  await admin.from("invoices").update({ payment_link_url: url, updated_by: staff.id }).eq("id", invoiceId);
  const { data: inv } = await admin.from("invoices").select("job_id, number").eq("id", invoiceId).maybeSingle();
  if (inv?.job_id) await admin.from("job_events").insert({ job_id: inv.job_id, event_type: "payment_link", note: url ? `Payment link added to ${inv.number} by ${staff.display_name}` : `Payment link removed from ${inv.number} by ${staff.display_name}`, created_by: staff.id });
  refresh(inv?.job_id ?? null, invoiceId);
  redirect(`/invoices/${invoiceId}?message=${encodeURIComponent(url ? "Payment link saved. The customer sees Pay now on the invoice page." : "Payment link removed.")}`);
}

/** A cheque clears, or bounces (which reverses the payment). */
export async function setChequeStatus(paymentId: string, formData: FormData) {
  const staff = await requirePermission("recordPayments");
  const admin = createAdminClient();
  const { data: raw } = await admin.from("payments").select(PAYMENT_SELECT).eq("id", paymentId).maybeSingle();
  if (!raw) redirect("/invoices");
  const p = toPayment(raw as Record<string, unknown>);
  const back = p.invoice_id ? `/invoices/${p.invoice_id}` : "/invoices";
  const status = String(formData.get("status") ?? "");
  if (p.method !== "cheque" || !["cleared", "bounced"].includes(status)) redirect(back);
  const now = new Date().toISOString();
  await admin.from("payments").update(status === "cleared" ? { cheque_status: "cleared", cleared_at: now, updated_by: staff.id } : { cheque_status: "bounced", status: "reversed", reversed_at: now, reversed_reason: "Cheque bounced", updated_by: staff.id }).eq("id", paymentId);
  if (p.job_id) {
    await admin.from("job_events").insert({ job_id: p.job_id, event_type: "payment", note: `${p.number}: cheque ${p.cheque_number ?? ""} ${status} (${staff.display_name})`, created_by: staff.id });
    if (p.invoice_id) await settleJob(p.job_id, p.invoice_id, staff.id);
    if (status === "bounced") {
      const advisors = await advisorsOf(p.job_id);
      await notifyStaff(advisors, { type: "cheque_bounced", title: `Cheque bounced · ${p.number}`, body: `AED ${p.amount_aed.toLocaleString("en-GB")} reversed. The balance is due again.`, jobId: p.job_id, href: back });
      await notifyRoles(["owner"], { type: "cheque_bounced", title: `Cheque bounced · ${p.number}`, body: `AED ${p.amount_aed.toLocaleString("en-GB")} reversed.`, jobId: p.job_id, href: back });
    }
  }
  refresh(p.job_id, p.invoice_id ?? undefined);
  redirect(`${back}?message=${encodeURIComponent(status === "cleared" ? "Cheque cleared." : "Cheque bounced: the payment is reversed.")}`);
}

/** Accounts ask the owner for a credit note. */
export async function requestCreditNote(invoiceId: string, formData: FormData) {
  const staff = await requirePermission("issueInvoices");
  const reason = blankToNull(formData.get("reason"));
  const back = `/invoices/${invoiceId}`;
  if (!reason || reason.length < 3) redirect(`${back}?error=${encodeURIComponent("Say what needs correcting.")}`);
  const bundle = await loadInvoice(invoiceId);
  if (!bundle) redirect("/invoices");
  await notifyRoles(["owner"], { type: "credit_note_approval", title: `Credit note requested · ${bundle.invoice.number}`, body: `${staff.display_name}: ${reason}`, jobId: bundle.invoice.job_id, href: back });
  if (bundle.invoice.job_id) await createAdminClient().from("job_events").insert({ job_id: bundle.invoice.job_id, event_type: "credit_note_request", note: `${staff.display_name} asked the owner for a credit note on ${bundle.invoice.number}: ${reason}`, created_by: staff.id });
  redirect(`${back}?message=${encodeURIComponent("The owner has been asked to approve a credit note.")}`);
}

/** The owner issues a credit note against an invoice: an amount before VAT with a description. The invoice itself stays locked. */
export async function issueCreditNote(invoiceId: string, formData: FormData) {
  const staff = await requirePermission("approveCreditNotes");
  const back = `/invoices/${invoiceId}`;
  const bundle = await loadInvoice(invoiceId);
  if (!bundle || bundle.invoice.kind !== "tax_invoice") redirect("/invoices");
  const amount = Number(String(formData.get("amount") ?? "").replace(/[^\d.]/g, ""));
  const description = blankToNull(formData.get("description"));
  if (!Number.isFinite(amount) || amount <= 0) redirect(`${back}?error=${encodeURIComponent("Enter the amount before VAT to credit.")}`);
  if (!description) redirect(`${back}?error=${encodeURIComponent("Describe the correction.")}`);
  const credited = bundle.creditNotes.filter((c) => c.status === "issued").reduce((a, c) => a + c.taxable_aed, 0);
  if (amount + credited > bundle.invoice.taxable_aed + 0.005) redirect(`${back}?error=${encodeURIComponent("That is more than the invoice.")}`);
  const settings = await getSettings();
  const vatPct = bundle.invoice.taxable_aed ? round2((bundle.invoice.vat_aed / bundle.invoice.taxable_aed) * 100) || 5 : 5;
  const vat = round2(amount * (vatPct / 100));
  const number = await nextDocumentNumber("credit_note", settings);
  const admin = createAdminClient();
  const { data: cn, error } = await admin.from("invoices").insert({ number, kind: "credit_note", job_id: bundle.invoice.job_id, customer_id: bundle.invoice.customer_id, vehicle_id: bundle.invoice.vehicle_id, credit_of: invoiceId, token: newToken(), subtotal_aed: round2(amount), discount_aed: 0, taxable_aed: round2(amount), vat_aed: vat, total_aed: round2(amount + vat), prepared_by: staff.id, issued_by: staff.id, approved_by: staff.id, notes: `Credit against ${bundle.invoice.number}: ${description}`, customer_snapshot: bundle.invoice.customer_snapshot, vehicle_snapshot: bundle.invoice.vehicle_snapshot, created_by: staff.id, updated_by: staff.id }).select("id").single();
  if (error || !cn) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Could not issue the credit note.")}`);
  await admin.from("invoice_lines").insert({ invoice_id: cn.id, position: 0, section: "services", description, quantity: 1, unit_price: round2(amount), amount_aed: round2(amount), vat_aed: vat, total_aed: round2(amount + vat), created_by: staff.id, updated_by: staff.id });
  if (bundle.invoice.job_id) await admin.from("job_events").insert({ job_id: bundle.invoice.job_id, event_type: "credit_note", note: `${number} issued by ${staff.display_name} against ${bundle.invoice.number}: AED ${round2(amount + vat).toLocaleString("en-GB", { minimumFractionDigits: 2 })} with VAT (${description})`, created_by: staff.id });
  refresh(bundle.invoice.job_id, invoiceId);
  redirect(`/invoices/${cn.id}?message=${encodeURIComponent(`${number} issued.`)}`);
}

/** Records that the "car is ready" message with the invoice went to the customer. */
export async function markReadySent(jobId: string, method: string): Promise<{ error?: string; ok?: boolean }> {
  const staff = await requirePermission("sendApproval");
  const admin = createAdminClient();
  await admin.from("jobs").update({ ready_sent_at: new Date().toISOString() }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "ready_sent", note: `Tax invoice and "your car is ready" sent by ${staff.display_name} (${method})`, created_by: staff.id });
  refresh(jobId);
  return { ok: true };
}

