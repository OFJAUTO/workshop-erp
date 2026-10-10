"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { COMEBACK_CAUSES, COMEBACK_CAUSE_LABELS, isOurFault, type ComebackCause } from "@/lib/comebacks";
import { blankToNull } from "@/lib/format";
import { notifyRoles, notifyStaff } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

const back = (jobId: string, msg: string, ok = true) => redirect(`/jobs/${jobId}?${ok ? "message" : "error"}=${encodeURIComponent(msg)}#comeback`);

/** After the inspection the workshop manager (or the owner) says what caused the comeback. The owner is told. */
export async function setComebackCause(jobId: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  const cause = String(formData.get("cause") ?? "") as ComebackCause;
  if (!COMEBACK_CAUSES.includes(cause)) back(jobId, "Choose the cause.", false);
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, comeback_of, comeback_cause, comeback_confirmed_at").eq("id", jobId).maybeSingle();
  if (!job || !job.comeback_of) back(jobId, "This job is not a comeback.", false);
  if (job!.comeback_confirmed_at && staff.role_id !== "owner") back(jobId, "The owner has confirmed the cause; only the owner changes it now.", false);
  const now = new Date().toISOString();
  await admin.from("jobs").update({ comeback_cause: cause, comeback_cause_by: staff.id, comeback_cause_at: now, ...(isOurFault(cause) ? { priority: "high" } : {}) }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "comeback", note: `Comeback cause set by ${staff.display_name}: ${COMEBACK_CAUSE_LABELS[cause]}`, created_by: staff.id });
  if (staff.role_id !== "owner") await notifyRoles(["owner"], { type: "comeback", title: `Comeback cause: ${COMEBACK_CAUSE_LABELS[cause]} · ${job!.job_number}`, body: `${staff.display_name} set the cause. Confirm it and decide whether the repair is free of charge.`, jobId, href: `/jobs/${jobId}#comeback` });
  revalidatePath(`/jobs/${jobId}`);
  back(jobId, `Cause saved: ${COMEBACK_CAUSE_LABELS[cause]}.${staff.role_id === "owner" ? "" : " The owner confirms it."}`);
}

/** Only the owner confirms the cause and makes a job free of charge. */
export async function confirmComeback(jobId: string, formData: FormData) {
  const staff = await requirePermission("moveJobs");
  if (staff.role_id !== "owner") back(jobId, "Only the owner can make a job free of charge.", false);
  const free = String(formData.get("free") ?? "no") === "yes";
  const note = blankToNull(formData.get("note"));
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, comeback_of, comeback_cause, gated_in_by, status").eq("id", jobId).maybeSingle();
  if (!job || !job.comeback_of || !job.comeback_cause) back(jobId, "Set the cause first.", false);
  const now = new Date().toISOString();
  await admin.from("jobs").update({ comeback_confirmed_by: staff.id, comeback_confirmed_at: now, comeback_free: free, comeback_claim_status: job!.comeback_cause === "faulty_part" ? "to_claim" : "none" }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "comeback", note: `Comeback confirmed by ${staff.display_name}: ${COMEBACK_CAUSE_LABELS[job!.comeback_cause as ComebackCause]}, ${free ? "free of charge (warranty repair)" : "the customer pays"}${note ? ` · ${note}` : ""}`, created_by: staff.id });
  const { data: appr } = await admin.from("approval_requests").select("sent_by").eq("job_id", jobId);
  const advisors = Array.from(new Set([job!.gated_in_by, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
  await notifyStaff(advisors, { type: "comeback", title: `Comeback decided · ${job!.job_number}`, body: free ? "Free of charge: build the quotation as normal and send it; it is approved on sending without the customer." : "The customer pays: quote as normal.", jobId, href: `/jobs/${jobId}` });
  if (job!.comeback_cause === "faulty_part") await notifyRoles(["parts"], { type: "comeback", title: `Claim from the supplier · ${job!.job_number}`, body: "A part failed. Record the claim on the job card (supplier, LPO, amount).", jobId, href: `/jobs/${jobId}#comeback` });
  revalidatePath(`/jobs/${jobId}`);
  back(jobId, free ? "Confirmed: free of charge." : "Confirmed: the customer pays.");
}

/** Parts (or the owner) record the claim against the supplier for a failed part; paid claims reduce the loss. */
export async function claimFromSupplier(jobId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const status = String(formData.get("status") ?? "to_claim");
  if (!["to_claim", "claimed", "paid"].includes(status)) back(jobId, "Choose the claim status.", false);
  const amount = Number(String(formData.get("amount") ?? "").replace(/[^\d.]/g, ""));
  const admin = createAdminClient();
  await admin.from("jobs").update({ comeback_claim_status: status, comeback_claim_amount: Number.isFinite(amount) && amount > 0 ? amount : null, comeback_claim_po: blankToNull(formData.get("po")), comeback_claim_supplier: blankToNull(formData.get("supplier")) }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "comeback", note: `Supplier claim ${status.replace("_", " ")} by ${staff.display_name}${amount ? `: AED ${amount.toLocaleString("en-GB")}` : ""}`, created_by: staff.id });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/comebacks");
  back(jobId, "Claim saved.");
}
