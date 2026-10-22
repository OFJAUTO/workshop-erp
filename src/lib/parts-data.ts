import "server-only";
import { randomBytes } from "node:crypto";
import { PART_SELECT, toPart } from "./quote-data";
import type { PartItem } from "./quotes";
import { createAdminClient } from "./supabase/admin";
import { poCharges, type SupplierCharge } from "./supplier-charges";

export type PoStatus = "pending_approval" | "approved" | "ordered" | "partly_received" | "received" | "cancelled";
export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  pending_approval: "Waiting for approval",
  approved: "Approved, not sent yet",
  ordered: "Ordered",
  partly_received: "Partly received",
  received: "Received",
  cancelled: "Cancelled",
};
export type SupplierInvoiceStatus = "none" | "to_follow" | "received";

export type PurchaseOrderRow = {
  id: string;
  number: string;
  job_id: string;
  supplier_id: string | null;
  supplier_name: string;
  status: PoStatus;
  notes: string | null;
  total_cost_aed: number;
  approved_by: string | null;
  approved_at: string | null;
  deposit_override_by: string | null;
  deposit_override_reason: string | null;
  ordered_at: string | null;
  ordered_by: string | null;
  received_at: string | null;
  supplier_invoice_status: SupplierInvoiceStatus;
  /** The public verification link on the supplier copy (QR). */
  verify_token: string | null;
  superseded_by: string | null;
  sent_at: string | null;
  emailed_at: string | null;
  emailed_to: string | null;
  sent_by: string | null;
  sent_method: string | null;
  /** A stock order's kind of goods: stock parts, workshop consumables, or tools and equipment (a fixed asset above the Settings amount). */
  order_type?: "stock_parts" | "consumables" | "tools" | null;
  fixed_asset?: boolean;
  supplier_invoice_number: string | null;
  supplier_invoice_path: string | null;
  supplier_invoice_amount: number | null;
  supplier_invoice_at: string | null;
  supplier_invoice_by: string | null;
  /** The date printed on the supplier's invoice (compulsory with the number). */
  supplier_invoice_date: string | null;
  supplier_paid_at: string | null;
  supplier_paid_by: string | null;
  supplier_paid_reference: string | null;
  /** "main": the one LPO per job with every supplier, approved by the owner or accounts; "supplier": one supplier's parts, made from the main one (LPO-00012-1, -2...). */
  kind?: "main" | "supplier" | "stock";
  parent_id?: string | null;
  sub_number?: number | null;
  created_at: string;
  created_by: string | null;
};
export type PoLineRow = {
  id: string;
  po_id: string;
  part_item_id: string;
  position: number;
  description: string;
  part_number: string | null;
  quantity: number;
  /** The net cost per unit after the supplier's discount. */
  unit_cost: number;
  list_price: number | null;
  discount_percent: number | null;
  expected_date: string | null;
  received_qty: number;
  received_at: string | null;
  flag: "wrong" | "damaged" | null;
  flag_note: string | null;
  invoice_unit_cost: number | null;
  invoice_check: "match" | "mismatch" | "accepted" | "disputed" | null;
  stock_item_id: string | null;
};

export const PO_SELECT = "id, number, job_id, supplier_id, supplier_name, status, notes, total_cost_aed, approved_by, approved_at, deposit_override_by, deposit_override_reason, ordered_at, ordered_by, received_at, supplier_invoice_status, supplier_invoice_number, supplier_invoice_path, supplier_invoice_amount, supplier_invoice_at, supplier_invoice_by, supplier_invoice_date, supplier_paid_at, supplier_paid_by, supplier_paid_reference, verify_token, superseded_by, sent_at, sent_by, sent_method, created_at, created_by, kind, parent_id, sub_number, emailed_at, emailed_to, order_type, fixed_asset";
export const PO_LINE_SELECT = "id, po_id, part_item_id, position, description, part_number, quantity, unit_cost, list_price, discount_percent, expected_date, received_qty, received_at, flag, flag_note, invoice_unit_cost, invoice_check, stock_item_id";
/** The part columns the Parts desk needs after approval, on top of the quotation ones. */
export const PART_FULL_SELECT = PART_SELECT + ", stickers_printed, po_id, po_line_id, expected_date, received_qty, issued_qty, issue_status, issued_at, issued_by, issue_confirmed_at, issue_confirmed_by, returned_qty, return_status, return_note, label_code, final_cost_aed, tech_received_qty, not_received_at, exchange_status, exchange_reason, exchange_note, exchange_at, replacement_part_id, replaced_part_id, not_needed_at, not_needed_by, not_needed_reason, disposition, disposition_at, disposition_by, disposition_note, credit_note_path, goodwill_cost_aed, ready_for_handover_at, ready_for_handover_by";

