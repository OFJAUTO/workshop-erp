"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission, requireStaff } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { ensureInspection, inspectionLocked, loadInspection, reportProblems } from "@/lib/inspection-data";
import { workingTimeOf } from "@/lib/jobs";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { ROAD_TEST_SELECT, roadTestWaiting, type RoadTestRow } from "@/lib/road-test";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { workingHoursBetween } from "@/lib/working-time";

function refresh(jobId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/my-jobs");
  revalidatePath("/assign");
  revalidatePath(`/my-jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/inspection`);
}

async function logEvent(jobId: string, by: string, event_type: string, note: string, extra: Record<string, unknown> = {}) {
  await createAdminClient().from("job_events").insert({ job_id: jobId, event_type, note, created_by: by, ...extra });
}

async function jobOf(jobId: string) {
  const { data } = await createAdminClient().from("jobs").select("id, job_number, status, stage, department, assigned_to, gated_in_by, is_open, first_approval_at").eq("id", jobId).maybeSingle();
  return data;
}

/** The technician starts the clock. */
export async function startInspection(jobId: string) {
  const staff = await requireStaff();
  const gate = await jobOf(jobId);
  if (gate && !gate.first_approval_at && staff.role_id !== "owner") redirect(`/my-jobs/${jobId}?error=${encodeURIComponent("The customer has not approved the job card yet. The inspection starts after that.")}`);
  let bundle = await loadInspection(jobId);
  if (!bundle) {
    // Cars assigned before the inspection existed: set it up now for the assigned technician.
    const job = await jobOf(jobId);
    if (!job || job.assigned_to !== staff.id) redirect(`/my-jobs/${jobId}?error=${encodeURIComponent("No inspection has been set up for this car yet.")}`);
    const settings = await getSettings();
    await ensureInspection(jobId, staff.id, settings.inspection_checklist, Number(settings.inspection_target_minutes) || 90, staff.id);
    bundle = await loadInspection(jobId);
    if (!bundle) redirect(`/my-jobs/${jobId}`);
  }
  const insp = bundle.inspection;
  if (insp.technician_id !== staff.id && !can(staff.role_id as RoleId, "approveInspections")) redirect(`/my-jobs/${jobId}?error=${encodeURIComponent("This car is assigned to someone else.")}`);
  if (insp.status !== "not_started" && insp.status !== "returned") redirect(`/my-jobs/${jobId}`);
  const admin = createAdminClient();
  // A road test the manager asked for comes first: the inspection opens once the QC inspector has submitted it.
  const { data: road } = await admin.from("road_tests").select(ROAD_TEST_SELECT).eq("job_id", jobId).maybeSingle();
  if (roadTestWaiting(road as RoadTestRow | null) && staff.role_id !== "owner") redirect(`/my-jobs/${jobId}?error=${encodeURIComponent("Waiting for the QC road test. The inspection opens after it is submitted.")}`);
  const settings = await getSettings();
  await admin
    .from("inspections")
    .update({ status: "in_progress", started_at: insp.started_at ?? new Date().toISOString(), target_minutes: insp.target_minutes ?? (Number(settings.inspection_target_minutes) || 90), updated_by: staff.id })
    .eq("id", insp.id);
  await admin.from("jobs").update({ status: "in_inspection", stage: "inspection" }).eq("id", jobId).eq("status", "pending_inspection");
  await logEvent(jobId, staff.id, "inspection_started", `Inspection started by ${staff.display_name}`);
  refresh(jobId);
  redirect(`/my-jobs/${jobId}`);
}

