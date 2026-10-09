import "server-only";
import { round2 } from "./money";
import { LINE_SELECT, PART_SELECT, toLine, toPart } from "./quote-data";
import { hasCostFloor, isHidden, lineCost, lineTotal, lineUnitPrice, takesTotalDiscount, type QuoteLine } from "./quotes";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";

export type InvoiceKind = "tax_invoice" | "proforma" | "credit_note";
export type LabourMode = "itemised" | "combined";

export type InvoiceRow = {
  id: string;
  number: string;
  kind: InvoiceKind;
  job_id: string | null;
  customer_id: string;
  vehicle_id: string | null;
  credit_of: string | null;
  status: "issued" | "cancelled";
  issued_at: string;
  issued_by: string | null;
  token: string | null;
  labour_mode: LabourMode;
  subtotal_aed: number;
  discount_aed: number;
  taxable_aed: number;
  vat_aed: number;
  total_aed: number;
  agreed_total_aed: number | null;
  discount_note: string | null;
  prepared_by: string | null;
  approved_by: string | null;
  notes: string | null;
  customer_snapshot: Record<string, string | null> | null;
  vehicle_snapshot: Record<string, string | null> | null;
  created_at: string;
};

export type InvoiceLineRow = {
  id: string;
  invoice_id: string;
  position: number;
  section: "services" | "parts" | "fees";
  description: string;
  details: string | null;
  part_number: string | null;
  quantity: number;
  unit_price: number;
  amount_aed: number;
  vat_aed: number;
  total_aed: number;
  cost_aed: number;
  quotation_line_id: string | null;
  part_item_id: string | null;
  /** Labour lines carry their hours so the PDF can print "1.5 h". */
  hours: number | null;
};

export type PaymentRow = {
  id: string;
  number: string;
  job_id: string | null;
  invoice_id: string | null;
  customer_id: string;
  method: "cash" | "card" | "link" | "cheque";
  amount_aed: number;
  received_at: string;
  received_by: string | null;
  reference: string | null;
  cheque_number: string | null;
  cheque_bank: string | null;
  cheque_date: string | null;
  cheque_status: "pending" | "cleared" | "bounced" | null;
  cleared_at: string | null;
  bank_charge_aed: number;
  is_deposit: boolean;
  status: "recorded" | "reversed";
  reversed_at: string | null;
  reversed_reason: string | null;
  notes: string | null;
  created_at: string;
};

export const INVOICE_SELECT = "id, number, kind, job_id, customer_id, vehicle_id, credit_of, status, issued_at, issued_by, token, labour_mode, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, agreed_total_aed, discount_note, prepared_by, approved_by, notes, customer_snapshot, vehicle_snapshot, created_at";
export const INVOICE_LINE_SELECT = "id, invoice_id, position, section, description, details, part_number, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed, quotation_line_id, part_item_id";
export const PAYMENT_SELECT = "id, number, job_id, invoice_id, customer_id, method, amount_aed, received_at, received_by, reference, cheque_number, cheque_bank, cheque_date, cheque_status, cleared_at, bank_charge_aed, is_deposit, status, reversed_at, reversed_reason, notes, created_at";

export const METHOD_LABELS: Record<PaymentRow["method"], string> = { cash: "Cash", card: "Card", link: "Payment link", cheque: "Cheque" };

function num<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T {
  const out = { ...row };
  for (const k of keys) {
    const v = out[k];
    if (v !== null && v !== undefined && v !== "") (out as Record<string, unknown>)[k as string] = Number(v);
  }
  return out;
}
export const toInvoice = (r: Record<string, unknown>) => num(r as unknown as InvoiceRow, ["subtotal_aed", "discount_aed", "taxable_aed", "vat_aed", "total_aed", "agreed_total_aed"]);
export const toInvoiceLine = (r: Record<string, unknown>) => {
  const l = num(r as unknown as InvoiceLineRow, ["position", "quantity", "unit_price", "amount_aed", "vat_aed", "total_aed", "cost_aed"]);
  // Hours ride in the details as "1.5 h" when the line is labour; the builder sets the quantity to the hours.
  return { ...l, hours: l.section === "services" && /^\d+(\.\d)? h$/.test(String(l.details ?? "")) ? l.quantity : null };
};
export const toPayment = (r: Record<string, unknown>) => num(r as unknown as PaymentRow, ["amount_aed", "bank_charge_aed"]);