export type PartFull = PartItem & {
  stickers_printed: number;
  po_id: string | null;
  po_line_id: string | null;
  expected_date: string | null;
  received_qty: number;
  issued_qty: number;
  issue_status: "none" | "issued" | "confirmed";
  issued_at: string | null;
  issued_by: string | null;
  issue_confirmed_at: string | null;
  issue_confirmed_by: string | null;
  returned_qty: number;
  return_status: "none" | "to_return" | "returned";
  return_note: string | null;
  label_code: string | null;
  final_cost_aed: number | null;
  tech_received_qty: number | null;
  not_received_at: string | null;
  exchange_status: "none" | "needed" | "ordered" | "done" | null;
  exchange_reason: string | null;
  exchange_note: string | null;
  exchange_at: string | null;
  replacement_part_id: string | null;
  replaced_part_id: string | null;
  not_needed_at: string | null;
  not_needed_by: string | null;
  not_needed_reason: string | null;
  disposition: "returned" | "stock" | "fit_pending" | "fit_approved" | null;
  disposition_at: string | null;
  disposition_by: string | null;
  disposition_note: string | null;
  credit_note_path: string | null;
  goodwill_cost_aed: number | null;
  ready_for_handover_at: string | null;
  ready_for_handover_by: string | null;
};

function num<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T {
  const out = { ...row };
  for (const k of keys) {
    const v = out[k];
    if (v !== null && v !== undefined && v !== "") (out as Record<string, unknown>)[k as string] = Number(v);
  }
  return out;
}
export const toPo = (r: Record<string, unknown>) => num(r as unknown as PurchaseOrderRow, ["total_cost_aed", "supplier_invoice_amount"]);
export const toPoLine = (r: Record<string, unknown>) => num(r as unknown as PoLineRow, ["position", "quantity", "unit_cost", "list_price", "discount_percent", "received_qty", "invoice_unit_cost"]);
export const toPartFull = (r: Record<string, unknown>) => num({ ...toPart(r), ...(r as object) } as unknown as PartFull, ["quantity", "cost_aed", "confirmed_quantity", "received_qty", "issued_qty", "returned_qty", "final_cost_aed"]);

export type JobBrief = { id: string; job_number: string; status: string; is_open: boolean; customer_id: string; gated_in_by: string; assigned_to: string | null; department: string | null; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; model_year?: number | null; make: { name: string } | null; model: { name: string } | null } | null };
export const JOB_BRIEF_SELECT = "id, job_number, status, is_open, customer_id, gated_in_by, assigned_to, department, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name))";

export type SupplierRow = { id: string; name: string; trn: string | null; phone: string | null; email: string | null; address: string | null; payment_terms: string | null };
export type PoBundle = { po: PurchaseOrderRow; lines: PoLineRow[]; job: JobBrief | null; names: Map<string, string>; parts: PartFull[]; supplier: SupplierRow | null; /** Courier, freight: "Other charges" on this LPO, already in its total. */ charges: SupplierCharge[] };

