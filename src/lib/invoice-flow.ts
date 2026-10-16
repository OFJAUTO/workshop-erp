import "server-only";
import { INVOICE_LINE_SELECT, INVOICE_SELECT, PAYMENT_SELECT, buildInvoiceDraft, invoiceBalance, nextDocumentNumber, toInvoice, toPayment, type InvoiceRow } from "./invoice-data";
import { newToken } from "./media";
import { notifyRoles, notifyStaff } from "./notifications";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { round2 } from "./quotes";
import { approvedQuotations } from "./quote-data";
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
  const pro = rows.find((i) => i.kind === "proforma" && !i.deposit_for_quotation_id);
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
  // A bodyshop deposit proforma folds into this one: its payments move across and it drops out of the balance.
  const { data: deposits } = await admin.from("invoices").select("id").eq("job_id", jobId).in("kind", ["proforma", "tax_invoice"]).eq("is_active", true).is("converted_to", null).not("deposit_for_quotation_id", "is", null).neq("id", inv.id);
  for (const d of deposits ?? []) {
    await admin.from("payments").update({ invoice_id: inv.id, updated_by: by }).eq("invoice_id", d.id).eq("is_active", true);
    await admin.from("invoices").update({ converted_to: inv.id, updated_by: by }).eq("id", d.id);
  }
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
  const { data: proRaw } = await admin.from("invoices").select(INVOICE_SELECT).eq("job_id", jobId).eq("kind", "proforma").eq("status", "issued").eq("is_active", true).is("converted_to", null).is("deposit_for_quotation_id", null).order("issued_at", { ascending: false }).limit(1).maybeSingle();
  if (!proRaw) return null;
  const pro = toInvoice(proRaw as Record<string, unknown>);
  const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", pro.id).eq("is_active", true);
  const bal = invoiceBalance(pro, ((pays ?? []) as Record<string, unknown>[]).map(toPayment));
  if (bal.balance > 0.005 && !opts.force) return null;
  const { data: job } = await admin.from("jobs").select("job_number, status, gated_in_by, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin)").eq("id", jobId).maybeSingle();
  if (!job) return null;
  const plate = job.vehicle ? formatPlate(job.vehicle as unknown as Parameters<typeof formatPlate>[0]) : job.job_number;
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
  await notifyStaff(await advisorsOf(jobId, job.gated_in_by), opts.force
    ? { type: "invoice_issued", title: `Tax invoice ready to send · ${job.job_number}`, body: `${number} is issued by the owner. Send it to the customer.`, jobId, href: `/jobs/${jobId}/invoice` }
    : { type: "invoice_paid", title: `Paid: ${plate}, ${money(pro.total_aed)}`, body: `Tax invoice ${number} created. Send it to the customer, then gate out.`, jobId, href: `/jobs/${jobId}/invoice` });
  return toInvoice(tax as unknown as Record<string, unknown>);
}

/**
 * A tax invoice for one charge on a declined job (for example DIAGNOSIS): issued at once, paid before the car leaves
 * like any invoice. Nothing comes from a quotation.
 */
/**
 * Settings "Deposit document: Tax invoice for the deposit": a tax invoice for the advance payment, VAT taken out of the
 * amount paid, the deposit payment attached to it. It folds into the final proforma like a deposit proforma, and the
 * final tax invoice shows "Less deposit invoiced (INV-…)".
 */
export async function createDepositInvoice(jobId: string, paymentId: string, amount: number, actor: { id: string | null; display_name: string } | null, settings: Settings): Promise<{ id: string; number: string } | { error: string }> {
  const admin = createAdminClient();
  const [{ data: job }, quotes] = await Promise.all([admin.from("jobs").select("id, job_number, customer_id, vehicle_id, gated_in_by").eq("id", jobId).maybeSingle(), approvedQuotations(jobId)]);
  if (!job) return { error: "Job not found." };
  const q = quotes[0] ?? null;
  const vatPercent = Number((settings as unknown as Record<string, unknown>).vat_percent) || 5;
  const total = round2(amount);
  if (!(total > 0)) return { error: "No amount." };
  const taxable = round2(total / (1 + vatPercent / 100));
  const vat = round2(total - taxable);
  const [{ data: customer }, { data: vehicle }] = await Promise.all([
    admin.from("customers").select("full_name, company_name, phone, email, trn").eq("id", job.customer_id).maybeSingle(),
    admin.from("vehicles").select("kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", job.vehicle_id).maybeSingle(),
  ]);
  const v = vehicle as unknown as { kind?: "car" | "loose" | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
  const number = await nextDocumentNumber("tax_invoice", settings);
  const token = newToken();
  const by = actor?.id ?? job.gated_in_by ?? null;
  const description = `Advance payment (deposit)${q ? ` against quotation ${q.number}` : ""}`;
  const { data: inv, error } = await admin
    .from("invoices")
    .insert({
      number, kind: "tax_invoice", job_id: jobId, customer_id: job.customer_id, vehicle_id: job.vehicle_id, token, labour_mode: "itemised",
      subtotal_aed: taxable, discount_aed: 0, taxable_aed: taxable, vat_aed: vat, total_aed: total, agreed_total_aed: null, warranty_credit_aed: 0,
      issue_reason: "Advance payment (deposit)", deposit_for_quotation_id: q?.id ?? null, prepared_by: job.gated_in_by, issued_by: by, customer_snapshot: customer ?? null,
      vehicle_snapshot: v ? (v.kind === "loose" ? { title: "Items", variant: null, plate: v.variant ?? "Loose items", vin: null } : { title: [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" "), variant: v.variant, plate: formatPlate(v), vin: v.vin }) : null,
      created_by: by, updated_by: by,
    })
    .select("id, number")
    .single();
  if (error || !inv) return { error: error?.message ?? "Could not make the deposit invoice." };
  await admin.from("invoice_lines").insert({ invoice_id: inv.id, position: 0, section: "services", description, details: null, part_number: null, quantity: 1, unit_price: taxable, amount_aed: taxable, vat_aed: vat, total_aed: total, cost_aed: null, quotation_line_id: null, part_item_id: null });
  await admin.from("payments").update({ invoice_id: inv.id, deposit_invoice_number: inv.number, updated_by: by }).eq("id", paymentId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "invoice_issued", note: `${inv.number} issued for the deposit (AED ${total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}) by ${actor?.display_name ?? "staff"}`, created_by: by });
  return { id: inv.id as string, number: inv.number as string };
}

