"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { logAppError, SAVE_FAILED } from "@/lib/app-errors";
import { getSettings } from "@/lib/settings";
import { generateFinalTaxInvoice } from "@/lib/final-invoice";

export type FinalState = { ok?: boolean; error?: string; message?: string; number?: string } | null;

/** "Generate the final tax invoice" (21 November 2026, J-01013): accounts and the owner, once the job is done. */
export async function generateFinalTaxInvoiceAction(jobId: string, _prev: FinalState, _formData: FormData): Promise<FinalState> {
  void _prev;
  void _formData;
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to generate it." };
  try {
    const r = await generateFinalTaxInvoice(jobId, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id }, await getSettings());
    if ("error" in r) return { error: r.error };
    revalidatePath(`/jobs/${jobId}`, "layout");
    revalidatePath("/invoices", "layout");
    return { ok: true, message: r.words, number: r.number };
  } catch (e) {
    await logAppError("invoices/final-invoice", e, { staffId: staff.id, jobId });
    return { error: SAVE_FAILED };
  }
}
