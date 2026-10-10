import "server-only";
import { randomBytes } from "node:crypto";
import { PART_SELECT, toPart } from "./quote-data";
import type { PartItem } from "./quotes";
import { createAdminClient } from "./supabase/admin";

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
  supplier_invoice_number: string | null;
  supplier_invoice_path: string | null;
  supplier_invoice_amount: number | null;
  supplier_invoice_at: string | null;
  supplier_invoice_by: string | null;
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
  unit_cost: number;
  expected_date: string | null;
  received_qty: number;
  received_at: string | null;
  flag: "wrong" | "damaged" | null;
  flag_note: string | null;
  invoice_unit_cost: number | null;
};

export const PO_SELECT = "id, number, job_id, supplier_id, supplier_name, status, notes, total_cost_aed, approved_by, approved_at, deposit_override_by, deposit_override_reason, ordered_at, ordered_by, received_at, supplier_invoice_status, supplier_invoice_number, supplier_invoice_path, supplier_invoice_amount, supplier_invoice_at, supplier_invoice_by, created_at, created_by";
export const PO_LINE_SELECT = "id, po_id, part_item_id, position, description, part_number, quantity, unit_cost, expected_date, received_qty, received_at, flag, flag_note, invoice_unit_cost";
/** The part columns the Parts desk needs after approval, on top of the quotation ones. */
export const PART_FULL_SELECT = PART_SELECT + ", stickers_printed, po_id, po_line_id, expected_date, received_qty, issued_qty, issue_status, issued_at, issued_by, issue_confirmed_at, issue_confirmed_by, returned_qty, return_status, return_note, label_code, final_cost_aed";

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
export const toPoLine = (r: Record<string, unknown>) => num(r as unknown as PoLineRow, ["position", "quantity", "unit_cost", "received_qty", "invoice_unit_cost"]);
export const toPartFull = (r: Record<string, unknown>) => num({ ...toPart(r), ...(r as object) } as unknown as PartFull, ["quantity", "cost_aed", "confirmed_quantity", "received_qty", "issued_qty", "returned_qty", "final_cost_aed"]);

export type JobBrief = { id: string; job_number: string; status: string; is_open: boolean; customer_id: string; gated_in_by: string; assigned_to: string | null; department: string | null; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; model_year?: number | null; make: { name: string } | null; model: { name: string } | null } | null };
export const JOB_BRIEF_SELECT = "id, job_number, status, is_open, customer_id, gated_in_by, assigned_to, department, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name))";

export type SupplierRow = { id: string; name: string; trn: string | null; phone: string | null; email: string | null; address: string | null; payment_terms: string | null };
export type PoBundle = { po: PurchaseOrderRow; lines: PoLineRow[]; job: JobBrief | null; names: Map<string, string>; parts: PartFull[]; supplier: SupplierRow | null };

export async function loadPurchaseOrder(id: string): Promise<PoBundle | null> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("purchase_orders").select(PO_SELECT).eq("id", id).maybeSingle();
  if (!raw) return null;
  const po = toPo(raw as Record<string, unknown>);
  const [{ data: lines }, { data: job }, { data: parts }, { data: supplier }] = await Promise.all([
    admin.from("purchase_order_lines").select(PO_LINE_SELECT).eq("po_id", id).eq("is_active", true).order("position"),
    admin.from("jobs").select(JOB_BRIEF_SELECT).eq("id", po.job_id).maybeSingle(),
    admin.from("part_items").select(PART_FULL_SELECT).eq("po_id", id).eq("is_active", true),
    po.supplier_id ? admin.from("suppliers").select("id, name, trn, phone, email, address, payment_terms").eq("id", po.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const ids = [po.created_by, po.approved_by, po.ordered_by, po.supplier_invoice_by, po.deposit_override_by].filter((x): x is string => !!x);
  const { data: people } = ids.length ? await admin.from("staff").select("id, display_name").in("id", ids) : { data: [] as { id: string; display_name: string }[] };
  return {
    po,
    lines: ((lines ?? []) as Record<string, unknown>[]).map(toPoLine),
    job: (job as unknown as JobBrief) ?? null,
    names: new Map((people ?? []).map((p) => [p.id, p.display_name])),
    parts: ((parts ?? []) as unknown as Record<string, unknown>[]).map(toPartFull),
    supplier: (supplier as SupplierRow | null) ?? null,
  };
}

/** A short code for the QR label on a part: ten letters and digits. */
export function newLabelCode() {
  return "P" + randomBytes(5).toString("hex").toUpperCase().slice(0, 9);
}

/** The approved parts on a job and where they stand, for the stage card, the work gate and the Parts desk. */
export async function jobPartsState(jobId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("part_items").select(PART_FULL_SELECT).eq("job_id", jobId).eq("is_active", true);
  const parts = ((data ?? []) as unknown as Record<string, unknown>[]).map(toPartFull);
  const approved = parts.filter((p) => p.order_status !== "none" || p.issue_status !== "none");
  const toOrder = approved.filter((p) => p.order_status === "to_order");
  const ordered = approved.filter((p) => p.order_status === "ordered" || p.order_status === "partly_received");
  const received = approved.filter((p) => p.order_status === "received");
  const needed = approved.filter((p) => p.return_status !== "returned");
  const issued = needed.filter((p) => p.issue_status !== "none");
  const confirmed = needed.filter((p) => p.issue_status === "confirmed");
  const today = new Date().toISOString().slice(0, 10);
  const late = ordered.filter((p) => p.expected_date && p.expected_date < today);
  return { parts, approved, toOrder, ordered, received, needed, issued, confirmed, late, allIssued: needed.length > 0 && needed.every((p) => p.issue_status === "confirmed"), noneNeeded: needed.length === 0 };
}
