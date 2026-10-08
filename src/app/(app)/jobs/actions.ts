"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission, requireStaff } from "@/lib/auth";
import { blankToNull, normalisePhone } from "@/lib/format";
import { MANUAL_STATUS_OPTIONS, STATUS_STAGE, dubaiDate, type JobStatus, feeNotice } from "@/lib/jobs";
import { ensureInspection } from "@/lib/inspection-data";
import { loadGateInFlags, loadMedia, mediaChecklist, newToken } from "@/lib/media";
import { notifyRoles, notifyStaff } from "@/lib/notifications";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { getSiteUrl } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  revalidatePath("/my-jobs");
}

async function logEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  by: string,
  event: { event_type: string; from_status?: string | null; to_status?: string | null; from_staff?: string | null; to_staff?: string | null; note?: string | null },
) {
  await supabase.from("job_events").insert({
    job_id: jobId,
    event_type: event.event_type,
    from_status: event.from_status ?? null,
    to_status: event.to_status ?? null,
    from_stage: event.from_status ? STATUS_STAGE[event.from_status as JobStatus] : null,
    to_stage: event.to_status ? STATUS_STAGE[event.to_status as JobStatus] : null,
    from_staff: event.from_staff ?? null,
    to_staff: event.to_staff ?? null,
    note: event.note ?? null,
    created_by: by,
  });
}

/** Workshop manager hands the car to a technician. Blocked until the gate-in media is complete. */
export async function assignJob(jobId: string, formData: FormData) {
  const staff = await requirePermission("assignJobs");
  const technicianId = String(formData.get("technician") ?? "");
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("id, status, assigned_to, is_open, first_approval_at").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) redirect(`/jobs/${jobId}?error=` + encodeURIComponent("This job is closed."));

  const check = mediaChecklist(await loadMedia(jobId), await loadGateInFlags(jobId));
  if (!check.complete) redirect(`/jobs/${jobId}?error=` + encodeURIComponent("The gate-in videos and photos must all be uploaded before the car can be assigned."));
  if (!job.first_approval_at && staff.role_id !== "owner") redirect(`/jobs/${jobId}?error=` + encodeURIComponent("The customer has not approved the job card yet. No inspection before that."));

  const { data: tech } = await supabase.from("staff").select("id, display_name, role_id, is_active").eq("id", technicianId).maybeSingle();
  if (!tech || !tech.is_active) redirect(`/jobs/${jobId}?error=` + encodeURIComponent("Choose a technician."));

  const toStatus: JobStatus = job.status === "gate_in_pending" || job.status === "pending_approval" ? "pending_inspection" : (job.status as JobStatus);
  const { error } = await supabase
    .from("jobs")
    .update({ assigned_to: tech.id, assigned_at: new Date().toISOString(), status: toStatus, stage: STATUS_STAGE[toStatus] })
    .eq("id", jobId);
  if (error) redirect(`/jobs/${jobId}?error=` + encodeURIComponent(error.message));

  await logEvent(supabase, jobId, staff.id, {
    event_type: "assigned",
    from_status: job.status,
    to_status: toStatus,
    from_staff: job.assigned_to,
    to_staff: tech.id,
    note: `Assigned to ${tech.display_name}`,
  });
  const { data: jobRow } = await supabase.from("jobs").select("job_number, department").eq("id", jobId).maybeSingle();
  if (jobRow?.department !== "bodyshop") {
    const settings = await getSettings();
    await ensureInspection(jobId, tech.id, settings.inspection_checklist, Number(settings.inspection_target_minutes) || 90, staff.id);
    const { data: existingRoad } = await createAdminClient().from("road_tests").select("id").eq("job_id", jobId).maybeSingle();
    if (!existingRoad) {
      await createAdminClient().from("road_tests").insert({ job_id: jobId, created_by: staff.id, updated_by: staff.id });
      await notifyRoles(["qc_inspector"], { type: "road_test_assigned", title: `Road test needed · ${jobRow?.job_number ?? ""}`, body: `Assigned to ${tech.display_name} by ${staff.display_name}. Do it before, during or after the inspection.`, jobId, href: `/road-tests/${jobId}` });
    }
  }
  await notifyStaff([tech.id], { type: "job_assigned", title: `New car for you · ${jobRow?.job_number ?? ""}`, body: `Assigned by ${staff.display_name}. Open it on the tablet and start the inspection.`, jobId, href: `/my-jobs/${jobId}` });
  refresh(jobId);
  revalidatePath("/assign");
  const back = String(formData.get("back") ?? "") === "/assign" ? "/assign" : `/jobs/${jobId}`;
  redirect(`${back}?message=` + encodeURIComponent(`Assigned to ${tech.display_name}.`));
}