/** How much is paid against an invoice; cheques count only once cleared. */
export function invoiceBalance(invoice: Pick<InvoiceRow, "total_aed">, payments: PaymentRow[]) {
  const live = payments.filter((p) => p.status === "recorded");
  const cleared = live.filter((p) => p.method !== "cheque" || p.cheque_status === "cleared");
  const pending = live.filter((p) => p.method === "cheque" && p.cheque_status === "pending");
  const paid = round2(cleared.reduce((a, p) => a + p.amount_aed, 0));
  const pendingAmount = round2(pending.reduce((a, p) => a + p.amount_aed, 0));
  const balance = round2(invoice.total_aed - paid);
  const paidAt = cleared.length ? cleared.map((p) => p.cleared_at ?? p.received_at).sort().at(-1) ?? null : null;
  const state: "paid" | "part_paid" | "unpaid" | "cheque_pending" = balance <= 0.005 ? "paid" : paid > 0 ? "part_paid" : pendingAmount > 0 ? "cheque_pending" : "unpaid";
  return { paid, pendingAmount, balance: Math.max(0, balance), state, paidAt };
}

export const PAYMENT_STATE_LABELS = { paid: "Paid in full", part_paid: "Part paid", unpaid: "Unpaid", cheque_pending: "Cheque pending clearance" } as const;

export type InvoiceBundle = {
  invoice: InvoiceRow;
  lines: InvoiceLineRow[];
  payments: PaymentRow[];
  customer: { id: string; full_name: string; company_name: string | null; phone: string; email: string | null; trn: string | null } | null;
  vehicle: { id: string; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
  job: { id: string; job_number: string; status: string; is_open: boolean; gated_in_by: string } | null;
  creditNotes: InvoiceRow[];
  preparedByName: string | null;
  issuedByName: string | null;
};

export async function loadInvoice(id: string): Promise<InvoiceBundle | null> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("invoices").select(INVOICE_SELECT).eq("id", id).maybeSingle();
  if (!raw) return null;
  const invoice = toInvoice(raw as Record<string, unknown>);
  const [{ data: lines }, { data: payments }, { data: customer }, { data: vehicle }, { data: job }, { data: credits }, { data: people }] = await Promise.all([
    admin.from("invoice_lines").select(INVOICE_LINE_SELECT).eq("invoice_id", id).eq("is_active", true).order("position"),
    admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", id).eq("is_active", true).order("received_at"),
    admin.from("customers").select("id, full_name, company_name, phone, email, trn").eq("id", invoice.customer_id).maybeSingle(),
    invoice.vehicle_id ? admin.from("vehicles").select("id, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", invoice.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    invoice.job_id ? admin.from("jobs").select("id, job_number, status, is_open, gated_in_by").eq("id", invoice.job_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("invoices").select(INVOICE_SELECT).eq("credit_of", id).eq("is_active", true).order("issued_at"),
    admin.from("staff").select("id, display_name").in("id", [invoice.prepared_by, invoice.issued_by].filter((x): x is string => !!x)),
  ]);
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.display_name]));
  return {
    invoice,
    lines: ((lines ?? []) as Record<string, unknown>[]).map(toInvoiceLine),
    payments: ((payments ?? []) as Record<string, unknown>[]).map(toPayment),
    customer: (customer as InvoiceBundle["customer"]) ?? null,
    vehicle: (vehicle as unknown as InvoiceBundle["vehicle"]) ?? null,
    job: (job as InvoiceBundle["job"]) ?? null,
    creditNotes: ((credits ?? []) as Record<string, unknown>[]).map(toInvoice),
    preparedByName: invoice.prepared_by ? (nameOf.get(invoice.prepared_by) ?? null) : null,
    issuedByName: invoice.issued_by ? (nameOf.get(invoice.issued_by) ?? null) : null,
  };
}

export type DraftLine = { section: "services" | "parts" | "fees"; description: string; details: string | null; part_number: string | null; quantity: number; hours: number | null; unit_price: number; amount_aed: number; cost_aed: number; quotation_line_id: string | null; part_item_id: string | null; takesDiscount: boolean };
export type DraftTotals = { gross: number; services: number; parts: number; fees: number; discount: number; discountPercent: number; taxable: number; vat: number; total: number; discountLimitAed: number; agreedTotalApplied: boolean; agreedTotalProblem: string | null };
export type InvoiceDraft = { lines: DraftLine[]; totals: DraftTotals; quotationNumbers: string[]; vatPercent: number };

/**
 * The invoice from the job: every approved quotation's visible lines (and approved additional
 * quotations), the inspection fee when it applies, a Consumables line if asked for. Prices come from
 * the approved quotation and cannot change here. The discount is one bold line on labour and
 * services; an "agreed total" works it out backwards within the discount limit.
 */
