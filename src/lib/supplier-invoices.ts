import "server-only";
import { logAppError } from "./app-errors";
import { formatDateTime } from "./format";
import { notifyRoles } from "./notifications";
import { pageAll, pageAllIn } from "./page-all";
import { schemaReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";
import { MATCH_WORDS, STATUS_WORDS, groupInvoices, invoiceKeyNumber, invoiceNoticeTitle, type InvoiceRow, type SiJob, type SiLine, type SiPo, type SiSupplier } from "./supplier-invoice-rows";
import type { XlsxSheet } from "./xlsx";

/** Migration 20261202130000_supplier_invoice_query: accounts' query back to the parts desk. */
export const siQueryReady = () => schemaReady("purchase_orders", "supplier_invoice_query, supplier_invoice_query_at, supplier_invoice_query_by");
/** Supplier invoice edit (5 November 2026): the VAT override and the edit history. Migration 20261205150000_supplier_invoice_edit. */
export const invoiceEditReady = () => schemaReady("supplier_invoice_edits", "id, po_id, remark, changes");
export const invoiceVatReady = () => schemaReady("purchase_orders", "supplier_invoice_vat_aed");

const PO_COLS = "id, number, job_id, supplier_id, supplier_name, status, kind, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_at, supplier_invoice_path, received_at, supplier_invoice_checked_at, zoho_bill_id, supplier_paid_at, supplier_paid_method, supplier_paid_reference, supplier_paid_proof_path, supplier_paid_by";

export type SupplierInvoices = { rows: InvoiceRow[]; partNames: Map<string, string[]>; lines: SiLine[] };

const none = (): SupplierInvoices => ({ rows: [], partNames: new Map(), lines: [] });

/**
 * Every supplier invoice (and every LPO still waiting for one), as rows of the tab. Every list is read page by page.
 * A read that fails: with `strict` it throws (Parts accounts, the Supplier invoices screen, its export, the actions and
 * the dashboard count, which each show it in words); without it (the job card, accounts' Waiting on you) it is logged
 * and reads as no invoices, so a passing database hiccup never takes a whole page down.
 */
export async function loadSupplierInvoices(opts: { jobId?: string; poIds?: string[]; strict?: boolean } = {}): Promise<SupplierInvoices> {
  if (opts.strict) return readSupplierInvoices(opts);
  try {
    return await readSupplierInvoices(opts);
  } catch (e) {
    await logAppError("supplier-invoices.load", e, { jobId: opts.jobId ?? null });
    return none();
  }
}

async function readSupplierInvoices(opts: { jobId?: string; poIds?: string[] }): Promise<SupplierInvoices> {
  const admin = createAdminClient();
  const queryCols = ((await siQueryReady()) ? ", supplier_invoice_query, supplier_invoice_query_at" : "") + ((await invoiceVatReady()) ? ", supplier_invoice_vat_aed" : "");
  // Every row, page by page (PostgREST answers 1,000 rows at most; the old .limit(1500) stopped silently at 1,000).
  const page = (from: number, to: number) => {
    let q = admin.from("purchase_orders").select(PO_COLS + queryCols).eq("is_active", true).neq("kind", "main").in("supplier_invoice_status", ["received", "to_follow"]).order("created_at", { ascending: false }).order("id").range(from, to);
    if (opts.jobId) q = q.eq("job_id", opts.jobId);
    if (opts.poIds?.length) q = q.in("id", opts.poIds);
    return q as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
  };
  let raw = await pageAll<Record<string, unknown>>(page);
  // A job's invoice can be split with other cars: their LPOs of the same invoice come along.
  if ((opts.jobId || opts.poIds?.length) && raw.length) {
    const numbers = Array.from(new Set(raw.map((r) => String(r.supplier_invoice_number ?? "")).filter(Boolean)));
    if (numbers.length) {
      const { data: more, error } = await admin.from("purchase_orders").select(PO_COLS + queryCols).eq("is_active", true).neq("kind", "main").in("supplier_invoice_number", numbers);
      if (error) throw new Error(error.message);
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
    supplier_invoice_vat_aed: r.supplier_invoice_vat_aed === null || r.supplier_invoice_vat_aed === undefined ? null : Number(r.supplier_invoice_vat_aed),
    supplier_invoice_at: (r.supplier_invoice_at as string | null) ?? null,
    received_at: (r.received_at as string | null) ?? null,
    checked_at: (r.supplier_invoice_checked_at as string | null) ?? null,
    zoho_bill_id: (r.zoho_bill_id as string | null) ?? null,
    paid_at: (r.supplier_paid_at as string | null) ?? null,
    paid_method: (r.supplier_paid_method as string | null) ?? null,
    paid_reference: (r.supplier_paid_reference as string | null) ?? null,
    proof_path: (r.supplier_paid_proof_path as string | null) ?? null,
    paid_by: (r.supplier_paid_by as string | null) ?? null,
    query: (r.supplier_invoice_query as string | null | undefined) ?? null,
    query_at: (r.supplier_invoice_query_at as string | null | undefined) ?? null,
  }));
  if (!pos.length) return none();
  const jobIds = Array.from(new Set(pos.map((p) => p.job_id).filter((x): x is string => !!x)));
  const supIds = Array.from(new Set(pos.map((p) => p.supplier_id).filter((x): x is string => !!x)));
  // Long id lists in short pieces (an in(...) list travels in the address), each read page by page.
  const [lineRows, jobRows, supRows] = await Promise.all([
    pageAllIn<Record<string, unknown>>(pos.map((p) => p.id), (ids, a, b) => admin.from("purchase_order_lines").select("id, po_id, description, quantity, received_qty, unit_cost, invoice_unit_cost, invoice_check").in("po_id", ids).eq("is_active", true).order("id").range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>),
    pageAllIn<Record<string, unknown>>(jobIds, (ids, a, b) => admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))").in("id", ids).order("id").range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>),
    pageAllIn<Record<string, unknown>>(supIds, (ids, a, b) => admin.from("suppliers").select("id, name, trn, vat_registered").in("id", ids).order("id").range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>),
  ]);
  const lines: SiLine[] = lineRows.map((l) => ({ po_id: String(l.po_id), description: String(l.description ?? ""), quantity: Number(l.quantity) || 0, received_qty: Number(l.received_qty) || 0, unit_cost: Number(l.unit_cost) || 0, invoice_unit_cost: l.invoice_unit_cost === null || l.invoice_unit_cost === undefined ? null : Number(l.invoice_unit_cost), invoice_check: (l.invoice_check as string | null) ?? null }));
  type J = { id: string; job_number: string; vehicle: (Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null }) | null };
  const jobs: SiJob[] = (jobRows as unknown as J[]).map((j) => ({ id: j.id, job_number: j.job_number, plate: j.vehicle ? formatPlate(j.vehicle) : "", car: [j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ") }));
  const suppliers = supRows as unknown as SiSupplier[];
  const partNames = new Map<string, string[]>();
  for (const l of lines) partNames.set(l.po_id, [...(partNames.get(l.po_id) ?? []), l.description]);
  return { rows: groupInvoices(pos, lines, jobs, suppliers), partNames, lines };
}

const sum2 = (xs: number[]) => Math.round(xs.reduce((a, x) => a + x, 0) * 100) / 100;

/**
 * THE Excel sheet of supplier invoices (3 November 2026): one row per invoice. Used by the Supplier invoices export and
 * by Parts accounts' export (its Supplier invoices sheet), so both files read the same.
 */
export function supplierInvoiceSheet(rows: InvoiceRow[]): XlsxSheet {
  return {
    name: "Supplier invoices",
    columns: [
      { header: "Supplier", key: "supplier", width: 28 },
      { header: "Invoice no.", key: "number", width: 16 },
      { header: "Date", key: "date", width: 12 },
      { header: "TRN", key: "trn", width: 18 },
      { header: "Before VAT (AED)", key: "before", width: 15, numFmt: "#,##0.00" },
      { header: "VAT (AED)", key: "vat", width: 12, numFmt: "#,##0.00" },
      { header: "Total (AED)", key: "total", width: 14, numFmt: "#,##0.00" },
      { header: "LPO(s)", key: "lpos", width: 22 },
      { header: "Car(s) / job(s)", key: "cars", width: 34 },
      { header: "Parts", key: "parts", width: 8 },
      { header: "Match", key: "match", width: 24 },
      { header: "Status", key: "status", width: 20 },
    ],
    rows: rows.map((r) => ({
      supplier: r.supplier,
      number: r.number ?? "Invoice missing",
      date: r.date ? new Date(`${r.date}T12:00:00Z`) : "",
      trn: r.trn ?? "",
      before: r.beforeVat,
      vat: r.vat,
      total: r.total,
      lpos: r.shares.map((s) => s.poNumber).join(", "),
      cars: r.shares.map((s) => [s.jobNumber, s.plate, s.car].filter(Boolean).join(" ")).filter(Boolean).join("; ") || "Stock order",
      parts: r.parts,
      match: [...r.match.map((m) => MATCH_WORDS[m]), r.duplicateOf ? `Possible duplicate of ${r.duplicateOf}` : ""].filter(Boolean).join(", "),
      status: STATUS_WORDS[r.status],
    })),
    totals: { supplier: `${rows.length} invoices`, before: sum2(rows.map((r) => r.beforeVat)), vat: sum2(rows.map((r) => r.vat)), total: sum2(rows.map((r) => r.total)) },
  };
}

/** The tab's address for the row an LPO's invoice belongs to. */
export function invoiceHref(po: { id: string; supplier_id: string | null; supplier_name: string; supplier_invoice_number: string | null; supplier_invoice_status?: string | null }): string {
  const key = po.supplier_invoice_status === "to_follow" || !invoiceKeyNumber(po.supplier_invoice_number) ? `follow:${po.id}` : `${po.supplier_id ?? po.supplier_name.trim().toLowerCase()}|${invoiceKeyNumber(po.supplier_invoice_number)}`;
  return `/supplier-invoices?open=${encodeURIComponent(key)}`;
}

/**
 * Parts marked received with the supplier invoice (or the invoice entered later): accounts are told, one notice per
 * invoice. "Supplier invoice · SPARE HUB SPARE PARTS · INV 4512 · AED 1,040.00 + VAT" with the LPO, the car and the
 * parts; one tap opens it in the Supplier invoices tab. Called AFTER the parts are received and the invoice is saved:
 * a failure here is logged and never turns that finished save into an error (staff would press again).
 */
export async function notifyInvoiceReceived(poIds: string[]): Promise<void> {
  if (!poIds.length) return;
  try {
    const { rows } = await loadSupplierInvoices({ poIds, strict: true });
    for (const r of rows.filter((x) => x.status !== "waiting" && x.shares.some((s) => poIds.includes(s.poId)))) {
      const where = r.shares.map((s) => [s.poNumber, s.jobNumber, s.plate, s.car].filter(Boolean).join(" ")).join(" · ");
      await notifyRoles(["accounts"], { type: "supplier_invoice_received", title: invoiceNoticeTitle(r.supplier, r.number ?? "", r.beforeVat, r.vatRegistered), body: `${where} · ${r.parts} part${r.parts === 1 ? "" : "s"} received.${r.duplicateOf ? ` Possible duplicate of ${r.duplicateOf}.` : ""} Check it in Supplier invoices.`, jobId: r.shares[0]?.jobId ?? null, href: `/supplier-invoices?open=${encodeURIComponent(r.key)}` });
    }
  } catch (e) {
    await logAppError("supplier-invoices.notify", e, { detail: { poIds } });
  }
}

export type InvoiceEdit = { id: string; poId: string; at: string; by: string; remark: string; changes: { field: string; old: string; new: string }[]; paidDiff: number | null };

/**
 * The edit history of these LPOs' invoices, newest first, with who and when preformatted (supplier invoice edit,
 * 5 November 2026). Shown on the LPO page's Record box and under the opened invoice in Supplier invoices; empty
 * until the owner's "apply" creates the table.
 */
export async function loadInvoiceEdits(poIds: string[]): Promise<InvoiceEdit[]> {
  if (!poIds.length || !(await invoiceEditReady())) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("supplier_invoice_edits").select("id, po_id, remark, changes, paid_difference_aed, created_at, created_by").in("po_id", poIds).eq("is_active", true).order("created_at", { ascending: false }).limit(50);
  const rows = (data ?? []) as { id: string; po_id: string; remark: string; changes: unknown; paid_difference_aed: number | null; created_at: string; created_by: string | null }[];
  const byIds = Array.from(new Set(rows.map((r) => r.created_by).filter((x): x is string => !!x)));
  const { data: staff } = byIds.length ? await admin.from("staff").select("id, display_name").in("id", byIds) : { data: [] };
  const names = new Map(((staff ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  return rows.map((r) => ({
    id: r.id,
    poId: r.po_id,
    at: formatDateTime(r.created_at),
    by: r.created_by ? (names.get(r.created_by) ?? "") : "",
    remark: r.remark,
    changes: Array.isArray(r.changes) ? (r.changes as { field: string; old: string; new: string }[]) : [],
    paidDiff: r.paid_difference_aed === null || r.paid_difference_aed === undefined ? null : Number(r.paid_difference_aed),
  }));
}

/** The tile count (accounts' dashboard): invoices to check, waiting for the invoice, queried, or with a price that differs and is not decided. Strict: its caller falls back to its own count. */
export async function supplierInvoicesToCheckCount(): Promise<number> {
  const { rows, lines } = await loadSupplierInvoices({ strict: true });
  const undecided = new Set(lines.filter((l) => l.invoice_check === "mismatch").map((l) => l.po_id));
  return rows.filter((r) => ["waiting", "new", "queried"].includes(r.status) || r.shares.some((s) => undecided.has(s.poId))).length;
}
