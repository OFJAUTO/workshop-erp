"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { notifyRoles } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSupplierInvoices, siQueryReady } from "@/lib/supplier-invoices";
import { invWords } from "@/lib/supplier-invoice-rows";
import { tryEnqueueZoho } from "@/lib/zoho-sync";

/** Back to where the button was pressed: the Supplier invoices page, or its tab in Parts accounts (a whitelist, never a typed address). */
function back(key: string, words: { message?: string; error?: string }, formData?: FormData): never {
  revalidatePath("/supplier-invoices");
  revalidatePath("/parts-accounts");
  revalidatePath("/dashboard");
  revalidatePath("/parts/orders");
  const inPartsAccounts = formData?.get("from") === "parts-accounts";
  const q = new URLSearchParams({ ...(inPartsAccounts ? { tab: "invoices" } : {}), open: key, ...(words.error ? { error: words.error } : { message: words.message ?? "" }) });
  redirect(`/${inPartsAccounts ? "parts-accounts" : "supplier-invoices"}?${q.toString()}`);
}

/** The invoice row, null when it is gone, or undefined when the list could not be read (said in words, never "gone"). */
async function rowOf(key: string) {
  const read = await loadSupplierInvoices({ strict: true }).catch(() => null);
  if (!read) return undefined;
  return read.rows.find((r) => r.key === key) ?? null;
}

const READ_FAILED = "Couldn't read the supplier invoices just now – nothing was changed. Try again.";

/**
 * Accounts (or the owner) mark a supplier invoice Checked: every LPO it covers is checked, and each becomes its bill in
 * Zoho Books under the existing supplier-bill rules (OFJ TEST until go-live). A query on it is closed.
 */
export async function checkInvoiceAction(key: string, formData?: FormData) {
  const to = (w: { message?: string; error?: string }) => back(key, w, formData);
  const staff = await requireStaff();
  if (!["owner", "accounts"].includes(staff.role_id) || staff.viewingAs) return to({ error: "Only accounts or the owner check supplier invoices." });
  const row = await rowOf(key);
  if (row === undefined) return to({ error: READ_FAILED });
  if (!row) return to({ error: "That invoice is no longer on the list." });
  if (row.status === "waiting") return to({ error: "The invoice has not arrived yet: Parts enter it when it comes." });
  const { count: waitingOwner } = await createAdminClient().from("purchase_order_lines").select("id", { count: "exact", head: true }).in("po_id", row.shares.map((s) => s.poId)).eq("invoice_check", "mismatch").eq("is_active", true);
  if ((waitingOwner ?? 0) > 0) return to({ error: "A price went up above the limit: it waits for the owner's OK (or Query with supplier) before the bill goes to Zoho." });
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
  return to({ message: `${invWords(row.number)} checked ✓ — the bill goes to Zoho Books (OFJ TEST until go-live).` });
}

/** Accounts send a supplier invoice back to the parts desk with a comment ("the quantity on the paper is 1, not 2"). */
export async function queryInvoiceAction(key: string, formData: FormData) {
  const to = (w: { message?: string; error?: string }) => back(key, w, formData);
  const staff = await requireStaff();
  if (!["owner", "accounts"].includes(staff.role_id) || staff.viewingAs) return to({ error: "Only accounts or the owner query supplier invoices." });
  if (!(await siQueryReady())) return to({ error: "Query needs the database update first (waiting for apply). Tell Parts on WhatsApp for now." });
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 500);
  if (comment.length < 3) return to({ error: "Write what Parts should check." });
  const row = await rowOf(key);
  if (row === undefined) return to({ error: READ_FAILED });
  if (!row) return to({ error: "That invoice is no longer on the list." });
  const admin = createAdminClient();
  const now = new Date().toISOString();
  for (const s of row.shares) {
    await admin.from("purchase_orders").update({ supplier_invoice_query: comment, supplier_invoice_query_at: now, supplier_invoice_query_by: staff.id, supplier_invoice_checked_at: null, supplier_invoice_checked_by: null, updated_by: staff.id }).eq("id", s.poId);
    if (s.jobId) await admin.from("job_events").insert({ job_id: s.jobId, event_type: "supplier_invoice_query", note: `Supplier invoice ${row.number ?? ""} (${row.supplier}, ${s.poNumber}) queried by ${staff.display_name}: ${comment}`, created_by: staff.id });
  }
  // 4 November 2026: Parts no longer enter invoices - the query asks them about the PAPER (check with the supplier, tell accounts), and accounts correct the entry.
  await notifyRoles(["parts"], { type: "supplier_invoice_missing", title: `Accounts query · ${invWords(row.number)} · ${row.supplier}`, body: `${staff.display_name}: ${comment}. Check the paper with the supplier and tell accounts – they correct the entry (${row.shares.map((s) => s.poNumber).join(", ")}).`, jobId: row.shares[0]?.jobId ?? null, href: `/parts/orders/${row.shares[0]?.poId}` });
  return to({ message: "Sent to Parts with your comment ✓ (they check the paper; you correct the entry here)" });
}
