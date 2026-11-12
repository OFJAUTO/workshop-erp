"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { logAppError, SAVE_FAILED } from "@/lib/app-errors";
import { changePreview, linkReplacement, requestPartChange, type ChangeAnswer, type ChangeInput } from "@/lib/part-change";

/** 13 November 2026, Section 3: what the window shows before saving (the customer's price each, the part now). */
export async function partChangePreviewAction(jobId: string, partId: string) {
  const staff = await requireStaff();
  if (!["owner", "parts"].includes(staff.role_id)) return null;
  const p = await changePreview(jobId, partId);
  return p ? { ...p, isOwner: staff.role_id === "owner" } : null;
}

/** THE change of a part's supplier, cost, delivery time or part number, in place. */
export async function changePartAction(jobId: string, partId: string, input: ChangeInput): Promise<ChangeAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to change it." };
  try {
    const r = await requestPartChange(jobId, partId, input, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
    if (r.ok) {
      revalidatePath(`/parts/${jobId}`);
      revalidatePath(`/jobs/${jobId}`);
    }
    return r;
  } catch (e) {
    await logAppError("parts/part-change-actions", e, { staffId: staff.id, jobId });
    return { error: SAVE_FAILED };
  }
}

/** The repair: "This replaces…" links a part added again to the removed one it replaced. */
export async function linkReplacementAction(jobId: string, newId: string, oldId: string): Promise<ChangeAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to change it." };
  try {
    const r = await linkReplacement(jobId, newId, oldId, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
    if (r.ok) {
      revalidatePath(`/parts/${jobId}`);
      revalidatePath(`/jobs/${jobId}`);
    }
    return r;
  } catch (e) {
    await logAppError("parts/part-change-actions: link", e, { staffId: staff.id, jobId });
    return { error: SAVE_FAILED };
  }
}
