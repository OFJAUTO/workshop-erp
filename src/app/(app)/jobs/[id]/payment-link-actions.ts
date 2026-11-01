"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { jobMoneyOf } from "@/lib/customer-money";
import { round2 } from "@/lib/money";
import { notifyRoles } from "@/lib/notifications";
import { ensurePaymentRequest, validateGatewayUrl } from "@/lib/pay-page";
import { paymentsAnytimeReady } from "@/lib/schema-ready";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

const SENDERS = ["owner", "service_advisor", "accounts"];
const aed = (n: number) => `AED ${round2(n).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

/**
 * The advisor's payment link for any amount (1 November 2026, 1.9): the full balance or a custom figure, deposit asked or
 * not. The message carries OUR /p/ payment page (never the gateway's address); a pasted Pay-now link from the bank's
 * portal opens from it. Advisors never record the money - accounts do when it arrives.
 */
export async function preparePaymentLink(jobId: string, amountIn: number, gatewayUrl?: string | null): Promise<{ error?: string; shortLink?: string; host?: string | null; amount?: number }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "Viewing only." };
  if (!SENDERS.includes(staff.role_id)) return { error: "The advisor or accounts send payment links." };
  if (!(await paymentsAnytimeReady())) return { error: "This needs the database update of 1 November. Ask the owner to apply it." };
  const amount = round2(Number(amountIn));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter the amount to ask for." };
  const settings = await getSettings();
  const m = await jobMoneyOf(jobId, settings);
  if (!m) return { error: "Job not found." };
  let host: string | null = null;
  let url: string | null | undefined = undefined;
  if (gatewayUrl !== undefined && gatewayUrl !== null) {
    const clean = String(gatewayUrl).trim();
    if (clean === "") url = null;
    else {
      const v = validateGatewayUrl(clean, settings);
      if (!v.ok) return { error: v.error };
      url = clean;
      host = v.host;
    }
  }
  const { shortLink } = await ensurePaymentRequest({ jobId, kind: "advance", amount, purpose: `Payment for your ${m.car || "car"} (${m.jobNumber})`, ...(url !== undefined ? { gatewayUrl: url } : {}), by: staff.id });
  return { shortLink, host, amount };
}

/** WhatsApp opened or the message copied: logged on the job, and accounts know to watch for the money. */
export async function markPaymentLinkSent(jobId: string, amountIn: number): Promise<{ ok?: boolean; error?: string }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "Viewing only." };
  if (!SENDERS.includes(staff.role_id)) return { error: "The advisor or accounts send payment links." };
  const amount = round2(Number(amountIn) || 0);
  const { data: job } = await createAdminClient().from("jobs").select("id, job_number").eq("id", jobId).maybeSingle();
  if (!job) return { error: "Job not found." };
  await createAdminClient().from("job_events").insert({ job_id: jobId, event_type: "payment_link", note: `Payment link for ${aed(amount)} sent by ${staff.display_name}`, created_by: staff.id });
  await notifyRoles(["accounts"], { type: "deposit_to_collect", title: `Payment link sent · ${job.job_number} · ${aed(amount)}`, body: `${staff.display_name} sent the customer a payment link for ${aed(amount)}. Record it when it arrives (Record payment on the job card).`, jobId, href: `/jobs/${jobId}` });
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
