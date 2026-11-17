import "server-only";
import { createAdminClient } from "./supabase/admin";
import { compactInvoiceNumber, leadOf, splitInvoiceTotal } from "./invoice-cover-rules";
import { lpoInvoicesReady } from "./lpo-invoices";

/*
 * ONE SUPPLIER INVOICE FOR SEVERAL LPOs (17 November 2026, Section 2). The invoice is entered ONCE, on one LPO, with the
 * step "THIS INVOICE ALSO COVERS…" ticking that supplier's other open LPOs; or an LPO is added later to an invoice
 * already saved ("Add another LPO to this invoice"). Every covered LPO gets the same number, date and scan, and its own
 * share of the typed total (by its approved total), so its "Invoice missing" clears and each part stays on exactly one
 * invoice. The Supplier invoices list already shows them as ONE row (grouped by supplier and number); Zoho posts ONE
 * bill for all of them (zoho-sync, the oldest LPO carries it).
 */

export type CoverOption = { id: string; number: string; total: number; car: string; refs: string[]; status: string };

type PoLite = { id: string; number: string; kind: string | null; status: string; supplier_id: string | null; supplier_name: string; total_cost_aed: number | string | null; supplier_invoice_status: string | null; supplier_invoice_number: string | null; supplier_invoice_amount: number | string | null; supplier_paid_at: string | null; supplier_payment_id: string | null; zoho_bill_id: string | null; job_id: string | null; created_at: string; is_active: boolean };
const PO_LITE = "id, number, kind, status, supplier_id, supplier_name, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_amount, supplier_paid_at, supplier_payment_id, zoho_bill_id, job_id, created_at, is_active";

const sameSupplier = (a: { supplier_id: string | null; supplier_name: string }, b: { supplier_id: string | null; supplier_name: string }) =>
  (a.supplier_id && b.supplier_id ? a.supplier_id === b.supplier_id : false) || String(a.supplier_name ?? "").trim().toUpperCase() === String(b.supplier_name ?? "").trim().toUpperCase();

/** The supplier's OTHER LPOs an invoice may also cover: theirs, not cancelled, no invoice of any kind on them yet. */
export async function coverOptionsFor(poId: string): Promise<CoverOption[]> {
  const admin = createAdminClient();
  const { data: me } = await admin.from("purchase_orders").select(PO_LITE).eq("id", poId).maybeSingle();
  if (!me) return [];
  const po = me as unknown as PoLite;
  let q = admin.from("purchase_orders").select(PO_LITE).neq("id", poId).neq("status", "cancelled").eq("is_active", true).neq("supplier_invoice_status", "received").order("created_at").limit(40);
  q = po.supplier_id ? q.eq("supplier_id", po.supplier_id) : q.ilike("supplier_name", po.supplier_name);
  const { data } = await q;
  let rows = ((data ?? []) as unknown as PoLite[]).filter((p) => p.kind !== "main" && !/^our stock$/i.test(String(p.supplier_name).trim()) && ["approved", "ordered", "partly_received", "received"].includes(p.status));
  if (!rows.length) return [];
  // An LPO that already has a further invoice of its own is not offered (each part on exactly one invoice).
  if (await lpoInvoicesReady()) {
    const { data: further } = await admin.from("lpo_invoices").select("po_id").in("po_id", rows.map((r) => r.id)).eq("is_active", true);
    const taken = new Set(((further ?? []) as { po_id: string }[]).map((f) => f.po_id));
    rows = rows.filter((r) => !taken.has(r.id));
  }
  const jobIds = Array.from(new Set(rows.map((r) => r.job_id).filter((x): x is string => !!x)));
  const [{ data: jobs }, { data: receipts }] = await Promise.all([
    jobIds.length ? admin.from("jobs").select("id, job_number").in("id", jobIds) : Promise.resolve({ data: [] }),
    admin.from("part_receipts").select("po_id, invoice_number").in("po_id", rows.map((r) => r.id)).eq("is_active", true).not("invoice_number", "is", null),
  ]);
  const jobNo = new Map(((jobs ?? []) as { id: string; job_number: string }[]).map((j) => [j.id, j.job_number]));
  const refs = new Map<string, string[]>();
  for (const r of (receipts ?? []) as { po_id: string; invoice_number: string }[]) refs.set(r.po_id, Array.from(new Set([...(refs.get(r.po_id) ?? []), r.invoice_number])));
  const words: Record<string, string> = { approved: "Approved, not received yet", ordered: "Ordered", partly_received: "Partly received", received: "Received" };
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    total: Number(r.total_cost_aed) || 0,
    car: r.job_id ? jobNo.get(r.job_id) ?? "Car job" : "Stock order",
    refs: refs.get(r.id) ?? [],
    status: `${words[r.status] ?? r.status} · ${r.supplier_invoice_status === "to_follow" ? "invoice missing" : "no invoice yet"}`,
  }));
}

