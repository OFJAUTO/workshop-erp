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
 * Section 2 (21 October): accounts or the owner pay one or SEVERAL ready commissions of one person in
 * one payment. Cash makes a numbered voucher to print and sign; a bank transfer records its reference.
 * Either way the payment stays "Paid - proof missing" (amber, and on the Waiting lists) until the
 * signed voucher or the bank slip is uploaded.
 */
export async function payCommissions(formData: FormData) {
  const staff = await requireStaff();
  if (!(staff.role_id === "owner" || staff.role_id === "accounts") || staff.viewingAs) back("Only accounts or the owner pay commissions.", true);
  const ids = formData.getAll("ids").map((x) => String(x)).filter(Boolean);
  const method = String(formData.get("method") ?? "");
  const paidOn = String(formData.get("paid_on") ?? "").slice(0, 10);
  const amountRaw = Number(String(formData.get("amount") ?? "").replace(",", "."));
  const reference = blankToNull(formData.get("reference"));
  const note = blankToNull(formData.get("note"));
  if (!ids.length) back("Tick at least one commission to pay.", true);
  if (!["cash", "transfer"].includes(method)) back("Pick Cash or Bank transfer.", true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) back("Pick the payment date.", true);
  if (method === "transfer" && !reference) back("A bank transfer needs its transfer reference.", true);
  const { ready } = await loadCommissions();
  const rows = ids.map((id) => ready.find((r) => r.quotationId === id)).filter((x): x is NonNullable<typeof x> => !!x);
  if (rows.length !== ids.length) back("One of the ticked commissions is not payable any more. Reload the page.", true);
  const recipients = Array.from(new Set(rows.map((r) => r.recipient)));
  if (recipients.length > 1) back("One payment covers one person. Tick commissions of the same person only.", true);
  const total = Math.round(rows.reduce((a, r) => a + r.amount, 0) * 100) / 100;
  const amount = Number.isFinite(amountRaw) && amountRaw > 0 ? Math.round(amountRaw * 100) / 100 : total;
  if (Math.abs(amount - total) > 0.005 && staff.role_id !== "owner") back(`The amount must equal the ticked commissions (AED ${total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}). Only the owner may pay a different figure.`, true);
  const admin = createAdminClient();
  const { data: pay, error } = await admin
    .from("commission_payments")
    .insert({ recipient: recipients[0], recipient_phone: rows[0].phone, method, paid_on: paidOn, amount_aed: amount, reference, note, paid_by: staff.id, created_by: staff.id, updated_by: staff.id })
    .select("id, number")
    .single();
  if (error || !pay) back(error?.message ?? "Could not record the payment.", true);
  const now = new Date().toISOString();
  for (const r of rows) {
    await admin.from("quotations").update({ commission_paid_at: now, commission_paid_by: staff.id, commission_paid_method: method, commission_paid_note: note, commission_payment_id: pay!.id, updated_by: staff.id }).eq("id", r.quotationId);
    if (r.jobId) await admin.from("job_events").insert({ job_id: r.jobId, event_type: "commission_paid", note: `Commission AED ${r.amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })} to ${r.recipient} paid by ${staff.display_name} (${method === "cash" ? "cash" : `bank transfer${reference ? `, ref ${reference}` : ""}`}) · voucher ${pay!.number}`, created_by: staff.id });
  }
  revalidatePath("/commissions");
  revalidatePath("/reports/monthly");
  redirect(`/commissions?message=${encodeURIComponent(`${pay!.number}: AED ${amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })} to ${recipients[0]} by ${method === "cash" ? "cash" : "bank transfer"}. ${method === "cash" ? "Print the voucher, sign it, then upload the signed copy." : "Upload the bank slip or screenshot."}`)}&voucher=${pay!.id}`);
}
