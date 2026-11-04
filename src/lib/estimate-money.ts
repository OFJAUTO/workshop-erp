import "server-only";
/**
 * Money from the estimate (4 November 2026) — the server side. A proforma invoice issued from an
 * ESTIMATE before any job exists (complete, or partial as % / AED), recorded payments against it, and
 * the automatic tax invoice the moment it is paid:
 *
 * - COMPLETE proforma paid  -> the tax invoice for the WHOLE bill (the estimate's own lines), queued
 *   for Zoho like any tax invoice.
 * - PARTIAL proforma paid   -> an "ADVANCE PAYMENT AGAINST ESTIMATE E-xxxxx" tax invoice (VAT inside
 *   the amount), marked as a deposit document (deposit_for_quotation_id), so Zoho carries the money as
 *   an unapplied advance and the job's final invoice deducts it — nothing is ever counted twice.
 *
 * Everything stays dormant until the migration is applied (estimateMoneyReady).
 */
import { INVOICE_LINE_SELECT, INVOICE_SELECT, PAYMENT_SELECT, draftFrom, invoiceBalance, nextDocumentNumber, toInvoice, toPayment, type InvoiceRow, type PaymentRow } from "./invoice-data";
import { LINE_SELECT, toLine, type ApprovedQuote } from "./quote-data";
import { OPEN_ESTIMATE_STATUSES } from "./quote-history";
import { advanceSplit, advanceWordsOf, billToProblem, billToWords, cleanBillTo, estimateBadge, paidOfWords, partialOf, validUntilFrom, type BillTo, type EstimateMoneyState } from "./estimate-money-rules";
import { estimateMoneyReady } from "./schema-ready";
import { newToken } from "./media";
import { notifyRoles, notifyStaff } from "./notifications";
import { quoteLeadIds } from "./quote-lead";
import { round2 } from "./quotes";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";
import { tryEnqueueZoho } from "./zoho-sync";
import { logAppError } from "./app-errors";

type Actor = { id: string | null; display_name: string } | null;
const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const EST_COLS = "id, number, version, kind, status, customer_id, vehicle_id, job_id, carried_job_id, vat_percent, discount_percent, discount_kind, discount_value, discount_scope, rounded_total_aed, total_aed, deposit_aed, validity_days, bill_to, is_active, deleted_at, cancelled_at";
export type EstimateRow = {
  id: string; number: string; version: number; kind: string; status: string; customer_id: string; vehicle_id: string | null; job_id: string | null;
  carried_job_id: string | null; vat_percent: number | string | null; discount_percent: number | string | null; discount_kind: "percent" | "aed" | null;
  discount_value: number | string | null; discount_scope: "labour" | "labour_services" | null; rounded_total_aed: number | string | null;
  total_aed: number | string | null; deposit_aed: number | string | null; validity_days: number | null; bill_to: BillTo | null; is_active: boolean;
  deleted_at: string | null; cancelled_at: string | null;
};

async function loadEstimate(id: string): Promise<EstimateRow | null> {
  const { data } = await createAdminClient().from("quotations").select(EST_COLS).eq("id", id).maybeSingle();
  const e = data as EstimateRow | null;
  return e && e.kind === "estimate" ? e : null;
}

/** Every version id of each estimate's NUMBER (a revision makes a new row; its documents must stay counted). */
async function familyIdsOf(estimateIds: string[]): Promise<Map<string, { number: string; ids: string[] }>> {
  const admin = createAdminClient();
  const out = new Map<string, { number: string; ids: string[] }>();
  const ids = Array.from(new Set(estimateIds.filter(Boolean)));
  if (!ids.length) return out;
  const { data: asked } = await admin.from("quotations").select("id, number").in("id", ids);
  const numbers = Array.from(new Set(((asked ?? []) as { id: string; number: string }[]).map((q) => q.number)));
  if (!numbers.length) return out;
  const { data: fam } = await admin.from("quotations").select("id, number").eq("kind", "estimate").in("number", numbers);
  const byNumber = new Map<string, string[]>();
  for (const q of (fam ?? []) as { id: string; number: string }[]) byNumber.set(q.number, [...(byNumber.get(q.number) ?? []), q.id]);
  for (const q of (asked ?? []) as { id: string; number: string }[]) out.set(q.id, { number: q.number, ids: byNumber.get(q.number) ?? [q.id] });
  return out;
}

