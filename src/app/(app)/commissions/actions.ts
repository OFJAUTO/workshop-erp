"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { loadCommissions } from "@/lib/commissions";
import { decideCommission, saveCommission } from "@/app/(app)/quotes/actions";
import { createAdminClient } from "@/lib/supabase/admin";

const back = (msg: string, isError = false) => redirect(`/commissions?${isError ? "error" : "message"}=${encodeURIComponent(msg)}`);

/** The owner's Approve / Reject from the page (the same rules as the quote editor's line). */
export async function decideCommissionAt(quotationId: string, formData: FormData) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner" || staff.viewingAs) back("Only the owner decides a commission.", true);
  const r = await decideCommission(quotationId, formData);
  revalidatePath("/commissions");
  back(r.error ? r.error : String(formData.get("decision")) === "approve" ? "Approved. Accounts can pay it once the customer's invoice is settled." : "Rejected and removed from the costs.", !!r.error);
}

/** The owner's Edit: a new amount (his own saves are approved at once). */
export async function editCommissionAt(quotationId: string, formData: FormData) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner" || staff.viewingAs) back("Only the owner edits a commission.", true);
  const r = await saveCommission(quotationId, formData);
  revalidatePath("/commissions");
  back(r.error ?? "Changed and approved.", !!r.error);
}

/**
 * Accounts (or the owner) mark a commission PAID: only an approved one, and only once the customer's
 * tax invoice is paid in full - otherwise the page says exactly why not. How it was paid and a note
 * are written down.
 */
export async function payCommissionAt(quotationId: string, formData: FormData) {
  const staff = await requireStaff();
  if (!(staff.role_id === "owner" || staff.role_id === "accounts") || staff.viewingAs) back("Only accounts or the owner pay commissions.", true);
  const method = blankToNull(formData.get("method"));
  const note = blankToNull(formData.get("note"));
  const { toPay } = await loadCommissions();
  const row = toPay.find((r) => r.quotationId === quotationId);
  if (!row) back("This commission is not payable (already paid, or not approved yet).", true);
  if (!row!.customerPaid) back(`Not yet: ${row!.customerPaidWhy}.`, true);
  if (!method) back("Pick how it was paid (cash, transfer…).", true);
  const admin = createAdminClient();
  await admin.from("quotations").update({ commission_paid_at: new Date().toISOString(), commission_paid_by: staff.id, commission_paid_method: method, commission_paid_note: note, updated_by: staff.id }).eq("id", quotationId);
  if (row!.jobId) await admin.from("job_events").insert({ job_id: row!.jobId, event_type: "commission_paid", note: `Commission AED ${row!.amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })} to ${row!.recipient} paid by ${staff.display_name} (${method}${note ? `, ${note}` : ""})`, created_by: staff.id });
  revalidatePath("/commissions");
  revalidatePath("/reports/monthly");
  back(`Paid to ${row!.recipient}: AED ${row!.amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })} by ${method}.`);
}
