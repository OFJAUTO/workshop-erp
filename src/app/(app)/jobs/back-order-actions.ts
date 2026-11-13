"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { formValues, type FormState } from "@/lib/form-state";
import { requestBackOrder } from "@/lib/back-orders";

/** "Back order - fit on a later visit" from the Work complete box or the job card (13 November 2026, J-00317). */
export async function backOrderAction(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const values = formValues(formData);
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to put a part on back order.", values };
  const payMode = formData.get("pay_mode") === "when_fitted" ? "when_fitted" : "now";
  const r = await requestBackOrder(jobId, {
    partId: String(formData.get("part_id") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    labourLineId: String(formData.get("labour_line_id") ?? "") || null,
    hoursLater: Number(String(formData.get("hours_later") ?? "0").replace(",", ".")) || 0,
    payMode,
  }, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  if (r.error) return { error: r.error, values };
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/work`);
  if (r.followJobId) revalidatePath(`/jobs/${r.followJobId}`);
  return { success: r.words ?? "Done." };
}
