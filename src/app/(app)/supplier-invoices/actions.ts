"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { notifyRoles } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSupplierInvoices, siQueryReady } from "@/lib/supplier-invoices";
import { invWords } from "@/lib/supplier-invoice-rows";
import { tryEnqueueZoho } from "@/lib/zoho-sync";

function back(key: string, words: { message?: string; error?: string }): never {
  revalidatePath("/supplier-invoices");
  revalidatePath("/dashboard");
  revalidatePath("/parts/orders");
  const q = new URLSearchParams({ open: key, ...(words.error ? { error: words.error } : { message: words.message ?? "" }) });
  redirect(`/supplier-invoices?${q.toString()}`);
}

async function rowOf(key: string) {
  const { rows } = await loadSupplierInvoices();
  return rows.find((r) => r.key === key) ?? null;
}

/**
 * Accounts (or the owner) mark a supplier invoice Checked: every LPO it covers is checked, and each becomes its bill in
 * Zoho Books under the existing supplier-bill rules (OFJ TEST until go-live). A query on it is closed.
 */
export async function checkInvoiceAction(key: string) {
  const staff = await requireStaff();
  if (!["owner", "accounts"].includes(staff.role_id) || staff.viewingAs) return back(key, { error: "Only accounts or the owner check supplier invoices." });
  const row = await rowOf(key);
  if (!row) return back(key, { error: "That invoice is no longer on the list." });
  if (row.status === "waiting") return back(key, { error: "The invoice has not arrived yet: Parts enter it when it comes." });
  const { count: waitingOwner } = await createAdminClient().from("purchase_order_lines").select("id", { count: "exact", head: true }).in("po_id", row.shares.map((s) => s.poId)).eq("invoice_check", "mismatch").eq("is_active", true);
  if ((waitingOwner ?? 0) > 0) return back(key, { error: "A price went up above the limit: it waits for the owner's OK (or Query with supplier) before the bill goes to Zoho." });
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const clearQuery = (await siQueryReady()) ? { supplier_invoice_query: null, supplier_invoice_query_at: null, supplier_invoice_query_by: null } : {};
  for (const s of row.shares) {
    await admin.from("purchase_orders").update({ supplier_invoice_checked_at: now, supplier_invoice_checked_by: staff.id, ...clearQuery, updated_by: staff.id }).eq("id", s.poId).is("supplier_invoice_checked_at", null);
    if (Object.keys(clearQuery).length) await admin.from("purchase_orders").update({ ...clearQuery, updated_by: staff.id }).eq("id", s.poId);
    // The bill goes to Zoho Books when accounts have checked the invoice (1 November 2026).
    await tryEnqueueZoho("bill", s.poId, s.jobId, staff.id);
    if (s.jobId) await admin.from("job_events").insert({ job_id: s.jobId, event_type: "supplier_invoice_checked", note: `Supplier invoice ${row.number} (${row.supplier}, ${s.poNumber}) checked by ${staff.display_name}`, created_by: staff.id });
  }
  return back(key, { message: `${invWords(row.number)} checked ✓ — the bill goes to Zoho Books (OFJ TEST until go-live).` });
}

/** Accounts send a supplier invoice back to the parts desk with a comment ("the quantity on the paper is 1, not 2"). */
export async function queryInvoiceAction(key: string, formData: FormData) {
  const staff = await requireStaff();
  if (!["owner", "accounts"].includes(staff.role_id) || staff.viewingAs) return back(key, { error: "Only accounts or the owner query supplier invoices." });
  if (!(await siQueryReady())) return back(key, { error: "Query needs the database update first (waiting for apply). Tell Parts on WhatsApp for now." });
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 500);
  if (comment.length < 3) return back(key, { error: "Write what Parts should check." });
  const row = await rowOf(key);
  if (!row) return back(key, { error: "That invoice is no longer on the list." });
  const admin = createAdminClient();
  const now = new Date().toISOString();
  for (const s of row.shares) {
    await admin.from("purchase_orders").update({ supplier_invoice_query: comment, supplier_invoice_query_at: now, supplier_invoice_query_by: staff.id, supplier_invoice_checked_at: null, supplier_invoice_checked_by: null, updated_by: staff.id }).eq("id", s.poId);
    if (s.jobId) await admin.from("job_events").insert({ job_id: s.jobId, event_type: "supplier_invoice_query", note: `Supplier invoice ${row.number ?? ""} (${row.supplier}, ${s.poNumber}) queried by ${staff.display_name}: ${comment}`, created_by: staff.id });
  }
  await notifyRoles(["parts"], { type: "supplier_invoice_missing", title: `Accounts query · ${invWords(row.number)} · ${row.supplier}`, body: `${staff.display_name}: ${comment}. Correct the invoice on the LPO page (${row.shares.map((s) => s.poNumber).join(", ")}).`, jobId: row.shares[0]?.jobId ?? null, href: `/parts/orders/${row.shares[0]?.poId}` });
  return back(key, { message: "Sent back to Parts with your comment ✓" });
}
