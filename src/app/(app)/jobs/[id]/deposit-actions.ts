"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { depositState } from "@/lib/deposits";
import { notifyRoles } from "@/lib/notifications";
import { ensurePaymentRequest, validateGatewayUrl } from "@/lib/pay-page";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Makes (or updates) the job's /p/ payment page for the deposit and hands back OUR short link - the
 * only link that ever goes in the message (1.4). A pasted gateway link is validated against the
 * allowed pay-page domains and stored ON the page; the same /p/ link keeps working when it changes.
 */
export async function prepareDepositRequest(jobId: string, gatewayUrl?: string | null): Promise<{ error?: string; shortLink?: string; host?: string | null }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "Viewing only." };
  if (!(staff.role_id === "owner" || staff.role_id === "service_advisor" || staff.role_id === "accounts")) return { error: "The advisor sends the deposit request." };
  const dep = await depositState(jobId);
  if (!(dep.required > 0)) return { error: "No deposit is asked for on this job." };
  let host: string | null = null;
  let url: string | null | undefined = undefined;
  if (gatewayUrl !== undefined && gatewayUrl !== null) {
    const clean = String(gatewayUrl).trim();
    if (clean === "") url = null;
    else {
      const v = validateGatewayUrl(clean, await getSettings());
      if (!v.ok) return { error: v.error };
      url = clean;
      host = v.host;
    }
  }
  const { shortLink } = await ensurePaymentRequest({ jobId, kind: "deposit", amount: Math.max(0, dep.required - dep.received), quotationId: dep.quotationId, purpose: `Advance payment to order the parts (${dep.quotationNumbers.join(", ")})`, ...(url !== undefined ? { gatewayUrl: url } : {}), by: staff.id });
  return { shortLink, host };
}

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