export async function buildInvoiceDraft(jobId: string, settings: Settings, opts: { labourMode: LabourMode; consumables?: number | null; agreedTotal?: number | null; discountPercent?: number | null }): Promise<InvoiceDraft> {
  const admin = createAdminClient();
  const [{ data: job }, { data: quotes }] = await Promise.all([
    admin.from("jobs").select("id, inspection_fee_due").eq("id", jobId).maybeSingle(),
    admin.from("quotations").select("id, number, version, discount_percent, vat_percent, status").eq("job_id", jobId).eq("kind", "quotation").eq("is_active", true).eq("status", "approved").order("created_at"),
  ]);
  const qs = (quotes ?? []) as { id: string; number: string; version: number; discount_percent: number | string; vat_percent: number | string; status: string }[];
  const vatPercent = qs.length ? Number(qs[0].vat_percent) || 5 : 5;
  const [{ data: lineRows }, { data: partRows }] = await Promise.all([
    qs.length ? admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", qs.map((q) => q.id)).eq("is_active", true).order("position") : Promise.resolve({ data: [] }),
    admin.from("part_items").select(PART_SELECT + ", final_cost_aed, label_code, return_status").eq("job_id", jobId).eq("is_active", true),
  ]);
  const parts = ((partRows ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ ...toPart(r), final_cost_aed: r.final_cost_aed === null || r.final_cost_aed === undefined ? null : Number(r.final_cost_aed), return_status: String(r.return_status ?? "none") }));
  const partOf = (id: string | null) => (id ? parts.find((p) => p.id === id) : undefined);
  const lines: DraftLine[] = [];
  let quotedDiscount = 0;
  for (const q of qs) {
    // Parts returned to the supplier come off the bill.
    const qLines = ((lineRows ?? []) as Record<string, unknown>[]).map(toLine).filter((l) => l.quotation_id === q.id && !isHidden(l) && partOf(l.part_item_id)?.return_status !== "returned");
    const discountBase = round2(qLines.filter(takesTotalDiscount).reduce((a, l) => a + lineTotal(l), 0));
    quotedDiscount += round2(discountBase * ((Number(q.discount_percent) || 0) / 100));
    for (const l of qLines) lines.push(draftLineOf(l, partOf(l.part_item_id)));
  }
  // Labour combined into one line when asked for.
  let out = lines;
  if (opts.labourMode === "combined") {
    const labour = lines.filter((l) => l.hours !== null);
    if (labour.length) {
      const amount = round2(labour.reduce((a, l) => a + l.amount_aed, 0));
      const hours = Math.round(labour.reduce((a, l) => a + (l.hours ?? 0), 0) * 10) / 10;
      const combined: DraftLine = { section: "services", description: `Labour charges (${hours.toFixed(1)} h)`, details: null, part_number: null, quantity: 1, hours: null, unit_price: amount, amount_aed: amount, cost_aed: 0, quotation_line_id: null, part_item_id: null, takesDiscount: true };
      out = [combined, ...lines.filter((l) => l.hours === null)];
    }
  }
  if (opts.consumables && opts.consumables > 0) {
    out.push({ section: "services", description: "Consumables", details: null, part_number: null, quantity: 1, hours: null, unit_price: round2(opts.consumables), amount_aed: round2(opts.consumables), cost_aed: 0, quotation_line_id: null, part_item_id: null, takesDiscount: true });
  }
  if (job?.inspection_fee_due) {
    const fee = Number(settings.inspection_fee_aed) || 0;
    if (fee > 0) out.push({ section: "fees", description: "Inspection fee", details: "No work was approved after the inspection", part_number: null, quantity: 1, hours: null, unit_price: fee, amount_aed: fee, cost_aed: 0, quotation_line_id: null, part_item_id: null, takesDiscount: false });
  }
  out = out.map((l, i) => ({ ...l, position: i }));
  const gross = round2(out.reduce((a, l) => a + l.amount_aed, 0));
  const services = round2(out.filter((l) => l.section === "services").reduce((a, l) => a + l.amount_aed, 0));
  const partsTotal = round2(out.filter((l) => l.section === "parts").reduce((a, l) => a + l.amount_aed, 0));
  const fees = round2(out.filter((l) => l.section === "fees").reduce((a, l) => a + l.amount_aed, 0));
  const discountBase = round2(out.filter((l) => l.takesDiscount).reduce((a, l) => a + l.amount_aed, 0));
  const limitPct = Number(settings.discount_limit_percent) || 0;
  const discountLimitAed = round2(discountBase * (limitPct / 100));
  let discount = quotedDiscount;
  let agreedTotalApplied = false;
  let agreedTotalProblem: string | null = null;
  if (opts.discountPercent !== null && opts.discountPercent !== undefined) discount = round2(discountBase * (Math.max(0, opts.discountPercent) / 100));
  if (opts.agreedTotal && opts.agreedTotal > 0) {
    const wanted = round2(gross - opts.agreedTotal / (1 + vatPercent / 100));
    if (wanted < 0) agreedTotalProblem = "The agreed total is more than the bill; no discount applied.";
    else if (wanted > discountBase) agreedTotalProblem = "The agreed total would need a discount on parts, which is not allowed.";
    else if (wanted > discountLimitAed + 0.005) agreedTotalProblem = `The agreed total needs a ${round2((wanted / (discountBase || 1)) * 100)}% discount on labour and services, above the ${limitPct}% limit.`;
    else {
      discount = wanted;
      agreedTotalApplied = true;
    }
  }
  discount = Math.min(discount, discountBase);
  const taxable = round2(gross - discount);
  // With an agreed total the customer pays exactly that figure: the VAT takes the rounding, never the total.
  const total = agreedTotalApplied ? round2(opts.agreedTotal!) : round2(taxable + round2(taxable * (vatPercent / 100)));
  const vat = round2(total - taxable);
  return {
    lines: out,
    totals: { gross, services, parts: partsTotal, fees, discount, discountPercent: discountBase ? round2((discount / discountBase) * 100) : 0, taxable, vat, total, discountLimitAed, agreedTotalApplied, agreedTotalProblem },
    quotationNumbers: Array.from(new Set(qs.map((q) => q.number))),
    vatPercent,
  };
}

