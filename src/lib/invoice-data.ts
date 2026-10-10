import "server-only";
import { round2 } from "./money";
import { LINE_SELECT, PART_SELECT, approvedQuotations, toLine, toPart } from "./quote-data";
import { isHidden, isUnchosen, lineCost, lineTotal, lineUnitPrice, partTypeText, takesTotalDiscount, type QuoteLine } from "./quotes";
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
  /** A payment link the advisor pasted: the customer's page shows Pay now. */
  payment_link_url: string | null;
  /** A comeback repaired free of charge: the work at its normal value, then this credit brings the total to zero. */
  warranty_credit_aed: number;
  /** A tax invoice generated from a proforma, and the proforma it came from. */
  converted_from: string | null;
  converted_to: string | null;
  /** The owner's reason when the tax invoice was issued before full payment. */
  issue_reason: string | null;
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
  status: "recorded" | "reversed" | "voided" | "pending_owner";
  reversed_at: string | null;
  reversed_reason: string | null;
  notes: string | null;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  approval_requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
};

export const INVOICE_SELECT = "id, number, kind, job_id, customer_id, vehicle_id, credit_of, status, issued_at, issued_by, token, labour_mode, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, agreed_total_aed, discount_note, prepared_by, approved_by, notes, customer_snapshot, vehicle_snapshot, payment_link_url, warranty_credit_aed, converted_from, converted_to, issue_reason, created_at";
export const INVOICE_LINE_SELECT = "id, invoice_id, position, section, description, details, part_number, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed, quotation_line_id, part_item_id";
export const PAYMENT_SELECT = "id, number, job_id, invoice_id, customer_id, method, amount_aed, received_at, received_by, reference, cheque_number, cheque_bank, cheque_date, cheque_status, cleared_at, bank_charge_aed, is_deposit, status, reversed_at, reversed_reason, notes, void_reason, voided_by, voided_at, verified_at, verified_by, approval_requested_by, approved_by, approved_at, created_at";

export const METHOD_LABELS: Record<PaymentRow["method"], string> = { cash: "Cash", card: "Card", link: "Payment link", cheque: "Cheque" };