/** Every LPO carrying this supplier invoice (same supplier, same number typed the same way), oldest first. */
export async function invoiceGroupOf(po: { id: string; supplier_id: string | null; supplier_name: string; supplier_invoice_number: string | null }): Promise<PoLite[]> {
  const key = compactInvoiceNumber(po.supplier_invoice_number);
  if (!key) return [];
  const admin = createAdminClient();
  let q = admin.from("purchase_orders").select(PO_LITE).eq("supplier_invoice_status", "received").eq("is_active", true).neq("status", "cancelled").not("supplier_invoice_number", "is", null);
  q = po.supplier_id ? q.eq("supplier_id", po.supplier_id) : q.ilike("supplier_name", po.supplier_name);
  const { data } = await q;
  return ((data ?? []) as unknown as PoLite[]).filter((p) => p.kind !== "main" && compactInvoiceNumber(p.supplier_invoice_number) === key).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** The LPO whose Zoho bill carries the whole invoice (the oldest of the group). */
export const billLeadOf = (group: PoLite[]) => leadOf(group);

/**
 * Checks the ticked LPOs an invoice also covers: the same supplier, not cancelled, no invoice yet. Returns them, or the
 * refusal in plain words.
 */
export async function checkCovers(anchor: { id: string; supplier_id: string | null; supplier_name: string }, coverIds: string[]): Promise<{ covers: PoLite[] } | { error: string }> {
  const ids = Array.from(new Set(coverIds.filter((id) => id && id !== anchor.id)));
  if (!ids.length) return { covers: [] };
  const allowed = new Set((await coverOptionsFor(anchor.id)).map((o) => o.id));
  const { data } = await createAdminClient().from("purchase_orders").select(PO_LITE).in("id", ids);
  const rows = (data ?? []) as unknown as PoLite[];
  for (const id of ids) {
    const r = rows.find((x) => x.id === id);
    if (!r) return { error: "One of the ticked LPOs is not there any more. Reload the page." };
    if (!sameSupplier(r, anchor)) return { error: `${r.number} is from another supplier: one invoice covers one supplier's LPOs only.` };
    if (!allowed.has(id)) return { error: `${r.number} already has an invoice (or was cancelled): untick it.` };
  }
  return { covers: rows };
}

/** The shares of a total across the anchor LPO and the LPOs it covers (by their approved totals, to the fils). */
export function sharesFor(total: number, anchor: { id: string; total_cost_aed: number | string | null }, covers: { id: string; total_cost_aed: number | string | null }[]): Map<string, number> {
  return splitInvoiceTotal(total, [anchor, ...covers].map((p) => ({ id: p.id, total: Number(p.total_cost_aed) || 0 })));
}

/**
 * "Add another LPO to this invoice": the LPO joins an invoice already saved. The paper's before-VAT total (as typed now)
 * is shared again across every LPO it covers; they go back to unchecked so accounts look again. Refused when any of them
 * is already paid (a share would move under a payment) - void the payment first.
 */
export async function addLpoToInvoice(anchorPoId: string, otherPoId: string, typedTotal: number, by: { id: string; display_name: string }): Promise<{ error?: string; words?: string; poIds?: string[]; postedBill?: boolean }> {
  const admin = createAdminClient();
  const { data: a } = await admin.from("purchase_orders").select(PO_LITE + ", supplier_invoice_date, supplier_invoice_path").eq("id", anchorPoId).maybeSingle();
  const anchor = a as unknown as (PoLite & { supplier_invoice_date: string | null; supplier_invoice_path: string | null }) | null;
  if (!anchor || anchor.supplier_invoice_status !== "received" || !anchor.supplier_invoice_number) return { error: "This LPO has no supplier invoice saved yet: enter the invoice first." };
  if (!(typedTotal > 0)) return { error: "Type the invoice's total before VAT, as printed on the paper." };
  const group = await invoiceGroupOf(anchor);
  const chk = await checkCovers(anchor, [otherPoId]);
  if ("error" in chk) return { error: chk.error };
  const other = chk.covers[0];
  if (!other) return { error: "Pick the LPO this invoice also covers." };
  const paid = [...group, other].filter((p) => p.supplier_paid_at || p.supplier_payment_id);
  if (paid.length) return { error: `${paid.map((p) => p.number).join(", ")} ${paid.length === 1 ? "is" : "are"} already paid: the invoice's shares cannot move under a payment. Void the payment first, then add the LPO.` };
  const all = [...group, other];
  const shares = splitInvoiceTotal(typedTotal, all.map((p) => ({ id: p.id, total: Number(p.total_cost_aed) || 0 })));
  const now = new Date().toISOString();
  const { error } = await admin
    .from("purchase_orders")
    .update({ supplier_invoice_status: "received", supplier_invoice_number: anchor.supplier_invoice_number, supplier_invoice_date: anchor.supplier_invoice_date, supplier_invoice_path: anchor.supplier_invoice_path, supplier_invoice_amount: shares.get(other.id) ?? null, supplier_invoice_at: now, supplier_invoice_by: by.id, supplier_invoice_checked_at: null, updated_by: by.id })
    .eq("id", other.id)
    .neq("supplier_invoice_status", "received");
  if (error) return { error: error.message };
  for (const p of group) {
    await admin.from("purchase_orders").update({ supplier_invoice_amount: shares.get(p.id) ?? null, supplier_invoice_checked_at: null, updated_by: by.id }).eq("id", p.id);
  }
  const numbers = all.map((p) => p.number).join(" + ");
  const words = `${other.number} added to invoice ${anchor.supplier_invoice_number} by ${by.display_name}: the invoice now covers ${numbers} (AED ${typedTotal.toFixed(2)} before VAT, shared by their totals).`;
  for (const jobId of Array.from(new Set(all.map((p) => p.job_id).filter((x): x is string => !!x)))) {
    await admin.from("job_events").insert({ job_id: jobId, event_type: "supplier_invoice", note: words, created_by: by.id });
  }
  return { words, poIds: all.map((p) => p.id), postedBill: group.some((p) => !!p.zoho_bill_id) };
}