/** The technician submits; the department manager is told. */
export async function submitInspection(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const values = formValues(formData);
  const bundle = await loadInspection(jobId);
  if (!bundle) return { error: "No inspection found.", values };
  const insp = bundle.inspection;
  if (insp.technician_id !== staff.id && !can(staff.role_id as RoleId, "approveInspections")) return { error: "This car is assigned to someone else.", values };
  if (insp.status !== "in_progress" && insp.status !== "returned") return { error: "The report is not open.", values };
  const admin = createAdminClient();
  const { data: requests } = await admin.from("job_requests").select("id, text").eq("job_id", jobId).eq("is_active", true);
  const problems = reportProblems(bundle, (requests ?? []) as { id: string; text: string }[]);
  if (problems.length) return { error: problems.slice(0, 4).join(" "), values };

  const settings = await getSettings();
  const wt = workingTimeOf(settings);
  const now = new Date();
  const elapsed = Math.round(workingHoursBetween(insp.started_at ?? now, now, wt) * 60);
  const target = insp.target_minutes ?? (Number(settings.inspection_target_minutes) || 90);
  await admin
    .from("inspections")
    .update({ status: "submitted", submitted_at: now.toISOString(), elapsed_minutes: elapsed, overrun_minutes: Math.max(0, elapsed - target), updated_by: staff.id })
    .eq("id", insp.id);
  await logEvent(jobId, staff.id, "inspection_submitted", `Inspection report submitted by ${staff.display_name} after ${elapsed} min of working time`);
  const job = await jobOf(jobId);
  await notifyManagers(job?.department ?? null, {
    type: "inspection_submitted",
    title: `Inspection report ready to approve · ${job?.job_number ?? ""}`,
    body: `${staff.display_name} submitted it after ${elapsed} min.`,
    jobId,
    href: `/jobs/${jobId}/inspection`,
  });
  refresh(jobId);
  // The technician sees a full-screen thank-you on My jobs; anyone else lands on the report.
  redirect(staff.role_id === "technician" ? `/my-jobs?submitted=${jobId}` : `/jobs/${jobId}/inspection`);
}

/** The manager approves with a note; the advisor is told and the car moves to Quote. */
export async function approveInspection(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("approveInspections");
  const values = formValues(formData);
  const note = blankToNull(formData.get("manager_note"));
  if (!note || note.length < 3) return { error: "Write the workshop manager's note before approving.", values };
  const bundle = await loadInspection(jobId);
  if (!bundle || bundle.inspection.status !== "submitted") return { error: "There is no submitted report to approve.", values };
  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin.from("inspections").update({ status: "approved", approved_at: now, approved_by: staff.id, manager_note: note, updated_by: staff.id }).eq("id", bundle.inspection.id);
  const job = await jobOf(jobId);
  if (job && (job.status === "in_inspection" || job.status === "pending_inspection")) {
    await admin.from("jobs").update({ status: "pending_quote", stage: "quote" }).eq("id", jobId);
  }
  await logEvent(jobId, staff.id, "inspection_approved", `Inspection report approved by ${staff.display_name}`, { from_status: job?.status ?? null, to_status: "pending_quote" });
  // The advisor: whoever created the approval link, else whoever gated the car in.
  const { data: approval } = await admin.from("approval_requests").select("sent_by, created_by").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const advisors = [approval?.sent_by, approval?.created_by, job?.gated_in_by].filter((x): x is string => !!x);
  await notifyStaff(advisors, {
    type: "inspection_approved",
    title: `Inspection report approved · ${job?.job_number ?? ""}`,
    body: "Ready for the quote. Open the report for the technician's findings and suggested lines.",
    jobId,
    href: `/jobs/${jobId}/inspection`,
  });
  refresh(jobId);
  return { success: "Approved. The advisor has been told and the car moved to Quote.", values };
}

/** The manager sends the report back with a reason. */
export async function returnInspection(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("approveInspections");
  const values = formValues(formData);
  const reason = blankToNull(formData.get("return_reason"));
  if (!reason || reason.length < 3) return { error: "Say why it is going back.", values };
  const bundle = await loadInspection(jobId);
  if (!bundle || bundle.inspection.status !== "submitted") return { error: "There is no submitted report to send back.", values };
  const admin = createAdminClient();
  await admin.from("inspections").update({ status: "returned", returned_at: new Date().toISOString(), return_reason: reason, updated_by: staff.id }).eq("id", bundle.inspection.id);
  await logEvent(jobId, staff.id, "inspection_returned", `Report sent back by ${staff.display_name}: ${reason}`);
  const job = await jobOf(jobId);
  if (bundle.inspection.technician_id) {
    await notifyStaff([bundle.inspection.technician_id], { type: "inspection_returned", title: `Report sent back · ${job?.job_number ?? ""}`, body: reason, jobId, href: `/my-jobs/${jobId}` });
  }
  refresh(jobId);
  return { success: "Sent back to the technician.", values };
}