function num<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T {
  const out = { ...row };
  for (const k of keys) {
    const v = out[k];
    if (v !== null && v !== undefined && v !== "") (out as Record<string, unknown>)[k as string] = Number(v);
  }
  return out;
}
export const toInvoice = (r: Record<string, unknown>) => num(r as unknown as InvoiceRow, ["subtotal_aed", "discount_aed", "taxable_aed", "vat_aed", "total_aed", "agreed_total_aed", "warranty_credit_aed"]);
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
  vehicle: { id: string; kind?: "car" | "loose" | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
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
    invoice.vehicle_id ? admin.from("vehicles").select("kind, id, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", invoice.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
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
export type DraftTotals = {
  gross: number;
  services: number;
  parts: number;
  fees: number;
  /** The discount the customer approved on the quotation (labour and services only). */
  discount: number;
  discountPercent: number;
  /** The adjustment that lands the invoice on the quotation's rounded total; the VAT line takes it. */
  rounding: number;
  taxable: number;
  vat: number;
  total: number;
  /** A free comeback: the whole bill, taken off after the lines so the customer sees the value of the repair. */
  warrantyCredit: number;
};
export type InvoiceDraft = { lines: DraftLine[]; totals: DraftTotals; quotationNumbers: string[]; vatPercent: number };

/**
 * The invoice lines and totals from the approved quotations, exactly as the customer approved them:
 * every labour line itemised, the same discount, the same rounded total. Nothing is chosen or typed at
 * invoice time; a change goes through a revised quotation or the owner. Parts returned to the supplier
 * come off; the inspection fee is added when no work was approved; a free comeback ends at zero.
 */
export async function buildInvoiceDraft(jobId: string, settings: Settings): Promise<InvoiceDraft> {
  const admin = createAdminClient();
  const [{ data: job }, quotes] = await Promise.all([
    admin.from("jobs").select("id, inspection_fee_due, comeback_free").eq("id", jobId).maybeSingle(),
    approvedQuotations(jobId),
  ]);
  const qs = quotes;
  const vatPercent = qs.length ? Number(qs[0].vat_percent) || 5 : 5;
  const [{ data: lineRows }, { data: partRows }, { data: quoteRows }] = await Promise.all([
    qs.length ? admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", qs.map((q) => q.id)).eq("is_active", true).order("position") : Promise.resolve({ data: [] }),
    admin.from("part_items").select(PART_SELECT + ", final_cost_aed, label_code, return_status").eq("job_id", jobId).eq("is_active", true),
    qs.length ? admin.from("quotations").select("id, rounded_total_aed, total_aed").in("id", qs.map((q) => q.id)) : Promise.resolve({ data: [] }),
  ]);
  const parts = ((partRows ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ ...toPart(r), final_cost_aed: r.final_cost_aed === null || r.final_cost_aed === undefined ? null : Number(r.final_cost_aed), return_status: String(r.return_status ?? "none") }));
  const partOf = (id: string | null) => (id ? parts.find((p) => p.id === id) : undefined);
  const roundedOf = new Map(((quoteRows ?? []) as { id: string; rounded_total_aed: number | string | null; total_aed: number | string }[]).map((q) => [q.id, q.rounded_total_aed === null ? null : Number(q.rounded_total_aed)]));
  const lines: DraftLine[] = [];
  let discount = 0;
  let discountBase = 0;
  let quotedTotal = 0;
  let anyRounded = false;
  for (const q of qs) {
    // Parts returned to the supplier come off the bill.
    const qLines = ((lineRows ?? []) as Record<string, unknown>[]).map(toLine).filter((l) => l.quotation_id === q.id && !isHidden(l) && !isUnchosen(l) && partOf(l.part_item_id)?.return_status !== "returned");
    const base = round2(qLines.filter(takesTotalDiscount).reduce((a, l) => a + lineTotal(l), 0));
    const d = round2(base * ((Number(q.discount_percent) || 0) / 100));
    discount += d;
    discountBase += base;
    for (const l of qLines) lines.push(draftLineOf(l, partOf(l.part_item_id)));
    // The quotation's own total, rounded when the advisor rounded it on sending.
    const net = round2(qLines.reduce((a, l) => a + lineTotal(l), 0) - d);
    const rounded = roundedOf.get(q.id);
    if (rounded !== null && rounded !== undefined) anyRounded = true;
    quotedTotal += rounded ?? round2(net + round2(net * (vatPercent / 100)));
  }
  const out = lines;
  if (job?.inspection_fee_due && !qs.length) {
    const fee = Number(settings.inspection_fee_aed) || 0;
    if (fee > 0) {
      out.push({ section: "fees", description: "Inspection fee", details: "No work was approved after the inspection", part_number: null, quantity: 1, hours: null, unit_price: fee, amount_aed: fee, cost_aed: 0, quotation_line_id: null, part_item_id: null, takesDiscount: false });
      quotedTotal += round2(fee + round2(fee * (vatPercent / 100)));
    }
  }
  const gross = round2(out.reduce((a, l) => a + l.amount_aed, 0));
  const services = round2(out.filter((l) => l.section === "services").reduce((a, l) => a + l.amount_aed, 0));
  const partsTotal = round2(out.filter((l) => l.section === "parts").reduce((a, l) => a + l.amount_aed, 0));
  const fees = round2(out.filter((l) => l.section === "fees").reduce((a, l) => a + l.amount_aed, 0));
  discount = round2(Math.min(discount, discountBase));
  // A free comeback (warranty repair): no discount, the whole bill comes off after the lines, the total is zero.
  const warrantyCredit = job?.comeback_free ? gross : 0;
  if (warrantyCredit) discount = 0;
  const beforeRounding = round2(gross - discount - warrantyCredit);
  // The customer pays the figure on the quotation: the pre-VAT amount adjusts and the VAT line takes the rounding.
  const total = warrantyCredit ? 0 : anyRounded ? round2(quotedTotal) : round2(beforeRounding + round2(beforeRounding * (vatPercent / 100)));
  const taxable = warrantyCredit ? 0 : anyRounded ? round2(total / (1 + vatPercent / 100)) : beforeRounding;
  const rounding = round2(taxable - beforeRounding);
  const vat = round2(total - taxable);
  return {
    lines: out,
    totals: { gross, services, parts: partsTotal, fees, discount, discountPercent: discountBase ? round2((discount / discountBase) * 100) : 0, rounding, taxable, vat, total, warrantyCredit },
    quotationNumbers: Array.from(new Set(qs.map((q) => q.number))),
    vatPercent,
  };
}

function draftLineOf(l: QuoteLine, part: { part_number: string | null; cost_aed: number | null; final_cost_aed: number | null } | undefined): DraftLine {
  const amount = lineTotal(l);
  // Spare parts are the lines Parts entered (a part item with a name and a type). Anything else, even with a cost, is work or a charge.
  const isPart = l.line_type === "part" && !!l.part_item_id;
  const number = part?.part_number ?? (l.line_type === "part" ? (l.title.match(/\(([^()]+)\)\s*$/)?.[1] ?? null) : null);
  const title = l.line_type === "part" && number && l.title.endsWith(`(${number})`) ? l.title.slice(0, -(number.length + 2)).trim() : l.title;
  const cost = l.line_type === "part" ? round2((part?.final_cost_aed ?? part?.cost_aed ?? l.unit_cost ?? 0) * (l.quantity || 1)) : lineCost(l);
  return {
    section: isPart ? "parts" : "services",
    description: title,
    details: l.line_type === "labour" ? `${(Math.round((l.hours ?? 0) * 10) / 10).toFixed(1)} h` : l.line_type === "part" ? [partTypeText(l), l.details].filter(Boolean).join(" · ") || null : l.details,
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
  const [{ data: inv }, quotes, { data: job }] = await Promise.all([
    admin.from("invoices").select(INVOICE_SELECT).eq("job_id", jobId).in("kind", ["tax_invoice", "proforma"]).eq("status", "issued").eq("is_active", true).is("converted_to", null).order("issued_at", { ascending: false }),
    approvedQuotations(jobId),
    admin.from("jobs").select("inspection_fee_due").eq("id", jobId).maybeSingle(),
  ]);
  const needsInvoice = (quotes ?? []).length > 0 || !!job?.inspection_fee_due;
  const rows = ((inv ?? []) as Record<string, unknown>[]).map(toInvoice);
  const picked = rows.find((i) => i.kind === "tax_invoice") ?? rows.find((i) => i.kind === "proforma") ?? null;
  if (!picked) return { invoice: null, balance: 0, needsInvoice, state: needsInvoice ? ("no_invoice" as const) : ("nothing" as const), paid: 0, pending: 0 };
  const invoice = picked;
  const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", invoice.id).eq("is_active", true);
  const bal = invoiceBalance(invoice, ((pays ?? []) as Record<string, unknown>[]).map(toPayment));
  return { invoice, balance: bal.balance, needsInvoice, state: bal.state, paid: bal.paid, pending: bal.pendingAmount };
}
