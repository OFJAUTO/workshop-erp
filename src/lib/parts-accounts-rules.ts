/**
 * PARTS ACCOUNTS (3 November 2026, section 12): the supplier side of the money, for accounts and the owner. Every part
 * line (car, part, supplier, LPO, quantity, cost, selling, margin, where it stands), every LPO (approved by and when,
 * ordered, received, supplier invoiced, paid, the invoice match), what we owe each supplier, the returned parts waiting
 * for a supplier credit note, and the PROBLEMS (bought but never charged, received without a supplier invoice, a price
 * different from the LPO, placeholder costs, a cost changed after invoicing).
 *
 * Pure: no database and no server imports (only other pure modules: the one part state, the one placeholder rule, the
 * one price-change rule, the supplier invoice rows), so the page, the Excel export and the unit tests read the same
 * answer. The server reads the rows (src/lib/parts-accounts.ts) and hands them in as `PartsBase`.
 */
import { formatDate } from "./format";
import { ENDING_LABEL, endingOf, returnCreditOf, type EndingState } from "./part-endings";
import { partState } from "./part-state";
import { cleanUnit, qtyWithUnit as unitQtyWords } from "./part-units";
import { settledCostProblem } from "./part-cost-check";
import { isOurStock, realPartNumber } from "./parts-rows";
import { changeWords, lineChange, profitChangeWords } from "./price-change";
import { MATCH_WORDS, STATUS_WORDS, invWords, unpaidBySupplier, type InvoiceRow } from "./supplier-invoice-rows";
import { supplierNeedsTrn } from "./supplier-rules";

/* ------------------------------------------------------------------------------------------------------------------
 * What the server hands in.
 * ---------------------------------------------------------------------------------------------------------------- */

export type PaJob = {
  id: string;
  jobNumber: string;
  status: string;
  isOpen: boolean;
  workDoneAt: string | null;
  plate: string;
  car: string;
  vin: string;
  /** The live issued tax invoices of the job (numbers), and its live proformas not converted yet. */
  taxInvoices: string[];
  proformas: string[];
};

export type PaPart = {
  id: string;
  jobId: string | null;
  description: string;
  partNumber: string | null;
  quantity: number;
  confirmedQuantity: number | null;
  /** The request's unit ("pc", "set"; section 9 may add litres): shown through qtyWithUnit. */
  unit: string | null;
  supplier: string | null;
  costAed: number | null;
  /** The cost that really stands: the supplier invoice price, the stock average, or a corrected cost. */
  finalCostAed: number | null;
  availability: string | null;
  orderStatus: string | null;
  poId: string | null;
  expectedDate: string | null;
  receivedQty: number;
  issueStatus: string | null;
  issueConfirmedAt: string | null;
  returnStatus: string | null;
  returnedQty: number;
  disposition: string | null;
  dispositionAt: string | null;
  dispositionNote: string | null;
  creditNotePath: string | null;
  notNeededAt: string | null;
  exchangeStatus: string | null;
  exchangeReason: string | null;
  replacedPartId: string | null;
  replacementPartId: string | null;
  pricedAt: string | null;
  createdAt: string;
  goodwillCostAed: number | null;
  zohoVendorcreditId: string | null;
  isActive: boolean;
  removedAt: string | null;
  refusedAt: string | null;
  refusedReason: string | null;
  /** The supplier's credit note for a returned part. Section 7 owns these columns; the loader fills them once they exist. */
  creditNumber?: string | null;
  creditDate?: string | null;
  creditAmount?: number | null;
};

export type PaPo = {
  id: string;
  number: string;
  kind: string;
  orderType: string | null;
  jobId: string | null;
  supplierId: string | null;
  supplierName: string;
  status: string;
  /** Before VAT, supplier charges (courier, freight) included. */
  total: number;
  approvedBy: string | null;
  approvedAt: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  invoiceStatus: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceAmount: number | null;
  checkedAt: string | null;
  zohoBillId: string | null;
  paidAt: string | null;
  paidBy: string | null;
  paidMethod: string | null;
  paidReference: string | null;
};

export type PaPoLine = {
  id: string;
  poId: string;
  partItemId: string | null;
  description: string;
  partNumber: string | null;
  quantity: number;
  unitCost: number;
  receivedQty: number;
  expectedDate: string | null;
  invoiceUnitCost: number | null;
  invoiceCheck: string | null;
};

/** One line that sells a part: an issued tax invoice, a live proforma, or the newest approved quotation version. */
export type PaSale = {
  /** The part_item_id on the line (a tax invoice keeps the ORIGINAL part when it was replaced). */
  partId: string;
  kind: "tax_invoice" | "proforma" | "quotation";
  docId: string;
  number: string;
  jobId: string | null;
  /** Net, before VAT. */
  amount: number;
  /** The invoice line's cost snapshot (tax invoices and proformas). */
  cost: number | null;
  quantity: number;
  at: string | null;
  /**
   * Why the line sells for nothing: a quotation line hidden, left off or complimentary; or an invoice line of a free
   * comeback (the whole bill taken off as the warranty credit, so the customer paid nothing for the part).
   */
  notCharged: "hidden" | "left_off" | "complimentary" | "warranty" | null;
};

export type PaSupplier = {
  id: string;
  name: string;
  trn: string | null;
  vatRegistered: boolean;
  paymentTerms: string | null;
  isActive: boolean;
};

/** A placeholder price found by the Parts desk's "Prices to fix" (open jobs: placeholder, stand-in supplier, cost question). */
export type PlaceholderIn = { partId: string | null; jobId: string | null; why: string; settled: boolean };

export type PartsBase = {
  /** Today in Dubai (YYYY-MM-DD) and now in milliseconds: every day count reads these. */
  today: string;
  now: number;
  parts: PaPart[];
  /**
   * Parts read only to follow a replacement (never listed): an original marked not needed or refused before it was
   * bought, whose replacement carries its sale. The quotation and the invoices keep the ORIGINAL id on the line.
   */
  linkParts?: PaPart[];
  pos: PaPo[];
  lines: PaPoLine[];
  jobs: PaJob[];
  sales: PaSale[];
  suppliers: PaSupplier[];
  /** The Supplier invoices rows (THE grouping of supplier invoices), so every tab reads the same match and status. */
  invoices: InvoiceRow[];
  /** The part names on each LPO of those invoices (the search finds an invoice by a part on it). */
  invoicePartNames: Map<string, string[]>;
  /** Zoho Books state of bills, supplier payments and vendor credits: "bill:<poId>", "billpayment:<poId>", "vendorcredit:<partId>". */
  zoho: Map<string, string>;
  placeholders: PlaceholderIn[];
  limits: { invoiceRedDays: number; creditWaitDays: number; vatPercent: number };
};

/* ------------------------------------------------------------------------------------------------------------------
 * Small words and numbers.
 * ---------------------------------------------------------------------------------------------------------------- */

const r2 = (n: number) => Math.round(n * 100) / 100;
export const aedWords = (n: number) => `AED ${r2(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lower = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A day in Dubai: "2026-11-03" stays as it is; a moment is moved four hours ahead of UTC. */
export function dubaiDay(at: string | null | undefined): string | null {
  if (!at) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const t = Date.parse(at);
  return Number.isFinite(t) ? new Date(t + 4 * 3600000).toISOString().slice(0, 10) : null;
}

/** Whole days between a moment (or day) and now. */
export function daysSince(at: string | null | undefined, now: number): number | null {
  if (!at) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T08:00:00+04:00` : at);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86400000)) : null;
}

/**
 * The quantity with its unit: "2", "1 set", "2 sets", "4 L". THE rule is section 9's (part-units.ts `qtyWithUnit`):
 * the stored word is read through its `cleanUnit` (pieces, litres, sets), and pieces show the number alone.
 */
export function qtyWithUnit(qty: number, unit: string | null | undefined): string {
  return unitQtyWords(qty, cleanUnit(unit));
}

/**
 * Section 7's ending of a part (part-endings.ts `endingOf`, THE rule): cancelled with the supplier, going back to the
 * supplier with the credit note awaited, returned with the credit note in, or kept in stock. Also reads the storage of
 * before migration 20261203140000 (disposition empty, disposition_at set). Every ending takes the part's cost off the
 * job (`partCostCounts`), and is written with removed_at set and the part inactive, so it is read BEFORE "removed".
 */
export const endingStateOf = (p: Pick<PaPart, "disposition" | "dispositionAt" | "returnStatus">): EndingState | null => endingOf({ disposition: p.disposition, disposition_at: p.dispositionAt, return_status: p.returnStatus });

/* ------------------------------------------------------------------------------------------------------------------
 * Part lines: the ladder Priced → To order → On an LPO → Approved → Ordered → Received → With the technician → Fitted →
 * On the proforma → Invoiced to the customer; or an ending instead (returned, stock, scrap, goodwill, refused...).
 * ---------------------------------------------------------------------------------------------------------------- */