/** After approval the report is locked: a technician or manager asks the owner before changing it. */
export async function requestInspectionChange(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const values = formValues(formData);
  const role = staff.role_id as RoleId;
  if (!(role === "technician" || can(role, "approveInspections"))) return { error: "Not allowed.", values };
  const reason = blankToNull(formData.get("reason"));
  if (!reason || reason.length < 5) return { error: "Explain what needs to change and why.", values };
  const bundle = await loadInspection(jobId);
  if (!bundle || bundle.inspection.status !== "approved") return { error: "Only an approved report needs a change request.", values };
  if (bundle.changeRequests.some((c) => c.status === "pending")) return { error: "A change request is already waiting for the owner.", values };
  const admin = createAdminClient();
  await admin.from("inspection_change_requests").insert({ inspection_id: bundle.inspection.id, requested_by: staff.id, reason, created_by: staff.id, updated_by: staff.id });
  await logEvent(jobId, staff.id, "inspection_change_requested", `${staff.display_name} asked to change the approved report: ${reason}`);
  const job = await jobOf(jobId);
  await notifyRoles(["owner"], { type: "inspection_change_requested", title: `Change to an approved report needs your approval · ${job?.job_number ?? ""}`, body: `${staff.display_name}: ${reason}`, jobId, href: `/jobs/${jobId}/inspection` });
  refresh(jobId);
  return { success: "Sent to the owner for approval.", values };
}

/** The owner approves (the report opens for 24 hours) or refuses. */
export async function decideInspectionChange(jobId: string, requestId: string, formData: FormData) {
  const staff = await requirePermission("decideInspectionChanges");
  const decision = String(formData.get("decision") ?? "");
  const note = blankToNull(formData.get("decision_note"));
  if (decision !== "approved" && decision !== "refused") redirect(`/jobs/${jobId}/inspection`);
  const admin = createAdminClient();
  const { data: req } = await admin.from("inspection_change_requests").select("id, inspection_id, requested_by, status").eq("id", requestId).maybeSingle();
  if (!req || req.status !== "pending") redirect(`/jobs/${jobId}/inspection`);
  const now = new Date();
  await admin.from("inspection_change_requests").update({ status: decision, decided_by: staff.id, decided_at: now.toISOString(), decision_note: note, updated_by: staff.id }).eq("id", req.id);
  if (decision === "approved") {
    const hours = Number((await getSettings()).inspection_unlock_hours) || 1;
    await admin.from("inspections").update({ unlocked_until: new Date(now.getTime() + hours * 3600000).toISOString(), updated_by: staff.id }).eq("id", req.inspection_id);
  }
  await logEvent(jobId, staff.id, "inspection_change_decided", `Owner ${decision} the change request${note ? `: ${note}` : ""}`);
  const job = await jobOf(jobId);
  if (req.requested_by) {
    await notifyStaff([req.requested_by], {
      type: "inspection_change_decided",
      title: `Change request ${decision} · ${job?.job_number ?? ""}`,
      body: decision === "approved" ? "The report is open for a short time. Make the change now." : (note ?? "The owner refused the change."),
      jobId,
      href: `/jobs/${jobId}/inspection`,
    });
  }
  refresh(jobId);
  redirect(`/jobs/${jobId}/inspection`);
}

/** Technicians log what they changed on an unlocked report, so every step after approval is on record. */
export async function noteInspectionEdit(jobId: string, formData: FormData) {
  const staff = await requireStaff();
  const bundle = await loadInspection(jobId);
  if (!bundle || inspectionLocked(bundle.inspection)) redirect(`/jobs/${jobId}/inspection`);
  const note = blankToNull(formData.get("note"));
  if (note) await logEvent(jobId, staff.id, "inspection_edited", `${staff.display_name} changed the approved report: ${note}`);
  refresh(jobId);
  redirect(`/my-jobs/${jobId}`);
}

/** Advisors and the owner decide whether the pre-scan PDF goes to the customer with the report. */
export async function setPrescanVisible(jobId: string, formData: FormData) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!can(role, "sendReport")) redirect(`/jobs/${jobId}/inspection`);
  const bundle = await loadInspection(jobId);
  if (!bundle) redirect(`/jobs/${jobId}/inspection`);
  const visible = String(formData.get("visible") ?? "") === "1";
  await createAdminClient().from("inspections").update({ show_prescan_to_customer: visible, updated_by: staff.id }).eq("id", bundle.inspection.id);
  await logEvent(jobId, staff.id, "prescan_visibility", visible ? "Pre-scan will be shown to the customer" : "Pre-scan hidden from the customer");
  refresh(jobId);
  redirect(`/jobs/${jobId}/inspection`);
}
