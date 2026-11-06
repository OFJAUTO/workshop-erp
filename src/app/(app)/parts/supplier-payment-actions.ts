"use server";

import { revalidatePath } from "next/cache";
import { dbWords } from "@/lib/app-errors";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordSupplierPayment } from "@/lib/supplier-payments";
import { tryEnqueueZoho } from "@/lib/zoho-sync";

/**
 * SUPPLIER PAYMENTS (6 November 2026, Section 4): record one payment (amount, method, spread over the supplier's
 * invoices, any excess as an advance or a fee) and void one with a remark. Owner and accounts only.
 */
export type PayState = { ok?: boolean; error?: string; message?: string } | null;

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

export async function recordSupplierPaymentAction(_prev: PayState, formData: FormData): Promise<PayState> {
  const staff = await requireStaff();
  if (!(staff.role_id === "owner" || staff.role_id === "accounts") || staff.viewingAs) return { error: "Only the owner or accounts record supplier payments." };
  const lines: { poId: string; amount: number }[] = [];
  const useAdvances: { paymentId: string; amount: number }[] = [];
  formData.forEach((v, k) => {
    if (k.startsWith("alloc__")) {
      const amount = num(v);
      if (amount > 0) lines.push({ poId: k.slice(7), amount });
    } else if (k.startsWith("advance__")) {
      const amount = num(v);
      if (amount > 0) useAdvances.push({ paymentId: k.slice(9), amount });
    }
  });
  const excessRaw = String(formData.get("excess_kind") ?? "");
  const res = await recordSupplierPayment(
    {
      supplierId: String(formData.get("supplier_id") ?? "") || null,
      supplierName: String(formData.get("supplier_name") ?? "").trim(),
      paidOn: String(formData.get("paid_on") ?? "").slice(0, 10),
      method: String(formData.get("method") ?? "transfer"),
      reference: String(formData.get("reference") ?? "").trim().slice(0, 120) || null,
      amount: num(formData.get("amount")),
      lines,
      excessKind: excessRaw === "advance" || excessRaw === "fee" ? excessRaw : null,
      proofPath: null,
      note: String(formData.get("note") ?? "").trim().slice(0, 500) || null,
      useAdvances,
    },
    staff,
  );
  if (res.error || !res.id) return { error: res.error ? dbWords({ message: res.error }, "parts/supplier-payment") : "Couldn't save – nothing was recorded." };
  await tryEnqueueZoho("supplierpay", res.id, null, staff.id);
  revalidatePath("/parts/orders", "layout");
  revalidatePath("/supplier-invoices");
  revalidatePath("/parts-accounts");
  revalidatePath("/parts/suppliers");
  return { ok: true, message: `Recorded ${res.words}.` };
}

/** Void a payment (owner and accounts, with a remark): its LPOs are unpaid again, and Zoho takes it back. */
export async function voidSupplierPaymentAction(paymentId: string, _prev: PayState, formData: FormData): Promise<PayState> {
  const staff = await requireStaff();
  if (!(staff.role_id === "owner" || staff.role_id === "accounts") || staff.viewingAs) return { error: "Only the owner or accounts change a supplier payment." };
  const remark = String(formData.get("remark") ?? "").trim();
  if (remark.length < 5) return { error: "Write why (a few words) – it stays in the history." };
  const admin = createAdminClient();
  const { data: pay } = await admin.from("supplier_payments").select("id, number, status, edit_history").eq("id", paymentId).maybeSingle();
  if (!pay || pay.status !== "recorded") return { error: "This payment is already voided or gone." };
  const history = [...((pay.edit_history as unknown[]) ?? []), { at: new Date().toISOString(), by: staff.display_name, remark, changes: [{ field: "status", old: "recorded", new: "void" }] }];
  const { error } = await admin.from("supplier_payments").update({ status: "void", void_reason: remark, edit_history: history, updated_by: staff.id }).eq("id", paymentId).eq("status", "recorded");
  if (error) return { error: dbWords(error, "parts/supplier-payment-void", { staffId: staff.id }) };
  await admin.from("purchase_orders").update({ supplier_paid_at: null, supplier_paid_by: null, supplier_paid_reference: null, supplier_payment_id: null, updated_by: staff.id }).eq("supplier_payment_id", paymentId);
  await tryEnqueueZoho("supplierpay", paymentId, null, staff.id);
  revalidatePath("/parts/orders", "layout");
  revalidatePath("/supplier-invoices");
  revalidatePath("/parts-accounts");
  return { ok: true, message: `${pay.number} voided. Its invoices are unpaid again.` };
}
