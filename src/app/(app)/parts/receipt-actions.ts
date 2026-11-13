"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { formValues, type FormState } from "@/lib/form-state";
import { askRetake, lposWithNumber, replaceReceiptFile, setReceiptNumber } from "@/lib/receipts";
import { createAdminClient } from "@/lib/supabase/admin";
import { laterDays } from "@/lib/receipt-rules";

/** The receipt box asks on leaving the number: other LPOs of this supplier with the same invoice number. */
export async function checkReceiptNumberAction(supplierId: string | null, supplierName: string, number: string, poIds: string[]): Promise<string[]> {
  await requireStaff();
  return lposWithNumber(supplierId, supplierName, number, poIds).catch(() => []);
}

const actor = (s: { id: string; display_name: string; role_id: string }) => ({ id: s.id, display_name: s.display_name, role_id: s.role_id });
const refresh = (poId: string | null) => {
  if (poId) revalidatePath(`/parts/orders/${poId}`);
  revalidatePath("/supplier-invoices");
  revalidatePath("/dashboard");
};

/** The invoice number typed later (parts desk, accounts) or corrected (accounts, owner). */
export async function receiptNumberAction(receiptId: string, poId: string, _s: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  const r = await setReceiptNumber(receiptId, String(formData.get("number") ?? ""), formData.get("same_ok") === "on", actor(staff));
  if (r.error) return { error: r.error, values: formValues(formData) };
  refresh(poId);
  return { success: r.words };
}

/** "Retake photo" / "Scan again" for the delivery paper or the invoice. */
export async function receiptFileAction(receiptId: string, poId: string, kind: "paper" | "invoice", _s: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  const f = formData.get("file");
  if (!(f instanceof File) || !f.size) return { error: "Take or choose the photo first." };
  const r = await replaceReceiptFile(receiptId, kind, f, actor(staff));
  if (r.error) return { error: r.error };
  refresh(poId);
  return { success: r.words };
}

/** "Photo unclear - ask Parts to retake". */
export async function receiptRetakeAction(receiptId: string, poId: string, _s: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  const r = await askRetake(receiptId, String(formData.get("note") ?? ""), actor(staff));
  if (r.error) return { error: r.error };
  refresh(poId);
  return { success: r.words };
}

/** Owner and accounts mark a supplier "Invoice later allowed" (at most 5 days). */
export async function supplierInvoiceLaterAction(supplierId: string, _s: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  if (staff.viewingAs || !["owner", "accounts"].includes(staff.role_id)) return { error: "Only the owner or accounts can mark a supplier." };
  const allowed = formData.get("allowed") === "on";
  const days = laterDays(Number(formData.get("days")));
  const admin = createAdminClient();
  const { error } = await admin.from("suppliers").update({ invoice_later_allowed: allowed, invoice_later_days: days, updated_by: staff.id }).eq("id", supplierId);
  if (error) return { error: "Couldn't save – nothing was changed. Try again." };
  // The suppliers audit trigger logs the change (who, when, old and new).
  revalidatePath("/parts/suppliers");
  return { success: allowed ? `Invoice later allowed: up to ${days} day${days === 1 ? "" : "s"}.` : "Invoice later switched off: the invoice number is needed at every receipt." };
}
