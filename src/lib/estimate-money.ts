import { awaitsBank, countsAsPaid } from "@/lib/bank-status";
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
  /** Paid MORE than the (revised) total: the owner settles it with a credit note - refund or customer credit. */
  over: number;
  /** This estimate is billed on another estimate's COMBINED proforma (Part 3). */
  combinedOn: { proformaNumber: string; baseNumber: string } | null;
  /** What issued credit notes of the family take off (already counted in `over`). */
  credited: number;
};

/** The money of each estimate (by its current version id): documents, payments, paid-of-total, the badge. */
export async function estimateMoneyMany(estimateIds: string[], opts: { totals?: Map<string, number> } = {}): Promise<Map<string, EstimateMoneyView>> {
  const out = new Map<string, EstimateMoneyView>();
  if (!estimateIds.length || !(await estimateMoneyReady())) return out;
  const admin = createAdminClient();
  const fam = await familyIdsOf(estimateIds);
  const allIds = Array.from(new Set(Array.from(fam.values()).flatMap((f) => f.ids)));
  if (!allIds.length) return out;
  const { estimateCombineReady } = await import("./schema-ready");
  const combineOk = await estimateCombineReady();
  const invCols = INVOICE_SELECT + ", estimate_id, bill_to, valid_until" + (combineOk ? ", covers_estimate_ids" : "");
  const [{ data: invRaw }, { data: estRows }, { data: coverRaw }] = await Promise.all([
    admin.from("invoices").select(invCols).in("estimate_id", allIds).eq("is_active", true),
    admin.from("quotations").select("id, number, status, rounded_total_aed, total_aed").in("id", allIds),
    // A COMBINED proforma on ANOTHER estimate that covers one of these (Part 3): named on this one's card.
    combineOk ? admin.from("invoices").select("number, estimate_id, covers_estimate_ids, status, converted_to, kind").overlaps("covers_estimate_ids", allIds).eq("is_active", true) : Promise.resolve({ data: [] }),
  ]);
  const invoices = ((invRaw ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ ...toInvoice(r), estimate_id: String(r.estimate_id), bill_to: (r.bill_to as BillTo | null) ?? null, valid_until: (r.valid_until as string | null) ?? null, covers: ((r.covers_estimate_ids as string[] | null) ?? null) }));
  const covering = ((coverRaw ?? []) as unknown as { number: string; estimate_id: string; covers_estimate_ids: string[] | null; status: string; converted_to: string | null; kind: string }[]).filter((c) => c.status === "issued" && !c.converted_to && c.kind === "proforma");
  const baseNumbers = new Map<string, string>();
  if (covering.length) {
    const { data: bases } = await admin.from("quotations").select("id, number").in("id", covering.map((c) => c.estimate_id));
    for (const b of (bases ?? []) as { id: string; number: string }[]) baseNumbers.set(b.id, b.number);
  }
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
    const cleared = pays.filter((p) => countsAsPaid(p));
    const pendingCheque = round2(pays.filter((p) => awaitsBank(p)).reduce((a, p) => a + p.amount_aed, 0));
    const paid = round2(cleared.reduce((a, p) => a + p.amount_aed, 0));
    // The figure the badge measures against: the newest APPROVED version's total (rounded when rounded), else the asked row's.
    const ests = ((estRows ?? []) as { id: string; status: string; rounded_total_aed: number | string | null; total_aed: number | string | null }[]).filter((q) => famSet.has(q.id));
    const approved = ests.filter((q) => q.status === "approved").at(-1) ?? ests.find((q) => q.id === askedId) ?? ests.at(-1);
    // A combined OPEN proforma IS the agreed bill (base + additionals): the base measures against it.
    const combinedOpen = proforma && (proforma as { covers?: string[] | null }).covers?.length ? proforma : null;
    const total = opts.totals?.get(askedId) ?? (combinedOpen ? combinedOpen.total_aed : round2(Number(approved?.rounded_total_aed ?? approved?.total_aed ?? 0) || 0));
    const advanceInvoiced = round2(taxes.filter((t) => t.deposit_for_quotation_id && !t.converted_to).reduce((a, t) => a + t.total_aed, 0));
    const fullyInvoiced = taxes.some((t) => !t.deposit_for_quotation_id && !t.converted_to);
    // Issued credit notes of the family lower what stands invoiced (a revision down, a cancellation fee's rest).
    const credited = round2(docs.filter((d) => d.kind === "credit_note").reduce((a, d) => a + d.total_aed, 0));
    const state: EstimateMoneyState = {
      total,
      paid,
      pendingCheque,
      proformaOpen: !!proforma,
      proformaComplete: !!proforma && !/partial/i.test(String(proforma.issue_reason ?? "")),
      fullyInvoiced,
      advanceInvoiced,
    };
    // Paid more than the (revised) bill, beyond what credit notes already gave back: the owner settles it.
    const over = round2(Math.max(0, paid - credited - total));
    const coverRow = covering.find((c) => (c.covers_estimate_ids ?? []).some((id) => famSet.has(id)));
    out.set(askedId, {
      ...state, estimateId: askedId, number: f.number, proforma, taxInvoices: taxes, payments: pays,
      balance: round2(Math.max(0, total - paid)), badge: estimateBadge(state), paidWords: paidOfWords(state),
      over, credited, combinedOn: coverRow ? { proformaNumber: coverRow.number, baseNumber: baseNumbers.get(coverRow.estimate_id) ?? "" } : null,
    });
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
  input: { mode: "complete" | "partial"; partial?: { kind: "percent" | "aed"; value: number }; billTo?: Partial<Record<keyof BillTo, unknown>> | null; validityDays?: number | null; /** Part 3: approved ADDITIONAL estimates billed together on this one proforma (complete mode). */ combineIds?: string[] },
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
  // Part 3: a COMBINED proforma bills the base together with ticked, accepted additional estimates of the
  // same customer and car (the advisor's choice). The proforma belongs to the base; covers names the rest.
  let combined: EstimateRow[] = [];
  let coversIds: string[] | null = null;
  if (input.mode === "complete" && input.combineIds?.length) {
    if (!(await (await import("./schema-ready")).estimateCombineReady())) return { error: "A combined proforma needs the second database update (waiting for apply)." };
    const { data: sibRaw } = await admin.from("quotations").select(EST_COLS).in("id", input.combineIds);
    combined = ((sibRaw ?? []) as EstimateRow[]).filter((s) => s.kind === "estimate" && s.is_active && !s.deleted_at && !s.cancelled_at && !s.carried_job_id && !s.job_id && s.status === "approved" && s.customer_id === e.customer_id && s.vehicle_id === e.vehicle_id && s.number !== e.number);
    if (combined.length !== input.combineIds.length) return { error: "Only an ACCEPTED additional estimate of the same customer and car can be billed together. Untick the others." };
    const sibMoney = await estimateMoneyMany(combined.map((s) => s.id));
    const busy = combined.find((s) => sibMoney.get(s.id)?.proforma || sibMoney.get(s.id)?.fullyInvoiced);
    if (busy) return { error: `${busy.number} already has its own proforma or invoice: it cannot join a combined one.` };
    const sibFam = await familyIdsOf(combined.map((s) => s.id));
    coversIds = Array.from(new Set(Array.from(sibFam.values()).flatMap((f) => f.ids)));
  }
  if (input.mode === "complete") {
    const everyEst = [e, ...combined];
    const { data: lineRaw, error: lineReadErr } = await admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", everyEst.map((x) => x.id)).eq("is_active", true).order("position").order("id");
    if (lineReadErr) {
      await logAppError("estimate proforma: read lines", lineReadErr, { staffId: staff.id, detail: { estimateId } });
      return { error: "Couldn't read the estimate's lines right now. Try again." };
    }
    const quotes: ApprovedQuote[] = everyEst.map((x) => ({ id: x.id, number: x.number, version: x.version, discount_percent: Number(x.discount_percent) || 0, vat_percent: vatPercent, deposit_aed: Number(x.deposit_aed) || 0, total_aed: Number(x.total_aed) || 0, discount_kind: x.discount_kind, discount_value: x.discount_value === null ? null : Number(x.discount_value), discount_scope: x.discount_scope, rounded_total_aed: x.rounded_total_aed === null ? null : Number(x.rounded_total_aed) }));
    const draft = draftFrom({ job: null, quotes, lines: ((lineRaw ?? []) as Record<string, unknown>[]).map(toLine), parts: [], charges: [] }, settings);
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
      ...(coversIds?.length ? { covers_estimate_ids: coversIds } : {}),
      subtotal_aed: totals.gross, discount_aed: totals.discount, taxable_aed: totals.taxable, vat_aed: totals.vat, total_aed: totals.total, agreed_total_aed: null, warranty_credit_aed: 0,
      discount_note: discountNote, bill_to: billTo, valid_until: validUntil,
      issue_reason: input.mode === "complete" ? `Estimate ${[e, ...combined].map((x) => x.number).join(" + ")} (complete)` : `Estimate ${e.number} (partial advance)`,
      // 13 November 2026 (Section 6): the template prints this line itself; saved again here it printed twice.
      notes: null,
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
  await admin.from("quotation_events").insert({ quotation_id: e.id, job_id: null, event_type: "proforma_issued", note: `${number} (${input.mode === "complete" ? "complete" : "partial advance"}${combined.length ? `, combined with ${combined.map((x) => x.number).join(", ")}` : ""}, ${money(totals.total)}) issued by ${staff.display_name}${billTo ? ` · bill to ${billToWords(billTo)[0] ?? ""}` : ""}`, created_by: staff.id });
  for (const s of combined) await admin.from("quotation_events").insert({ quotation_id: s.id, job_id: null, event_type: "proforma_issued", note: `${s.number} is billed on ${number} together with ${e.number} (combined proforma, ${money(totals.total)} in all) by ${staff.display_name}`, created_by: staff.id });
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
  // 13 November 2026 (Section 7): the money is in (or a cheque waits) - the parts desk is told to order.
  if (data?.estimate_id) await (await import("./estimate-order")).alertOrderParts(String(data.estimate_id)).catch(() => null);
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
  const paid = Math.round(((pays ?? []) as { amount_aed: number | string; status: string; method: string; cheque_status: string | null }[]).filter((p) => p.status === "recorded" && (countsAsPaid(p))).reduce((a, p) => a + (Number(p.amount_aed) || 0), 0) * 100) / 100;
  const live = docs.filter((d) => d.status === "issued" && !d.converted_to);
  const words = `Estimate money carried over: ${live.map((d) => `${d.number} (${d.kind === "tax_invoice" ? (d.deposit_for_quotation_id ? "advance tax invoice" : "tax invoice") : "proforma"}, ${money(Number(d.total_aed) || 0)})`).join(", ") || docs.map((d) => d.number).join(", ")}${paid > 0 ? ` · ${money(paid)} already paid` : ""}. It counts on this job now.`;
  return { moved: docs.length, paid, words };
}