export const PART_STEPS = ["to_price", "priced", "to_order", "lpo_waiting", "approved", "ordered", "partly_received", "received", "with_tech", "fitted", "on_proforma", "invoiced"] as const;
export type PartStep = (typeof PART_STEPS)[number];
export const PART_STEP_WORDS: Record<PartStep, string> = {
  to_price: "Waiting for the price",
  priced: "Priced",
  to_order: "To order",
  lpo_waiting: "On LPO, waiting approval",
  approved: "Approved, not ordered",
  ordered: "Ordered",
  partly_received: "Partly received",
  received: "Received",
  with_tech: "With the technician",
  fitted: "Fitted",
  on_proforma: "On the proforma",
  invoiced: "Invoiced to the customer",
};

export const PART_ENDINGS = ["cancelled", "return_pending", "returned", "stock", "scrap", "goodwill", "fit_pending", "exchange", "exchanged", "not_needed", "back", "refused", "removed"] as const;
export type PartEnding = (typeof PART_ENDINGS)[number];
export const PART_ENDING_WORDS: Record<PartEnding, string> = {
  // Section 7's four endings in its own words (ENDING_LABEL).
  cancelled: ENDING_LABEL.cancelled,
  return_pending: ENDING_LABEL.return_pending,
  returned: ENDING_LABEL.returned,
  stock: ENDING_LABEL.stock,
  scrap: "Scrapped",
  goodwill: "Goodwill (owner approved)",
  fit_pending: "Fit as goodwill: waiting for the owner",
  exchange: "Wrong or faulty: being exchanged",
  exchanged: "Exchanged",
  not_needed: "Not needed: ending to decide",
  back: "Back with Parts",
  refused: "Refused on the LPO",
  removed: "Removed",
};

/** Job statuses after the work (the car went on to QC, wash, ready, payment, delivery or out): a part with the technician is fitted. */
const AFTER_WORK = new Set(["pending_qc", "pending_wash", "ready", "pending_payment", "in_delivery", "closed"]);

/**
 * The ending of a part, from THE one part state (part-state.ts, which reads section 7's endings through `endingOf`),
 * plus refused on the LPO and removed. Section 7's endings come first: they are written with removed_at set, so a part
 * cancelled, returned or kept in stock never reads as plain "Removed". Null on the ladder.
 */
export function partEnding(p: PaPart): PartEnding | null {
  if (p.refusedAt) return "refused";
  const seven = endingStateOf(p);
  if (seven) return seven;
  if (p.removedAt) return "removed";
  const key = partState({ order_status: p.orderStatus, issue_status: p.issueStatus, return_status: p.returnStatus, not_needed_at: p.notNeededAt, disposition: p.disposition, disposition_at: p.dispositionAt, exchange_status: p.exchangeStatus, exchange_reason: p.exchangeReason, cost_aed: p.costAed, received_qty: p.receivedQty, availability: p.availability }).key;
  switch (key) {
    case "cancelled": return "cancelled";
    case "return_pending": return "return_pending";
    case "returned_supplier": return "returned";
    case "stock": return "stock";
    case "scrap": return "scrap";
    case "fit_approved": return "goodwill";
    case "fit_pending": return "fit_pending";
    case "exchange":
    case "exchange_ordered": return "exchange";
    case "exchanged": return "exchanged";
    case "not_needed": return "not_needed";
    case "back": return "back";
    default: return null;
  }
}

/** The part reached our hands: received from the supplier (or the shelf), or handed to the technician. */
export function partIsHere(p: PaPart): boolean {
  return p.orderStatus === "received" || p.orderStatus === "partly_received" || p.receivedQty > 0 || p.issueStatus === "confirmed";
}

/** All of it is here: received in full (or off the shelf), or handed to the technician. A part only partly received is not. */
export function partFullyHere(p: PaPart): boolean {
  const qty = p.confirmedQuantity ?? p.quantity;
  return p.orderStatus === "received" || p.issueStatus === "confirmed" || (p.receivedQty > 0 && (p.availability === "in_stock" || p.receivedQty + 0.001 >= qty));
}

/** We bought it (or took it off our shelf): on an LPO that was approved, ordered or received, or here already. */
export function partIsBought(p: PaPart, po: PaPo | null): boolean {
  if (p.refusedAt) return false;
  // Section 7: cancelled with the supplier = never delivered; going back, returned or kept in stock = it arrived.
  const seven = endingStateOf(p);
  if (seven) return seven !== "cancelled";
  if (p.removedAt) return false;
  if (partIsHere(p)) return true;
  if (p.orderStatus === "ordered") return true;
  return !!po && po.kind !== "main" && !["pending_approval", "cancelled"].includes(po.status);
}

/** Ordered from the supplier (or here already): the part's own order status, or its supplier LPO ordered or later. */
export function partIsOrdered(p: PaPart, po: PaPo | null): boolean {
  if (partIsHere(p)) return true;
  if (p.orderStatus === "ordered" || p.orderStatus === "partly_received" || p.orderStatus === "received") return true;
  return !!po && po.kind !== "main" && ["ordered", "partly_received", "received"].includes(po.status);
}

/** Fitted: handed to the technician and the work finished (or the car gone on past the work). */
export function partIsFitted(p: PaPart, job: PaJob | null): boolean {
  return p.issueStatus === "confirmed" && !!job && (!!job.workDoneAt || AFTER_WORK.has(job.status));
}

/**
 * The supplier a part is bought from: its supplier LPO's supplier; on a MAIN LPO still waiting for approval (one LPO for
 * every supplier, named "3 suppliers") the part's own supplier, so the name and the supplier filter stay right.
 */
export function partSupplierOf(p: PaPart, po: PaPo | null, supByName: Map<string, PaSupplier>): { name: string; id: string | null } {
  const own = !!po && po.kind !== "main";
  const name = own ? po.supplierName : (p.supplier ?? po?.supplierName ?? "");
  return { name, id: (own ? po.supplierId : null) ?? supByName.get(lower(name))?.id ?? null };
}

/** Every part the money rules may follow: the listed parts and the originals read only for their replacement. */
export const everyPart = (base: Pick<PartsBase, "parts" | "linkParts">): PaPart[] => (base.linkParts?.length ? [...base.parts, ...base.linkParts] : base.parts);

type SalesOf = { tax: PaSale | null; proforma: PaSale | null; quote: PaSale | null };

/**
 * THE part a replaced part's money follows: its replacement (refused on the LPO and replaced, or exchanged), up to four
 * steps, read both ways (the original's replacement_part_id, or a replacement's replaced_part_id when only that is set).
 */
export function replacementChain(parts: PaPart[]): (id: string) => string {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const back = new Map<string, string>();
  for (const p of parts) if (p.replacedPartId && byId.has(p.replacedPartId) && !back.has(p.replacedPartId)) back.set(p.replacedPartId, p.id);
  return (id: string) => {
    let cur = id;
    for (let i = 0; i < 4; i++) {
      const own = byId.get(cur)?.replacementPartId;
      const next = own && byId.has(own) ? own : back.get(cur);
      if (!next || next === cur) break;
      cur = next;
    }
    return cur;
  };
}

/**
 * Which part each sale belongs to. A tax invoice line keeps the ORIGINAL part when the part was replaced (refused on the
 * LPO, exchanged): the sale belongs to the replacement, never to both, so nothing is counted twice.
 */
export function salesByPart(parts: PaPart[], sales: PaSale[]): Map<string, SalesOf> {
  const ownerOf = replacementChain(parts);
  const out = new Map<string, SalesOf>();
  for (const s of sales) {
    const owner = ownerOf(s.partId);
    const cur = out.get(owner) ?? { tax: null, proforma: null, quote: null };
    if (s.kind === "tax_invoice") cur.tax = cur.tax ? { ...cur.tax, amount: r2(cur.tax.amount + s.amount), cost: s.cost === null ? cur.tax.cost : r2((cur.tax.cost ?? 0) + s.cost) } : s;
    else if (s.kind === "proforma") cur.proforma = cur.proforma ?? s;
    else if (!cur.quote || String(s.at ?? "") > String(cur.quote.at ?? "")) cur.quote = s;
    out.set(owner, cur);
  }
  return out;
}

/**
 * Where a part stands on the ladder (its ending aside): the furthest step, the customer's documents first. The four dots
 * (Ordered · Received · Fitted · Invoiced) are NOT read from this position: each one is its own fact (partLines), so a
 * part put on an early tax invoice while it is still with the supplier shows Received grey and can be late.
 */
