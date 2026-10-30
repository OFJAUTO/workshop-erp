import "server-only";
import { checkFee, feeWords, type FeeBounds, type FeeInput } from "./inspection-fee";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";

/** The VAT on the inspection fee (the UAE rate). */
export const FEE_VAT_PERCENT = 5;

/** The range an advisor may set, the suggestion for this car's make (premium brands higher), and the VAT. */
export function feeBoundsFor(settings: Settings, makeName: string | null | undefined): FeeBounds {
  const make = (makeName ?? "").toLowerCase();
  const premium = ((settings.premium_brands ?? []) as string[]).some((b) => make && b.toLowerCase() === make);
  return {
    min: Number(settings.inspection_fee_min_aed) || 500,
    max: Number(settings.inspection_fee_max_aed) || 2500,
    suggested: premium ? Number(settings.premium_brand_fee_aed) || 1500 : Number(settings.inspection_fee_aed) || 750,
    vatPercent: FEE_VAT_PERCENT,
  };
}

/** The job's choice as the screens start from it (a job from before 30 October counts as Inspection fee with its amount). */
export function feeInputOf(job: { inspection_fee_choice?: string | null; inspection_fee_aed?: number | string | null; no_fee_reason?: string | null; no_fee_note?: string | null; inspection_type?: string | null }): FeeInput {
  const choice = job.inspection_fee_choice === "fee" || job.inspection_fee_choice === "none" ? job.inspection_fee_choice : null;
  const amount = job.inspection_fee_aed === null || job.inspection_fee_aed === undefined ? null : Number(job.inspection_fee_aed);
  return { choice, amount: choice === "none" ? null : amount, reason: job.no_fee_reason ?? null, note: job.no_fee_note ?? null, type: job.inspection_type === "quick" ? "quick" : "full" };
}

/**
 * Saves a job's fee choice (the approval link, the gate-in, the owner's change). Checked by the one rule (checkFee).
 * Once the customer approved the job card it is locked: only the owner changes it, with a reason, written down.
 */
export async function saveFeeChoice(jobId: string, input: FeeInput, actor: { id: string; role_id: string; display_name: string }, settings: Settings, opts: { ownerReason?: string | null } = {}): Promise<{ error: string } | { ok: true; changed: boolean }> {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, first_approval_at, inspection_fee_choice, inspection_fee_aed, no_fee_reason, no_fee_note, inspection_type, vehicle:vehicles(make:vehicle_makes(name))").eq("id", jobId).maybeSingle();
  if (!job) return { error: "Job not found." };
  const isOwner = actor.role_id === "owner";
  const makeName = (job.vehicle as unknown as { make: { name: string } | null } | null)?.make?.name ?? null;
  const check = checkFee(input, feeBoundsFor(settings, makeName), isOwner);
  if ("error" in check) return check;
  const before = feeWords(job);
  const after = feeWords({ inspection_fee_choice: input.choice, inspection_fee_aed: input.choice === "fee" ? input.amount : 0, no_fee_reason: input.reason, inspection_type: input.type });
  const same = job.inspection_fee_choice === input.choice && before === after && (job.no_fee_note ?? null) === (input.choice === "none" ? input.note : null);
  if (same) return { ok: true, changed: false };
  if (job.first_approval_at) {
    if (!isOwner) return { error: "The inspection fee is locked: the customer already approved the job card with it. Only the owner can change it." };
    if ((opts.ownerReason ?? "").trim().length < 5) return { error: "The customer approved the job card with the old fee: write the reason for the change (it is logged)." };
  }
  const now = new Date().toISOString();
  const { error } = await admin
    .from("jobs")
    .update({
      inspection_fee_choice: input.choice,
      inspection_fee_aed: input.choice === "fee" ? input.amount : 0,
      no_fee_reason: input.choice === "none" ? input.reason : null,
      no_fee_note: input.choice === "none" ? input.note : null,
      inspection_type: input.choice === "none" ? input.type : "full",
      fee_set_by: actor.id,
      fee_set_at: now,
      inspection_fee_request_aed: null,
      inspection_fee_request_by: null,
      updated_by: actor.id,
    })
    .eq("id", jobId);
  if (error) return { error: error.message };
  const outside = "outside" in check && check.outside ? " (outside the usual range: the owner's decision)" : "";
  const why = job.first_approval_at ? ` after the customer's approval. Reason: ${String(opts.ownerReason).trim()}` : "";
  await admin.from("job_events").insert({ job_id: jobId, event_type: "inspection_fee", note: `${actor.display_name}: ${job.inspection_fee_choice ? `${before} → ` : ""}${after}${input.choice === "none" && input.note ? ` (${input.note})` : ""}${outside}${why}`, created_by: actor.id });
  return { ok: true, changed: true };
}