/**
 * Part 3: a CREDIT NOTE on the estimate's money (a revision down, or a cancellation). The amount is WITH
 * VAT (what the customer gets back); the parent is the newest live tax invoice of the family — the
 * COMPLETE one when it exists (it is in Zoho, so the credit note posts and applies there), else the
 * advance invoice (never in Zoho: the row is flagged "by hand" from birth, and a later refund fails with
 * the same words instead of waiting forever — the phase 3 parent rules).
 */
export async function createEstimateCreditNote(estimateId: string, amountIncl: number, reason: string, staff: { id: string; display_name: string }, settings: Settings): Promise<{ cn?: { id: string; number: string; total: number; parent: string }; error?: string }> {
  const admin = createAdminClient();
  const m = await estimateMoneyOf(estimateId);
  if (!m) return { error: "Estimate not found." };
  const amount = round2(amountIncl);
  if (!(amount > 0)) return { error: "Nothing to credit." };
  const live = m.taxInvoices.filter((t) => t.status === "issued" && !t.converted_to);
  const parent = live.find((t) => !t.deposit_for_quotation_id) ?? live.at(-1) ?? null;
  if (!parent) return { error: "No tax invoice stands on this estimate: there is nothing to credit." };
  const { data: cns } = await admin.from("invoices").select("total_aed").eq("credit_of", parent.id).eq("status", "issued").eq("is_active", true);
  const already = round2(((cns ?? []) as { total_aed: number | string }[]).reduce((a, c) => a + (Number(c.total_aed) || 0), 0));
  if (amount + already > parent.total_aed + 0.005) return { error: `More than ${parent.number} (${money(parent.total_aed)}, ${money(already)} already credited).` };
  const vatPercent = parent.taxable_aed ? round2((parent.vat_aed / parent.taxable_aed) * 100) || 5 : 5;
  const split = advanceSplit(amount, vatPercent);
  const number = await nextDocumentNumber("credit_note", settings);
  const why = reason.trim().slice(0, 300);
  const { data: cn, error } = await admin.from("invoices").insert({
    number, kind: "credit_note", job_id: null, estimate_id: estimateId, customer_id: parent.customer_id, vehicle_id: parent.vehicle_id, credit_of: parent.id, token: newToken(),
    subtotal_aed: split.taxable, discount_aed: 0, taxable_aed: split.taxable, vat_aed: split.vat, total_aed: split.total,
    notes: `Credit against ${parent.number}: ${why}`, prepared_by: staff.id, issued_by: staff.id, approved_by: staff.id,
    customer_snapshot: parent.customer_snapshot, vehicle_snapshot: parent.vehicle_snapshot, created_by: staff.id, updated_by: staff.id,
  }).select("id, number").single();
  const cnRow = cn as unknown as { id: string; number: string } | null;
  if (error || !cnRow) {
    await logAppError("estimate credit note", error ?? new Error("no row"), { staffId: staff.id, detail: { estimateId } });
    return { error: "Couldn't save – nothing was recorded. Try again or tell the owner." };
  }
  await admin.from("invoice_lines").insert({ invoice_id: cnRow.id, position: 0, section: "services", description: `CREDIT AGAINST ${parent.number} – ${why.toUpperCase()}`, quantity: 1, unit_price: split.taxable, amount_aed: split.taxable, vat_aed: split.vat, total_aed: split.total, cost_aed: 0, created_by: staff.id, updated_by: staff.id });
  await admin.from("quotation_events").insert({ quotation_id: estimateId, job_id: null, event_type: "credit_note", note: `${cnRow.number} issued against ${parent.number} by ${staff.display_name}: ${money(split.total)} with VAT – ${why}`, created_by: staff.id });
  if (parent.deposit_for_quotation_id) {
    // The parent advance invoice never reached Zoho (the money is the advance there): the credit is done by
    // hand in Zoho — refund or re-apply the advance — and a later ERP refund fails with the same words.
    const { flagZohoAttention } = await import("./zoho-sync");
    await flagZohoAttention("creditnote", String(cnRow.id), `${cnRow.number} credits the advance ${parent.number} (estimate ${m.number}). The advance sits in Zoho as an unapplied customer payment: refund or re-apply it there by hand, then press "Done by hand".`, { handOnly: true });
  } else {
    await tryEnqueueZoho("invoice", String(parent.id), null, staff.id);
    await tryEnqueueZoho("creditnote", String(cnRow.id), null, staff.id);
  }
  return { cn: { id: cnRow.id, number: cnRow.number, total: split.total, parent: parent.number } };
}