export function partStep(p: PaPart, po: PaPo | null, job: PaJob | null, sale: SalesOf | null): PartStep {
  if (sale?.tax) return "invoiced";
  if (sale?.proforma) return "on_proforma";
  if (partIsFitted(p, job)) return "fitted";
  if (p.issueStatus === "confirmed") return "with_tech";
  if (partFullyHere(p)) return "received";
  if (p.orderStatus === "partly_received" || p.receivedQty > 0) return "partly_received";
  if (p.orderStatus === "ordered" || (po && (po.status === "ordered" || po.status === "partly_received"))) return "ordered";
  if (po && po.status === "approved") return "approved";
  if (po && po.status === "pending_approval") return "lpo_waiting";
  if (p.orderStatus === "to_order") return "to_order";
  if (p.costAed === null) return "to_price";
  return "priced";
}

export type PartLineRow = {
  key: string;
  partId: string;
  jobId: string | null;
  jobNumber: string;
  plate: string;
  car: string;
  vin: string;
  part: string;
  partNumber: string | null;
  supplier: string;
  supplierId: string | null;
  poId: string | null;
  poNumber: string | null;
  qty: number;
  unit: string | null;
  qtyWords: string;
  unitCost: number | null;
  cost: number;
  costFrom: string;
  selling: number | null;
  sellingFrom: "tax_invoice" | "proforma" | "quotation" | null;
  sellingDoc: string | null;
  /** Why it sells for nothing: hidden line, left off, complimentary. */
  notCharged: string | null;
  margin: number | null;
  marginPct: number | null;
  step: PartStep;
  ending: PartEnding | null;
  /** The ending when there is one, else the step: the status filter reads this. */
  state: string;
  stateWords: string;
  dots: { ordered: boolean; received: boolean; fitted: boolean; invoiced: boolean };
  bought: boolean;
  expectedDate: string | null;
  late: boolean;
  /** The row's date for the date filter: ordered (else approved, priced, made). */
  day: string | null;
};

const NOT_CHARGED_WORDS: Record<NonNullable<PaSale["notCharged"]>, string> = {
  hidden: "hidden line (internal cost only)",
  left_off: "left off the quotation",
  complimentary: "complimentary line (AED 0)",
  warranty: "free comeback (warranty repair, the customer paid nothing)",
};

/** The status words of a part line: the ending, else the step, with the plain date and what is still missing. */
function lineWords(p: PaPart, po: PaPo | null, step: PartStep, ending: PartEnding | null, sale: SalesOf | null): string {
  if (ending) return PART_ENDING_WORDS[ending];
  // Sold on a document while the part is not all here yet (an early tax invoice, a proforma made at Ready): say so.
  const missing = partFullyHere(p) ? "" : partIsHere(p) ? " · partly received" : partIsOrdered(p, po) || p.availability === "in_stock" ? " · not received yet" : " · not ordered yet";
  if (step === "invoiced" && sale?.tax) return `Invoiced ${sale.tax.number}${missing}`;
  if (step === "on_proforma" && sale?.proforma) return `On proforma ${sale.proforma.number}${missing}`;
  if (step === "ordered" && p.expectedDate) return `Ordered, expected ${formatDate(p.expectedDate)}`;
  return PART_STEP_WORDS[step];
}

/** Every part line with its money and where it stands. */
export function partLines(base: PartsBase): PartLineRow[] {
  const poOf = new Map(base.pos.map((p) => [p.id, p]));
  const jobOf = new Map(base.jobs.map((j) => [j.id, j]));
  const supByName = new Map(base.suppliers.map((s) => [lower(s.name), s]));
  const sales = salesByPart(everyPart(base), base.sales);
  return base.parts.map((p) => {
    const po = p.poId ? (poOf.get(p.poId) ?? null) : null;
    const job = p.jobId ? (jobOf.get(p.jobId) ?? null) : null;
    const sale = sales.get(p.id) ?? null;
    const step = partStep(p, po, job, sale);
    const ending = partEnding(p);
    const qty = p.confirmedQuantity ?? p.quantity;
    const unitCost = p.finalCostAed ?? p.costAed;
    // Section 7's endings take the cost off the job (partCostCounts: cancelled, back to the supplier for a credit, or
    // moved to our stock); goodwill costs what the owner approved.
    const seven = endingStateOf(p);
    const cost = seven ? 0 : ending === "goodwill" && p.goodwillCostAed !== null ? r2(p.goodwillCostAed) : r2((unitCost ?? 0) * qty);
    const costFrom = seven === "returned" || seven === "return_pending" ? "Returned: credit due" : seven === "cancelled" ? "Cancelled: nothing to pay" : seven === "stock" ? "Moved to stock" : p.finalCostAed !== null ? (isOurStock(p.supplier) ? "Stock average" : "Final cost") : po ? "LPO price" : p.costAed !== null ? "Priced" : "No price yet";
    const own = sale?.tax ?? sale?.proforma ?? sale?.quote ?? null;
    const selling = own ? r2(own.amount) : null;
    const margin = selling === null ? null : r2(selling - cost);
    const { name: supplierName, id: supplierId } = partSupplierOf(p, po, supByName);
    const bought = partIsBought(p, po);
    // Late from the supplier: bought, the expected day gone, not all here yet, whatever document it is already on.
    const late = !!p.expectedDate && p.expectedDate < base.today && bought && !partFullyHere(p) && !ending;
    return {
      key: p.id,
      partId: p.id,
      jobId: p.jobId,
      jobNumber: job?.jobNumber ?? "",
      plate: job?.plate ?? "",
      car: job?.car ?? "",
      vin: job?.vin ?? "",
      part: p.description.toUpperCase(),
      partNumber: realPartNumber(p.partNumber),
      supplier: supplierName,
      supplierId,
      poId: po?.id ?? null,
      poNumber: po?.number ?? null,
      qty,
      unit: p.unit,
      qtyWords: qtyWithUnit(qty, p.unit),
      unitCost,
      cost,
      costFrom,
      selling,
      sellingFrom: own?.kind ?? null,
      sellingDoc: own ? (own.kind === "tax_invoice" ? invWords(own.number) : own.number) : null,
      notCharged: own?.notCharged ? NOT_CHARGED_WORDS[own.notCharged] : null,
      margin,
      marginPct: margin !== null && selling ? Math.round((margin / selling) * 1000) / 10 : null,
      step,
      ending,
      state: ending ?? step,
      stateWords: lineWords(p, po, step, ending, sale),
      // Each dot is its own fact, never the ladder position.
      dots: { ordered: partIsOrdered(p, po), received: partFullyHere(p), fitted: partIsFitted(p, job), invoiced: !!sale?.tax },
      bought,
      expectedDate: p.expectedDate,
      late,
      day: dubaiDay(po?.orderedAt ?? po?.approvedAt ?? p.pricedAt ?? p.createdAt),
    };
  });
}

/* ------------------------------------------------------------------------------------------------------------------
 * LPOs: Waiting for approval → Approved, not ordered → Ordered → Received → Supplier invoiced → Paid (Cancelled aside).
 * ---------------------------------------------------------------------------------------------------------------- */

export const LPO_STEPS = ["waiting_approval", "approved", "ordered", "partly_received", "received", "invoiced", "paid", "cancelled"] as const;
export type LpoStep = (typeof LPO_STEPS)[number];
export const LPO_STEP_WORDS: Record<LpoStep, string> = {
  waiting_approval: "Waiting for approval",
  approved: "Approved, not ordered",
  ordered: "Ordered",
  partly_received: "Partly received",
  received: "Received, invoice missing",
  invoiced: "Supplier invoiced",
  paid: "Paid to supplier",
  cancelled: "Cancelled",
};

export function lpoStep(po: Pick<PaPo, "status" | "invoiceStatus" | "paidAt">): LpoStep {
  if (po.status === "cancelled") return "cancelled";
  if (po.status === "pending_approval") return "waiting_approval";
  if (po.status === "approved") return "approved";
  if (po.paidAt) return "paid";
  if (po.invoiceStatus === "received") return "invoiced";
  if (po.status === "received") return "received";
  if (po.status === "partly_received") return "partly_received";
  return "ordered";
}

export type LpoRow = {
  key: string;
  id: string;
  number: string;
  kind: string;
  orderType: string | null;
  supplier: string;
  supplierId: string | null;
  jobId: string | null;
  jobNumber: string;
  plate: string;
  car: string;
  amount: number;
  vat: number;
  total: number;
  approvedBy: string | null;
  approvedAt: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  expected: string | null;
  lateLines: number;
  step: LpoStep;
  stepWords: string;
  /** The LPO's own status (pending_approval, approved, ordered, partly_received, received, cancelled). */
  poStatus: string;
  /** Received or partly received with no supplier invoice entered (to follow). */
  invoiceMissing: boolean;
  invoiceMissingDays: number | null;
  invoice: { key: string; number: string | null; status: string; statusWords: string; match: string[]; matchWords: string[]; duplicateOf: string | null } | null;
  paidAt: string | null;
  paidMethod: string | null;
  paidReference: string | null;
  zohoBill: string | null;
  zohoPayment: string | null;
  parts: number;
  partNames: string[];
  day: string | null;
};

