"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { receiveCombined } from "@/lib/payment-groups";
import { logAppError, SAVE_FAILED } from "@/lib/app-errors";

export type ReceiveAnswer = { error?: string; message?: string; at: number };

/** Receive payment from the customer (9 November 2026, Section 3): one payment over several cars, oldest first. */
export async function receivePaymentAction(customerId: string, _prev: ReceiveAnswer | null, formData: FormData): Promise<ReceiveAnswer> {
  const staff = await requirePermission("recordPayments");
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to record.", at: Date.now() };
  const num = (v: FormDataEntryValue | null) => Number(String(v ?? "").replace(/,/g, "")) || 0;
  const shares = formData.getAll("share_invoice").map((id, i) => ({ invoiceId: String(id), amount: num(formData.getAll("share_amount")[i] ?? null) })).filter((s) => s.amount > 0);
  const replaceIds = formData.getAll("replace_id").map(String).filter(Boolean);
  try {
    const r = await receiveCombined(customerId, {
      method: String(formData.get("method") ?? ""),
      amount: num(formData.get("amount")),
      reference: String(formData.get("reference") ?? "").trim() || null,
      authCode: String(formData.get("auth_code") ?? "").trim() || null,
      cheque: { number: String(formData.get("cheque_number") ?? "").trim() || null, bank: String(formData.get("cheque_bank") ?? "").trim() || null, date: String(formData.get("cheque_date") ?? "").trim() || null },
      shares,
      clientKey: String(formData.get("client_key") ?? ""),
      replace: replaceIds.length ? { paymentIds: replaceIds, reason: String(formData.get("replace_reason") ?? "") } : null,
    }, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id, is_head_accountant: staff.is_head_accountant });
    if (r.ok) {
      revalidatePath(`/customers/${customerId}`);
      revalidatePath("/invoices");
      revalidatePath("/accounts-posting");
      revalidatePath("/jobs", "layout");
    }
    return { error: r.error, message: r.words, at: Date.now() };
  } catch (e) {
    await logAppError("customers/receive-actions", e, { staffId: staff.id });
    return { error: SAVE_FAILED, at: Date.now() };
  }
}