/**
 * Part 3: the customer paid MORE than the (revised) bill. The owner settles the difference with a credit
 * note — kept as customer credit (it comes off at the job, or is refunded any time from the credit note's
 * page) or refunded now (the link to record the refund comes back).
 */
export async function settleEstimateOver(estimateId: string, input: { keep: "credit" | "refund"; reason: string }, staff: { id: string; display_name: string; role_id: string }, settings: Settings): Promise<{ error?: string; cnId?: string; cnNumber?: string; amount?: number; words?: string }> {
  if (staff.role_id !== "owner") return { error: "Only the owner settles an over-payment on an estimate." };
  const m = await estimateMoneyOf(estimateId);
  if (!m) return { error: "Estimate not found." };
  if (m.over <= 0.005) return { error: "Nothing is over-paid on this estimate." };
  if (m.pendingCheque > 0.005) return { error: "A cheque is still clearing: settle the difference once it has cleared or bounced." };
  const why = input.reason.trim();
  if (why.length < 3) return { error: "Write why (the revision, the agreement) – it goes on the credit note." };
  const r = await createEstimateCreditNote(estimateId, m.over, why, staff, settings);
  if (r.error || !r.cn) return { error: r.error ?? "Couldn't issue the credit note." };
  const words = input.keep === "credit"
    ? `${r.cn.number} (${money(r.cn.total)}) stands as the customer's credit: it comes off at the job, or record the refund on its page any time.`
    : `${r.cn.number} (${money(r.cn.total)}) issued. Record the refund on its page (method and reference are asked there).`;
  return { cnId: r.cn.id, cnNumber: r.cn.number, amount: r.cn.total, words };
}