/** Every LPO as the LPO list shows it: a main LPO only while it waits or when refused (its supplier LPOs carry it after). */
export function lpoRows(base: PartsBase): LpoRow[] {
  const jobOf = new Map(base.jobs.map((j) => [j.id, j]));
  const supOf = new Map(base.suppliers.map((s) => [s.id, s]));
  const supByName = new Map(base.suppliers.map((s) => [lower(s.name), s]));
  const invOfPo = new Map<string, InvoiceRow>();
  for (const r of base.invoices) for (const s of r.shares) invOfPo.set(s.poId, r);
  const linesOf = new Map<string, PaPoLine[]>();
  for (const l of base.lines) linesOf.set(l.poId, [...(linesOf.get(l.poId) ?? []), l]);
  return base.pos
    .filter((p) => p.kind !== "main" || p.status === "pending_approval" || p.status === "cancelled")
    .map((p) => {
      const job = p.jobId ? (jobOf.get(p.jobId) ?? null) : null;
      const sup = (p.supplierId ? supOf.get(p.supplierId) : null) ?? supByName.get(lower(p.supplierName)) ?? null;
      const vat = sup?.vatRegistered === false || isOurStock(p.supplierName) ? 0 : r2((p.total * base.limits.vatPercent) / 100);
      const mine = linesOf.get(p.id) ?? [];
      const step = lpoStep(p);
      const missing = (p.status === "received" || p.status === "partly_received") && p.invoiceStatus !== "received" && !isOurStock(p.supplierName);
      const inv = invOfPo.get(p.id) ?? null;
      return {
        key: p.id,
        id: p.id,
        number: p.number,
        kind: p.kind,
        orderType: p.orderType,
        supplier: sup?.name ?? p.supplierName,
        supplierId: p.supplierId ?? sup?.id ?? null,
        jobId: p.jobId,
        jobNumber: job?.jobNumber ?? "",
        plate: job?.plate ?? "",
        car: job?.car ?? "",
        amount: r2(p.total),
        vat,
        total: r2(p.total + vat),
        approvedBy: p.approvedBy,
        approvedAt: p.approvedAt,
        orderedAt: p.orderedAt,
        receivedAt: p.receivedAt,
        createdAt: p.createdAt,
        expected: mine.map((l) => l.expectedDate).filter((d): d is string => !!d).sort().at(-1) ?? null,
        lateLines: ["ordered", "partly_received"].includes(p.status) ? mine.filter((l) => l.expectedDate && l.expectedDate < base.today && l.receivedQty + 0.001 < l.quantity).length : 0,
        step,
        stepWords: LPO_STEP_WORDS[step],
        poStatus: p.status,
        invoiceMissing: missing,
        invoiceMissingDays: missing ? daysSince(p.receivedAt ?? p.orderedAt ?? p.createdAt, base.now) : null,
        invoice: inv && inv.status !== "waiting" ? { key: inv.key, number: inv.number, status: inv.status, statusWords: STATUS_WORDS[inv.status], match: inv.match, matchWords: inv.match.map((m) => MATCH_WORDS[m]), duplicateOf: inv.duplicateOf } : null,
        paidAt: p.paidAt,
        paidMethod: p.paidMethod,
        paidReference: p.paidReference,
        zohoBill: base.zoho.get(`bill:${p.id}`) ?? (p.zohoBillId ? "synced" : null),
        zohoPayment: base.zoho.get(`billpayment:${p.id}`) ?? null,
        parts: mine.length,
        partNames: mine.map((l) => l.description),
        day: dubaiDay(p.createdAt),
      };
    });
}

/* ------------------------------------------------------------------------------------------------------------------
 * Payments to suppliers: per supplier, from THE supplier invoice rows (the Supplier invoices tab and the suppliers list
 * read the same unpaid figure, unpaidBySupplier). With VAT. "Our stock" is never a supplier we pay.
 * ---------------------------------------------------------------------------------------------------------------- */

export type SupplierBalance = {
  key: string;
  supplierId: string | null;
  supplier: string;
  trn: string | null;
  vatRegistered: boolean;
  needsTrn: boolean;
  terms: string | null;
  invoiced: number;
  invoicedCount: number;
  paid: number;
  paidCount: number;
  unpaid: number;
  unpaidCount: number;
  oldestUnpaid: string | null;
  /** LPOs received with the invoice still to follow (their LPO total, with VAT). */
  toFollow: number;
  toFollowCount: number;
  /** Returned parts still waiting for this supplier's credit note (with VAT). */
  creditsDue: number;
  /** Fix 4 (4 November 2026): invoices paid without a proof of payment on file. */
  proofMissingCount: number;
  invoices: InvoiceRow[];
};

export function supplierBalances(invoices: InvoiceRow[], suppliers: PaSupplier[], returns: ReturnRow[] = []): SupplierBalance[] {
  const supOf = new Map(suppliers.map((s) => [s.id, s]));
  const keyOf = (id: string | null, name: string) => id ?? `name:${lower(name)}`;
  const unpaid = new Map(unpaidBySupplier(invoices).map((u) => [keyOf(u.supplierId, u.supplier), u]));
  const out = new Map<string, SupplierBalance>();
  for (const r of invoices) {
    if (isOurStock(r.supplier)) continue;
    const k = keyOf(r.supplierId, r.supplier);
    const s = r.supplierId ? supOf.get(r.supplierId) : null;
    const cur = out.get(k) ?? { key: k, supplierId: r.supplierId, supplier: r.supplier, trn: r.trn, vatRegistered: r.vatRegistered, needsTrn: supplierNeedsTrn({ name: r.supplier, trn: r.trn, vat_registered: r.vatRegistered }), terms: s?.paymentTerms ?? null, invoiced: 0, invoicedCount: 0, paid: 0, paidCount: 0, unpaid: 0, unpaidCount: 0, oldestUnpaid: null, toFollow: 0, toFollowCount: 0, creditsDue: 0, proofMissingCount: 0, invoices: [] };
    cur.invoices.push(r);
    if (r.status === "waiting") {
      cur.toFollow = r2(cur.toFollow + r.total);
      cur.toFollowCount++;
    } else {
      cur.invoiced = r2(cur.invoiced + r.total);
      cur.invoicedCount++;
      // Paid LPO by LPO: a split invoice paid on one LPO counts that LPO's share here and the rest as unpaid.
      if (r.paidAmount > 0) {
        cur.paid = r2(cur.paid + r.paidAmount);
        cur.paidCount++;
      }
      // Fix 4 (4 November 2026): a payment without its proof on file is flagged on Payments to suppliers too.
      if (r.proofMissing) cur.proofMissingCount++;
    }
    out.set(k, cur);
  }
  for (const b of out.values()) {
    const u = unpaid.get(b.key);
    b.unpaid = u?.total ?? 0;
    b.unpaidCount = u?.count ?? 0;
    b.oldestUnpaid = u?.oldest ?? null;
    // Something still to pay first (partly paid included), oldest first; then paid in full, newest first.
    const done = (r: InvoiceRow) => r.status !== "waiting" && r.unpaidAmount <= 0.005;
    b.invoices.sort((x, y) => Number(done(x)) - Number(done(y)) || (done(x) ? String(y.date ?? y.at ?? "").localeCompare(String(x.date ?? x.at ?? "")) : String(x.date ?? x.at ?? "").localeCompare(String(y.date ?? y.at ?? ""))));
  }
  for (const rr of returns) {
    if (rr.state !== "waiting_credit" && rr.state !== "credit_due") continue;
    const k = keyOf(rr.supplierId, rr.supplier);
    const b = out.get(k);
    if (b) b.creditsDue = r2(b.creditsDue + rr.creditWithVat);
  }
  return Array.from(out.values()).sort((a, b) => b.unpaid - a.unpaid || a.supplier.localeCompare(b.supplier));
}

/* ------------------------------------------------------------------------------------------------------------------
 * Returns and credits: parts returned to the supplier waiting for their credit note, parts scanned back to go to the
 * supplier, and parts still without an ending (decided on Returns and leftovers).
 * ---------------------------------------------------------------------------------------------------------------- */

export const RETURN_STATES = ["waiting_credit", "credit_due", "credit_on_file", "to_return", "no_ending"] as const;
export type ReturnState = (typeof RETURN_STATES)[number];
export const RETURN_STATE_WORDS: Record<ReturnState, string> = {
  waiting_credit: "Returned, waiting for the credit note",
  credit_due: "Cancelled after the LPO was paid: credit due",
  credit_on_file: "Credit note on file",
  to_return: "To go back to the supplier",
  no_ending: "No ending decided yet",
};

