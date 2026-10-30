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
    original = input.originalJobId || null;
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