/**
 * Part 3: CANCEL an estimate that holds money (the owner's call). An optional cancellation fee stays
 * invoiced; the rest becomes a credit note — refunded, or kept as the customer's credit. Open proformas
 * are voided (logged); a cheque still clearing blocks the cancel; the estimate is then cancelled with
 * the reason like any other.
 */
export async function cancelEstimateWithMoney(estimateId: string, input: { reason: string; fee: number; keep: "credit" | "refund" }, staff: { id: string; display_name: string; role_id: string }, settings: Settings): Promise<{ error?: string; cnId?: string | null; cnNumber?: string | null; words?: string }> {
  if (staff.role_id !== "owner") return { error: "Only the owner cancels an estimate that holds money." };
  const admin = createAdminClient();
  const e = await loadEstimate(estimateId);
  if (!e || !e.is_active || e.deleted_at) return { error: "Estimate not found." };
  if (e.carried_job_id || e.job_id) return { error: "The car is here: this is the job's money now." };
  if (e.cancelled_at || e.status === "cancelled") return { error: "Already cancelled." };
  const why = input.reason.trim().slice(0, 200);
  if (why.length < 3) return { error: "Write why it is cancelled." };
  const m = await estimateMoneyOf(estimateId);
  if (!m) return { error: "Estimate not found." };
  if (m.pendingCheque > 0.005) return { error: "A cheque is still clearing: wait for it to clear or bounce, then cancel." };
  if (m.combinedOn) return { error: `This estimate is billed on ${m.combinedOn.proformaNumber} (with ${m.combinedOn.baseNumber}): void that combined proforma first.` };
  const fee = round2(Math.max(0, Number(input.fee) || 0));
  const invoiced = round2(m.taxInvoices.filter((t) => t.status === "issued" && !t.converted_to).reduce((a, t) => a + t.total_aed, 0) - m.credited);
  if (fee > invoiced + 0.005) return { error: `The fee (${money(fee)}) is more than what stands invoiced (${money(invoiced)}).` };
  // The open proforma goes first (unpaid: voided and logged).
  if (m.proforma) {
    const hasMoney = m.payments.some((p) => p.invoice_id === m.proforma!.id && p.status === "recorded");
    if (hasMoney) return { error: `${m.proforma.number} has money on it that has not become a tax invoice yet. Tell the owner – this should not happen.` };
    const v = await voidEstimateProforma(m.proforma.id, `Estimate cancelled: ${why}`, staff);
    if (v.error) return { error: v.error };
  }
  let cn: { id: string; number: string; total: number } | null = null;
  const giveBack = round2(invoiced - fee);
  if (giveBack > 0.005) {
    const r = await createEstimateCreditNote(estimateId, giveBack, `Estimate cancelled${fee > 0 ? ` (cancellation fee ${money(fee)} kept)` : ""}: ${why}`, staff, settings);
    if (r.error || !r.cn) return { error: r.error ?? "Couldn't issue the credit note." };
    cn = r.cn;
  }
  await admin.from("quotations").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: staff.id, cancel_reason: why, updated_by: staff.id }).eq("id", e.id);
  await admin.from("quotation_events").insert({ quotation_id: e.id, job_id: null, event_type: "estimate_cancelled", note: `${e.number} cancelled by ${staff.display_name} with ${money(m.paid)} paid: ${why}.${fee > 0 ? ` Cancellation fee ${money(fee)} kept.` : ""}${cn ? ` ${cn.number} (${money(cn.total)}) ${input.keep === "credit" ? "stands as the customer's credit" : "to refund"}.` : ""}`, created_by: staff.id });
  const words = cn
    ? input.keep === "credit"
      ? `Cancelled. ${cn.number} (${money(cn.total)}) stands as the customer's credit${fee > 0 ? `; the ${money(fee)} fee is kept` : ""}.`
      : `Cancelled. Record the refund of ${money(cn.total)} on ${cn.number}'s page${fee > 0 ? `; the ${money(fee)} fee is kept` : ""}.`
    : `Cancelled.${fee > 0 ? ` The ${money(fee)} fee stays invoiced.` : ""}`;
  await notifyRoles(["accounts"], { type: "invoice_issued", title: `Estimate cancelled with money · ${e.number}`, body: words, href: cn ? `/invoices/${cn.id}` : `/estimates/${e.id}` });
  return { cnId: cn?.id ?? null, cnNumber: cn?.number ?? null, words };
}

