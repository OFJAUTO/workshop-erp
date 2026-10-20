"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { depositState } from "@/lib/deposits";
import { notifyRoles } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The advisor pressed Send on the deposit request (WhatsApp or copy): stamped on the job, so the step
 * bar moves from "send the request" to "waiting for the deposit" and accounts know to watch for it.
 * Only accounts or the owner record the money itself.
 */
export async function markDepositRequested(jobId: string): Promise<{ ok?: boolean; error?: string }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "Viewing only." };
  if (!(staff.role_id === "owner" || staff.role_id === "service_advisor" || staff.role_id === "accounts")) return { error: "The advisor sends the deposit request." };
  const admin = createAdminClient();
  const dep = await depositState(jobId);
  if (!(dep.required > 0)) return { error: "No deposit is asked for on this job." };
  const { data: job } = await admin.from("jobs").select("id, job_number, deposit_requested_at").eq("id", jobId).maybeSingle();
  if (!job) return { error: "Job not found." };
  const now = new Date().toISOString();
  if (!job.deposit_requested_at) await admin.from("jobs").update({ deposit_requested_at: now, deposit_requested_by: staff.id, updated_by: staff.id }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "deposit_requested", note: `Deposit request (AED ${Math.max(0, dep.required - dep.received).toLocaleString("en-GB")}) sent by ${staff.display_name}`, created_by: staff.id });
  if (!job.deposit_requested_at) await notifyRoles(["accounts"], { type: "deposit_to_collect", title: `Deposit request sent · ${job.job_number}`, body: `AED ${Math.max(0, dep.required - dep.received).toLocaleString("en-GB")} asked from the customer. Record it on the money page when it arrives (quotation ${dep.quotationNumbers.join(", ")}).`, jobId, href: `/jobs/${jobId}/invoice` });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
