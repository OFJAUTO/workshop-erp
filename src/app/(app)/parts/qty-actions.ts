"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { changeApprovedQuantity, type QtyAnswer } from "@/lib/qty-after-approval";
import { keepPriceAfterApproval, reduceAfterApproval } from "@/lib/qty-reduce";
import { logAppError, SAVE_FAILED } from "@/lib/app-errors";

/** Section 1 of 9 November 2026: the parts desk or the owner changes an approved part's quantity (THE window on the Parts table). */
export async function changeQuantityAction(jobId: string, partId: string, input: { qty: number; reason: string; note?: string | null; extras?: "stock" | "return" | null }): Promise<QtyAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to change it." };
  try {
    const r = await changeApprovedQuantity(jobId, partId, input, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
    if (r.ok) {
      revalidatePath(`/parts/${jobId}`);
      revalidatePath(`/jobs/${jobId}`);
      revalidatePath(`/jobs/${jobId}/quote`, "layout");
    }
    return r;
  } catch (e) {
    await logAppError("parts/qty-actions", e, { staffId: staff.id, jobId });
    return { error: SAVE_FAILED };
  }
}

export async function reduceAfterApprovalAction(jobId: string, quotationId: string) {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to change it." };
  try {
    const r = await reduceAfterApproval(quotationId, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
    if (r.ok) {
      revalidatePath(`/jobs/${jobId}`);
      revalidatePath(`/jobs/${jobId}/quote`, "layout");
      revalidatePath(`/jobs/${jobId}/invoice`);
    }
    return r;
  } catch (e) {
    await logAppError("parts/qty-actions: reduce", e, { staffId: staff.id, jobId });
    return { error: SAVE_FAILED };
  }
}

export async function keepPriceAction(jobId: string, quotationId: string, reason: string) {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to change it." };
  try {
    const r = await keepPriceAfterApproval(quotationId, reason, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
    if (r.ok) revalidatePath(`/jobs/${jobId}/quote`, "layout");
    return r;
  } catch (e) {
    await logAppError("parts/qty-actions: keep", e, { staffId: staff.id, jobId });
    return { error: SAVE_FAILED };
  }
}