/**
 * A part cancelled with the supplier (section 7) owes no credit, unless its LPO was already paid when it was cancelled:
 * the supplier then has our money for a part that never came.
 */
export function cancelledAfterPayment(p: Pick<PaPart, "dispositionAt">, po: Pick<PaPo, "paidAt"> | null): boolean {
  if (!po?.paidAt) return false;
  return !p.dispositionAt || po.paidAt <= p.dispositionAt;
}

/**
 * The supplier's credit note of a returned part (ONE function to extend). Today the database holds it as the number
 * typed on Returns and leftovers > "Returned to supplier" (its "Credit note number" box is stored in disposition_note:
 * setDisposition refuses a return with neither the number nor the scan) and the scan (credit_note_path). Section 7 adds
 * structured columns (number, date, amount): the loader maps them into creditNumber/creditDate/creditAmount, which win.
 * `typed` says the number came from that box, so the card does not print it twice as a note.
 */
export function creditNoteOf(p: PaPart): { onFile: boolean; number: string | null; date: string | null; amount: number | null; scan: string | null; typed: boolean } {
  const structured = p.creditNumber?.trim() || null;
  const typedNote = !structured && p.disposition === "returned" ? p.dispositionNote?.trim() || null : null;
  const number = structured ?? typedNote;
  const scan = p.creditNotePath ?? null;
  return { onFile: !!(number || scan), number, date: p.creditDate ?? null, amount: p.creditAmount ?? null, scan, typed: !!typedNote };
}

/**
 * THE one reading of Returns and credits: where a part stands with the supplier's credit, or null when it does not
 * belong on the tab. Section 7's endings (endingStateOf) first: returned with the credit note in = on file; "return
 * pending" (Return to supplier, credit note awaited) = waiting for the credit note; cancelled with the supplier = nothing
 * to credit, unless the LPO was paid before it was cancelled (credit due); kept in stock = not on the tab. Then the older
 * states: scanned back to go to the supplier (to_return); bought and still without an ending (not needed, wrong or
 * faulty, back with Parts). A part never bought (on an LPO still waiting for approval, or never ordered) owes no credit
 * and is left out.
 */
export function returnStateOf(p: PaPart, po: PaPo | null): ReturnState | null {
  if (p.refusedAt) return null;
  const seven = endingStateOf(p);
  if (seven === "returned") return creditNoteOf(p).onFile ? "credit_on_file" : "waiting_credit";
  if (seven === "return_pending") return "waiting_credit";
  if (seven === "cancelled") return cancelledAfterPayment(p, po) ? (creditNoteOf(p).onFile ? "credit_on_file" : "credit_due") : null;
  if (seven) return null;
  if (p.removedAt) return null;
  const ending = partEnding(p);
  if (!partIsBought(p, po)) return null;
  if (p.returnStatus === "to_return" && !p.disposition) return "to_return";
  if (!p.disposition && (ending === "not_needed" || ending === "exchange" || ending === "back")) return "no_ending";
  return null;
}

/**
 * The credit expected from the supplier (before VAT), by section 7's ONE rule (part-endings.ts `returnCreditOf`, also
 * the Zoho vendor-credit figure): the supplier's credit note amount when typed, else the supplier invoice price on the
 * part's LPO line, else the LPO price, else the part's own cost. A cancelled part counts what was ordered.
 */
export function expectedCredit(p: PaPart, line: Pick<PaPoLine, "unitCost" | "invoiceUnitCost" | "quantity"> | null = null): number {
  const qty = endingStateOf(p) === "cancelled" ? (line?.quantity || p.confirmedQuantity || p.quantity || 1) : p.returnedQty || p.receivedQty || p.confirmedQuantity || p.quantity || 1;
  return returnCreditOf({ qty, creditNoteAmount: p.creditAmount ?? null, invoiceUnit: line?.invoiceUnitCost ?? null, lineUnit: line?.unitCost ?? null, finalCost: p.finalCostAed, cost: p.costAed }).amount;
}

export type ReturnRow = {
  key: string;
  partId: string;
  jobId: string | null;
  jobNumber: string;
  plate: string;
  car: string;
  part: string;
  partNumber: string | null;
  supplier: string;
  supplierId: string | null;
  poId: string | null;
  poNumber: string | null;
  qtyWords: string;
  credit: number;
  creditWithVat: number;
  returnedAt: string | null;
  note: string | null;
  creditNote: ReturnType<typeof creditNoteOf>;
  waitingDays: number | null;
  overdue: boolean;
  zoho: string | null;
  state: ReturnState;
  stateWords: string;
  day: string | null;
};

export function returnRows(base: PartsBase): ReturnRow[] {
  const poOf = new Map(base.pos.map((p) => [p.id, p]));
  const jobOf = new Map(base.jobs.map((j) => [j.id, j]));
  const supByName = new Map(base.suppliers.map((s) => [lower(s.name), s]));
  const supOf = new Map(base.suppliers.map((s) => [s.id, s]));
  const lineOfPart = new Map(base.lines.filter((l) => l.partItemId).map((l) => [l.partItemId as string, l]));
  const out: ReturnRow[] = [];
  for (const p of base.parts) {
    const po = p.poId ? (poOf.get(p.poId) ?? null) : null;
    const state = returnStateOf(p, po);
    if (!state) continue;
    const returned = state === "waiting_credit" || state === "credit_on_file" || state === "credit_due";
    const job = p.jobId ? (jobOf.get(p.jobId) ?? null) : null;
    const { name: supplierName, id: supplierId } = partSupplierOf(p, po, supByName);
    const sup = (supplierId ? supOf.get(supplierId) : null) ?? supByName.get(lower(supplierName)) ?? null;
    const credit = expectedCredit(p, lineOfPart.get(p.id) ?? null);
    const vat = sup?.vatRegistered === false ? 0 : r2((credit * base.limits.vatPercent) / 100);
    const cn = creditNoteOf(p);
    const since = returned ? p.dispositionAt : (p.notNeededAt ?? p.createdAt);
    const waitingDays = state === "credit_on_file" ? null : daysSince(since, base.now);
    out.push({
      key: p.id,
      partId: p.id,
      jobId: p.jobId,
      jobNumber: job?.jobNumber ?? "",
      plate: job?.plate ?? "",
      car: job?.car ?? "",
      part: p.description.toUpperCase(),
      partNumber: realPartNumber(p.partNumber),
      supplier: sup?.name ?? supplierName,
      supplierId: supplierId ?? sup?.id ?? null,
      poId: po?.id ?? null,
      poNumber: po?.number ?? null,
      qtyWords: qtyWithUnit(p.returnedQty || p.receivedQty || p.confirmedQuantity || p.quantity || 1, p.unit),
      credit,
      creditWithVat: r2(credit + vat),
      returnedAt: returned ? p.dispositionAt : null,
      // The typed credit note number is shown as the credit note, never again as a note.
      note: cn.typed ? null : p.dispositionNote,
      creditNote: cn,
      waitingDays,
      overdue: state === "waiting_credit" && (waitingDays ?? 0) >= base.limits.creditWaitDays,
      zoho: base.zoho.get(`vendorcredit:${p.id}`) ?? (p.zohoVendorcreditId ? "synced" : null),
      state,
      stateWords: RETURN_STATE_WORDS[state],
      day: dubaiDay(since),
    });
  }
  // Waiting for a credit note first (oldest first), then to return, no ending, and on file.
  const order: Record<ReturnState, number> = { waiting_credit: 0, credit_due: 1, to_return: 2, no_ending: 3, credit_on_file: 4 };
  return out.sort((a, b) => order[a.state] - order[b.state] || String(a.day ?? "").localeCompare(String(b.day ?? "")));
}

/* ------------------------------------------------------------------------------------------------------------------
 * PROBLEMS: one rule each, red first.
 * ---------------------------------------------------------------------------------------------------------------- */

export const PROBLEM_RULES = ["not_charged", "not_on_quote", "no_supplier_invoice", "price_differs", "placeholder_cost", "stale_invoice_cost", "duplicate_invoice", "credit_missing", "supplier_no_trn"] as const;
export type ProblemRule = (typeof PROBLEM_RULES)[number];
export const PROBLEM_WORDS: Record<ProblemRule, string> = {
  not_charged: "Bought, never charged",
  not_on_quote: "Bought, not on the quotation",
  no_supplier_invoice: "Received, no supplier invoice",
  price_differs: "Price different from the LPO",
  placeholder_cost: "Placeholder cost",
  stale_invoice_cost: "Cost changed after invoicing",
  duplicate_invoice: "Supplier invoice to look at",
  credit_missing: "Credit note missing",
  supplier_no_trn: "Supplier without TRN",
};