export async function loadPurchaseOrder(id: string): Promise<PoBundle | null> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("purchase_orders").select(PO_SELECT).eq("id", id).maybeSingle();
  if (!raw) return null;
  const po = toPo(raw as Record<string, unknown>);
  const [{ data: lines }, { data: job }, { data: parts }, { data: supplier }, charges] = await Promise.all([
    admin.from("purchase_order_lines").select(PO_LINE_SELECT).eq("po_id", id).eq("is_active", true).order("position"),
    admin.from("jobs").select(JOB_BRIEF_SELECT).eq("id", po.job_id).maybeSingle(),
    admin.from("part_items").select(PART_FULL_SELECT).eq("po_id", id).eq("is_active", true),
    po.supplier_id ? admin.from("suppliers").select("id, name, trn, phone, email, address, payment_terms").eq("id", po.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
    poCharges(id),
  ]);
  const ids = [po.created_by, po.approved_by, po.ordered_by, po.supplier_invoice_by, po.deposit_override_by, po.sent_by].filter((x): x is string => !!x);
  const { data: people } = ids.length ? await admin.from("staff").select("id, display_name").in("id", ids) : { data: [] as { id: string; display_name: string }[] };
  return {
    po,
    lines: ((lines ?? []) as Record<string, unknown>[]).map(toPoLine),
    job: (job as unknown as JobBrief) ?? null,
    names: new Map((people ?? []).map((p) => [p.id, p.display_name])),
    parts: ((parts ?? []) as unknown as Record<string, unknown>[]).map(toPartFull),
    supplier: (supplier as SupplierRow | null) ?? null,
    charges,
  };
}

/** A short code for the QR label on a part: ten letters and digits. */
export function newLabelCode() {
  return "P" + randomBytes(5).toString("hex").toUpperCase().slice(0, 9);
}

/**
 * THE one live calculation of where a job's parts stand, computed from the part rows alone - no stored
 * stage flag that can go stale. The job card's NEXT STEP, the Planning card, the delay note, Remind,
 * the parts desk dots, the dashboard cards, the technician screen and the parts page all read this.
 */
export type PartsLive = {
  hasParts: boolean;
  /** Needed, not here, and not on any LPO yet. */
  toOrder: number;
  /** Needed parts not yet received at the desk. */
  missing: number;
  /** Missing parts whose due date has passed: the only time a delay note shows. */
  late: number;
  /** The latest due date among the missing parts. */
  readyDate: string | null;
  /** Missing parts with no due date at all (still to plan). */
  missingNoDate: number;
  needed: number;
  receivedCount: number;
  /** Parts the technician confirmed with his PIN - the only thing Handover counts. */
  handed: number;
  allReceived: boolean;
  allHanded: boolean;
  fromStockOnly: boolean;
  /** The job's main LPO is waiting for the one-tap approval. */
  pendingLpo: boolean;
  /** Parts whose supplier LPO is APPROVED but not yet ordered: the red ORDER NOW state. */
  orderNow: number;
};

const dubaiToday = () => new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);

/** The pure rule: the live parts picture from the rows and today's date. */
export function partsLiveOf(parts: PartFull[], today: string, pendingLpo = false, poStatus?: Map<string, string>): PartsLive {
  const approved = parts.filter((p) => p.is_active !== false && (p.order_status !== "none" || p.issue_status !== "none"));
  const needed = approved.filter((p) => p.return_status !== "returned" && !(p.not_needed_at && p.disposition !== "fit_approved") && p.exchange_status !== "needed" && p.exchange_status !== "ordered");
  const here = (p: PartFull) => p.availability === "in_stock" || p.order_status === "received" || p.received_qty + 0.005 >= (Number(p.confirmed_quantity ?? p.quantity) || 1);
  const missingRows = needed.filter((p) => !here(p));
  const dueOf = (p: PartFull) => (p.expected_date ?? p.delivery_date ?? null)?.slice(0, 10) ?? null;
  const lateRows = missingRows.filter((p) => { const d = dueOf(p); return !!d && d < today; });
  const dues = missingRows.map(dueOf).filter((d): d is string => !!d);
  const handed = needed.filter((p) => p.issue_status === "confirmed").length;
  return {
    hasParts: needed.length > 0,
    toOrder: missingRows.filter((p) => !p.po_id && !["ordered", "partly_received"].includes(p.order_status ?? "")).length,
    orderNow: missingRows.filter((p) => !!p.po_id && poStatus?.get(p.po_id) === "approved").length,
    missing: missingRows.length,
    late: lateRows.length,
    readyDate: dues.length ? dues.sort().at(-1)! : null,
    missingNoDate: missingRows.length - dues.length,
    needed: needed.length,
    receivedCount: needed.length - missingRows.length,
    handed,
    allReceived: needed.length > 0 && missingRows.length === 0,
    allHanded: needed.length > 0 && handed === needed.length,
    fromStockOnly: needed.length > 0 && needed.every((p) => p.availability === "in_stock"),
    pendingLpo,
  };
}

