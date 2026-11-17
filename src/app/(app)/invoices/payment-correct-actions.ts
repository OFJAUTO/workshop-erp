"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { logAppError, SAVE_FAILED } from "@/lib/app-errors";
import { getSettings } from "@/lib/settings";
import { correctCustomerPayment } from "@/lib/payment-date";

export type CorrectState = { ok?: boolean; error?: string; message?: string } | null;

/** "Correct this payment" for a customer payment (17 November 2026, Section 3): owner and accounts, with a reason. */
export async function correctCustomerPaymentAction(paymentId: string, _prev: CorrectState, formData: FormData): Promise<CorrectState> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to correct it." };
  try {
    const proof = formData.get("proof");
    const r = await correctCustomerPayment(
      paymentId,
      {
        day: String(formData.get("paid_on") ?? "").slice(0, 10) || null,
        method: String(formData.get("method") ?? "") || null,
        reference: String(formData.get("reference") ?? ""),
        proof: proof instanceof File && proof.size > 0 ? proof : null,
        reason: String(formData.get("reason") ?? ""),
      },
      { id: staff.id, display_name: staff.display_name, role_id: staff.role_id },
      await getSettings(),
    );
    if (r.error) return { error: r.error };
    revalidatePath("/jobs", "layout");
    revalidatePath("/invoices", "layout");
    revalidatePath("/customers", "layout");
    revalidatePath("/estimates", "layout");
    revalidatePath("/accounts-posting");
    return { ok: true, message: r.words };
  } catch (e) {
    await logAppError("invoices/payment-correct", e, { staffId: staff.id });
    return { error: SAVE_FAILED };
  }
}
