"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { INVOICE_SELECT, PAYMENT_SELECT, buildInvoiceDraft, invoiceBalance, loadInvoice, nextDocumentNumber, toInvoice, toPayment, type InvoiceKind, type LabourMode } from "@/lib/invoice-data";
import { newToken } from "@/lib/media";
import { round2 } from "@/lib/money";
import { notifyRoles, notifyStaff } from "@/lib/notifications";
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
      discount_note: draft.totals.discount ? `${draft.totals.discountPercent}% on labour and services${draft.totals.agreedTotalApplied ? " (agreed total)" : ""}` : null,
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
    await admin.from("job_events").insert({ job_id: jobId, event_type: "invoice_issued", from_status: job.status, to_status: bal.balance > 0 ? "pending_payment" : "ready", note: `${number} issued by ${staff.display_name}: AED ${draft.totals.total.toLocaleString("en-GB", { minimumFractionDigits: 2 })} with VAT${bal.paid ? `, AED ${bal.paid.toLocaleString("en-GB")} already received` : ""}`, created_by: staff.id });
    const advisors = await advisorsOf(jobId);
    await notifyStaff(advisors, { type: "invoice_issued", title: `Invoice issued · ${job.job_number}`, body: `${number}, AED ${draft.totals.total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}. Send the customer the "car is ready" message from the job card.`, jobId, href: `/jobs/${jobId}` });
  } else {
    await admin.from("job_events").insert({ job_id: jobId, event_type: "proforma_issued", note: `${number} issued by ${staff.display_name}`, created_by: staff.id });
  }
  refresh(jobId, inv.id);
  redirect(`/invoices/${inv.id}?message=${encodeURIComponent(`${number} issued.`)}`);
}

/** A payment: cash, card, link or cheque, against an invoice or as a deposit on the job. Card and link carry the bank charge from Settings. */
export async function recordPayment(formData: FormData) {
  const staff = await requirePermission("recordPayments");
  const admin = createAdminClient();
  const settings = await getSettings();
  const invoiceId = blankToNull(formData.get("invoice_id"));
  const jobIdIn = blankToNull(formData.get("job_id"));
  const method = String(formData.get("method") ?? "");
  const amount = Number(String(formData.get("amount") ?? "").replace(/[^\d.]/g, ""));
  const reference = blankToNull(formData.get("reference"));
  // Back to the page the payment came from, keeping its options (the invoice build page carries labour, consumables and the agreed total in its address).
  const returnTo = blankToNull(formData.get("return_to"));
  const base = invoiceId ? `/invoices/${invoiceId}` : jobIdIn ? `/jobs/${jobIdIn}/invoice` : "/invoices";
  const back = returnTo && returnTo.startsWith(base) && !returnTo.includes("message=") && !returnTo.includes("error=") ? returnTo : base;
  const sep = back.includes("?") ? "&" : "?";
  if (!["cash", "card", "link", "cheque"].includes(method)) redirect(`${back}${sep}error=${encodeURIComponent("Choose the payment method.")}`);
  if (!Number.isFinite(amount) || amount <= 0) redirect(`${back}?error=${encodeURIComponent("Enter the amount received.")}`);
  let jobId = jobIdIn;
  let customerId: string | null = null;
  let invoice = null as Awaited<ReturnType<typeof loadInvoice>>;
  if (invoiceId) {
    invoice = await loadInvoice(invoiceId);
    if (!invoice || invoice.invoice.status !== "issued") redirect(`${back}?error=${encodeURIComponent("Invoice not found.")}`);
    jobId = invoice.invoice.job_id;
    customerId = invoice.invoice.customer_id;
  } else if (jobId) {
    const { data: job } = await admin.from("jobs").select("customer_id").eq("id", jobId).maybeSingle();
    customerId = job?.customer_id ?? null;
  }
  if (!customerId) redirect(`${back}?error=${encodeURIComponent("Choose the invoice or the job.")}`);
  const cheque = method === "cheque" ? { cheque_number: blankToNull(formData.get("cheque_number")), cheque_bank: blankToNull(formData.get("cheque_bank")), cheque_date: blankToNull(formData.get("cheque_date")), cheque_status: "pending" as const } : {};
  if (method === "cheque" && (!cheque.cheque_number || !cheque.cheque_bank || !cheque.cheque_date)) redirect(`${back}?error=${encodeURIComponent("A cheque needs its number, bank and date.")}`);
  const pct = method === "card" ? Number(settings.bank_charge_card_percent) || 0 : method === "link" ? Number(settings.bank_charge_link_percent) || 0 : 0;
  const { data: created, error } = await admin.from("payments").insert({ job_id: jobId, invoice_id: invoiceId, customer_id: customerId, method, amount_aed: round2(amount), reference, ...cheque, bank_charge_aed: round2(amount * (pct / 100)), is_deposit: !invoiceId, received_by: staff.id, notes: blankToNull(formData.get("notes")), created_by: staff.id, updated_by: staff.id }).select("id, number").single();
  if (error || !created) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Could not record the payment.")}`);
  if (jobId) await admin.from("job_events").insert({ job_id: jobId, event_type: "payment", note: `${created.number}: AED ${round2(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })} by ${method}${method === "cheque" ? " (pending clearance)" : ""}${invoiceId ? "" : " as a deposit"} received by ${staff.display_name}`, created_by: staff.id });
  if (invoice && jobId) await settleJob(jobId, invoice.invoice.id, staff.id);
  if (jobId) {
    const advisors = await advisorsOf(jobId);
    await notifyStaff(advisors, { type: "payment_received", title: `Payment received · ${created.number}`, body: `AED ${round2(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })} by ${method}${invoiceId ? "" : " (deposit)"}`, jobId, href: invoiceId ? `/invoices/${invoiceId}` : `/jobs/${jobId}` });
  }
  refresh(jobId, invoiceId ?? undefined);
  redirect(`${back}?message=${encodeURIComponent(`${created.number} recorded.${method === "cheque" ? " The cheque counts as unpaid until it clears." : ""}`)}`);
}

/** After a payment or a cheque change: the job is Ready when the invoice is settled, pending payment otherwise. */
async function settleJob(jobId: string, invoiceId: string, by: string) {
  const admin = createAdminClient();
  const [{ data: inv }, { data: pays }, { data: job }] = await Promise.all([
    admin.from("invoices").select(INVOICE_SELECT).eq("id", invoiceId).maybeSingle(),
    admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", invoiceId).eq("is_active", true),
    admin.from("jobs").select("status, is_open").eq("id", jobId).maybeSingle(),
  ]);
  if (!inv || !job || !job.is_open) return;
  const bal = invoiceBalance(toInvoice(inv as Record<string, unknown>), ((pays ?? []) as Record<string, unknown>[]).map(toPayment));
  if (job.status === "pending_payment" && bal.balance <= 0) {
    await admin.from("jobs").update({ status: "ready" }).eq("id", jobId);
    await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: "pending_payment", to_status: "ready", note: "Invoice paid in full", created_by: by });
  } else if (job.status === "ready" && bal.balance > 0) {
    await admin.from("jobs").update({ status: "pending_payment" }).eq("id", jobId);
  }
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

/** Records that the "car is ready" message went to the customer. */
export async function markReadySent(jobId: string, method: string): Promise<{ error?: string; ok?: boolean }> {
  const staff = await requirePermission("sendApproval");
  const admin = createAdminClient();
  await admin.from("jobs").update({ ready_sent_at: new Date().toISOString() }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "ready_sent", note: `"Your car is ready" sent by ${staff.display_name} (${method})`, created_by: staff.id });
  refresh(jobId);
  return { ok: true };
}