export type PartsProblem = {
  key: string;
  rule: ProblemRule;
  severity: "red" | "amber";
  title: string;
  detail: string;
  amount: number | null;
  href: string;
  jobId: string | null;
  jobNumber: string;
  plate: string;
  poId: string | null;
  poNumber: string | null;
  partId: string | null;
  supplier: string;
  supplierId: string | null;
  since: string | null;
  day: string | null;
  hay: string;
};

const jobHref = (jobId: string | null) => (jobId ? `/jobs/${jobId}` : "/parts-accounts?tab=lines");

export function partsProblems(base: PartsBase, rows: { lines?: PartLineRow[]; lpos?: LpoRow[]; returns?: ReturnRow[] } = {}): PartsProblem[] {
  const lines = rows.lines ?? partLines(base);
  const lpos = rows.lpos ?? lpoRows(base);
  const returns = rows.returns ?? returnRows(base);
  const all = everyPart(base);
  const partOf = new Map(all.map((p) => [p.id, p]));
  const jobOf = new Map(base.jobs.map((j) => [j.id, j]));
  const poOf = new Map(base.pos.map((p) => [p.id, p]));
  const lineOf = new Map(lines.map((l) => [l.partId, l]));
  const sales = salesByPart(all, base.sales);
  const out: PartsProblem[] = [];
  const add = (x: Omit<PartsProblem, "day" | "hay">) => out.push({ ...x, day: dubaiDay(x.since), hay: [x.title, x.detail, x.jobNumber, x.plate, x.poNumber ?? "", x.supplier].join(" ") });

  for (const l of lines) {
    const p = partOf.get(l.partId)!;
    const job = l.jobId ? (jobOf.get(l.jobId) ?? null) : null;
    const sale = sales.get(l.partId) ?? null;
    // 1. Bought but never charged: here (received or with the technician), no ending, not on an issued tax invoice nor on
    //    a live proforma, on a job already invoiced or gone. A car released on credit leaves with its proforma unpaid (it
    //    becomes the tax invoice when paid): the part IS charged, the customer owes it. Goodwill is the owner's decision.
    if (!l.ending && partIsHere(p) && !sale?.tax && !sale?.proforma && job && (job.taxInvoices.length > 0 || !job.isOpen)) {
      const comp = sale?.quote?.notCharged === "complimentary";
      const why = sale?.quote?.notCharged ? NOT_CHARGED_WORDS[sale.quote.notCharged] : sale?.quote ? `on ${sale.quote.number}, not on the tax invoice` : "no approved quotation line";
      add({ key: `not_charged:${l.partId}`, rule: "not_charged", severity: comp ? "amber" : "red", title: `${l.part} · ${l.jobNumber}`, detail: `${comp ? "Complimentary: the cost is on us" : "Never charged to the customer"} – ${why}${job.taxInvoices.length ? ` (${job.taxInvoices.map(invWords).join(", ")})` : " (car gone)"} · cost ${aedWords(l.cost)}`, amount: l.cost, href: jobHref(l.jobId), jobId: l.jobId, jobNumber: l.jobNumber, plate: l.plate, poId: l.poId, poNumber: l.poNumber, partId: l.partId, supplier: l.supplier, supplierId: l.supplierId, since: p.issueConfirmedAt ?? p.dispositionAt ?? p.pricedAt ?? p.createdAt });
      continue;
    }
    // 2. Bought, not on the quotation (open job, not invoiced yet): caught before the invoice.
    if (!l.ending && (l.bought || partIsHere(p)) && job && job.isOpen && !job.taxInvoices.length && !sale?.tax && !sale?.proforma && (!sale?.quote || sale.quote.notCharged === "hidden" || sale.quote.notCharged === "left_off")) {
      const why = sale?.quote?.notCharged ? NOT_CHARGED_WORDS[sale.quote.notCharged] : "no approved quotation line";
      add({ key: `not_on_quote:${l.partId}`, rule: "not_on_quote", severity: "amber", title: `${l.part} · ${l.jobNumber}`, detail: `Bought for the car but not charged: ${why} · cost ${aedWords(l.cost)}. Add it to the quotation (or mark it goodwill) before the invoice.`, amount: l.cost, href: jobHref(l.jobId), jobId: l.jobId, jobNumber: l.jobNumber, plate: l.plate, poId: l.poId, poNumber: l.poNumber, partId: l.partId, supplier: l.supplier, supplierId: l.supplierId, since: (l.poId ? poOf.get(l.poId)?.orderedAt : null) ?? p.pricedAt ?? p.createdAt });
    }
  }

  // 3. Received without a supplier invoice.
  for (const r of lpos) {
    if (!r.invoiceMissing) continue;
    const days = r.invoiceMissingDays ?? 0;
    add({ key: `no_supplier_invoice:${r.id}`, rule: "no_supplier_invoice", severity: days >= base.limits.invoiceRedDays ? "red" : "amber", title: `${r.number} · ${r.supplier}`, detail: `Received ${days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}, supplier invoice missing · ${aedWords(r.amount)} before VAT`, amount: r.amount, href: `/parts/orders/${r.id}`, jobId: r.jobId, jobNumber: r.jobNumber, plate: r.plate, poId: r.id, poNumber: r.number, partId: null, supplier: r.supplier, supplierId: r.supplierId, since: r.receivedAt ?? r.orderedAt ?? r.createdAt });
  }

  // 4. A supplier invoice price different from the LPO (one problem per line).
  const lpoOf = new Map(lpos.map((r) => [r.id, r]));
  for (const ln of base.lines) {
    const change = lineChange({ quantity: ln.quantity, received_qty: ln.receivedQty, unit_cost: ln.unitCost, invoice_unit_cost: ln.invoiceUnitCost });
    if (!change && ln.invoiceCheck !== "mismatch" && ln.invoiceCheck !== "disputed") continue;
    const po = poOf.get(ln.poId);
    if (!po || po.status === "cancelled") continue;
    const r = lpoOf.get(po.id);
    const job = po.jobId ? (jobOf.get(po.jobId) ?? null) : null;
    const words = changeWords({ quantity: ln.quantity, received_qty: ln.receivedQty, unit_cost: ln.unitCost, invoice_unit_cost: ln.invoiceUnitCost }) ?? "Price to check";
    const state = ln.invoiceCheck === "mismatch" ? "waits for the owner's OK" : ln.invoiceCheck === "disputed" ? "queried with the supplier" : "accepted";
    const profit = change ? profitChangeWords(change.total) : null;
    add({ key: `price_differs:${ln.id}`, rule: "price_differs", severity: ln.invoiceCheck === "mismatch" || ln.invoiceCheck === "disputed" ? "red" : "amber", title: `${ln.description.toUpperCase()} · ${po.number}`, detail: `${words} · ${state}${profit ? ` · ${profit}` : ""}`, amount: change?.total ?? null, href: `/parts/orders/${po.id}`, jobId: po.jobId, jobNumber: job?.jobNumber ?? "", plate: job?.plate ?? "", poId: po.id, poNumber: po.number, partId: ln.partItemId, supplier: r?.supplier ?? po.supplierName, supplierId: r?.supplierId ?? po.supplierId, since: po.receivedAt ?? po.orderedAt ?? po.createdAt });
  }

  // 5. Placeholder costs: open jobs from the Parts desk's "Prices to fix" (THE list: placeholder price, stand-in
  //    supplier, an open cost question); jobs that left from THE settled-cost rule (settledCostProblem).
  const seen = new Set<string>();
  for (const ph of base.placeholders) {
    if (!ph.partId || seen.has(ph.partId)) continue;
    const l = lineOf.get(ph.partId);
    if (!l) continue;
    seen.add(ph.partId);
    add(placeholderProblem(l, ph.why, partOf.get(ph.partId)!));
  }
  for (const l of lines) {
    if (seen.has(l.partId) || !l.jobId) continue;
    const job = jobOf.get(l.jobId);
    if (!job || job.isOpen) continue;
    if (l.ending && l.ending !== "goodwill") continue;
    const p = partOf.get(l.partId)!;
    if (!l.bought && !partIsHere(p) && !sales.get(l.partId)?.tax) continue;
    const why = settledCostProblem({ cost_aed: p.costAed, final_cost_aed: p.finalCostAed, supplier: p.supplier });
    if (!why) continue;
    seen.add(l.partId);
    add(placeholderProblem(l, why, p));
  }

  // 6. A tax invoice line whose cost is no longer the part's cost (the supplier invoice came after the invoice).
  const ownerOf = replacementChain(all);
  for (const s of base.sales) {
    if (s.kind !== "tax_invoice" || s.cost === null) continue;
    const owner = partOf.get(ownerOf(s.partId)) ?? null;
    if (!owner) continue;
    const ending = partEnding(owner);
    if (ending === "refused" || ending === "removed") continue;
    // Section 7: an ending after the tax invoice takes the part's cost off the job (0); the tax invoice is never changed
    // from there (the owner is told "Cost correction needed"), so it stays on this list until corrected.
    const seven = endingStateOf(owner);
    const unit = seven ? 0 : (owner.finalCostAed ?? owner.costAed);
    if (unit === null) continue;
    const real = r2(unit * (s.quantity || 1));
    const diff = r2(real - s.cost);
    if (Math.abs(diff) <= 0.05) continue;
    const l = lineOf.get(owner.id);
    add({ key: `stale_invoice_cost:${s.docId}:${s.partId}`, rule: "stale_invoice_cost", severity: "red", title: `${owner.description.toUpperCase()} · ${invWords(s.number)}`, detail: `${invWords(s.number)} counts the cost as ${aedWords(s.cost)}, ${seven ? `but the part was ${seven === "cancelled" ? "cancelled with the supplier" : seven === "stock" ? "moved to our stock" : "returned to the supplier"} after it: its cost on the job is` : owner.finalCostAed !== null ? "the supplier invoice makes it" : "the part's cost is now"} ${aedWords(real)}: the job's profit is ${diff > 0 ? "overstated" : "understated"} by ${aedWords(Math.abs(diff))}`, amount: diff, href: jobHref(s.jobId), jobId: s.jobId, jobNumber: l?.jobNumber ?? "", plate: l?.plate ?? "", poId: l?.poId ?? null, poNumber: l?.poNumber ?? null, partId: owner.id, supplier: l?.supplier ?? owner.supplier ?? "", supplierId: l?.supplierId ?? null, since: s.at });
  }

  // 7. Supplier invoices to look at: a possible duplicate (red) or a query with Parts still open (amber).
  for (const r of base.invoices) {
    if (r.status === "waiting" || isOurStock(r.supplier)) continue;
    const share = r.shares[0];
    if (r.duplicateOf) add({ key: `duplicate_invoice:${r.key}`, rule: "duplicate_invoice", severity: "red", title: `${invWords(r.number)} · ${r.supplier}`, detail: `Possible duplicate of ${r.duplicateOf} · ${aedWords(r.total)} with VAT`, amount: r.total, href: `/parts-accounts?tab=invoices&open=${encodeURIComponent(r.key)}`, jobId: share?.jobId ?? null, jobNumber: share?.jobNumber ?? "", plate: share?.plate ?? "", poId: share?.poId ?? null, poNumber: share?.poNumber ?? null, partId: null, supplier: r.supplier, supplierId: r.supplierId, since: r.at });
    else if (r.status === "queried") add({ key: `duplicate_invoice:${r.key}`, rule: "duplicate_invoice", severity: "amber", title: `${invWords(r.number)} · ${r.supplier}`, detail: `Queried with Parts: ${r.query ?? ""}`, amount: r.total, href: `/parts-accounts?tab=invoices&open=${encodeURIComponent(r.key)}`, jobId: share?.jobId ?? null, jobNumber: share?.jobNumber ?? "", plate: share?.plate ?? "", poId: share?.poId ?? null, poNumber: share?.poNumber ?? null, partId: null, supplier: r.supplier, supplierId: r.supplierId, since: r.at });
  }

  // 8. Returned to the supplier with no credit note on file (and, amber, a part cancelled after its LPO was paid).
  for (const rr of returns) {
    if (rr.state === "credit_due") {
      add({ key: `credit_missing:${rr.partId}`, rule: "credit_missing", severity: "amber", title: `${rr.part} · ${rr.supplier}`, detail: `Cancelled with the supplier after ${rr.poNumber ?? "its LPO"} was paid: ask the supplier for the credit · ${aedWords(rr.creditWithVat)} with VAT`, amount: rr.creditWithVat, href: "/parts-accounts?tab=returns", jobId: rr.jobId, jobNumber: rr.jobNumber, plate: rr.plate, poId: rr.poId, poNumber: rr.poNumber, partId: rr.partId, supplier: rr.supplier, supplierId: rr.supplierId, since: rr.returnedAt });
      continue;
    }
    if (rr.state !== "waiting_credit") continue;
    add({ key: `credit_missing:${rr.partId}`, rule: "credit_missing", severity: rr.overdue ? "red" : "amber", title: `${rr.part} · ${rr.supplier}`, detail: `Returned ${rr.waitingDays === 0 ? "today" : `${rr.waitingDays} day${rr.waitingDays === 1 ? "" : "s"} ago`}, no supplier credit note on file · ${aedWords(rr.creditWithVat)} with VAT due`, amount: rr.creditWithVat, href: "/parts-accounts?tab=returns", jobId: rr.jobId, jobNumber: rr.jobNumber, plate: rr.plate, poId: rr.poId, poNumber: rr.poNumber, partId: rr.partId, supplier: rr.supplier, supplierId: rr.supplierId, since: rr.returnedAt });
  }

  // 9. A VAT-registered supplier with invoices but no TRN: their bills cannot reach Zoho Books.
  const noTrn = new Map<string, { name: string; id: string | null; n: number; at: string | null }>();
  for (const r of base.invoices) {
    if (r.status === "waiting" || !supplierNeedsTrn({ name: r.supplier, trn: r.trn, vat_registered: r.vatRegistered })) continue;
    const k = r.supplierId ?? lower(r.supplier);
    const cur = noTrn.get(k) ?? { name: r.supplier, id: r.supplierId, n: 0, at: r.at };
    cur.n++;
    if (r.at && (!cur.at || r.at < cur.at)) cur.at = r.at;
    noTrn.set(k, cur);
  }
  for (const [k, s] of noTrn) add({ key: `supplier_no_trn:${k}`, rule: "supplier_no_trn", severity: "amber", title: s.name, detail: `VAT registered but no TRN: ${s.n} invoice${s.n === 1 ? "" : "s"} cannot go to Zoho Books until the 15-digit TRN is typed on Parts > Suppliers`, amount: null, href: `/parts/suppliers?q=${encodeURIComponent(s.name)}`, jobId: null, jobNumber: "", plate: "", poId: null, poNumber: null, partId: null, supplier: s.name, supplierId: s.id, since: s.at });

  return out.sort((a, b) => Number(a.severity !== "red") - Number(b.severity !== "red") || String(a.since ?? "").localeCompare(String(b.since ?? "")));
}