/**
 * Part 4 (4 November 2026): ORDER PARTS NOW on an ACCEPTED estimate — before the car arrives. A held
 * job shell is made once (status 'booked', is_open false, like the bodyshop bookings; gate-in reuses it,
 * so the parts, the LPOs and later the money all sit on the ONE job). The estimate's priced part lines
 * become part requests and priced parts through THE one converter (estimateLineRows — idempotent by
 * client_key, so Start quotation later never doubles them), and the main LPO goes for approval under the
 * normal rules; with no advance received the owner sees the warning at approval and may approve anyway.
 */
export async function orderEstimatePartsNow(estimateId: string, staff: { id: string; display_name: string; role_id: string }): Promise<{ error?: string; jobId?: string; jobNumber?: string; lpoNumber?: string; held?: string }> {
  // 13 November 2026 (Section 7): the parts desk orders too (the ORDER PARTS alert opens their list).
  if (!["owner", "service_advisor", "parts"].includes(staff.role_id)) return { error: "Advisors, the parts desk or the owner order an estimate's parts." };
  const admin = createAdminClient();
  const e = await loadEstimate(estimateId);
  if (!e || !e.is_active || e.deleted_at) return { error: "Estimate not found." };
  if (e.status !== "approved") return { error: "The customer has not accepted this estimate yet." };
  if (e.cancelled_at) return { error: "This estimate was cancelled." };
  if (e.carried_job_id || e.job_id) return { error: "The car is here: order the parts from the job's Parts page." };
  if (!e.vehicle_id) return { error: "The estimate has no car on record." };
  // At least one PRICED part line (the parts desk priced it, or the advisor did).
  const { data: partLines } = await admin.from("quotation_lines").select("id, line_type, priced_at, supplier_text, unit_cost").eq("quotation_id", e.id).eq("is_active", true).eq("line_type", "part");
  const priced = ((partLines ?? []) as { priced_at: string | null; unit_cost: number | string | null }[]).filter((l) => l.priced_at && l.unit_cost !== null);
  if (!priced.length) return { error: "No priced parts on this estimate yet: send them to the parts desk to price first." };
  // The held job: made once per estimate family (gate-in reuses it).
  const fam = await familyIdsOf([e.id]);
  const famIds = fam.get(e.id)?.ids ?? [e.id];
  const { data: existing } = await admin.from("jobs").select("id, job_number, status, is_open").in("estimate_id", famIds).limit(1).maybeSingle();
  if (existing && existing.status !== "booked") return { error: `${existing.job_number} already carries this estimate.` };
  let job = existing as { id: string; job_number: string } | null;
  if (!job) {
    const now = new Date().toISOString();
    const { data: made, error: jobErr } = await admin.from("jobs").insert({ vehicle_id: e.vehicle_id, customer_id: e.customer_id, status: "booked", stage: "quote", is_open: false, department: "mechanical", priority: "normal", gated_in_by: staff.id, advisor_id: staff.id, gated_in_at: now, booked_at: now, estimate_id: e.id, created_by: staff.id, updated_by: staff.id }).select("id, job_number").single();
    if (jobErr || !made) {
      await logAppError("order estimate parts: job", jobErr ?? new Error("no row"), { staffId: staff.id, detail: { estimateId } });
      return { error: "Couldn't save – nothing was recorded. Try again or tell the owner." };
    }
    job = made as { id: string; job_number: string };
    await admin.from("job_events").insert({ job_id: job.id, event_type: "estimate_attached", note: `${job.job_number} opened as a HELD job for ${e.number} (parts ordered before the car arrives). Gate-in opens this same job.`, created_by: staff.id });
  }
  // The estimate's priced part lines become requests + priced parts (idempotent by client_key).
  const { estimateLineRows } = await import("@/app/(app)/quotes/actions");
  await estimateLineRows(e.id, e.id, staff.id, job.id);
  // The customer's acceptance of the ESTIMATE is the approval: the priced to-order parts become orderable
  // (exactly what applyCustomerResponse stamps at a quotation's approval).
  await admin.from("part_items").update({ order_status: "to_order", updated_by: staff.id }).eq("job_id", job.id).eq("is_active", true).eq("availability", "to_order").eq("order_status", "none").not("priced_at", "is", null);
  // The main LPO under the NORMAL rules: built from every To order part, sent for the one-tap approval.
  const { createMainLpo } = await import("./lpo");
  const r = await createMainLpo(job.id, { id: staff.id, display_name: staff.display_name });
  if (r.error) return { error: r.error };
  const m = await estimateMoneyOf(e.id);
  const noAdvance = !m || m.paid <= 0.005;
  await admin.from("quotation_events").insert({ quotation_id: e.id, job_id: job.id, event_type: "parts_ordered_early", note: `Order parts now: ${priced.length} priced part${priced.length === 1 ? "" : "s"} sent for LPO approval (${r.number ?? ""}) on held job ${job.job_number} by ${staff.display_name}.${noAdvance ? " No advance received yet - the approver sees the warning." : ""}`, created_by: staff.id });
  if (noAdvance) {
    await notifyRoles(["owner"], { type: "po_approval", title: `LPO to approve, NO ADVANCE · ${e.number}`, body: `${r.number ?? "The LPO"} for ${e.number}'s parts (held job ${job.job_number}) - the car is not here and NOTHING is paid yet. You can approve anyway with a reason, or ask for the advance first.`, jobId: job.id, href: r.poId ? `/parts/orders/${r.poId}` : `/parts/${job.id}` });
  }
  return { jobId: job.id, jobNumber: job.job_number, lpoNumber: r.number, held: `${r.number ?? "The LPO"} sent for approval on ${job.job_number} – the parts are held for ${e.number} and the job opens at gate-in.${noAdvance ? " No advance received yet: the owner sees the warning at approval." : ""}` };
}

