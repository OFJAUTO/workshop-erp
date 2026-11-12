"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { logAppError, SAVE_FAILED } from "@/lib/app-errors";
import type { FormState } from "@/lib/form-state";
import { applyLpoAdvance, markPayFirst, payInAdvance } from "@/lib/lpo-advance";
import { reopenZoho, tryEnqueueZoho } from "@/lib/zoho-sync";

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};
const refresh = (poId: string) => {
  revalidatePath(`/parts/orders/${poId}`);
  revalidatePath("/supplier-invoices");
  revalidatePath("/parts-accounts");
  revalidatePath("/dashboard");
};

/** 13 November 2026 (Section 4): "Pay in advance" on an LPO waiting for its invoice (owner and accounts). */
export async function payInAdvanceAction(poId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to record it." };
  const values = { amount: String(formData.get("amount") ?? ""), reference: String(formData.get("reference") ?? ""), paid_on: String(formData.get("paid_on") ?? "") };
  try {
    const proof = String(formData.get("proof_path") ?? "");
    const r = await payInAdvance(poId, {
      amount: num(formData.get("amount")),
      method: String(formData.get("method") ?? "transfer"),
      paidOn: String(formData.get("paid_on") ?? "").slice(0, 10),
      reference: String(formData.get("reference") ?? "").trim().slice(0, 120) || null,
      proofPath: /^supplier-payments\/[\w./-]+$/.test(proof) ? proof : null,
      note: String(formData.get("note") ?? "").trim().slice(0, 500) || null,
    }, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
    if (r.error) return { error: r.error, values };
    if (r.paymentId) await tryEnqueueZoho("supplierpay", r.paymentId, null, staff.id);
    refresh(poId);
    return { success: `Recorded: ${r.words}. The parts desk is told to confirm the order.` };
  } catch (e) {
    await logAppError("parts/lpo-advance-actions", e, { staffId: staff.id });
    return { error: SAVE_FAILED, values };
  }
}

/** The parts desk: "Supplier needs payment first" (accounts get the task). */
export async function payFirstAction(poId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as." };
  const r = await markPayFirst(poId, String(formData.get("note") ?? "").slice(0, 300), { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  if (r.error) return { error: r.error };
  refresh(poId);
  return { success: r.words };
}

/** One tap once the invoice is entered: the advance pays it. */
export async function applyLpoAdvanceAction(poId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  void _formData;
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as." };
  try {
    const r = await applyLpoAdvance(poId, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
    if (r.error) return { error: r.error };
    for (const pid of r.paymentIds ?? []) await reopenZoho("supplierpay", pid).catch(() => null);
    refresh(poId);
    return { success: r.words };
  } catch (e) {
    await logAppError("parts/lpo-advance-actions: apply", e, { staffId: staff.id });
    return { error: SAVE_FAILED };
  }
}