/** Parts are sorted when nothing is left to order or approve and nothing missing is late or undated. */
export const partsPlanned = (live: PartsLive) => !live.pendingLpo && live.toOrder === 0 && live.late === 0 && live.missingNoDate === 0;

/** Whose move the Planning card waits on, live: Parts until the parts are sorted, then the manager, then the advisor. */
export function planningOnOf(job: { plan_released_at: string | null; plan_date_confirmed_at: string | null }, live: PartsLive): "parts" | "workshop" | "advisor" | null {
  if (!partsPlanned(live)) return "parts";
  if (!job.plan_released_at) return "workshop";
  if (!job.plan_date_confirmed_at) return "advisor";
  return null;
}

/** The live picture for many jobs in two queries (the dashboard, the waiting list). */
export async function loadPartsLiveMap(jobIds: string[]): Promise<Map<string, PartsLive>> {
  const out = new Map<string, PartsLive>();
  if (!jobIds.length) return out;
  const admin = createAdminClient();
  const [{ data: partRows }, { data: pendingMains }, { data: poRows }] = await Promise.all([
    admin.from("part_items").select(PART_FULL_SELECT).in("job_id", jobIds).eq("is_active", true),
    admin.from("purchase_orders").select("job_id").in("job_id", jobIds).eq("kind", "main").eq("status", "pending_approval"),
    admin.from("purchase_orders").select("id, status").in("job_id", jobIds).eq("is_active", true),
  ]);
  const pending = new Set((pendingMains ?? []).map((r) => r.job_id as string));
  const poStatus = new Map(((poRows ?? []) as { id: string; status: string }[]).map((r) => [r.id, r.status]));
  const byJob = new Map<string, PartFull[]>();
  for (const r of (partRows ?? []) as unknown as Record<string, unknown>[]) {
    const p = toPartFull(r);
    const list = byJob.get(p.job_id) ?? [];
    list.push(p);
    byJob.set(p.job_id, list);
  }
  const today = dubaiToday();
  for (const id of jobIds) out.set(id, partsLiveOf(byJob.get(id) ?? [], today, pending.has(id), poStatus));
  return out;
}

/** The approved parts on a job and where they stand, for the stage card, the work gate and the Parts desk. */
export async function jobPartsState(jobId: string) {
  const admin = createAdminClient();
  const [{ data }, { data: pendingMain }, { data: jobPos }] = await Promise.all([
    admin.from("part_items").select(PART_FULL_SELECT).eq("job_id", jobId).eq("is_active", true),
    admin.from("purchase_orders").select("id").eq("job_id", jobId).eq("kind", "main").eq("status", "pending_approval").limit(1),
    admin.from("purchase_orders").select("id, status").eq("job_id", jobId).eq("is_active", true),
  ]);
  const parts = ((data ?? []) as unknown as Record<string, unknown>[]).map(toPartFull);
  const approved = parts.filter((p) => p.order_status !== "none" || p.issue_status !== "none");
  const toOrder = approved.filter((p) => p.order_status === "to_order");
  const ordered = approved.filter((p) => p.order_status === "ordered" || p.order_status === "partly_received");
  const received = approved.filter((p) => p.order_status === "received");
  // A part that came back for good (returned to the supplier, to stock, wrong part being exchanged) is no longer needed on the car.
  const needed = approved.filter((p) => p.return_status !== "returned" && !(p.not_needed_at && p.disposition !== "fit_approved") && p.exchange_status !== "needed" && p.exchange_status !== "ordered");
  const issued = needed.filter((p) => p.issue_status !== "none");
  const confirmed = needed.filter((p) => p.issue_status === "confirmed");
  const today = dubaiToday();
  const live = partsLiveOf(parts, today, (pendingMain ?? []).length > 0, new Map(((jobPos ?? []) as { id: string; status: string }[]).map((r) => [r.id, r.status])));
  const late = ordered.filter((p) => p.expected_date && p.expected_date < today);
  return { parts, approved, toOrder, ordered, received, needed, issued, confirmed, late, live, allIssued: needed.length > 0 && needed.every((p) => p.issue_status === "confirmed"), noneNeeded: needed.length === 0 };
}
