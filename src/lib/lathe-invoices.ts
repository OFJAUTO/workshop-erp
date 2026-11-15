import "server-only";
import { createAdminClient } from "./supabase/admin";
import { schemaReady } from "./schema-ready";
import { supplierChargesVat } from "./supplier-rules";
import type { InvoiceRow, InvoiceStatus } from "./supplier-invoice-rows";

/*
 * LATHE INVOICES GO THROUGH SUPPLIER INVOICES FIRST (15 November 2026, Section 4). A lathe bill is a supplier invoice row
 * (key "lathe:<bill id>", tagged LATHE) in THE Supplier invoices list: the same card, scan, checks, filters and Excel
 * export. Accounts check it there (or query it); only a checked bill can be paid on Supplier payments. The check and
 * query columns arrive with 20261217100000_lathe_bill_check.sql; until then a lathe bill is listed and pays as before.
 */

export const latheCheckReady = () => schemaReady("lathe_bills", "checked_at, query");
export const LATHE_KEY = "lathe:";
export const isLatheRowKey = (key: string) => key.startsWith(LATHE_KEY);
export const latheBillIdOf = (key: string) => key.slice(LATHE_KEY.length);

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type Bill = { id: string; supplier_id: string | null; supplier_name: string; bill_number: string; bill_date: string; before_vat_aed: number | string; vat_aed: number | string; total_aed: number | string; paid_at: string | null; paid_method: string | null; paid_reference: string | null; zoho_bill_id: string | null; created_at: string; checked_at?: string | null; query?: string | null };

