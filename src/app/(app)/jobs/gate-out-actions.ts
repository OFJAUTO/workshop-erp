"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { formValues, type FormState } from "@/lib/form-state";
import { jobBalance } from "@/lib/invoice-data";
import { dubaiDate } from "@/lib/jobs";
import { notifyRoles, notifyStaff } from "@/lib/notifications";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/gate-out`);
  revalidatePath("/dashboard");
  revalidatePath("/jobs");
  revalidatePath("/calendar");
}

async function advisorIds(jobId: string, gatedInBy: string | null) {
  const { data: appr } = await createAdminClient().from("approval_requests").select("sent_by").eq("job_id", jobId);
  return Array.from(new Set([gatedInBy, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
}

async function closeJob(jobId: string, by: string, byName: string, how: string) {
  const admin = createAdminClient();
  const settings = await getSettings();
  const followDays = Number(settings.followup_days) || 3;
  const due = new Date(Date.now() + followDays * 86400000);
  const { data: job } = await admin.from("jobs").select("status, gated_in_by").eq("id", jobId).maybeSingle();
  await admin.from("jobs").update({ status: "closed", stage: "ready", is_open: false, gated_out_at: new Date().toISOString(), gated_out_by: by, followup_due_at: dubaiDate(due) }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "gate_out", from_status: job?.status ?? null, to_status: "closed", note: `Gated out by ${byName}: ${how}`, created_by: by });
  await admin.from("appointments").update({ status: "done", updated_by: by }).eq("job_id", jobId).eq("kind", "customer_collects").eq("status", "booked");
}

/**
 * Gate-out: how the car leaves, the checks before release (balance, keys, dash cam, old parts),
 * the handover. Customer collections close the job; a delivery stamps "Left workshop" and closes
 * on "Delivered".
 */
export async function gateOutJob(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("gateOut");
  const role = staff.role_id as RoleId;
  const values = formValues(formData);
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, status, is_open, job_number, gated_in_by, customer_id").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return { error: "This job is already closed.", values };
  if (job.status === "in_delivery") return { error: "The car has left for delivery. Mark it delivered instead.", values };
  // Gate-out comes after QC, the wash and the invoice. Only the owner may go through earlier, and it is written down.
  if (!["ready", "pending_payment"].includes(job.status)) {
    if (role !== "owner") return { error: "This car is not ready to leave yet: QC, the wash and the invoice come first.", values };
    await admin.from("job_events").insert({ job_id: jobId, event_type: "override", from_status: job.status, note: `Gate-out by ${staff.display_name} while the car was still at "${job.status.replace(/_/g, " ")}" (owner override)`, created_by: staff.id });
  }
  const { data: gi } = await admin.from("gate_ins").select("keys_count, keys_keychain, dash_cam, old_parts_return").eq("job_id", jobId).maybeSingle();
  if (!gi) return { error: "No gate-in record found.", values };
  const method = String(formData.get("leave_method") ?? "");
  if (!["customer", "customer_driver", "recovery"].includes(method)) return { error: "Choose how the car leaves.", values };
  const collector = blankToNull(formData.get("collector_name"));
  if (method !== "recovery" && !collector) return { error: "Enter the name of the person collecting the car.", values };
  if (method !== "recovery" && formData.get("handover_confirmed") !== "on") return { error: "Tick that the handover is confirmed with the collecting person.", values };

  // Keys
  const keysReturned = String(formData.get("keys_returned") ?? "");
  const keychain = formData.get("keychain_returned") === "yes";
  if (!/^\d{1,2}$/.test(keysReturned)) return { error: "Enter the number of keys handed back.", values };
  const keysMatch = Number(keysReturned) === gi.keys_count && keychain === gi.keys_keychain;
  let overrideBy: string | null = null;
  const overrideReason = String(formData.get("override_reason") ?? "").trim();
  if (!keysMatch) {
    if (!can(role, "overrideKeys")) return { error: "Keys do not match the gate-in record. Only the owner or workshop manager can override, with a reason.", values };
    if (overrideReason.length < 5) return { error: "Keys do not match. Write the reason for the override.", values };
    overrideBy = staff.id;
  }
  const dashCam = gi.dash_cam ? formData.get("dash_cam_reconnected") === "on" : null;
  if (gi.dash_cam && !dashCam) return { error: "Tick that the dash cam has been reconnected.", values };
  const oldParts = gi.old_parts_return ? formData.get("old_parts_handed") === "on" : null;
  if (gi.old_parts_return && !oldParts) return { error: "Tick that the old parts were handed over; the customer asked for them.", values };

  // Balance
  const bal = await jobBalance(jobId);
  let releaseBy: string | null = null;
  const releaseReason = String(formData.get("release_reason") ?? "").trim();
  if (bal.state === "no_invoice") {
    if (!can(role, "approveRelease")) return { error: "No invoice has been issued for this job. Accounts must issue it before the car leaves.", values };
    if (releaseReason.length < 5) return { error: "No invoice issued yet. Write the reason to release without one (logged).", values };
    releaseBy = staff.id;
  } else if (bal.balance > 0) {
    if (!can(role, "approveRelease")) return { error: `Balance due AED ${bal.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })}. Only the owner or accounts can approve the release.`, values };
    if (releaseReason.length < 5) return { error: "Write the reason for releasing with a balance due (logged).", values };
    releaseBy = staff.id;
  }

  const delivery = method === "recovery"
    ? {
        delivery_address: blankToNull(formData.get("delivery_address")),
        delivery_at: blankToNull(formData.get("delivery_at")) ? new Date(String(formData.get("delivery_at"))).toISOString() : null,
        delivery_by: String(formData.get("delivery_by") ?? "our_truck") === "outside" ? "outside" : "our_truck",
        delivery_company: blankToNull(formData.get("delivery_company")),
        delivery_fee_aed: Number(String(formData.get("delivery_fee") ?? "").replace(/[^\d.]/g, "")) || null,
        left_at: new Date().toISOString(),
        left_by: staff.id,
      }
    : {};
  if (method === "recovery" && !delivery.delivery_address) return { error: "Enter the delivery address.", values };

  const { error } = await admin.from("gate_outs").upsert(
    {
      job_id: jobId,
      leave_method: method,
      collector_name: collector,
      handover_confirmed: method !== "recovery",
      keys_returned: Number(keysReturned),
      keychain_returned: keychain,
      keys_match: keysMatch,
      keys_override_by: overrideBy,
      keys_override_reason: overrideBy ? overrideReason : null,
      dash_cam_reconnected: dashCam,
      old_parts_handed: oldParts,
      balance_due_aed: bal.balance,
      release_approved_by: releaseBy,
      release_reason: releaseBy ? releaseReason : null,
      notes: blankToNull(formData.get("notes")),
      ...delivery,
      created_by: staff.id,
      updated_by: staff.id,
    },
    { onConflict: "job_id" },
  );
  if (error) return { error: error.message, values };
  if (releaseBy) await admin.from("job_events").insert({ job_id: jobId, event_type: "override", note: `Release approved by ${staff.display_name} with ${bal.state === "no_invoice" ? "no invoice" : `AED ${bal.balance.toLocaleString("en-GB")} due`}: ${releaseReason}`, created_by: staff.id });
  if (overrideBy) await admin.from("job_events").insert({ job_id: jobId, event_type: "override", note: `Keys override by ${staff.display_name}: ${overrideReason}`, created_by: staff.id });

  if (method === "recovery") {
    await admin.from("jobs").update({ status: "in_delivery", stage: "ready" }).eq("id", jobId);
    await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: job.status, to_status: "in_delivery", note: `Left the workshop for delivery (${delivery.delivery_by === "outside" ? delivery.delivery_company ?? "outside recovery" : "our truck"}) to ${delivery.delivery_address}, stamped by ${staff.display_name}`, created_by: staff.id });
    const ids = await advisorIds(jobId, job.gated_in_by);
    await notifyStaff(ids, { type: "delivery", title: `Left workshop for delivery · ${job.job_number}`, body: `To ${delivery.delivery_address}. Mark it delivered with the name and a photo at the door.`, jobId, href: `/jobs/${jobId}/gate-out` });
    refresh(jobId);
    redirect(`/jobs/${jobId}/gate-out?message=${encodeURIComponent("Stamped: left the workshop. Mark it delivered when the customer has it.")}`);
  }
  await closeJob(jobId, staff.id, staff.display_name, `${method === "customer" ? "customer collected" : "customer's driver collected"} (${collector})`);
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent("Gated out. The job is closed.")}`);
}