export type EstimateMoneyView = EstimateMoneyState & {
  estimateId: string;
  number: string;
  /** The open (unconverted) proforma, if any. */
  proforma: InvoiceRow | null;
  /** Every live tax invoice of the family (advance ones carry deposit_for_quotation_id). */
  taxInvoices: InvoiceRow[];
  payments: PaymentRow[];
  balance: number;
  badge: ReturnType<typeof estimateBadge>;
  paidWords: string | null;
};

/** The money of each estimate (by its current version id): documents, payments, paid-of-total, the badge. */
export async function estimateMoneyMany(estimateIds: string[], opts: { totals?: Map<string, number> } = {}): Promise<Map<string, EstimateMoneyView>> {
  const out = new Map<string, EstimateMoneyView>();
  if (!estimateIds.length || !(await estimateMoneyReady())) return out;
  const admin = createAdminClient();
  const fam = await familyIdsOf(estimateIds);
  const allIds = Array.from(new Set(Array.from(fam.values()).flatMap((f) => f.ids)));
  if (!allIds.length) return out;
  const [{ data: invRaw }, { data: estRows }] = await Promise.all([
    admin.from("invoices").select(INVOICE_SELECT + ", estimate_id, bill_to, valid_until").in("estimate_id", allIds).eq("is_active", true),
    admin.from("quotations").select("id, number, status, rounded_total_aed, total_aed").in("id", allIds),
  ]);
  const invoices = ((invRaw ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ ...toInvoice(r), estimate_id: String(r.estimate_id), bill_to: (r.bill_to as BillTo | null) ?? null, valid_until: (r.valid_until as string | null) ?? null }));
  const invIds = invoices.map((i) => i.id);
  const payRaw = invIds.length ? (await admin.from("payments").select(PAYMENT_SELECT).in("invoice_id", invIds).eq("is_active", true)).data : [];
  const payments = ((payRaw ?? []) as Record<string, unknown>[]).map(toPayment).filter((p) => p.status !== "voided" && p.status !== "reversed");
  for (const [askedId, f] of fam) {
    const famSet = new Set(f.ids);
    const docs = invoices.filter((i) => famSet.has(i.estimate_id) && i.status === "issued");
    const proforma = docs.find((i) => i.kind === "proforma" && !i.converted_to) ?? null;
    const taxes = docs.filter((i) => i.kind === "tax_invoice");
    const docIds = new Set(docs.map((d) => d.id));
    const pays = payments.filter((p) => p.invoice_id && docIds.has(p.invoice_id));
    const cleared = pays.filter((p) => p.method !== "cheque" || p.cheque_status === "cleared");
    const pendingCheque = round2(pays.filter((p) => p.method === "cheque" && p.cheque_status !== "cleared" && p.cheque_status !== "bounced").reduce((a, p) => a + p.amount_aed, 0));
    const paid = round2(cleared.reduce((a, p) => a + p.amount_aed, 0));
    // The figure the badge measures against: the newest APPROVED version's total (rounded when rounded), else the asked row's.
    const ests = ((estRows ?? []) as { id: string; status: string; rounded_total_aed: number | string | null; total_aed: number | string | null }[]).filter((q) => famSet.has(q.id));
    const approved = ests.filter((q) => q.status === "approved").at(-1) ?? ests.find((q) => q.id === askedId) ?? ests.at(-1);
    const total = opts.totals?.get(askedId) ?? round2(Number(approved?.rounded_total_aed ?? approved?.total_aed ?? 0) || 0);
    const advanceInvoiced = round2(taxes.filter((t) => t.deposit_for_quotation_id && !t.converted_to).reduce((a, t) => a + t.total_aed, 0));
    const fullyInvoiced = taxes.some((t) => !t.deposit_for_quotation_id && !t.converted_to);
    const state: EstimateMoneyState = {
      total,
      paid,
      pendingCheque,
      proformaOpen: !!proforma,
      proformaComplete: !!proforma && !/partial/i.test(String(proforma.issue_reason ?? "")),
      fullyInvoiced,
      advanceInvoiced,
    };
    out.set(askedId, { ...state, estimateId: askedId, number: f.number, proforma, taxInvoices: taxes, payments: pays, balance: round2(Math.max(0, total - paid)), badge: estimateBadge(state), paidWords: paidOfWords(state) });
  }
  return out;
}

