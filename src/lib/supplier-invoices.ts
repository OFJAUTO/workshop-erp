import "server-only";
import { notifyRoles } from "./notifications";
import { schemaReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";
import { groupInvoices, invoiceKeyNumber, invoiceNoticeTitle, type InvoiceRow, type SiJob, type SiLine, type SiPo, type SiSupplier } from "./supplier-invoice-rows";

/** Migration 20261202130000_supplier_invoice_query: accounts' query back to the parts desk. */
export const siQueryReady = () => schemaReady("purchase_orders", "supplier_invoice_query, supplier_invoice_query_at, supplier_invoice_query_by");

const PO_COLS = "id, number, job_id, supplier_id, supplier_name, status, kind, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_at, supplier_invoice_path, received_at, supplier_invoice_checked_at, zoho_bill_id, supplier_paid_at, supplier_paid_method, supplier_paid_reference";

export type SupplierInvoices = { rows: InvoiceRow[]; partNames: Map<string, string[]>; lines: SiLine[] };

/** Every supplier invoice (and every LPO still waiting for one), as rows of the tab. */
export async function loadSupplierInvoices(opts: { jobId?: string; poIds?: string[] } = {}): Promise<SupplierInvoices> {
  const admin = createAdminClient();
  const queryCols = (await siQueryReady()) ? ", supplier_invoice_query, supplier_invoice_query_at" : "";
  let q = admin.from("purchase_orders").select(PO_COLS + queryCols).eq("is_active", true).neq("kind", "main").in("supplier_invoice_status", ["received", "to_follow"]).order("created_at", { ascending: false }).limit(1500);
  if (opts.jobId) q = q.eq("job_id", opts.jobId);
  if (opts.poIds?.length) q = q.in("id", opts.poIds);
  const { data: poRows } = await q;
  let raw = (poRows ?? []) as unknown as Record<string, unknown>[];
  // A job's invoice can be split with other cars: their LPOs of the same invoice come along.
  if ((opts.jobId || opts.poIds?.length) && raw.length) {
    const numbers = Array.from(new Set(raw.map((r) => String(r.supplier_invoice_number ?? "")).filter(Boolean)));
    if (numbers.length) {
      const { data: more } = await admin.from("purchase_orders").select(PO_COLS + queryCols).eq("is_active", true).neq("kind", "main").in("supplier_invoice_number", numbers);
      const have = new Set(raw.map((r) => String(r.id)));
      raw = [...raw, ...((more ?? []) as unknown as Record<string, unknown>[]).filter((r) => !have.has(String(r.id)))];
    }
  }
  const pos: SiPo[] = raw.map((r) => ({
    id: String(r.id),
    number: String(r.number),
    job_id: (r.job_id as string | null) ?? null,
    supplier_id: (r.supplier_id as string | null) ?? null,
    supplier_name: String(r.supplier_name ?? ""),
    status: String(r.status),
    total_cost_aed: Number(r.total_cost_aed) || 0,
    supplier_invoice_status: String(r.supplier_invoice_status),
    supplier_invoice_number: (r.supplier_invoice_number as string | null) ?? null,
    supplier_invoice_date: (r.supplier_invoice_date as string | null) ?? null,
    supplier_invoice_amount: r.supplier_invoice_amount === null || r.supplier_invoice_amount === undefined ? null : Number(r.supplier_invoice_amount),
    supplier_invoice_at: (r.supplier_invoice_at as string | null) ?? null,
    received_at: (r.received_at as string | null) ?? null,
    checked_at: (r.supplier_invoice_checked_at as string | null) ?? null,
    zoho_bill_id: (r.zoho_bill_id as string | null) ?? null,
    paid_at: (r.supplier_paid_at as string | null) ?? null,
    query: (r.supplier_invoice_query as string | null | undefined) ?? null,
    query_at: (r.supplier_invoice_query_at as string | null | undefined) ?? null,
  }));
  if (!pos.length) return { rows: [], partNames: new Map(), lines: [] };
  const jobIds = Array.from(new Set(pos.map((p) => p.job_id).filter((x): x is string => !!x)));
  const supIds = Array.from(new Set(pos.map((p) => p.supplier_id).filter((x): x is string => !!x)));
  const [{ data: lineRows }, { data: jobRows }, { data: supRows }] = await Promise.all([
    admin.from("purchase_order_lines").select("po_id, description, quantity, received_qty, unit_cost, invoice_unit_cost, invoice_check").in("po_id", pos.map((p) => p.id)).eq("is_active", true),
    jobIds.length ? admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))").in("id", jobIds) : Promise.resolve({ data: [] }),
    supIds.length ? admin.from("suppliers").select("id, name, trn, vat_registered").in("id", supIds) : Promise.resolve({ data: [] }),
  ]);
  const lines: SiLine[] = ((lineRows ?? []) as Record<string, unknown>[]).map((l) => ({ po_id: String(l.po_id), description: String(l.description ?? ""), quantity: Number(l.quantity) || 0, received_qty: Number(l.received_qty) || 0, unit_cost: Number(l.unit_cost) || 0, invoice_unit_cost: l.invoice_unit_cost === null || l.invoice_unit_cost === undefined ? null : Number(l.invoice_unit_cost), invoice_check: (l.invoice_check as string | null) ?? null }));
  type J = { id: string; job_number: string; vehicle: (Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null }) | null };
  const jobs: SiJob[] = ((jobRows ?? []) as unknown as J[]).map((j) => ({ id: j.id, job_number: j.job_number, plate: j.vehicle ? formatPlate(j.vehicle) : "", car: [j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ") }));
  const suppliers = (supRows ?? []) as SiSupplier[];
  const partNames = new Map<string, string[]>();
  for (const l of lines) partNames.set(l.po_id, [...(partNames.get(l.po_id) ?? []), l.description]);
  return { rows: groupInvoices(pos, lines, jobs, suppliers), partNames, lines };
}

/** The tab's address for the row an LPO's invoice belongs to. */
export function invoiceHref(po: { id: string; supplier_id: string | null; supplier_name: string; supplier_invoice_number: string | null; supplier_invoice_status?: string | null }): string {
  const key = po.supplier_invoice_status === "to_follow" || !invoiceKeyNumber(po.supplier_invoice_number) ? `follow:${po.id}` : `${po.supplier_id ?? po.supplier_name.trim().toLowerCase()}|${invoiceKeyNumber(po.supplier_invoice_number)}`;
  return `/supplier-invoices?open=${encodeURIComponent(key)}`;
}

/**
 * Parts marked received with the supplier invoice (or the invoice entered later): accounts are told, one notice per
 * invoice. "Supplier invoice · SPARE HUB SPARE PARTS · INV 4512 · AED 1,040.00 + VAT" with the LPO, the car and the
 * parts; one tap opens it in the Supplier invoices tab.
 */
export async function notifyInvoiceReceived(poIds: string[]): Promise<void> {
  if (!poIds.length) return;
  const { rows } = await loadSupplierInvoices({ poIds });
  for (const r of rows.filter((x) => x.status !== "waiting" && x.shares.some((s) => poIds.includes(s.poId)))) {
    const where = r.shares.map((s) => [s.poNumber, s.jobNumber, s.plate, s.car].filter(Boolean).join(" ")).join(" · ");
    await notifyRoles(["accounts"], { type: "supplier_invoice_received", title: invoiceNoticeTitle(r.supplier, r.number ?? "", r.beforeVat, r.vatRegistered), body: `${where} · ${r.parts} part${r.parts === 1 ? "" : "s"} received.${r.duplicateOf ? ` Possible duplicate of ${r.duplicateOf}.` : ""} Check it in Supplier invoices.`, jobId: r.shares[0]?.jobId ?? null, href: `/supplier-invoices?open=${encodeURIComponent(r.key)}` });
  }
}

/** The tile count (accounts' dashboard): invoices to check, waiting for the invoice, queried, or with a price that differs and is not decided. */
export async function supplierInvoicesToCheckCount(): Promise<number> {
  const { rows, lines } = await loadSupplierInvoices();
  const undecided = new Set(lines.filter((l) => l.invoice_check === "mismatch").map((l) => l.po_id));
  return rows.filter((r) => ["waiting", "new", "queried"].includes(r.status) || r.shares.some((s) => undecided.has(s.poId))).length;
}
