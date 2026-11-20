"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { startLooseJob } from "@/lib/loose-start";
import { startQuotation } from "@/app/(app)/quotes/actions";

/** START THE JOB – LOOSE ITEMS (20 November 2026, Section 2): the job card at once, no gate-in, the estimate carried. */
export async function startLooseJobAction(estimateId: string, back: string) {
  const staff = await requireStaff();
  if (staff.viewingAs) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent("View as is read-only.")}`);
  const r = await startLooseJob(estimateId, staff);
  if (r.error || !r.jobId) {
    if (r.jobId) redirect(`/jobs/${r.jobId}?message=${encodeURIComponent(r.error ?? "")}`);
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(r.error ?? "Could not start the job.")}`);
  }
  revalidatePath("/dashboard");
  revalidatePath("/jobs");
  // The quotation starts from the estimate as at a gate-in (an exact copy of an approved estimate approves itself).
  if (staff.role_id === "owner" || staff.role_id === "service_advisor") await startQuotation(r.jobId);
  redirect(`/jobs/${r.jobId}?message=${encodeURIComponent(`${r.jobNumber} opened: LOOSE ITEMS – NO CAR.`)}`);
}