/** Part 3: an estimate past its date that HOLDS MONEY is never expired by itself — the people are told instead. */
export async function estimateExpiryHold(q: { id: string; number: string }, settings: Settings): Promise<boolean> {
  void settings;
  if (!(await estimateMoneyReady())) return false;
  const m = await estimateMoneyOf(q.id);
  if (!m || (m.paid <= 0.005 && m.pendingCheque <= 0.005)) return false;
  const admin = createAdminClient();
  const { data: told } = await admin.from("quotation_events").select("id").eq("quotation_id", q.id).eq("event_type", "expiry_hold").limit(1);
  if (!told?.length) {
    await admin.from("quotation_events").insert({ quotation_id: q.id, job_id: null, event_type: "expiry_hold", note: `${q.number} is past its validity but ${money(m.paid)} is paid on it: never expired by itself. Re-send it, revise it, or cancel it (the owner settles the money).` });
    const { quoteLeadIds: leads } = await import("./quote-lead");
    const ids = await leads({ kind: "estimate", number: q.number, job_id: null, created_by: null });
    await notifyStaff(ids, { type: "quote_expired", title: `Estimate past its date, money held · ${q.number}`, body: `${money(m.paid)} is paid on it, so it was NOT expired. Re-send, revise, or cancel it (the money is settled with a credit note).`, href: `/estimates/${q.id}` });
    await notifyRoles(["owner"], { type: "quote_expired", title: `Estimate past its date, money held · ${q.number}`, body: `${money(m.paid)} paid. It stays open until you settle it.`, href: `/estimates/${q.id}` });
  }
  return true;
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