function placeholderProblem(l: PartLineRow, why: string, p: PaPart): Omit<PartsProblem, "day" | "hay"> {
  return { key: `placeholder_cost:${l.partId}`, rule: "placeholder_cost", severity: "red", title: `${l.part} · ${l.jobNumber}`, detail: `${why} · cost ${aedWords(l.cost)}${l.selling !== null ? ` · sold ${aedWords(l.selling)}` : ""} – the real cost is missing, the profit is wrong`, amount: l.cost, href: jobHref(l.jobId), jobId: l.jobId, jobNumber: l.jobNumber, plate: l.plate, poId: l.poId, poNumber: l.poNumber, partId: l.partId, supplier: l.supplier, supplierId: l.supplierId, since: p.pricedAt ?? p.createdAt };
}

/* ------------------------------------------------------------------------------------------------------------------
 * Tabs, filters, totals.
 * ---------------------------------------------------------------------------------------------------------------- */

export const PA_TABS = [
  { key: "lines", label: "Parts lines" },
  { key: "lpos", label: "LPOs" },
  { key: "invoices", label: "Supplier invoices" },
  { key: "payments", label: "Payments to suppliers" },
  { key: "returns", label: "Returns and credits" },
  { key: "problems", label: "Problems" },
] as const;
export type PaTab = (typeof PA_TABS)[number]["key"];
export const asPaTab = (v: string | null | undefined): PaTab => (PA_TABS.some((t) => t.key === v) ? (v as PaTab) : "lines");

/** The quick chips of each tab (the Supplier invoices tab keeps its own filters). */
export const PA_QUICK: Record<PaTab, { key: string; label: string }[]> = {
  lines: [
    { key: "bought", label: "Parts bought" },
    { key: "not_invoiced", label: "Bought, not invoiced yet" },
    { key: "invoiced", label: "Invoiced" },
    { key: "late", label: "Late from the supplier" },
    { key: "ended", label: "Returned, stock, refused…" },
  ],
  lpos: [
    { key: "approved_not_ordered", label: "Approved but not ordered" },
    { key: "ordered_not_received", label: "Ordered but not received" },
    { key: "received_no_invoice", label: "Received, invoice missing" },
    { key: "unpaid", label: "Invoiced, not paid" },
  ],
  invoices: [],
  payments: [
    { key: "unpaid", label: "Unpaid only" },
    { key: "paid", label: "Paid in full" },
    { key: "to_follow", label: "Invoice to follow" },
  ],
  returns: RETURN_STATES.map((s) => ({ key: s, label: RETURN_STATE_WORDS[s] })),
  problems: PROBLEM_RULES.map((r) => ({ key: r, label: PROBLEM_WORDS[r] })),
};