export async function createChargeInvoice(jobId: string, actor: Actor, settings: Settings, charge: { description: string; amount: number }): Promise<{ id: string; number: string; token: string; total: number } | { error: string }> {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, customer_id, vehicle_id, gated_in_by").eq("id", jobId).maybeSingle();
  if (!job) return { error: "Job not found." };
  const description = charge.description.trim().slice(0, 200);
  const amount = round2(charge.amount);
  if (!description || !(amount > 0)) return { error: "Give the charge a name and an amount." };
  const vatPercent = Number((settings as unknown as Record<string, unknown>).vat_percent) || 5;
  const vat = round2(amount * (vatPercent / 100));
  const total = round2(amount + vat);
  const [{ data: customer }, { data: vehicle }] = await Promise.all([
    admin.from("customers").select("full_name, company_name, phone, email, trn").eq("id", job.customer_id).maybeSingle(),
    admin.from("vehicles").select("kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", job.vehicle_id).maybeSingle(),
  ]);
  const v = vehicle as unknown as { kind?: "car" | "loose" | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
  const number = await nextDocumentNumber("tax_invoice", settings);
  const token = newToken();
  const by = actor?.id ?? job.gated_in_by ?? null;
  const { data: inv, error } = await admin
    .from("invoices")
    .insert({
      number, kind: "tax_invoice", job_id: jobId, customer_id: job.customer_id, vehicle_id: job.vehicle_id, token, labour_mode: "itemised",
      subtotal_aed: amount, discount_aed: 0, taxable_aed: amount, vat_aed: vat, total_aed: total, agreed_total_aed: null, warranty_credit_aed: 0,
      issue_reason: "Charge on a declined quotation", prepared_by: job.gated_in_by, issued_by: by, customer_snapshot: customer ?? null,
      vehicle_snapshot: v ? (v.kind === "loose" ? { title: "Items", variant: null, plate: v.variant ?? "Loose items", vin: null } : { title: [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" "), variant: v.variant, plate: formatPlate(v), vin: v.vin }) : null,
      created_by: by, updated_by: by,
    })
    .select("id, number, token")
    .single();
  if (error || !inv) return { error: error?.message ?? "Could not make the invoice." };
  await admin.from("invoice_lines").insert({ invoice_id: inv.id, position: 0, section: "services", description, details: null, part_number: null, quantity: 1, unit_price: amount, amount_aed: amount, vat_aed: vat, total_aed: total, cost_aed: null, quotation_line_id: null, part_item_id: null, created_by: by, updated_by: by });
  await admin.from("job_events").insert({ job_id: jobId, event_type: "invoice_issued", note: `${inv.number} issued for ${description} (AED ${total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}) by ${actor?.display_name ?? "staff"}`, created_by: by });
  return { id: inv.id as string, number: inv.number as string, token: inv.token as string, total };
}

/**
 * The customer approved a revised quotation after a proforma was already out: the old proforma is cancelled and a new
 * one is made from the approved lines, with every payment carried across (and converted to the tax invoice at once if
 * the balance is already covered). A tax invoice is never touched here: a quotation cannot be revised once one exists.
 */
export async function replaceProformaAfterRevision(jobId: string, by: string | null, settings: Settings): Promise<InvoiceRow | null> {
  const admin = createAdminClient();
  const { data: proRaw } = await admin.from("invoices").select(INVOICE_SELECT).eq("job_id", jobId).eq("kind", "proforma").eq("status", "issued").eq("is_active", true).is("converted_to", null).is("deposit_for_quotation_id", null).order("issued_at", { ascending: false }).limit(1).maybeSingle();
  if (!proRaw) return null;
  const old = toInvoice(proRaw as Record<string, unknown>);
  const { data: who } = by ? await admin.from("staff").select("display_name").eq("id", by).maybeSingle() : { data: null };
  await admin.from("invoices").update({ status: "cancelled", issue_reason: "Replaced: the quotation was revised and approved again", updated_by: by }).eq("id", old.id);
  const fresh = await ensureProforma(jobId, by ? { id: by, display_name: who?.display_name ?? "staff" } : null, settings);
  if (!fresh) return null;
  if (fresh.kind === "proforma") {
    await admin.from("payments").update({ invoice_id: fresh.id, updated_by: by }).eq("invoice_id", old.id).eq("is_active", true);
    await admin.from("job_events").insert({ job_id: jobId, event_type: "proforma_replaced", note: `${old.number} cancelled and ${fresh.number} issued after the revised quotation was approved (${money(fresh.total_aed)})`, created_by: by });
    const converted = await convertProformaIfPaid(jobId, by, settings);
    return converted ?? fresh;
  }
  return fresh;
}
