"use server";

import { revalidatePath } from "next/cache";
import { dbWords } from "@/lib/app-errors";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordSupplierPayment, undoAdvanceUse } from "@/lib/supplier-payments";
import { objectExists } from "@/lib/upload-targets/common";
import { JOB_FILES_BUCKET } from "@/lib/work-data";
import { reopenZoho, tryEnqueueZoho } from "@/lib/zoho-sync";

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
  const advanceUses: { paymentId: string; poId: string; amount: number }[] = [];
  formData.forEach((v, k) => {
    if (k.startsWith("alloc__")) {
      const amount = num(v);
      if (amount > 0) lines.push({ poId: k.slice(7), amount });
    } else if (k.startsWith("use__")) {
      // use__<advance payment id>__<invoice key>: how much of that advance goes on that invoice (11 November 2026).
      const [paymentId, poId] = k.slice(5).split("__");
      const amount = num(v);
      if (paymentId && poId && amount > 0) advanceUses.push({ paymentId, poId, amount });
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
      proofPath: /^supplier-payments\/[\w./-]+$/.test(String(formData.get("proof_path") ?? "")) ? String(formData.get("proof_path")) : null,
      note: String(formData.get("note") ?? "").trim().slice(0, 500) || null,
      advanceUses,
    },
    staff,
  );
  if (res.error) return { error: dbWords({ message: res.error }, "parts/supplier-payment") };
  // Advances applied with no new payment (11 November 2026, Section 3): each advance's vendor payment is applied again in Zoho.
  for (const pid of [...(res.appliedOnly ?? []), ...(res.advancesUsed ?? [])]) await reopenZoho("supplierpay", pid).catch(() => null);
  if (!res.id) {
    revalidatePath("/parts/orders", "layout");
    revalidatePath("/supplier-invoices");
    revalidatePath("/supplier-payments");
    revalidatePath("/parts-accounts");
    return res.appliedOnly ? { ok: true, message: `Advance applied, no new payment: ${res.words}.` } : { error: "Couldn't save – nothing was recorded." };
  }
  // A proof that arrived WHILE the payment was being saved (its record step looked at the LPO a moment too early) joins
  // the payment and the LPOs it settled; one still on its way lands on the LPO by itself when it arrives.
  const pending = String(formData.get("proof_pending") ?? "").trim();
  if (!formData.get("proof_path") && /^supplier-payments\/[0-9a-f-]{36}\/[\w-]{1,60}\.[a-z]{2,5}$/i.test(pending) && (await objectExists(JOB_FILES_BUCKET, pending))) {
    const admin = createAdminClient();
    await admin.from("supplier_payments").update({ proof_path: pending, updated_by: staff.id }).eq("id", res.id).is("proof_path", null);
    await admin.from("purchase_orders").update({ supplier_paid_proof_path: pending, supplier_paid_proof_at: new Date().toISOString(), supplier_paid_proof_by: staff.id, updated_by: staff.id }).eq("supplier_payment_id", res.id).is("supplier_paid_proof_path", null);
  }
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

/** Undo one applied advance (owner and accounts, a remark of a few words): the invoice owes again, the advance holds it again, Zoho follows. */
export async function undoAdvanceUseAction(lineId: string, _prev: PayState, formData: FormData): Promise<PayState> {
  const staff = await requireStaff();
  if (!(staff.role_id === "owner" || staff.role_id === "accounts") || staff.viewingAs) return { error: "Only the owner or accounts change a supplier payment." };
  const remark = String(formData.get("remark") ?? "").trim();
  if (remark.length < 5) return { error: "Write why (a few words) – it stays in the history." };
  const r = await undoAdvanceUse(lineId, remark.slice(0, 300), staff);
  if (r.error) return { error: dbWords({ message: r.error }, "parts/advance-undo", { staffId: staff.id }) };
  if (r.paymentId) await reopenZoho("supplierpay", r.paymentId).catch(() => null);
  revalidatePath("/parts/orders", "layout");
  revalidatePath("/supplier-invoices");
  revalidatePath("/supplier-payments");
  revalidatePath("/parts-accounts");
  return { ok: true, message: r.words };
}
