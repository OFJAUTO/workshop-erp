import "server-only";
import { INVOICE_LINE_SELECT, INVOICE_SELECT, PAYMENT_SELECT, buildInvoiceDraft, invoiceBalance, nextDocumentNumber, toInvoice, toPayment, type InvoiceRow } from "./invoice-data";
import { newToken } from "./media";
import { notifyRoles, notifyStaff } from "./notifications";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { round2 } from "./quotes";
import { formatPlate } from "./types";

type Actor = { id: string; display_name: string } | null;

const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function advisorsOf(jobId: string, gatedInBy: string | null) {
  const { data: appr } = await createAdminClient().from("approval_requests").select("sent_by").eq("job_id", jobId);
  return Array.from(new Set([gatedInBy, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
}

/**
 * The proforma is prepared by itself when the car is Ready (or on demand): a straight copy of the
 * approved quotation, numbered PRO-00001 onwards, with "This is not a tax invoice" on the page. The
 * advisor sends it; payments are recorded against it; the tax invoice follows at zero balance.
 * Returns the invoice the job should show now (a tax invoice if one exists, else the proforma).
 */
export async function ensureProforma(jobId: string, actor: Actor, settings: Settings): Promise<InvoiceRow | null> {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, status, is_open, customer_id, vehicle_id, gated_in_by").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return null;
  const { data: existing } = await admin.from("invoices").select(INVOICE_SELECT).eq("job_id", jobId).eq("status", "issued").eq("is_active", true).in("kind", ["tax_invoice", "proforma"]).is("converted_to", null).order("issued_at", { ascending: false });
  const rows = ((existing ?? []) as Record<string, unknown>[]).map(toInvoice);
  const tax = rows.find((i) => i.kind === "tax_invoice");
  if (tax) return tax;
  const pro = rows.find((i) => i.kind === "proforma");
  if (pro) return pro;

  const draft = await buildInvoiceDraft(jobId, settings);
  if (!draft.lines.length) return null;
  const by = actor?.id ?? job.gated_in_by;
  const [{ data: customer }, { data: vehicle }] = await Promise.all([
    admin.from("customers").select("full_name, company_name, phone, email, trn").eq("id", job.customer_id).maybeSingle(),
    admin.from("vehicles").select("kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", job.vehicle_id).maybeSingle(),
  ]);
  const v = vehicle as unknown as { kind?: "car" | "loose" | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
  const number = await nextDocumentNumber("proforma", settings);
  const token = newToken();
  const { data: inv, error } = await admin
    .from("invoices")
    .insert({
      number,
      kind: "proforma",
      job_id: jobId,
      customer_id: job.customer_id,
      vehicle_id: job.vehicle_id,
      token,
      labour_mode: "itemised",
      subtotal_aed: draft.totals.gross,
      discount_aed: draft.totals.discount,
      taxable_aed: draft.totals.taxable,
      vat_aed: draft.totals.vat,
      total_aed: draft.totals.total,
      agreed_total_aed: null,
      warranty_credit_aed: draft.totals.warrantyCredit,
      discount_note: draft.totals.warrantyCredit ? "Warranty repair, no charge" : draft.totals.discount ? `${draft.totals.discountPercent}% on labour and services, as approved on the quotation` : null,
      prepared_by: job.gated_in_by,
      issued_by: by,
      customer_snapshot: customer ?? null,
      vehicle_snapshot: v ? (v.kind === "loose" ? { title: "Items", variant: null, plate: v.variant ?? "Loose items", vin: null } : { title: [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" "), variant: v.variant, plate: formatPlate(v), vin: v.vin }) : null,
      created_by: by,
      updated_by: by,
    })
    .select(INVOICE_SELECT)
    .single();
  if (error || !inv) throw new Error(error?.message ?? "Could not prepare the proforma.");
  await admin.from("invoice_lines").insert(
    draft.lines.map((l, i) => ({ invoice_id: inv.id, position: i, section: l.section, description: l.description, details: l.details, part_number: l.part_number, quantity: l.quantity, unit_price: l.unit_price, amount_aed: l.amount_aed, vat_aed: round2(l.amount_aed * (draft.vatPercent / 100)), total_aed: round2(l.amount_aed * (1 + draft.vatPercent / 100)), cost_aed: l.cost_aed, quotation_line_id: l.quotation_line_id, part_item_id: l.part_item_id, created_by: by, updated_by: by })),
  );
  // Deposits recorded before the proforma count against it.
  await admin.from("payments").update({ invoice_id: inv.id, updated_by: by }).eq("job_id", jobId).is("invoice_id", null).eq("is_active", true);
  await admin.from("jobs").update({ ready_token: token }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "proforma_issued", note: `${number} prepared: ${money(draft.totals.total)}${actor ? ` (${actor.display_name})` : ""}`, created_by: by });
  await notifyStaff(await advisorsOf(jobId, job.gated_in_by), { type: "invoice_issued", title: `Proforma ready to send · ${job.job_number}`, body: `${number}, ${money(draft.totals.total)}. Send it to the customer: the bank details and Pay now are on the page.`, jobId, href: `/jobs/${jobId}` });
  // Deposits may already cover it: then the tax invoice follows at once.
  const converted = await convertProformaIfPaid(jobId, by, settings);
  return converted ?? toInvoice(inv as unknown as Record<string, unknown>);
}

/**
 * At zero balance the proforma becomes the tax invoice: the next INV number, today's date, the same
 * lines, the payments moved across, marked paid. Accounts are told to check it; the advisor is told
 * it is ready to send. The owner may force it earlier with a reason (accounts are told why).
 */
export async function convertProformaIfPaid(jobId: string, by: string | null, settings: Settings, opts: { force?: { reason: string } } = {}): Promise<InvoiceRow | null> {
  const admin = createAdminClient();
  const { data: proRaw } = await admin.from("invoices").select(INVOICE_SELECT).eq("job_id", jobId).eq("kind", "proforma").eq("status", "issued").eq("is_active", true).is("converted_to", null).order("issued_at", { ascending: false }).limit(1).maybeSingle();
  if (!proRaw) return null;
  const pro = toInvoice(proRaw as Record<string, unknown>);
  const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", pro.id).eq("is_active", true);
  const bal = invoiceBalance(pro, ((pays ?? []) as Record<string, unknown>[]).map(toPayment));
  if (bal.balance > 0.005 && !opts.force) return null;
  const { data: job } = await admin.from("jobs").select("job_number, status, gated_in_by").eq("id", jobId).maybeSingle();
  if (!job) return null;
  const number = await nextDocumentNumber("tax_invoice", settings);
  const token = newToken();
  const { data: lines } = await admin.from("invoice_lines").select(INVOICE_LINE_SELECT).eq("invoice_id", pro.id).eq("is_active", true).order("position");
  const { data: tax, error } = await admin
    .from("invoices")
    .insert({
      number,
      kind: "tax_invoice",
      job_id: jobId,
      customer_id: pro.customer_id,
      vehicle_id: pro.vehicle_id,
      token,
      labour_mode: pro.labour_mode,
      subtotal_aed: pro.subtotal_aed,
      discount_aed: pro.discount_aed,
      taxable_aed: pro.taxable_aed,
      vat_aed: pro.vat_aed,
      total_aed: pro.total_aed,
      agreed_total_aed: pro.agreed_total_aed,
      warranty_credit_aed: pro.warranty_credit_aed,
      discount_note: pro.discount_note,
      prepared_by: pro.prepared_by,
      issued_by: by,
      notes: pro.notes,
      customer_snapshot: pro.customer_snapshot,
      vehicle_snapshot: pro.vehicle_snapshot,
      payment_link_url: pro.payment_link_url,
      converted_from: pro.id,
      issue_reason: opts.force?.reason ?? null,
      created_by: by,
      updated_by: by,
    })
    .select(INVOICE_SELECT)
    .single();
  if (error || !tax) throw new Error(error?.message ?? "Could not generate the tax invoice.");
  if ((lines ?? []).length) {
    await admin.from("invoice_lines").insert(
      ((lines ?? []) as Record<string, unknown>[]).map((l) => {
        const copy = { ...l };
        delete copy.id;
        return { ...copy, invoice_id: tax.id, created_by: by, updated_by: by };
      }),
    );
  }
  await admin.from("payments").update({ invoice_id: tax.id, updated_by: by }).eq("invoice_id", pro.id);
  await admin.from("invoices").update({ converted_to: tax.id, updated_by: by }).eq("id", pro.id);
  await admin.from("jobs").update({ ready_token: token, ...(job.status === "pending_payment" && bal.balance <= 0.005 ? { status: "ready" } : {}) }).eq("id", jobId);
  const paidNote = opts.force ? `${number} issued by the owner before full payment (${money(bal.balance)} still due): ${opts.force.reason}` : `${number} generated: ${pro.number} paid in full`;
  await admin.from("job_events").insert({ job_id: jobId, event_type: "invoice_issued", note: paidNote, created_by: by });
  await notifyRoles(["accounts"], { type: "invoice_issued", title: `Tax invoice ${number} ${opts.force ? "issued" : "generated"} · ${job.job_number}`, body: `${paidNote}. Check it.`, jobId, href: `/invoices/${tax.id}` });
  await notifyStaff(await advisorsOf(jobId, job.gated_in_by), { type: "invoice_issued", title: `Tax invoice ready to send · ${job.job_number}`, body: `${number} is ${opts.force ? "issued" : "generated and marked paid"}. Send it to the customer.`, jobId, href: `/jobs/${jobId}` });
  return toInvoice(tax as unknown as Record<string, unknown>);
}