/** Every live lathe bill as a Supplier invoices row. */
export async function latheInvoiceRows(): Promise<InvoiceRow[]> {
  if (!(await schemaReady("lathe_bills", "id, voided_at"))) return [];
  const admin = createAdminClient();
  const checkOn = await latheCheckReady();
  const { data, error } = await admin.from("lathe_bills").select(`id, supplier_id, supplier_name, bill_number, bill_date, before_vat_aed, vat_aed, total_aed, paid_at, paid_method, paid_reference, zoho_bill_id, created_at${checkOn ? ", checked_at, query" : ""}`).eq("is_active", true).is("voided_at", null).order("bill_date", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  const bills = (data ?? []) as unknown as Bill[];
  if (!bills.length) return [];
  const ids = bills.map((b) => b.id);
  const supIds = Array.from(new Set(bills.map((b) => b.supplier_id).filter((x): x is string => !!x)));
  const [{ data: tickets }, { data: lines }, { data: sups }] = await Promise.all([
    admin.from("part_items").select("lathe_bill_id").in("lathe_bill_id", ids),
    admin.from("supplier_payment_lines").select("lathe_bill_id, amount_aed, payment_id").in("lathe_bill_id", ids).eq("is_active", true),
    supIds.length ? admin.from("suppliers").select("id, name, trn, vat_registered").in("id", supIds) : Promise.resolve({ data: [] as { id: string; name: string; trn: string | null; vat_registered: boolean | null }[] }),
  ]);
  const payIds = Array.from(new Set(((lines ?? []) as { payment_id: string }[]).map((l) => l.payment_id)));
  const { data: pays } = payIds.length ? await admin.from("supplier_payments").select("id, status, proof_path, paid_on, method, number").in("id", payIds) : { data: [] };
  const live = new Map(((pays ?? []) as { id: string; status: string; proof_path: string | null; paid_on: string; method: string; number: string }[]).filter((p) => p.status === "recorded").map((p) => [p.id, p]));
  const supOf = new Map(((sups ?? []) as { id: string; name: string; trn: string | null; vat_registered: boolean | null }[]).map((s) => [s.id, s]));
  return bills.map((b) => {
    const total = r2(Number(b.total_aed) || 0);
    const mine = ((lines ?? []) as { lathe_bill_id: string; amount_aed: number | string; payment_id: string }[]).filter((l) => l.lathe_bill_id === b.id && live.has(l.payment_id));
    const paidNew = r2(mine.reduce((a, l) => a + (Number(l.amount_aed) || 0), 0));
    const paidAmount = b.paid_at && paidNew <= 0.004 ? total : Math.min(total, paidNew);
    const paid = paidAmount >= total - 0.004;
    const firstPay = mine.map((l) => live.get(l.payment_id)!).sort((x, y) => String(x.paid_on).localeCompare(String(y.paid_on)))[0] ?? null;
    const proof = mine.map((l) => live.get(l.payment_id)?.proof_path).find((x) => !!x) ?? null;
    const status: InvoiceStatus = paid ? "paid" : b.query ? "queried" : b.zoho_bill_id ? "zoho" : b.checked_at ? "checked" : checkOn ? "new" : "checked";
    const sup = b.supplier_id ? supOf.get(b.supplier_id) : null;
    const vat = r2(Number(b.vat_aed) || 0);
    return {
      key: `${LATHE_KEY}${b.id}`,
      lathe: true,
      notReceived: false,
      stock: false,
      dateWarning: null,
      lpoDate: null,
      supplier: b.supplier_name,
      supplierId: b.supplier_id,
      trn: sup?.trn ?? null,
      vatRegistered: sup?.vat_registered !== false,
      vatCharged: vat > 0.004 || (sup ? supplierChargesVat({ ...sup, name: b.supplier_name }) : false),
      number: b.bill_number,
      date: String(b.bill_date).slice(0, 10),
      beforeVat: r2(Number(b.before_vat_aed) || 0),
      vat,
      total,
      shares: [],
      parts: ((tickets ?? []) as { lathe_bill_id: string }[]).filter((t) => t.lathe_bill_id === b.id).length,
      match: ["matches"],
      status,
      duplicateOf: null,
      paid,
      partlyPaid: paidAmount > 0.004 && !paid,
      paidAmount: r2(paidAmount),
      unpaidAmount: r2(total - paidAmount),
      paidAt: firstPay?.paid_on ?? b.paid_at ?? null,
      paidMethod: firstPay?.method ?? b.paid_method ?? null,
      paidReference: firstPay?.number ?? b.paid_reference ?? null,
      proofMissing: paidAmount > 0.004 && !proof && !b.paid_at,
      at: b.created_at,
      query: b.query ?? null,
    } as InvoiceRow;
  });
}

/** Accounts check a lathe bill: it may then be paid, and its Zoho bill is queued (OFJ TEST until go-live). */
export async function checkLatheBill(billId: string, by: { id: string; display_name: string }): Promise<{ error?: string; words?: string }> {
  if (!(await latheCheckReady())) return { error: "Checking lathe bills switches on once the database change is applied." };
  const admin = createAdminClient();
  const { data: b } = await admin.from("lathe_bills").select("id, bill_number, checked_at, voided_at").eq("id", billId).maybeSingle();
  if (!b || b.voided_at) return { error: "That lathe bill is no longer on the list." };
  if (b.checked_at) return { words: `Lathe bill ${b.bill_number} was already checked.` };
  const { error } = await admin.from("lathe_bills").update({ checked_at: new Date().toISOString(), checked_by: by.id, query: null, query_at: null, query_by: null, updated_by: by.id }).eq("id", billId).is("checked_at", null);
  if (error) return { error: "Couldn't save – nothing was recorded. Try again or tell the owner." };
  const { tryEnqueueZoho } = await import("./zoho-sync");
  await tryEnqueueZoho("lathebill", billId, null, by.id).catch(() => null);
  return { words: `Lathe bill ${b.bill_number} checked by ${by.display_name}: it can be paid on Supplier payments now.` };
}

/** Accounts query a lathe bill back to Parts (the paper does not match): it is unchecked until answered. */
export async function queryLatheBill(billId: string, comment: string, by: { id: string; display_name: string }): Promise<{ error?: string; words?: string; number?: string }> {
  if (!(await latheCheckReady())) return { error: "Querying lathe bills switches on once the database change is applied." };
  const admin = createAdminClient();
  const { data: b } = await admin.from("lathe_bills").select("id, bill_number, supplier_name, voided_at").eq("id", billId).maybeSingle();
  if (!b || b.voided_at) return { error: "That lathe bill is no longer on the list." };
  const { error } = await admin.from("lathe_bills").update({ query: comment, query_at: new Date().toISOString(), query_by: by.id, checked_at: null, checked_by: null, updated_by: by.id }).eq("id", billId);
  if (error) return { error: "Couldn't save – nothing was recorded. Try again or tell the owner." };
  return { words: "Sent to Parts with your comment ✓", number: String(b.bill_number) };
}
