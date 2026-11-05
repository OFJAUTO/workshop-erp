import "server-only";
import { cache } from "react";
import { dubaiDate } from "./jobs";
import { refusalsReady } from "./lpo";
import { pageAll, pageAllIn } from "./page-all";
import { pricesToFix } from "./part-cost-history";
import { endingOf } from "./part-endings";
import { partEndingsReady } from "./part-endings-server";
import { cleanUnit } from "./part-units";
import { commonFilter, filterInvoiceRows, filterLines, filterLpos, filterProblems, filterReturns, lpoRows, partLines, partsAccountsTotals, partsProblems, returnRows, supplierBalances, type PaFilter, type PaJob, type PaPart, type PaPo, type PaPoLine, type PaSale, type PaSupplier, type PartsBase } from "./parts-accounts-rules";
import { approvedQuotationsMany } from "./quote-data";
import { isComplimentary, isHidden, isUnchosen, lineTotal, type QuoteLine } from "./quotes";
import { partUnitsReady } from "./schema-ready";
import { getSettings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { loadSupplierInvoices } from "./supplier-invoices";
import { formatPlate, type PlateFields } from "./types";

/*
 * PARTS ACCOUNTS (3 November 2026, section 12), the server side: the reads behind the page and its Excel export, all
 * through the admin client (owner and accounts only: the page and the export check viewPartsAccounts), page by page
 * (PostgREST answers 1,000 rows at most) and with long id lists in short pieces. THE rules are pure, in
 * parts-accounts-rules.ts. No customer details are read (the supplier side never needs them).
 */

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

const PART_COLS = "id, job_id, part_request_id, description, part_number, quantity, confirmed_quantity, supplier, cost_aed, final_cost_aed, availability, order_status, po_id, expected_date, received_qty, issue_status, issue_confirmed_at, return_status, returned_qty, disposition, disposition_at, disposition_note, credit_note_path, not_needed_at, exchange_status, exchange_reason, replaced_part_id, replacement_part_id, priced_at, created_at, goodwill_cost_aed, zoho_vendorcredit_id, is_active, removed_at";
const PO_COLS = "id, number, kind, order_type, job_id, supplier_id, supplier_name, status, total_cost_aed, approved_by, approved_at, ordered_at, received_at, created_at, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_checked_at, zoho_bill_id, supplier_paid_at, supplier_paid_by, supplier_paid_method, supplier_paid_reference";
const QL_COLS = "id, quotation_id, part_item_id, line_type, quantity, unit_cost, markup_percent, markup_mode, markup_aed, unit_price, hours, labour_rate, discount_percent, visible_to_customer, price_display, left_off, option_group, chosen, fee_kind";

type CarRow = PlateFields & { vin?: string | null; make: { name: string } | null; model: { name: string } | null };

/**
 * A part's unit: section 9's own column once it exists (migration 20261203160000, `partUnitsReady`), else the unit its
 * request stored (sets); read through `cleanUnit`, so the words follow section 9's one rule.
 */
function unitOfPart(r: Row, units: Map<string, string | null>, ownUnit: boolean): string | null {
  const own = ownUnit ? cleanUnit(r.unit) : null;
  if (own) return own;
  return r.part_request_id ? cleanUnit(units.get(String(r.part_request_id)) ?? null) : null;
}

function toPart(r: Row, units: Map<string, string | null>, ownUnit = false): PaPart {
  return {
    id: String(r.id),
    jobId: str(r.job_id),
    description: String(r.description ?? ""),
    partNumber: str(r.part_number),
    quantity: Number(r.quantity) || 1,
    confirmedQuantity: num(r.confirmed_quantity),
    unit: unitOfPart(r, units, ownUnit),
    supplier: str(r.supplier),
    costAed: num(r.cost_aed),
    finalCostAed: num(r.final_cost_aed),
    availability: str(r.availability),
    orderStatus: str(r.order_status),
    poId: str(r.po_id),
    expectedDate: str(r.expected_date),
    receivedQty: Number(r.received_qty) || 0,
    issueStatus: str(r.issue_status),
    issueConfirmedAt: str(r.issue_confirmed_at),
    returnStatus: str(r.return_status),
    returnedQty: Number(r.returned_qty) || 0,
    disposition: str(r.disposition),
    dispositionAt: str(r.disposition_at),
    dispositionNote: str(r.disposition_note),
    creditNotePath: str(r.credit_note_path),
    notNeededAt: str(r.not_needed_at),
    exchangeStatus: str(r.exchange_status),
    exchangeReason: str(r.exchange_reason),
    replacedPartId: str(r.replaced_part_id),
    replacementPartId: str(r.replacement_part_id),
    pricedAt: str(r.priced_at),
    createdAt: String(r.created_at ?? ""),
    goodwillCostAed: num(r.goodwill_cost_aed),
    zohoVendorcreditId: str(r.zoho_vendorcredit_id),
    isActive: r.is_active !== false,
    removedAt: str(r.removed_at),
    refusedAt: str(r.refused_at),
    refusedReason: str(r.refused_reason),
    // Section 7's credit note columns (migration 20261203140000: credit_note_number, credit_note_date,
    // credit_note_amount_aed) once they exist; until then creditNoteOf reads the number typed on Returns and leftovers
    // (disposition_note of a returned part).
    creditNumber: str(r.credit_note_number),
    creditDate: str(r.credit_note_date),
    creditAmount: num(r.credit_note_amount_aed),
  };
}

/** A part read only to follow its replacement: an original never bought (not needed or refused before ordering). */
const neverBought = (r: Row) => (r.order_status === "none" || !r.order_status) && !r.po_id && !(Number(r.received_qty) > 0) && !r.disposition;

/** Every row the page needs, once per request (the page's tabs and totals share it). */
export const loadPartsBase = cache(async (): Promise<PartsBase> => {
  const admin = createAdminClient();
  const [refusals, endingsOn, unitsOn] = await Promise.all([refusalsReady(), partEndingsReady(), partUnitsReady()]);
  // Columns that exist only after their migrations: refusals; section 7's credit note; section 9's unit.
  const refCols = `${refusals ? ", refused_at, refused_reason" : ""}${endingsOn ? ", credit_note_number, credit_note_date, credit_note_amount_aed" : ""}${unitsOn ? ", unit" : ""}`;
  // Parts on the supplier side: anything on an order, received, ended (section 7's endings before its migration are
  // stored as disposition empty + disposition_at set), or refused on an LPO.
  const orFilter = `order_status.neq.none,po_id.not.is.null,received_qty.gt.0,disposition.not.is.null,disposition_at.not.is.null${refusals ? ",refused_at.not.is.null" : ""}`;
  const [settings, partRows, poRows, supRows, saleRows, invoiceData, toFix] = await Promise.all([
    getSettings(),
    pageAll<Row>((a, b) => admin.from("part_items").select(PART_COLS + refCols).or(orFilter).order("id").range(a, b) as unknown as Page<Row>),
    pageAll<Row>((a, b) => admin.from("purchase_orders").select(PO_COLS).eq("is_active", true).order("id").range(a, b) as unknown as Page<Row>),
    pageAll<Row>((a, b) => admin.from("suppliers").select("id, name, trn, vat_registered, payment_terms, is_active").order("id").range(a, b) as unknown as Page<Row>),
    // Every invoice line that sells a part, with its document (and the warranty credit of a free comeback).
    pageAll<Row>((a, b) => admin.from("invoice_lines").select("id, part_item_id, amount_aed, cost_aed, quantity, invoice:invoices!invoice_lines_invoice_id_fkey(id, number, kind, status, is_active, issued_at, converted_to, job_id, deposit_for_quotation_id, warranty_credit_aed)").not("part_item_id", "is", null).eq("is_active", true).order("id").range(a, b) as unknown as Page<Row>),
    // Strict: a failed read stops the page (accounts never see "nothing owed" because a read failed).
    loadSupplierInvoices({ strict: true }),
    // A failed read of the Parts desk's list leaves the closed-job rule alone (never a crash of the whole page).
    pricesToFix().catch(() => []),
  ]);

  // Parts: active ones, and inactive ones only when refused on an LPO (refused lines are taken off the LPO and kept) or
  // ended by section 7 (cancelled with the supplier, returned, kept in stock: written inactive with the ending).
  const endedBySeven = (r: Row) => !!endingOf({ disposition: str(r.disposition), disposition_at: str(r.disposition_at), return_status: str(r.return_status) });
  const raw = partRows.filter((r) => r.is_active !== false || !!r.refused_at || endedBySeven(r));
  // Lines that sell a part this list does not have yet (a shelf part straight onto the invoice): read those parts too.
  type InvLine = { id: string; part_item_id: string; amount_aed: number | string; cost_aed: number | string | null; quantity: number | string; invoice: { id: string; number: string; kind: string; status: string; is_active: boolean; issued_at: string | null; converted_to: string | null; job_id: string | null; deposit_for_quotation_id: string | null; warranty_credit_aed: number | string | null } | null };
  const invLines = (saleRows as unknown as InvLine[]).filter((l) => l.invoice && l.invoice.is_active && l.invoice.status === "issued" && !l.invoice.deposit_for_quotation_id && (l.invoice.kind === "tax_invoice" || (l.invoice.kind === "proforma" && !l.invoice.converted_to)));
  const have = new Set(raw.map((r) => String(r.id)));
  const missing = Array.from(new Set(invLines.map((l) => l.part_item_id).filter((id) => !have.has(id))));
  const readParts = (ids: string[]) => pageAllIn<Row>(ids, (piece, a, b) => admin.from("part_items").select(PART_COLS + refCols).in("id", piece).order("id").range(a, b) as unknown as Page<Row>);
  // An original never bought whose replacement carries its sale is read only to follow it (never listed as a line).
  const linkRows: Row[] = [];
  if (missing.length) {
    for (const r of await readParts(missing)) (r.replacement_part_id && neverBought(r) ? linkRows : raw).push(r);
    for (const r of raw) have.add(String(r.id));
    for (const r of linkRows) have.add(String(r.id));
  }
  // The originals a listed part replaces (marked not needed or refused before ordering, then replaced from another
  // supplier): the approved quotation line still points at the ORIGINAL, so without it the replacement would read
  // "not on a quotation". Up to three steps back.
  for (let step = 0; step < 3; step++) {
    const back = Array.from(new Set([...raw, ...linkRows].map((r) => str(r.replaced_part_id)).filter((id): id is string => !!id && !have.has(id))));
    if (!back.length) break;
    for (const r of await readParts(back)) {
      have.add(String(r.id));
      linkRows.push(r);
    }
  }

  const requestIds = Array.from(new Set(raw.map((r) => str(r.part_request_id)).filter((x): x is string => !!x)));
  const poIds = poRows.map((p) => String(p.id));
  const jobIds = Array.from(new Set([...raw.map((r) => str(r.job_id)), ...poRows.map((p) => str(p.job_id)), ...invLines.map((l) => l.invoice?.job_id ?? null)].filter((x): x is string => !!x)));
  const staffIds = Array.from(new Set(poRows.flatMap((p) => [str(p.approved_by), str(p.supplier_paid_by)]).filter((x): x is string => !!x)));
  const zohoIds = [...poIds, ...raw.filter((r) => r.disposition === "returned").map((r) => String(r.id))];

  const [reqRows, lineRows, jobRows, docRows, staffRows, zohoRows, approved] = await Promise.all([
    pageAllIn<Row>(requestIds, (ids, a, b) => admin.from("part_requests").select("id, unit").in("id", ids).order("id").range(a, b) as unknown as Page<Row>),
    pageAllIn<Row>(poIds, (ids, a, b) => admin.from("purchase_order_lines").select("id, po_id, part_item_id, description, part_number, quantity, unit_cost, received_qty, expected_date, invoice_unit_cost, invoice_check").in("po_id", ids).eq("is_active", true).order("id").range(a, b) as unknown as Page<Row>),
    pageAllIn<Row>(jobIds, (ids, a, b) => admin.from("jobs").select("id, job_number, status, is_open, work_done_at, vehicle:vehicles(kind, variant, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))").in("id", ids).order("id").range(a, b) as unknown as Page<Row>),
    pageAllIn<Row>(jobIds, (ids, a, b) => admin.from("invoices").select("id, number, kind, job_id, converted_to, issued_at").in("job_id", ids).eq("is_active", true).eq("status", "issued").in("kind", ["tax_invoice", "proforma"]).is("deposit_for_quotation_id", null).order("id").range(a, b) as unknown as Page<Row>),
    pageAllIn<Row>(staffIds, (ids, a, b) => admin.from("staff").select("id, display_name").in("id", ids).order("id").range(a, b) as unknown as Page<Row>),
    pageAllIn<Row>(zohoIds, (ids, a, b) => admin.from("zoho_outbox").select("kind, record_id, status").in("kind", ["bill", "billpayment", "vendorcredit"]).in("record_id", ids).order("id").range(a, b) as unknown as Page<Row>).catch(() => [] as Row[]),
    approvedQuotationsMany(jobIds),
  ]);

  const units = new Map(reqRows.map((r) => [String(r.id), str(r.unit)]));
  const parts = raw.map((r) => toPart(r, units, unitsOn));
  const linkParts = linkRows.map((r) => toPart(r, units, unitsOn));
  const names = new Map(staffRows.map((s) => [String(s.id), String(s.display_name ?? "")]));

  // The newest approved version of each quotation number: its part lines sell the parts (before any invoice).
  const quoteOf = new Map<string, { number: string; version: number; jobId: string }>();
  for (const [jobId, qs] of approved) for (const q of qs) quoteOf.set(q.id, { number: q.number, version: q.version, jobId });
  const quoteLines = await pageAllIn<Row>(Array.from(quoteOf.keys()), (ids, a, b) => admin.from("quotation_lines").select(QL_COLS).in("quotation_id", ids).not("part_item_id", "is", null).eq("is_active", true).order("id").range(a, b) as unknown as Page<Row>);

  const sales: PaSale[] = [
    // A free comeback keeps every line at its value and takes the whole bill off as the warranty credit (total 0): its
    // parts sold for nothing, so they count as AED 0 with the reason, never as charged.
    ...invLines.map((l): PaSale => {
      const warranty = (Number(l.invoice!.warranty_credit_aed) || 0) > 0.005;
      return { partId: l.part_item_id, kind: l.invoice!.kind === "tax_invoice" ? "tax_invoice" : "proforma", docId: l.invoice!.id, number: l.invoice!.number, jobId: l.invoice!.job_id, amount: warranty ? 0 : Number(l.amount_aed) || 0, cost: num(l.cost_aed), quantity: Number(l.quantity) || 1, at: l.invoice!.issued_at, notCharged: warranty ? "warranty" : null };
    }),
    ...quoteLines.map((r): PaSale => {
      const q = quoteOf.get(String(r.quotation_id))!;
      const l = { ...r, quantity: Number(r.quantity) || 1, unit_cost: num(r.unit_cost), markup_percent: num(r.markup_percent), markup_aed: num(r.markup_aed), unit_price: num(r.unit_price), hours: num(r.hours), labour_rate: num(r.labour_rate), discount_percent: num(r.discount_percent) } as unknown as QuoteLine & { price_display?: string | null; left_off?: boolean; option_group?: string | null; chosen?: boolean; fee_kind?: string | null };
      const notCharged = isUnchosen(l) ? "left_off" : isHidden(l) ? "hidden" : isComplimentary(l) ? "complimentary" : null;
      return { partId: String(r.part_item_id), kind: "quotation", docId: String(r.quotation_id), number: `${q.number}${q.version > 1 ? ` v${q.version}` : ""}`, jobId: q.jobId, amount: notCharged ? 0 : lineTotal(l), cost: null, quantity: Number(r.quantity) || 1, at: null, notCharged };
    }),
  ];

  const docsByJob = new Map<string, { tax: string[]; proforma: string[] }>();
  for (const d of docRows) {
    const j = String(d.job_id);
    const cur = docsByJob.get(j) ?? { tax: [], proforma: [] };
    if (d.kind === "tax_invoice") cur.tax.push(String(d.number));
    else if (!d.converted_to) cur.proforma.push(String(d.number));
    docsByJob.set(j, cur);
  }
  const jobs: PaJob[] = (jobRows as unknown as { id: string; job_number: string; status: string; is_open: boolean; work_done_at: string | null; vehicle: CarRow | null }[]).map((j) => ({
    id: j.id,
    jobNumber: j.job_number,
    status: j.status,
    isOpen: j.is_open,
    workDoneAt: j.work_done_at,
    plate: j.vehicle ? formatPlate(j.vehicle) : "",
    car: [j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" "),
    vin: j.vehicle?.vin ?? "",
    taxInvoices: docsByJob.get(j.id)?.tax ?? [],
    proformas: docsByJob.get(j.id)?.proforma ?? [],
  }));

  // A cancelled LPO's original amount (5 November 2026): every line it ever had, the inactive ones too.
  const cancelledPoIds = poRows.filter((p) => p.status === "cancelled").map((p) => String(p.id));
  const originalOf = new Map<string, number>();
  for (const l of cancelledPoIds.length ? await pageAllIn<Row>(cancelledPoIds, (ids, a, b) => admin.from("purchase_order_lines").select("id, po_id, quantity, unit_cost").in("po_id", ids).order("id").range(a, b) as unknown as Page<Row>) : []) originalOf.set(String(l.po_id), (originalOf.get(String(l.po_id)) ?? 0) + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0));
  const pos: PaPo[] = poRows.map((p) => ({
    id: String(p.id),
    number: String(p.number),
    kind: String(p.kind ?? "supplier"),
    orderType: str(p.order_type),
    jobId: str(p.job_id),
    supplierId: str(p.supplier_id),
    supplierName: String(p.supplier_name ?? ""),
    status: String(p.status),
    total: Number(p.total_cost_aed) || 0,
    originalTotal: p.status === "cancelled" ? (originalOf.get(String(p.id)) ?? null) : null,
    approvedBy: p.approved_by ? (names.get(String(p.approved_by)) ?? null) : null,
    approvedAt: str(p.approved_at),
    orderedAt: str(p.ordered_at),
    receivedAt: str(p.received_at),
    createdAt: String(p.created_at ?? ""),
    invoiceStatus: String(p.supplier_invoice_status ?? "none"),
    invoiceNumber: str(p.supplier_invoice_number),
    invoiceDate: str(p.supplier_invoice_date),
    invoiceAmount: num(p.supplier_invoice_amount),
    checkedAt: str(p.supplier_invoice_checked_at),
    zohoBillId: str(p.zoho_bill_id),
    paidAt: str(p.supplier_paid_at),
    paidBy: p.supplier_paid_by ? (names.get(String(p.supplier_paid_by)) ?? null) : null,
    paidMethod: str(p.supplier_paid_method),
    paidReference: str(p.supplier_paid_reference),
  }));
  const lines: PaPoLine[] = lineRows.map((l) => ({ id: String(l.id), poId: String(l.po_id), partItemId: str(l.part_item_id), description: String(l.description ?? ""), partNumber: str(l.part_number), quantity: Number(l.quantity) || 0, unitCost: Number(l.unit_cost) || 0, receivedQty: Number(l.received_qty) || 0, expectedDate: str(l.expected_date), invoiceUnitCost: num(l.invoice_unit_cost), invoiceCheck: str(l.invoice_check) }));
  const suppliers: PaSupplier[] = supRows.map((s) => ({ id: String(s.id), name: String(s.name ?? ""), trn: str(s.trn), vatRegistered: s.vat_registered !== false, paymentTerms: str(s.payment_terms), isActive: s.is_active !== false }));
  const zoho = new Map(zohoRows.map((z) => [`${z.kind}:${z.record_id}`, String(z.status)]));
  const s = settings as unknown as Record<string, unknown>;
  return {
    today: dubaiDate(),
    now: Date.now(),
    parts,
    linkParts,
    pos,
    lines,
    jobs,
    sales,
    suppliers,
    invoices: invoiceData.rows,
    invoicePartNames: invoiceData.partNames,
    zoho,
    placeholders: toFix.filter((t) => t.kind === "part").map((t) => ({ partId: t.key.startsWith("part:") ? t.key.slice(5) : null, jobId: t.jobId, why: t.why, settled: t.settled })),
    limits: { invoiceRedDays: Number(s.supplier_invoice_pending_red_days) || 7, creditWaitDays: Number(s.supplier_credit_wait_days) || 14, vatPercent: 5 },
  };
});

/** Every tab's rows from the one base (built once; the filters are applied by the caller). */
export function partsAccountsRows(base: PartsBase) {
  const lines = partLines(base);
  const lpos = lpoRows(base);
  const returns = returnRows(base);
  const problems = partsProblems(base, { lines, lpos, returns });
  return { lines, lpos, returns, problems };
}

/** The whole page's figures for a filter: each tab's rows, the supplier balances and the totals at the top. */
export function partsAccountsView(base: PartsBase, f: PaFilter) {
  const all = partsAccountsRows(base);
  const common = commonFilter(f);
  const sup = base.suppliers;
  const invoicesShared = filterInvoiceRows(base.invoices, common, sup, base.invoicePartNames);
  const returnsShared = filterReturns(all.returns, common, sup);
  return {
    all,
    totals: partsAccountsTotals(filterLines(all.lines, common, sup), invoicesShared, filterProblems(all.problems, common, sup)),
    shared: {
      lines: filterLines(all.lines, common, sup),
      lpos: filterLpos(all.lpos, common, sup),
      invoices: invoicesShared,
      balances: supplierBalances(invoicesShared, sup, returnsShared),
      returns: returnsShared,
      problems: filterProblems(all.problems, common, sup),
    },
  };
}