function draftLineOf(l: QuoteLine, part: { part_number: string | null; cost_aed: number | null; final_cost_aed: number | null } | undefined): DraftLine {
  const amount = lineTotal(l);
  const isPart = l.line_type === "part" || (l.line_type === "other" && hasCostFloor(l));
  const number = part?.part_number ?? (l.line_type === "part" ? (l.title.match(/\(([^()]+)\)\s*$/)?.[1] ?? null) : null);
  const title = l.line_type === "part" && number && l.title.endsWith(`(${number})`) ? l.title.slice(0, -(number.length + 2)).trim() : l.title;
  const cost = l.line_type === "part" ? round2((part?.final_cost_aed ?? part?.cost_aed ?? l.unit_cost ?? 0) * (l.quantity || 1)) : lineCost(l);
  return {
    section: isPart ? "parts" : "services",
    description: title,
    details: l.line_type === "labour" ? `${(Math.round((l.hours ?? 0) * 10) / 10).toFixed(1)} h` : l.details,
    part_number: number,
    quantity: l.line_type === "labour" ? Math.round((l.hours ?? 0) * 10) / 10 : l.quantity || 1,
    hours: l.line_type === "labour" ? Math.round((l.hours ?? 0) * 10) / 10 : null,
    unit_price: l.line_type === "labour" ? round2(l.labour_rate ?? 0) : lineUnitPrice(l),
    amount_aed: amount,
    cost_aed: cost,
    quotation_line_id: l.id,
    part_item_id: l.part_item_id,
    takesDiscount: takesTotalDiscount(l),
  };
}

/** The next number for a document kind; invoices continue from the "next invoice number" setting. */
export async function nextDocumentNumber(kind: InvoiceKind, settings: Settings): Promise<string> {
  const admin = createAdminClient();
  const prefix = kind === "tax_invoice" ? "INV-" : kind === "proforma" ? "PRO-" : "CN-";
  const { data } = await admin.from("invoices").select("number").eq("kind", kind).like("number", `${prefix}%`).order("number", { ascending: false }).limit(1).maybeSingle();
  const last = data?.number ? Number(data.number.slice(prefix.length)) || 0 : 0;
  const floor = kind === "tax_invoice" ? Math.max(1, Number(settings.next_invoice_number) || 1) : 1;
  const next = Math.max(last + 1, floor);
  return `${prefix}${String(next).padStart(5, "0")}`;
}

/** What the customer still owes on a job: the tax invoice balance, or "no invoice yet" when work was approved or a fee is due. */
export async function jobBalance(jobId: string) {
  const admin = createAdminClient();
  const [{ data: inv }, { data: quotes }, { data: job }] = await Promise.all([
    admin.from("invoices").select(INVOICE_SELECT).eq("job_id", jobId).eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true).order("issued_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("quotations").select("id").eq("job_id", jobId).eq("kind", "quotation").eq("status", "approved").eq("is_active", true).limit(1),
    admin.from("jobs").select("inspection_fee_due").eq("id", jobId).maybeSingle(),
  ]);
  const needsInvoice = (quotes ?? []).length > 0 || !!job?.inspection_fee_due;
  if (!inv) return { invoice: null, balance: 0, needsInvoice, state: needsInvoice ? ("no_invoice" as const) : ("nothing" as const), paid: 0, pending: 0 };
  const invoice = toInvoice(inv as Record<string, unknown>);
  const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", invoice.id).eq("is_active", true);
  const bal = invoiceBalance(invoice, ((pays ?? []) as Record<string, unknown>[]).map(toPayment));
  return { invoice, balance: bal.balance, needsInvoice, state: bal.state, paid: bal.paid, pending: bal.pendingAmount };
}
