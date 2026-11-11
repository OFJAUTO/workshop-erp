"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { SAVE_FAILED } from "@/lib/app-errors";
import { isCompReason, needsOriginalJob } from "@/lib/complimentary";
import { logQuoteEvent } from "@/lib/quote-data";
import { refuseIfLocked } from "@/lib/quote-lock-server";
import { can, type RoleId } from "@/lib/roles";
import { compReady } from "@/lib/schema-ready";
import { createAdminClient } from "@/lib/supabase/admin";
import { LINE_TEXT_MAX, tooLongWords } from "@/lib/text-limits";

/**
 * Why the free part of a quotation is free (section 5.1, 30 October 2026): our mistake or warranty with the original job,
 * or goodwill with a note. Changing it after the owner decided puts the decision back to "waiting" - the owner approves
 * what he saw, never a different reason.
 */
export async function saveCompReason(quotationId: string, input: { reason: string; originalJobId?: string | null; note?: string | null }): Promise<{ error?: string }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "Not allowed." };
  const role = staff.role_id as RoleId;
  if (role !== "owner" && !can(role, "editQuotes")) return { error: "Only the advisors and the owner set this." };
  if (!(await compReady())) return { error: "This needs a database update first (tell the owner)." };
  if (!isCompReason(input.reason)) return { error: "Pick the reason: our mistake, goodwill or warranty." };
  const note = (input.note ?? "").replace(/\s+/g, " ").trim();
  if (note.length > LINE_TEXT_MAX) return { error: tooLongWords(note.length) };
  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select("id, job_id, number, version, status, customer_id, vehicle_id, comp_reason, comp_original_job_id, comp_note").eq("id", quotationId).maybeSingle();
  if (!q) return { error: "Quotation not found." };
  if (q.status !== "draft" && q.status !== "pending_owner") return { error: (await refuseIfLocked(q.id, staff.id, "change the complimentary reason", "quotation page")) ?? "This version has been sent: revise it to change it." };
  let original: string | null = null;
  if (needsOriginalJob(input.reason)) {
    // Nobody types a job number (11 November 2026, Section 7): our mistake = the comeback's original job; warranty = this
    // car's earlier job of the last 6 months (else the customer's). The box shows it; another of the earlier jobs can be picked.
    original = input.originalJobId || (await earlierJobFor(q.job_id as string | null, q.vehicle_id as string | null, q.customer_id as string | null, input.reason as "our_mistake" | "warranty"));
    if (original) {
      const { data: j } = await admin.from("jobs").select("id, customer_id, vehicle_id").eq("id", original).maybeSingle();
      if (!j || j.id === q.job_id || (j.customer_id !== q.customer_id && j.vehicle_id !== q.vehicle_id)) return { error: "Pick one of this customer's or this car's earlier jobs." };
    }
  }
  const same = q.comp_reason === input.reason && (q.comp_original_job_id ?? null) === original && (q.comp_note ?? "") === note;
  if (same) return {};
  const { error } = await admin.from("quotations").update({ comp_reason: input.reason, comp_original_job_id: original, comp_note: note || null, comp_status: null, comp_decided_by: null, comp_decided_at: null, comp_decision_note: null, updated_by: staff.id }).eq("id", q.id);
  if (error) return { error: SAVE_FAILED };
  await logQuoteEvent(q.id, q.job_id, staff.id, "comp_reason", `${q.number} v${q.version}: complimentary reason set by ${staff.display_name}: ${input.reason.replace("_", " ")}${note ? ` (${note})` : ""}`);
  if (q.job_id) {
    revalidatePath(`/jobs/${q.job_id}`);
    revalidatePath(`/jobs/${q.job_id}/quote/${q.id}`);
  }
  revalidatePath(`/estimates/${q.id}`);
  return {};
}

/** The job this free work goes back to: a comeback's original job, else the car's latest earlier job (warranty: last 6 months). */
async function earlierJobFor(jobId: string | null, vehicleId: string | null, customerId: string | null, reason: "our_mistake" | "warranty"): Promise<string | null> {
  const admin = createAdminClient();
  if (jobId) {
    const { data: j } = await admin.from("jobs").select("comeback_of").eq("id", jobId).maybeSingle();
    if (j?.comeback_of) return j.comeback_of as string;
  }
  const since = reason === "warranty" ? new Date(Date.now() - 183 * 86400000).toISOString() : null;
  for (const [col, val] of [["vehicle_id", vehicleId], ["customer_id", customerId]] as const) {
    if (!val) continue;
    let q = admin.from("jobs").select("id").eq(col, val).not("gated_in_at", "is", null).order("gated_in_at", { ascending: false }).limit(5);
    if (since) q = q.gte("gated_in_at", since);
    const { data } = await q;
    const hit = ((data ?? []) as { id: string }[]).find((x) => x.id !== jobId);
    if (hit) return hit.id;
  }
  return null;
}