/** The delivered stamp: name, time and photo at the door. The job closes. */
export async function markDelivered(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("gateOut");
  const values = formValues(formData);
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, status, is_open, job_number, gated_in_by").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open || job.status !== "in_delivery") return { error: "This car is not out for delivery.", values };
  const to = blankToNull(formData.get("delivered_to"));
  if (!to) return { error: "Enter the name of the person who received the car.", values };
  if (formData.get("handover_confirmed") !== "on") return { error: "Tick that the handover is confirmed.", values };
  await admin.from("gate_outs").update({ delivered_at: new Date().toISOString(), delivered_by: staff.id, delivered_to: to, collector_name: to, handover_confirmed: true, updated_by: staff.id }).eq("job_id", jobId);
  await closeJob(jobId, staff.id, staff.display_name, `delivered to ${to}`);
  const ids = await advisorIds(jobId, job.gated_in_by);
  await notifyStaff(ids, { type: "delivery", title: `Delivered · ${job.job_number}`, body: `Received by ${to}. The job is closed.`, jobId, href: `/jobs/${jobId}` });
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent("Delivered. The job is closed.")}`);
}

/** The advisor records the follow-up call. */
export async function followUpDone(jobId: string) {
  const staff = await requirePermission("sendApproval");
  const admin = createAdminClient();
  await admin.from("jobs").update({ followup_done_at: new Date().toISOString() }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "followup", note: `Follow-up done by ${staff.display_name}`, created_by: staff.id });
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent("Follow-up recorded.")}`);
}

/** Tells the owner that a release needs approval (balance due or no invoice). */
export async function askReleaseApproval(jobId: string) {
  const staff = await requirePermission("gateOut");
  const bal = await jobBalance(jobId);
  const { data: job } = await createAdminClient().from("jobs").select("job_number").eq("id", jobId).maybeSingle();
  await notifyRoles(["owner", "accounts"], { type: "release_approval", title: `Release approval needed · ${job?.job_number ?? ""}`, body: bal.state === "no_invoice" ? `${staff.display_name} wants to release the car with no invoice issued.` : `${staff.display_name} wants to release the car with AED ${bal.balance.toLocaleString("en-GB")} due.`, jobId, href: `/jobs/${jobId}/gate-out` });
  redirect(`/jobs/${jobId}/gate-out?message=${encodeURIComponent("The owner and accounts have been asked to approve the release.")}`);
}