/** The Status drop-down of each tab. */
export const PA_STATUS: Record<PaTab, { value: string; label: string }[]> = {
  lines: [...PART_STEPS.map((s) => ({ value: s, label: PART_STEP_WORDS[s] })), ...PART_ENDINGS.map((e) => ({ value: e, label: PART_ENDING_WORDS[e] }))],
  lpos: LPO_STEPS.map((s) => ({ value: s, label: LPO_STEP_WORDS[s] })),
  invoices: [],
  payments: [],
  returns: RETURN_STATES.map((s) => ({ value: s, label: RETURN_STATE_WORDS[s] })),
  problems: [{ value: "red", label: "Red only" }, { value: "amber", label: "Amber only" }],
};

export type PaFilter = { q?: string; supplier?: string; from?: string; to?: string; status?: string; quick?: string };

/** The parts of a filter every tab shares (search, supplier, dates): the totals at the top read only these. */
export const commonFilter = (f: PaFilter): PaFilter => ({ q: f.q, supplier: f.supplier, from: f.from, to: f.to });

type Facets = { supplierId: string | null; supplier: string; day: string | null; hay: string };

/** One search: by letters, and without spaces or dashes for plates, part numbers and document numbers ("gg13706" = "GG 13706"). */
export function searchHit(hay: string, q: string | null | undefined): boolean {
  const needle = lower(q).replace(/\s+/g, " ");
  if (!needle) return true;
  const h = hay.toLowerCase();
  if (h.includes(needle)) return true;
  const c = compact(needle);
  return c.length >= 3 && compact(h).includes(c);
}

function passes(x: Facets, f: PaFilter, supplierNameOf: (id: string) => string | null): boolean {
  if (f.supplier) {
    const name = supplierNameOf(f.supplier);
    if (x.supplierId !== f.supplier && !(name && lower(x.supplier) === lower(name))) return false;
  }
  if (f.from && (!x.day || x.day < f.from)) return false;
  if (f.to && (!x.day || x.day > f.to)) return false;
  return searchHit(x.hay, f.q);
}

const nameLookup = (suppliers: PaSupplier[]) => {
  const m = new Map(suppliers.map((s) => [s.id, s.name]));
  return (id: string) => m.get(id) ?? null;
};

/**
 * THE rules behind the totals AND the lists their boxes open (a box and the list it opens always agree): a part bought
 * (its cost counts; a part returned to the supplier is a credit, not a cost), and a part charged on a tax invoice.
 */
export const isBoughtLine = (r: Pick<PartLineRow, "bought" | "ending">): boolean => r.bought && r.ending !== "returned" && r.ending !== "return_pending";
export const isChargedLine = (r: Pick<PartLineRow, "step" | "ending">): boolean => r.step === "invoiced" && !r.ending;

export function inLineQuick(r: PartLineRow, quick: string): boolean {
  switch (quick) {
    case "bought": return isBoughtLine(r);
    case "not_invoiced": return r.bought && !r.ending && r.step !== "invoiced";
    case "invoiced": return isChargedLine(r);
    case "late": return r.late;
    case "ended": return !!r.ending;
    default: return true;
  }
}
export function filterLines(rows: PartLineRow[], f: PaFilter, suppliers: PaSupplier[]): PartLineRow[] {
  const nameOf = nameLookup(suppliers);
  return rows.filter((r) => passes({ supplierId: r.supplierId, supplier: r.supplier, day: r.day, hay: [r.jobNumber, r.plate, r.car, r.vin, r.part, r.partNumber ?? "", r.supplier, r.poNumber ?? "", r.sellingDoc ?? ""].join(" ") }, f, nameOf) && (!f.status || r.state === f.status) && (!f.quick || inLineQuick(r, f.quick)));
}

export function inLpoQuick(r: LpoRow, quick: string): boolean {
  switch (quick) {
    case "approved_not_ordered": return r.step === "approved" && r.kind !== "main";
    // By the LPO's own status: an invoice entered (or even paid) before the parts came still counts as not received.
    case "ordered_not_received": return r.poStatus === "ordered" || r.poStatus === "partly_received";
    case "received_no_invoice": return r.invoiceMissing;
    case "unpaid": return r.step === "invoiced";
    default: return true;
  }
}
export function filterLpos(rows: LpoRow[], f: PaFilter, suppliers: PaSupplier[]): LpoRow[] {
  const nameOf = nameLookup(suppliers);
  return rows.filter((r) => passes({ supplierId: r.supplierId, supplier: r.supplier, day: r.day, hay: [r.number, r.supplier, r.jobNumber, r.plate, r.car, r.invoice?.number ?? "", ...r.partNames].join(" ") }, f, nameOf) && (!f.status || r.step === f.status) && (!f.quick || inLpoQuick(r, f.quick)));
}

/** The supplier invoices a balance is made of: the shared filters (search over invoice no., supplier, LPOs, cars, parts). */
export function filterInvoiceRows(rows: InvoiceRow[], f: PaFilter, suppliers: PaSupplier[], partNames: Map<string, string[]> = new Map()): InvoiceRow[] {
  const nameOf = nameLookup(suppliers);
  return rows.filter((r) => passes({ supplierId: r.supplierId, supplier: r.supplier, day: r.date ?? dubaiDay(r.at), hay: [r.number ?? "", r.supplier, r.trn ?? "", ...r.shares.flatMap((s) => [s.poNumber, s.jobNumber ?? "", s.plate, s.car, ...(partNames.get(s.poId) ?? [])])].join(" ") }, f, nameOf));
}
export function filterBalances(rows: SupplierBalance[], quick: string | undefined): SupplierBalance[] {
  if (quick === "unpaid") return rows.filter((b) => b.unpaid > 0);
  if (quick === "paid") return rows.filter((b) => b.invoicedCount > 0 && b.unpaid === 0);
  if (quick === "to_follow") return rows.filter((b) => b.toFollowCount > 0);
  return rows;
}

export function filterReturns(rows: ReturnRow[], f: PaFilter, suppliers: PaSupplier[]): ReturnRow[] {
  const nameOf = nameLookup(suppliers);
  const want = f.status || f.quick;
  return rows.filter((r) => passes({ supplierId: r.supplierId, supplier: r.supplier, day: r.day, hay: [r.jobNumber, r.plate, r.car, r.part, r.partNumber ?? "", r.supplier, r.poNumber ?? "", r.creditNote.number ?? "", r.note ?? ""].join(" ") }, f, nameOf) && (!want || r.state === want));
}

export function filterProblems(rows: PartsProblem[], f: PaFilter, suppliers: PaSupplier[]): PartsProblem[] {
  const nameOf = nameLookup(suppliers);
  return rows.filter((r) => passes({ supplierId: r.supplierId, supplier: r.supplier, day: r.day, hay: r.hay }, f, nameOf) && (!f.status || r.severity === f.status) && (!f.quick || r.rule === f.quick));
}

export type PaTotals = {
  bought: number;
  boughtCount: number;
  charged: number;
  chargedCount: number;
  margin: number;
  marginPct: number | null;
  owed: number;
  owedCount: number;
  toFollow: number;
  toFollowCount: number;
  problems: number;
  problemsRed: number;
};

/**
 * The figures across the top, the same on every tab, from the rows the shared filters keep (search, supplier, dates):
 * what the parts cost us, what the customers were charged for them on tax invoices, the margin on those, what we owe the
 * suppliers (with VAT; invoices to follow apart), and the problems.
 */
export function partsAccountsTotals(lines: PartLineRow[], invoices: InvoiceRow[], problems: PartsProblem[]): PaTotals {
  const bought = lines.filter(isBoughtLine);
  const invoiced = lines.filter(isChargedLine);
  const charged = r2(invoiced.reduce((a, l) => a + (l.selling ?? 0), 0));
  const margin = r2(invoiced.reduce((a, l) => a + (l.margin ?? 0), 0));
  const owedRows = unpaidBySupplier(invoices.filter((r) => !isOurStock(r.supplier)));
  const waiting = invoices.filter((r) => r.status === "waiting" && !isOurStock(r.supplier));
  return {
    bought: r2(bought.reduce((a, l) => a + l.cost, 0)),
    boughtCount: bought.length,
    charged,
    chargedCount: invoiced.length,
    margin,
    marginPct: charged > 0 ? Math.round((margin / charged) * 1000) / 10 : null,
    owed: r2(owedRows.reduce((a, u) => a + u.total, 0)),
    owedCount: owedRows.reduce((a, u) => a + u.count, 0),
    toFollow: r2(waiting.reduce((a, r) => a + r.total, 0)),
    toFollowCount: waiting.length,
    problems: problems.length,
    problemsRed: problems.filter((p) => p.severity === "red").length,
  };
}
