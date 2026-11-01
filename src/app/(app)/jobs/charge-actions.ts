"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import type { ChargeInput } from "@/lib/charge-rules";
import { addCharges, chargesReady } from "@/lib/charges";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

const MAY_ADD = ["owner", "service_advisor", "accounts"];

function back(jobId: string, words: { message?: string; error?: string }): never {
  revalidatePath(`/jobs/${jobId}`);
  const q = words.error ? `error=${encodeURIComponent(words.error)}` : `message=${encodeURIComponent(words.message ?? "")}`;
  redirect(`/jobs/${jobId}?${q}#charges`);
}

/** The lines of a charge form ("lines", JSON from ChargeLinesEditor). */
function linesOf(formData: FormData): ChargeInput[] | null {
  try {
    const raw = JSON.parse(String(formData.get("lines") ?? "[]")) as ChargeInput[];
    return Array.isArray(raw) ? raw.map((l) => ({ ...l, description: String(l.description ?? "") })) : null;
  } catch {
    return null;
  }
}

/**
 * Early charges on a car (1 November 2026, B2): recovery, fuel and other costs/charges, before or after the check-in
 * approval, by the owner, an advisor or accounts. Before the approval they are listed on the vehicle check-in; after
 * it they go into the quotation for the customer's approval.
 */
export async function addJobChargesAction(jobId: string, formData: FormData) {
  const staff = await requireStaff();
  if (!MAY_ADD.includes(staff.role_id) || staff.viewingAs) return back(jobId, { error: "Only the owner, an advisor or accounts add charges." });
  if (!(await chargesReady())) return back(jobId, { error: "Charges need the database update first (waiting for apply)." });
  const lines = linesOf(formData);
  if (!lines) return back(jobId, { error: "Couldn't read the charges. Try again." });
  const { data: job } = await createAdminClient().from("jobs").select("first_approval_at, is_open").eq("id", jobId).maybeSingle();
  if (!job?.is_open) return back(jobId, { error: "This job is closed." });
  const r = await addCharges({ jobId }, lines, staff, await getSettings());
  if (r.error) return back(jobId, { error: r.error });
  const n = r.ids?.length ?? 0;
  const what = `${n} charge${n === 1 ? "" : "s"} added ✓`;
  if (!job.first_approval_at) return back(jobId, { message: `${what} — listed on the vehicle check-in with VAT; the customer agrees to them with the approval.` });
  return back(jobId, { message: r.quotation ? `${what} — added to ${r.quotation} for the customer's approval.` : `${what} — the quotation is approved: the owner is asked to allow a revised quotation for it.` });
}

/** The owner approves or refuses a charge asked for free of charge (the complimentary rule). */
export async function decideFreeChargeAction(jobId: string, lineId: string, formData: FormData) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner" || staff.viewingAs) return back(jobId, { error: "Only the owner approves a free charge." });
  const ok = formData.get("decision") === "approve";
  await createAdminClient().from("charge_lines").update({ free_status: ok ? "approved" : "refused", updated_by: staff.id }).eq("id", lineId).eq("free_status", "pending_owner");
  return back(jobId, { message: ok ? "Free charge approved ✓" : "Refused: change it to a charged line or remove it." });
}