/** Manual stage move for the owner and workshop manager until later phases automate it. */
export async function moveJob(jobId: string, formData: FormData) {
  const staff = await requirePermission("moveJobs");
  const toStatus = String(formData.get("status") ?? "") as JobStatus;
  if (!MANUAL_STATUS_OPTIONS.includes(toStatus)) redirect(`/jobs/${jobId}?error=` + encodeURIComponent("Choose a step."));
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("id, status, is_open").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) redirect(`/jobs/${jobId}?error=` + encodeURIComponent("This job is closed."));
  if (job.status === "gate_in_pending") redirect(`/jobs/${jobId}?error=` + encodeURIComponent("Finish the gate-in media first."));

  const { error } = await supabase.from("jobs").update({ status: toStatus, stage: STATUS_STAGE[toStatus] }).eq("id", jobId);
  if (error) redirect(`/jobs/${jobId}?error=` + encodeURIComponent(error.message));
  await logEvent(supabase, jobId, staff.id, { event_type: "status_change", from_status: job.status, to_status: toStatus });
  refresh(jobId);
  redirect(`/jobs/${jobId}`);
}

export async function setJobPriority(jobId: string, formData: FormData) {
  const staff = await requirePermission("setPriority");
  const priority = String(formData.get("priority") ?? "");
  if (!["high", "normal", "low"].includes(priority)) redirect(`/jobs/${jobId}`);
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("priority").eq("id", jobId).maybeSingle();
  if (!job || job.priority === priority) redirect(`/jobs/${jobId}`);
  await supabase.from("jobs").update({ priority }).eq("id", jobId);
  await logEvent(supabase, jobId, staff.id, { event_type: "priority_change", note: `Priority ${job.priority} → ${priority}` });
  refresh(jobId);
  redirect(`/jobs/${jobId}`);
}