export const estimateMoneyOf = async (estimateId: string): Promise<EstimateMoneyView | null> => (await estimateMoneyMany([estimateId])).get(estimateId) ?? null;

/** The estimate behind a job-less invoice (null when it is not an estimate's document). */
export async function estimateOfInvoice(invoiceId: string): Promise<{ estimateId: string; number: string } | null> {
  if (!(await estimateMoneyReady())) return null;
  const { data } = await createAdminClient().from("invoices").select("estimate_id").eq("id", invoiceId).maybeSingle();
  const estId = (data?.estimate_id as string | null) ?? null;
  if (!estId) return null;
  const { data: q } = await createAdminClient().from("quotations").select("id, number").eq("id", estId).maybeSingle();
  return q ? { estimateId: String(q.id), number: String(q.number) } : null;
}

/**
 * The PROFORMA INVOICE from an estimate. Complete = the estimate's own lines and total through THE
 * draft rule (draftFrom: same discount, same rounded total, VAT fit); partial = one advance line with
 * the VAT inside the amount. One open proforma per estimate at a time.
 */
export async function createEstimateProforma(
  estimateId: string,
  input: { mode: "complete" | "partial"; partial?: { kind: "percent" | "aed"; value: number }; billTo?: Partial<Record<keyof BillTo, unknown>> | null; validityDays?: number | null },
  staff: { id: string; display_name: string },
  settings: Settings,
): Promise<{ invoice?: InvoiceRow & { valid_until?: string | null }; error?: string }> {
  if (!(await estimateMoneyReady())) return { error: "The estimate proforma needs the database update first (waiting for apply)." };
  const admin = createAdminClient();
  const e = await loadEstimate(estimateId);
  if (!e || !e.is_active || e.deleted_at) return { error: "Estimate not found." };
  if (e.cancelled_at || e.status === "cancelled") return { error: "This estimate was cancelled." };
  if (e.carried_job_id || e.job_id) return { error: "The car is here: record money on the job's money page." };
  if (input.mode === "complete" && e.status !== "approved") return { error: "A complete proforma needs the customer's acceptance first. Send a partial one (a deposit) instead." };
  if (input.mode === "partial" && !OPEN_ESTIMATE_STATUSES.includes(e.status as (typeof OPEN_ESTIMATE_STATUSES)[number])) return { error: `This estimate is ${e.status}: no proforma can be issued on it.` };
  const billTo = cleanBillTo(input.billTo);
  const btProblem = billToProblem(billTo);
  if (btProblem) return { error: btProblem };
  const current = await estimateMoneyOf(estimateId);
  if (current?.proforma) return { error: `Proforma ${current.proforma.number} is already out on ${e.number}. Record the payment against it, or void it first.` };
  if (current?.fullyInvoiced) return { error: `${e.number} is fully invoiced already (tax invoice out).` };

  // The figures: the whole bill through THE draft rule, or the advance with VAT inside.
  const vatPercent = Number(e.vat_percent) || 5;
  let totals: { gross: number; discount: number; taxable: number; vat: number; total: number };
  let lines: { section: "services" | "parts" | "fees"; description: string; details: string | null; positions: string[] | null; part_number: string | null; quantity: number; unit_price: number; amount_aed: number; cost_aed: number; quotation_line_id: string | null; price_display: string; discount_percent: number; package_items: unknown; cut_method: string | null; cut_note: string | null }[];
  let discountNote: string | null = null;
  if (input.mode === "complete") {
    const { data: lineRaw, error: lineReadErr } = await admin.from("quotation_lines").select(LINE_SELECT).eq("quotation_id", e.id).eq("is_active", true).order("position").order("id");
    if (lineReadErr) {
      await logAppError("estimate proforma: read lines", lineReadErr, { staffId: staff.id, detail: { estimateId } });
      return { error: "Couldn't read the estimate's lines right now. Try again." };
    }
    const quote: ApprovedQuote = { id: e.id, number: e.number, version: e.version, discount_percent: Number(e.discount_percent) || 0, vat_percent: vatPercent, deposit_aed: Number(e.deposit_aed) || 0, total_aed: Number(e.total_aed) || 0, discount_kind: e.discount_kind, discount_value: e.discount_value === null ? null : Number(e.discount_value), discount_scope: e.discount_scope, rounded_total_aed: e.rounded_total_aed === null ? null : Number(e.rounded_total_aed) };
    const draft = draftFrom({ job: null, quotes: [quote], lines: ((lineRaw ?? []) as Record<string, unknown>[]).map(toLine), parts: [], charges: [] }, settings);
    if (!draft.lines.length) return { error: "The estimate has no lines to invoice." };
    totals = { gross: draft.totals.gross, discount: draft.totals.discount, taxable: draft.totals.taxable, vat: draft.totals.vat, total: draft.totals.total };
    discountNote = draft.totals.discount ? `${draft.totals.discountPercent}% on labour and services, as on the estimate` : null;
    lines = draft.lines.map((l) => ({ section: l.section, description: l.description, details: l.details, positions: l.positions ?? null, part_number: l.part_number, quantity: l.quantity, unit_price: l.unit_price, amount_aed: l.amount_aed, cost_aed: l.cost_aed, quotation_line_id: l.quotation_line_id, price_display: l.price_display ?? "normal", discount_percent: l.discount_percent ?? 0, package_items: l.package_items ?? null, cut_method: l.cut_method ?? null, cut_note: l.cut_note ?? null }));
  } else {
    const total = round2(Number(e.rounded_total_aed ?? e.total_aed ?? 0) || 0);
    const p = partialOf(input.partial?.kind ?? "aed", Number(input.partial?.value), total || Number.MAX_SAFE_INTEGER);
    if ("error" in p) return { error: p.error };
    const split = advanceSplit(p.amount, vatPercent);
    totals = { gross: split.taxable, discount: 0, taxable: split.taxable, vat: split.vat, total: split.total };
    lines = [{ section: "services", description: advanceWordsOf(e.number), details: "VAT included in this amount", positions: null, part_number: null, quantity: 1, unit_price: split.taxable, amount_aed: split.taxable, cost_aed: 0, quotation_line_id: null, price_display: "normal", discount_percent: 0, package_items: null, cut_method: null, cut_note: null }];
  }

  const [{ data: customer }, { data: vehicle }] = await Promise.all([
    admin.from("customers").select("full_name, company_name, phone, email, trn").eq("id", e.customer_id).maybeSingle(),
    e.vehicle_id ? admin.from("vehicles").select("kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", e.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const v = vehicle as unknown as (Parameters<typeof formatPlate>[0] & { variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null }) | null;
  const number = await nextDocumentNumber("proforma", settings);
  const validUntil = validUntilFrom(Date.now(), input.validityDays ?? e.validity_days ?? 7);
  const { data: inv, error } = await admin
    .from("invoices")
    .insert({
      number, kind: "proforma", job_id: null, estimate_id: e.id, customer_id: e.customer_id, vehicle_id: e.vehicle_id, token: newToken(), labour_mode: "itemised",
      // A PARTIAL proforma is a deposit document from birth (like the bodyshop deposit proformas): once the
      // car arrives, the job's final proforma folds it in and Zoho never sees it as an invoice.
      ...(input.mode === "partial" ? { deposit_for_quotation_id: e.id } : {}),
      subtotal_aed: totals.gross, discount_aed: totals.discount, taxable_aed: totals.taxable, vat_aed: totals.vat, total_aed: totals.total, agreed_total_aed: null, warranty_credit_aed: 0,
      discount_note: discountNote, bill_to: billTo, valid_until: validUntil,
      issue_reason: input.mode === "complete" ? `Estimate ${e.number} (complete)` : `Estimate ${e.number} (partial advance)`,
      notes: "PROFORMA INVOICE – not a tax invoice. The tax invoice is issued the moment the payment is received.",
      prepared_by: staff.id, issued_by: staff.id, customer_snapshot: customer ?? null,
      vehicle_snapshot: v ? { title: [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" "), variant: v.variant, plate: formatPlate(v), vin: v.vin } : null,
      created_by: staff.id, updated_by: staff.id,
    })
    .select(INVOICE_SELECT + ", estimate_id, bill_to, valid_until")
    .single();
  const invRow = inv as unknown as (Record<string, unknown> & { id: string; valid_until?: string | null }) | null;
  if (error || !invRow) {
    await logAppError("estimate proforma: insert", error ?? new Error("no row"), { staffId: staff.id, detail: { estimateId } });
    return { error: "Couldn't save – nothing was recorded. Try again or tell the owner." };
  }
  const { error: lineErr } = await admin.from("invoice_lines").insert(lines.map((l, i) => ({ invoice_id: invRow.id, position: i, section: l.section, description: l.description, details: l.details, positions: l.positions, part_number: l.part_number, quantity: l.quantity, unit_price: l.unit_price, amount_aed: l.amount_aed, vat_aed: round2(l.amount_aed * (vatPercent / 100)), total_aed: round2(l.amount_aed * (1 + vatPercent / 100)), cost_aed: l.cost_aed, quotation_line_id: l.quotation_line_id, part_item_id: null, price_display: l.price_display, discount_percent: l.discount_percent, package_items: l.package_items, cut_method: l.cut_method, cut_note: l.cut_note, created_by: staff.id, updated_by: staff.id })));
  if (lineErr) {
    await admin.from("invoices").update({ is_active: false, status: "cancelled", updated_by: staff.id }).eq("id", invRow.id);
    await logAppError("estimate proforma: lines", lineErr, { staffId: staff.id, detail: { estimateId, invoiceId: invRow.id } });
    return { error: "Couldn't save – nothing was recorded. Try again or tell the owner." };
  }
  // The typed bill-to is kept on the estimate so every later document starts from it.
  await admin.from("quotations").update({ bill_to: billTo, updated_by: staff.id }).eq("id", e.id);
  await admin.from("quotation_events").insert({ quotation_id: e.id, job_id: null, event_type: "proforma_issued", note: `${number} (${input.mode === "complete" ? "complete" : "partial advance"}, ${money(totals.total)}) issued by ${staff.display_name}${billTo ? ` · bill to ${billToWords(billTo)[0] ?? ""}` : ""}`, created_by: staff.id });
  await notifyRoles(["accounts"], { type: "invoice_issued", title: `Estimate proforma ${number} · ${e.number}`, body: `${money(totals.total)} (${input.mode === "complete" ? "the whole bill" : "partial advance"}) for ${e.number} – the car is not here yet. Record the payment when it arrives; the tax invoice follows by itself.`, href: `/estimates/${e.id}` });
  return { invoice: { ...toInvoice(invRow), valid_until: invRow.valid_until ?? validUntil } };
}

/** An unpaid estimate proforma can be voided (owner + accounts; logged). Refused once money sits on it. */
export async function voidEstimateProforma(invoiceId: string, reason: string, staff: { id: string; display_name: string; role_id: string }): Promise<{ error?: string }> {
  if (!["owner", "accounts"].includes(staff.role_id)) return { error: "Only accounts or the owner void a proforma." };
  const admin = createAdminClient();
  const { data: rawQ } = await admin.from("invoices").select(INVOICE_SELECT + ", estimate_id").eq("id", invoiceId).maybeSingle();
  const raw = rawQ as unknown as (Record<string, unknown> & { kind: string; estimate_id: string | null; converted_to: string | null; number: string }) | null;
  if (!raw || raw.kind !== "proforma" || !raw.estimate_id) return { error: "Not an estimate proforma." };
  if (raw.converted_to) return { error: "It already became a tax invoice." };
  const { count } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("invoice_id", invoiceId).eq("is_active", true).neq("status", "voided");
  if ((count ?? 0) > 0) return { error: "Money was recorded on it: it cannot be voided. Refund or move the payment first." };
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) return { error: "Write why it is voided (logged)." };
  await admin.from("invoices").update({ status: "cancelled", issue_reason: `Voided: ${why}`, updated_by: staff.id }).eq("id", invoiceId);
  await admin.from("quotation_events").insert({ quotation_id: raw.estimate_id, job_id: null, event_type: "proforma_voided", note: `${raw.number} voided by ${staff.display_name}: ${why}`, created_by: staff.id });
  return {};
}

/**
 * The estimate proforma reached zero balance: the TAX INVOICE is issued by itself.
 * Complete -> the whole bill's tax invoice, queued for Zoho. Partial -> the advance tax invoice
 * (deposit document: Zoho carries the money as an advance; the job's final invoice deducts it).
 */
export async function convertEstimateProformaIfPaid(invoiceId: string, by: Actor, settings: Settings, force?: { reason: string }): Promise<InvoiceRow | null> {
  if (!(await estimateMoneyReady())) return null;
  const admin = createAdminClient();
  const { data: proQ } = await admin.from("invoices").select(INVOICE_SELECT + ", estimate_id, bill_to, valid_until").eq("id", invoiceId).maybeSingle();
  const proRaw = proQ as unknown as (Record<string, unknown> & { kind: string; estimate_id: string | null; status: string; converted_to: string | null; issue_reason: string | null; bill_to: BillTo | null }) | null;
  if (!proRaw || proRaw.kind !== "proforma" || !proRaw.estimate_id || proRaw.status !== "issued" || proRaw.converted_to) return null;
  const pro = toInvoice(proRaw);
  const estimateId = String(proRaw.estimate_id);
  const { data: est } = await admin.from("quotations").select("id, number, customer_id, vehicle_id").eq("id", estimateId).maybeSingle();
  if (!est) return null;
  const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", pro.id).eq("is_active", true);
  const bal = invoiceBalance(pro, ((pays ?? []) as Record<string, unknown>[]).map(toPayment));
  if (bal.balance > 0.005 && !force) return null;
  const partial = /partial/i.test(String(proRaw.issue_reason ?? ""));
  const number = await nextDocumentNumber("tax_invoice", settings);
  const { data: lines } = await admin.from("invoice_lines").select(INVOICE_LINE_SELECT).eq("invoice_id", pro.id).eq("is_active", true).order("position");
  const { data: tax, error } = await admin
    .from("invoices")
    .insert({
      number, kind: "tax_invoice", job_id: null, estimate_id: estimateId, customer_id: pro.customer_id, vehicle_id: pro.vehicle_id, token: newToken(), labour_mode: pro.labour_mode,
      subtotal_aed: pro.subtotal_aed, discount_aed: pro.discount_aed, taxable_aed: pro.taxable_aed, vat_aed: pro.vat_aed, total_aed: pro.total_aed, agreed_total_aed: pro.agreed_total_aed,
      warranty_credit_aed: 0, discount_note: pro.discount_note, bill_to: (proRaw.bill_to as BillTo | null) ?? null,
      // The partial advance is a deposit document: never posted to Zoho as an invoice (the money is the advance), and
      // the job's final proforma folds it in like every deposit invoice.
      deposit_for_quotation_id: partial ? estimateId : null,
      issue_reason: force?.reason ?? (partial ? `Advance payment against ${est.number}` : `Estimate ${est.number} paid in full`),
      prepared_by: pro.prepared_by, issued_by: by?.id ?? null, notes: null, customer_snapshot: pro.customer_snapshot, vehicle_snapshot: pro.vehicle_snapshot,
      converted_from: pro.id, created_by: by?.id ?? null, updated_by: by?.id ?? null,
    })
    .select(INVOICE_SELECT + ", estimate_id")
    .single();
  const taxRow = tax as unknown as (Record<string, unknown> & { id: string }) | null;
  if (error || !taxRow) {
    await logAppError("estimate proforma: convert", error ?? new Error("no row"), { detail: { invoiceId } });
    return null;
  }
  if ((lines ?? []).length) {
    await admin.from("invoice_lines").insert(((lines ?? []) as Record<string, unknown>[]).map((l) => { const c = { ...l }; delete c.id; return { ...c, invoice_id: taxRow.id, created_by: by?.id ?? null, updated_by: by?.id ?? null }; }));
  }
  // The payments move to the tax invoice; an advance's payments also remember the ADVANCE INVOICE they were
  // billed on, so the job's final proforma prints "Deposit invoiced (INV-xxxxx)" exactly like job deposits.
  await admin.from("payments").update({ invoice_id: taxRow.id, updated_by: by?.id ?? null, ...(partial ? { deposit_invoice_number: number, deposit_quotation_id: estimateId } : {}) }).eq("invoice_id", pro.id);
  await admin.from("invoices").update({ converted_to: taxRow.id, updated_by: by?.id ?? null }).eq("id", pro.id);
  if (!partial) await tryEnqueueZoho("invoice", String(taxRow.id), null, by?.id ?? null);
  await admin.from("quotation_events").insert({ quotation_id: estimateId, job_id: null, event_type: "invoice_issued", note: force ? `${number} issued before full payment (${money(bal.balance)} due): ${force.reason}` : `${number} issued: ${pro.number} paid in full${partial ? " (advance)" : ""}`, created_by: by?.id ?? null });
  await notifyRoles(["accounts"], { type: "invoice_issued", title: `Tax invoice ${number} · ${est.number}`, body: `${partial ? `Advance of ${money(pro.total_aed)} against ${est.number}` : `${est.number} paid in full (${money(pro.total_aed)})`} – the car is not here yet. Check it.`, href: `/invoices/${taxRow.id}` });
  await notifyStaff(await quoteLeadIds({ kind: "estimate", number: est.number, job_id: null, created_by: null }), { type: "invoice_paid", title: `Paid: ${est.number} · ${money(pro.total_aed)}`, body: `Tax invoice ${number} issued by itself${partial ? " (advance)" : ""}. The money and the invoice follow the car onto the job at gate-in.`, href: `/estimates/${estimateId}` });
  return toInvoice(taxRow);
}

/** A payment landed on a job-less invoice: when it is an estimate's proforma, the tax invoice may follow now. */
export async function afterEstimatePayment(invoiceId: string, by: Actor, settings: Settings): Promise<void> {
  if (!(await estimateMoneyReady())) return;
  const { data } = await createAdminClient().from("invoices").select("id, kind, estimate_id, converted_to, status").eq("id", invoiceId).maybeSingle();
  if (data && data.kind === "proforma" && data.estimate_id && !data.converted_to && data.status === "issued") await convertEstimateProformaIfPaid(invoiceId, by, settings);
}

/**
 * Part 2 (4 November 2026): THE CAR ARRIVES. Every proforma, payment and tax invoice of the carried
 * estimates moves onto the job — so "Paid so far" and the invoices are on the job card from the first
 * minute, the advance tax invoices fold into the final proforma like every deposit invoice, a COMPLETE
 * pre-paid tax invoice simply IS the job's invoice, and Zoho counts nothing twice (the moved payments
 * now carry the job, so the final invoice sync applies them as the job's advances).
 * Idempotent: only documents with no job yet move. Returns the words for the job history.
 */
export async function moveEstimateMoneyToJob(estimateIds: string[], jobId: string, by: string | null): Promise<{ moved: number; paid: number; words: string | null }> {
  if (!estimateIds.length || !(await estimateMoneyReady())) return { moved: 0, paid: 0, words: null };
  const admin = createAdminClient();
  const fam = await familyIdsOf(estimateIds);
  const allIds = Array.from(new Set(Array.from(fam.values()).flatMap((f) => f.ids)));
  if (!allIds.length) return { moved: 0, paid: 0, words: null };
  const { data: moved } = await admin
    .from("invoices")
    .update({ job_id: jobId, updated_by: by })
    .in("estimate_id", allIds)
    .is("job_id", null)
    .eq("is_active", true)
    .select("id, number, kind, total_aed, status, converted_to, deposit_for_quotation_id");
  const docs = ((moved ?? []) as { id: string; number: string; kind: string; total_aed: number | string; status: string; converted_to: string | null; deposit_for_quotation_id: string | null }[]);
  if (!docs.length) return { moved: 0, paid: 0, words: null };
  const { data: pays } = await admin.from("payments").update({ job_id: jobId, updated_by: by }).in("invoice_id", docs.map((d) => d.id)).is("job_id", null).eq("is_active", true).select("id, amount_aed, status, method, cheque_status");
  const paid = Math.round(((pays ?? []) as { amount_aed: number | string; status: string; method: string; cheque_status: string | null }[]).filter((p) => p.status === "recorded" && (p.method !== "cheque" || p.cheque_status === "cleared")).reduce((a, p) => a + (Number(p.amount_aed) || 0), 0) * 100) / 100;
  const live = docs.filter((d) => d.status === "issued" && !d.converted_to);
  const words = `Estimate money carried over: ${live.map((d) => `${d.number} (${d.kind === "tax_invoice" ? (d.deposit_for_quotation_id ? "advance tax invoice" : "tax invoice") : "proforma"}, ${money(Number(d.total_aed) || 0)})`).join(", ") || docs.map((d) => d.number).join(", ")}${paid > 0 ? ` · ${money(paid)} already paid` : ""}. It counts on this job now.`;
  return { moved: docs.length, paid, words };
}

/** The money list's estimate rows: every estimate with an open document or money, the car not here yet. */
export type EstimateMoneyListRow = { estimateId: string; number: string; customerId: string; vehicleId: string | null; total: number; paid: number; balance: number; pendingCheque: number; proformaId: string | null; proformaNumber: string | null; fullyInvoiced: boolean; payments: PaymentRow[]; /** Every live document id of the family (today's money and tax invoices are matched on them). */ docIds: string[]; taxIds: string[]; customer: string; plate: string | null; car: string | null; createdAt: string };
export async function loadEstimateMoneyRows(filter: { customerId?: string } = {}): Promise<EstimateMoneyListRow[]> {
  if (!(await estimateMoneyReady())) return [];
  const admin = createAdminClient();
  // Estimates with any document: found through their invoices (job_id null, estimate_id set, still live or paid today).
  let q = admin.from("invoices").select("estimate_id").not("estimate_id", "is", null).is("job_id", null).eq("is_active", true).limit(1000);
  if (filter.customerId) q = q.eq("customer_id", filter.customerId);
  const { data: invRaw } = await q;
  const ids = Array.from(new Set(((invRaw ?? []) as { estimate_id: string }[]).map((r) => r.estimate_id)));
  if (!ids.length) return [];
  // One row per estimate NUMBER: measure from the newest version of each family.
  const fam = await familyIdsOf(ids);
  const newestOf = new Map<string, string>();
  for (const [id, f] of fam) if (!newestOf.has(f.number)) newestOf.set(f.number, id);
  const askIds = Array.from(newestOf.values());
  const many = await estimateMoneyMany(askIds);
  const { data: estRows } = await admin.from("quotations").select("id, customer_id, vehicle_id, carried_job_id, job_id, created_at").in("id", askIds);
  const byId = new Map(((estRows ?? []) as { id: string; customer_id: string; vehicle_id: string | null; carried_job_id: string | null; job_id: string | null; created_at: string }[]).map((r) => [r.id, r]));
  const custIds = Array.from(new Set(Array.from(byId.values()).map((r) => r.customer_id)));
  const vehIds = Array.from(new Set(Array.from(byId.values()).map((r) => r.vehicle_id).filter((x): x is string => !!x)));
  const [{ data: custs }, { data: vehs }] = await Promise.all([
    custIds.length ? admin.from("customers").select("id, full_name, company_name").in("id", custIds) : Promise.resolve({ data: [] }),
    vehIds.length ? admin.from("vehicles").select("id, kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name)").in("id", vehIds) : Promise.resolve({ data: [] }),
  ]);
  const custOf = new Map(((custs ?? []) as { id: string; full_name: string | null; company_name: string | null }[]).map((c) => [c.id, c.company_name || c.full_name || ""]));
  const vehOf = new Map(((vehs ?? []) as unknown as ({ id: string; model_year: number | null; make: { name: string } | null; model: { name: string } | null } & Parameters<typeof formatPlate>[0])[]).map((v) => [v.id, { plate: formatPlate(v), car: [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" ") || null }]));
  const out: EstimateMoneyListRow[] = [];
  for (const [id, m] of many) {
    const e = byId.get(id);
    if (!e) continue;
    // Once the car is here the job's own money rows carry it.
    if (e.carried_job_id || e.job_id) continue;
    if (!m.proforma && !m.fullyInvoiced && m.paid <= 0.005) continue;
    const docIds = [m.proforma?.id, ...m.taxInvoices.map((t) => t.id)].filter((x): x is string => !!x);
    out.push({
      estimateId: id, number: m.number, customerId: e.customer_id, vehicleId: e.vehicle_id, total: m.total, paid: m.paid, balance: m.balance,
      pendingCheque: m.pendingCheque, proformaId: m.proforma?.id ?? null, proformaNumber: m.proforma?.number ?? null, fullyInvoiced: m.fullyInvoiced,
      payments: m.payments, docIds, taxIds: m.taxInvoices.map((t) => t.id), customer: custOf.get(e.customer_id) ?? "", plate: e.vehicle_id ? (vehOf.get(e.vehicle_id)?.plate ?? null) : null,
      car: e.vehicle_id ? (vehOf.get(e.vehicle_id)?.car ?? null) : null, createdAt: e.created_at,
    });
  }
  return out;
}
