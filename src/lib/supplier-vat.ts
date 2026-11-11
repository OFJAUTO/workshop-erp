import { createAdminClient } from "@/lib/supabase/admin";
import { loadLpoInvoices, type LpoInvoiceRow } from "./lpo-invoices";
import { supplierChargesVat } from "./supplier-rules";
import { addSupplierMoney, lpoMoney, originalNetOf, supplierMoney, type SupplierMoney } from "./supplier-money";
import { pageAllIn } from "./page-all";
import { invoiceVatReady } from "./supplier-invoices";

export type LpoAmount = SupplierMoney & { cancelled: boolean; fromInvoice: boolean };
type PoIn = { id: string; kind?: string | null; status: string; supplier_id: string | null; supplier_name: string; total_cost_aed: number; supplier_invoice_status?: string | null; supplier_invoice_number?: string | null; supplier_invoice_amount?: number | null };
type LineIn = { po_id: string; part_item_id: string | null; quantity: number | string; unit_cost: number | string; is_active: boolean };

/**
 * THE amount of each LPO in a list (5 November 2026, Mathew), for the LPO list and the approvers' Waiting on you: a
 * main LPO waiting for approval adds its suppliers, each with its own VAT (THE rule, by the supplier on each part and on
 * each supplier charge) - exactly as the approval screen does; a supplier or stock LPO by its supplier (an entered
 * invoice's own figures); a cancelled one at its ORIGINAL amount (every line it had), never counted.
 */
export async function lpoAmounts(pos: PoIn[], opts: { withFurther?: boolean } = {}): Promise<Map<string, LpoAmount>> {
  const out = new Map<string, LpoAmount>();
  if (!pos.length) return out;
  const admin = createAdminClient();
  const vatOf = await supplierVatLookup();
  const needLines = pos.filter((p) => p.kind === "main" || p.status === "cancelled").map((p) => p.id);
  const lines = needLines.length ? await pageAllIn<LineIn>(needLines, (chunk, a, b) => admin.from("purchase_order_lines").select("id, po_id, part_item_id, quantity, unit_cost, is_active").in("po_id", chunk).order("id").range(a, b) as unknown as PromiseLike<{ data: LineIn[] | null; error: { message: string } | null }>) : [];
  const partIds = Array.from(new Set(lines.map((l) => l.part_item_id).filter((x): x is string => !!x)));
  const partSupplier = new Map((partIds.length ? await pageAllIn<{ id: string; supplier: string | null }>(partIds, (chunk, a, b) => admin.from("part_items").select("id, supplier").in("id", chunk).order("id").range(a, b) as unknown as PromiseLike<{ data: { id: string; supplier: string | null }[] | null; error: { message: string } | null }>) : []).map((p) => [p.id, (p.supplier ?? "").trim()]));
  const mainIds = pos.filter((p) => p.kind === "main").map((p) => p.id);
  const charges = mainIds.length ? await pageAllIn<{ id: string; po_id: string; supplier_name: string; amount_aed: number | string }>(mainIds, (chunk, a, b) => admin.from("supplier_charges").select("id, po_id, supplier_name, amount_aed").in("po_id", chunk).eq("is_active", true).order("id").range(a, b) as unknown as PromiseLike<{ data: { id: string; po_id: string; supplier_name: string; amount_aed: number | string }[] | null; error: { message: string } | null }>) : [];
  const entered = pos.filter((p) => p.supplier_invoice_status === "received").map((p) => p.id);
  const typed = new Map(entered.length && (await invoiceVatReady()) ? ((await admin.from("purchase_orders").select("id, supplier_invoice_vat_aed").in("id", entered)).data ?? []).map((r) => [String(r.id), r.supplier_invoice_vat_aed === null ? null : Number(r.supplier_invoice_vat_aed)]) : []);
  const further = opts.withFurther === false ? new Map<string, LpoInvoiceRow[]>() : await loadLpoInvoices(pos.filter((p) => p.kind !== "main" && p.supplier_invoice_status === "received").map((p) => p.id)).catch(() => new Map<string, LpoInvoiceRow[]>());
  for (const po of pos) {
    const mine = lines.filter((l) => l.po_id === po.id);
    if (po.kind === "main") {
      // Per supplier, as the approval screen: the part's supplier on each line, plus each supplier charge.
      const counted = po.status === "cancelled" ? mine : mine.filter((l) => l.is_active);
      const groups = new Map<string, number>();
      for (const l of counted) {
        const name = partSupplier.get(l.part_item_id ?? "") || po.supplier_name;
        groups.set(name, (groups.get(name) ?? 0) + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0));
      }
      for (const c of charges.filter((c) => c.po_id === po.id)) groups.set(c.supplier_name, (groups.get(c.supplier_name) ?? 0) + (Number(c.amount_aed) || 0));
      const money = groups.size ? addSupplierMoney(Array.from(groups.entries()).map(([name, net]) => supplierMoney(net, { chargesVat: vatOf(null, name) }))) : supplierMoney(po.total_cost_aed, { chargesVat: vatOf(po.supplier_id, po.supplier_name) });
      out.set(po.id, { ...money, cancelled: po.status === "cancelled", fromInvoice: false });
      continue;
    }
    const original = po.status === "cancelled" ? originalNetOf(mine) : null;
    const base = lpoMoney({ ...po, supplier_invoice_vat_aed: typed.get(po.id) ?? null }, vatOf(po.supplier_id, po.supplier_name), original);
    // 10 November 2026 (Section 3): an LPO with several supplier invoices is worth all of them.
    const more = further.get(po.id) ?? [];
    out.set(po.id, more.length && po.supplier_invoice_status === "received" ? { ...base, ...addSupplierMoney([base, ...more.map((e) => supplierMoney(e.amount_aed, { chargesVat: vatOf(po.supplier_id, po.supplier_name), typedVat: e.vat_aed }))]) } : base);
  }
  return out;
}

type SupRow = { id: string; name: string; trn: string | null; vat_registered: boolean | null };

/**
 * Who charges VAT (5 November 2026, Mathew), for the pages that draw supplier amounts: THE rule (supplierChargesVat:
 * VAT registered with a 15-digit TRN, never Our stock) looked up by supplier id, else by name. A name that is not on
 * the suppliers list charges none (we hold no TRN for it). Server only; the rule itself is pure.
 */
/** The names of the suppliers that charge VAT by THE rule (for a client screen that groups by supplier name). */
export async function vatChargingSupplierNames(): Promise<string[]> {
  const { data } = await createAdminClient().from("suppliers").select("id, name, trn, vat_registered");
  return ((data ?? []) as SupRow[]).filter((r) => supplierChargesVat(r)).map((r) => r.name);
}

export async function supplierVatLookup(): Promise<(id: string | null | undefined, name: string | null | undefined) => boolean> {
  const { data } = await createAdminClient().from("suppliers").select("id, name, trn, vat_registered");
  const rows = (data ?? []) as SupRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byName = new Map(rows.map((r) => [r.name.trim().toLowerCase(), r]));
  return (id, name) => {
    const row = (id ? byId.get(id) : null) ?? byName.get(String(name ?? "").trim().toLowerCase()) ?? null;
    return supplierChargesVat(row ? { ...row, name: name || row.name } : { name: String(name ?? ""), trn: null, vat_registered: null });
  };
}