/** The promised date is set at the quotation stage or from the job card at any time. */
export async function setPromisedDate(jobId: string, formData: FormData) {
  const staff = await requirePermission("setPriority");
  const date = String(formData.get("promised_at") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect(`/jobs/${jobId}?error=` + encodeURIComponent("Choose the promised date."));
  if (date < dubaiDate()) redirect(`/jobs/${jobId}?error=` + encodeURIComponent("The promised date cannot be in the past."));
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("promised_at, is_open").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) redirect(`/jobs/${jobId}`);
  if (job.promised_at === date) redirect(`/jobs/${jobId}`);
  const { error } = await supabase.from("jobs").update({ promised_at: date }).eq("id", jobId);
  if (error) redirect(`/jobs/${jobId}?error=` + encodeURIComponent(error.message));
  await logEvent(supabase, jobId, staff.id, { event_type: "promised_date", note: `Promised date ${job.promised_at ?? "none"} → ${date}` });
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=` + encodeURIComponent("Promised date saved."));
}

/* ---------------------------------------------------------------------------
   Gate-in amendments
   --------------------------------------------------------------------------- */

const amendSchema = z.object({
  arrived_by: z.enum(["our_recovery", "customer_drove", "customer_driver", "outside_recovery"]),
  condition: z.enum(["runs_drives", "needs_assistance", "does_not_run"]),
  fuel_level: z.string(),
  battery_percent: z.string().trim(),
  cleanliness: z.enum(["clean", "average", "dirty", "very_dirty"]),
  dash_cam: z.enum(["yes", "no"]),
  major_damage: z.enum(["yes", "no"]),
  mileage: z.string().regex(/^\d{1,7}$/, "Enter the mileage in km."),
  keys_count: z.string().regex(/^\d{1,2}$/, "Enter how many keys were received."),
  keys_keychain: z.enum(["yes", "no"]),
  notes: z.string().trim(),
  old_parts_return: z.enum(["yes", "no"]),
  priority: z.enum(["high", "normal", "low"]),
  is_electric: z.string(),
});

export async function updateGateIn(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("editGateIn");
  const values = formValues(formData);
  const get = (k: string) => formData.get(k) ?? "";
  const parsed = amendSchema.safeParse({
    arrived_by: get("arrived_by"),
    condition: get("condition"),
    fuel_level: get("fuel_level"),
    battery_percent: get("battery_percent"),
    cleanliness: get("cleanliness"),
    dash_cam: get("dash_cam"),
    major_damage: get("major_damage"),
    mileage: get("mileage"),
    keys_count: get("keys_count"),
    keys_keychain: get("keys_keychain"),
    notes: get("notes"),
    old_parts_return: get("old_parts_return"),
    priority: get("priority"),
    is_electric: get("is_electric"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };
  const d = parsed.data;
  const requests = formData.getAll("requests").map((r) => String(r).trim()).filter(Boolean).slice(0, 50);
  if (requests.length === 0) return { error: "Keep at least one customer request.", values };
  const vipOn = formData.get("vip") === "on";
  const vipNote = blankToNull(formData.get("vip_note"));

  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("id, priority, is_open, customer_id, customer:customers(is_vip, vip_note)").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return { error: "This job is closed.", values };
  const { data: gi } = await supabase.from("gate_ins").select("is_complete").eq("job_id", jobId).maybeSingle();

  const { error } = await supabase
    .from("gate_ins")
    .update({
      arrived_by: d.arrived_by,
      condition: d.condition,
      fuel_level: d.is_electric === "yes" ? null : d.fuel_level || null,
      battery_percent: d.is_electric === "yes" && d.battery_percent ? Number(d.battery_percent) : null,
      cleanliness: d.cleanliness,
      dash_cam: d.dash_cam === "yes",
      major_damage: d.major_damage === "yes",
      mileage: Number(d.mileage),
      keys_count: Number(d.keys_count),
      keys_keychain: d.keys_keychain === "yes",
      notes: blankToNull(d.notes),
      old_parts_return: d.old_parts_return === "yes",
      ...(gi?.is_complete ? {} : { customer_requests: requests.map((r, i) => `${i + 1}. ${r}`).join("\n") }),
    })
    .eq("job_id", jobId);
  if (error) return { error: error.message, values };
  const dept = String(formData.get("department") ?? "");
  if (["mechanical", "bodyshop", "both"].includes(dept)) await supabase.from("jobs").update({ department: dept }).eq("id", jobId);

  if (!gi?.is_complete) {
    // Request lines can be rewritten until the gate-in is complete: retire the old ones, add the new ones.
    await supabase.from("job_requests").update({ is_active: false }).eq("job_id", jobId).eq("is_active", true);
    await supabase.from("job_requests").insert(requests.map((text, i) => ({ job_id: jobId, position: i + 1, text })));
  }

  const cust = job.customer as unknown as { is_vip: boolean; vip_note: string | null } | null;
  const wasVip = cust?.is_vip ?? false;
  if (vipOn !== wasVip || (vipOn && vipNote && vipNote !== cust?.vip_note)) {
    await supabase.from("customers").update({ is_vip: vipOn, vip_note: vipOn ? vipNote ?? cust?.vip_note ?? null : cust?.vip_note ?? null }).eq("id", job.customer_id);
    if (vipOn !== wasVip) await logEvent(supabase, jobId, staff.id, { event_type: "vip_change", note: `VIP switched ${vipOn ? "on" : "off"}` });
  }

  if (job.priority !== d.priority) {
    await supabase.from("jobs").update({ priority: d.priority }).eq("id", jobId);
    await logEvent(supabase, jobId, staff.id, { event_type: "amendment", note: `Priority ${job.priority} → ${d.priority}` });
  }
  await logEvent(supabase, jobId, staff.id, { event_type: "amendment", note: "Gate-in details amended" });
  refresh(jobId);
  redirect(`/jobs/${jobId}${staff.role_id === "gate_in" ? "/media" : ""}?message=` + encodeURIComponent("Amendments saved and logged."));
}

/* ---------------------------------------------------------------------------
   Customer approval link
   --------------------------------------------------------------------------- */

/** Creates the link. Nothing is "sent" until Open WhatsApp or Copy link is used. */
export async function sendApproval(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("sendApproval");
  const values = formValues(formData);
  const name = String(formData.get("sent_to_name") ?? "").trim();
  const phone = normalisePhone(String(formData.get("sent_to_phone") ?? ""));
  if (phone.length < 7) return { error: "Choose or enter the phone number to send to.", values };

  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("id, status, is_open, job_number").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return { error: "This job is closed.", values };
  const check = mediaChecklist(await loadMedia(jobId), await loadGateInFlags(jobId));
  if (!check.complete) return { error: "Both videos, the dashboard photo, both keys photos, the four wheel photos with their condition and any required damage photos must be uploaded before the approval link can be created.", values };

  const settings = await getSettings();
  const terms = String(settings.terms_and_conditions ?? "").trim();
  if (!terms) return { error: "Add the terms and conditions text in Settings first.", values };

  const token = newToken();
  const { data: created, error } = await supabase
    .from("approval_requests")
    .insert({
      job_id: jobId,
      kind: "job_card",
      token,
      sent_to_name: blankToNull(name),
      sent_to_phone: phone,
      sent_by: staff.id,
      sent_at: null,
      status: "created",
      terms_text: terms,
      terms_text_ar: blankToNull(settings.terms_and_conditions_ar),
      declaration_text: settings.declaration_text,
      declaration_text_ar: settings.declaration_text_ar,
      inspection_fee_aed: Number(settings.inspection_fee_aed) || 0,
      inspection_fee_notice: feeNotice(settings.inspection_fee_notice, settings.inspection_fee_aed),
      inspection_fee_notice_ar: feeNotice(settings.inspection_fee_notice_ar, settings.inspection_fee_aed),
    })
    .select("id")
    .single();
  if (error || !created) return { error: error?.message ?? "Could not create the link.", values };

  await logEvent(supabase, jobId, staff.id, { event_type: "approval_created", note: `Approval link created for ${name || phone}` });
  refresh(jobId);
  const site = await getSiteUrl();
  redirect(`/jobs/${jobId}?link=${encodeURIComponent(`${site}/approve/${token}`)}&req=${created.id}`);
}

/** Records that the link was actually sent (Open WhatsApp or Copy link). */
export async function markApprovalSent(jobId: string, requestId: string, method: "whatsapp" | "copy" | "tablet") {
  const staff = await requirePermission("sendApproval");
  const supabase = await createClient();
  const { data: req } = await supabase.from("approval_requests").select("id, status, sent_at, sent_to_name, sent_to_phone").eq("id", requestId).eq("job_id", jobId).maybeSingle();
  if (!req) return;
  if (!req.sent_at) {
    await supabase
      .from("approval_requests")
      .update({ sent_at: new Date().toISOString(), sent_method: method, status: req.status === "created" ? "sent" : req.status })
      .eq("id", requestId);
    await logEvent(supabase, jobId, staff.id, {
      event_type: "approval_sent",
      note: `Approval link sent by ${method === "whatsapp" ? "WhatsApp" : method === "copy" ? "copied link" : "tablet"} to ${req.sent_to_name || req.sent_to_phone}`,
    });
    refresh(jobId);
  }
}

/* ---------------------------------------------------------------------------
   Gate-out
   --------------------------------------------------------------------------- */

export async function gateOutJob(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("gateOut");
  const role = staff.role_id as RoleId;
  const values = formValues(formData);
  const keysReturned = String(formData.get("keys_returned") ?? "");
  const keychain = formData.get("keychain_returned") === "yes";
  const dashCamReconnected = formData.get("dash_cam_reconnected") === "on";
  const overrideReason = String(formData.get("override_reason") ?? "").trim();
  const releaseReason = String(formData.get("release_reason") ?? "").trim();
  const notes = blankToNull(formData.get("notes"));

  if (!/^\d{1,2}$/.test(keysReturned)) return { error: "Enter the number of keys returned.", values };

  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("id, status, is_open, job_number").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return { error: "This job is already closed.", values };
  const { data: gi } = await supabase.from("gate_ins").select("keys_count, keys_keychain, dash_cam").eq("job_id", jobId).maybeSingle();
  if (!gi) return { error: "No gate-in record found.", values };

  const keysMatch = Number(keysReturned) === gi.keys_count && keychain === gi.keys_keychain;
  let overrideBy: string | null = null;
  if (!keysMatch) {
    if (!can(role, "overrideKeys")) {
      return { error: "Keys do not match the gate-in record. Only the owner or workshop manager can override, with a reason.", values };
    }
    if (overrideReason.length < 5) return { error: "Keys do not match. Write the reason for the override.", values };
    overrideBy = staff.id;
  }
  if (gi.dash_cam && !dashCamReconnected) return { error: "Tick that the dash cam has been reconnected.", values };

  const balanceDue = 0;
  let releaseBy: string | null = null;
  if (balanceDue > 0) {
    if (!can(role, "approveRelease")) return { error: "This car has a balance due. Only the owner or accounts can approve the release.", values };
    if (releaseReason.length < 5) return { error: "Write the reason for releasing with a balance due.", values };
    releaseBy = staff.id;
  }

  const { error } = await supabase.from("gate_outs").insert({
    job_id: jobId,
    keys_returned: Number(keysReturned),
    keychain_returned: keychain,
    keys_match: keysMatch,
    keys_override_by: overrideBy,
    keys_override_reason: overrideBy ? overrideReason : null,
    dash_cam_reconnected: gi.dash_cam ? dashCamReconnected : null,
    balance_due_aed: balanceDue,
    release_approved_by: releaseBy,
    release_reason: releaseBy ? releaseReason : null,
    notes,
  });
  if (error) return { error: error.message, values };

  const { error: jobError } = await supabase
    .from("jobs")
    .update({ status: "closed", stage: "ready", is_open: false, gated_out_at: new Date().toISOString(), gated_out_by: staff.id })
    .eq("id", jobId);
  if (jobError) return { error: jobError.message, values };
  await createAdminClient().from("appointments").update({ status: "done", updated_by: staff.id }).eq("job_id", jobId).eq("kind", "customer_collects").eq("status", "booked");

  await logEvent(supabase, jobId, staff.id, {
    event_type: "gate_out",
    from_status: job.status,
    to_status: "closed",
    note: keysMatch ? "Gated out" : `Gated out with keys override: ${overrideReason}`,
  });
  if (overrideBy) await logEvent(supabase, jobId, staff.id, { event_type: "keys_override", note: overrideReason });
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=` + encodeURIComponent(`${job.job_number} gated out.`));
}

/** Short-lived link for the phone upload page, shown as a QR code. */
export async function createUploadLinkToken(jobId: string): Promise<string> {
  const staff = await requireStaff();
  if (!can(staff.role_id as RoleId, "editGateIn")) throw new Error("Not allowed");
  const token = newToken();
  const admin = createAdminClient();
  const { error } = await admin.from("upload_links").insert({
    job_id: jobId,
    token,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    created_by: staff.id,
  });
  if (error) throw new Error(error.message);
  return token;
}
