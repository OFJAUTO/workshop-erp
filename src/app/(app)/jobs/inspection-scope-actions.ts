"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCondition, isDowngrade, isScope, nowRunsWords, scopeLabel, type Scope } from "@/lib/inspection-scope";
import { applyCondition, scopeReady } from "@/lib/inspection-scope-data";

/**
 * THE INSPECTION TYPE AND "COULD NOT CHECK" (11 November 2026, Section 10). The advisor (or the owner) picks the type;
 * the technician taps the car's condition and marks items that could not be checked; the advisor settles the ones the
 * customer declined or that do not apply. Every change is on the car's history.
 */
export type ScopeAnswer = { ok?: boolean; error?: string; message?: string } | null;

const refresh = (jobId: string) => {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/my-jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/inspection`);
};

async function logEvent(jobId: string, by: string, type: string, note: string) {
  await createAdminClient().from("job_events").insert({ job_id: jobId, event_type: type, note, created_by: by });
}

/** The type: first choice saved; a bigger type later is logged; a smaller one after the start waits for the owner. */
export async function setInspectionScope(jobId: string, scope: string, reason: string = ""): Promise<ScopeAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  if (!(staff.role_id === "owner" || can(staff.role_id as RoleId, "editQuotes"))) return { error: "The advisor (or the owner) picks the inspection type." };
  if (!isScope(scope)) return { error: "Pick Full inspection, Customer complaints only or Pre-purchase inspection." };
  if (!(await scopeReady())) return { error: "Inspection types switch on once the database change is applied." };
  const admin = createAdminClient();
  const [{ data: job }, { data: insp }] = await Promise.all([
    admin.from("jobs").select("job_number, inspection_scope").eq("id", jobId).maybeSingle(),
    admin.from("inspections").select("status").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!job) return { error: "Job not found." };
  const from = (isScope(job.inspection_scope) ? job.inspection_scope : null) as Scope | null;
  if (from === scope) return { ok: true, message: "No change." };
  const started = !!insp && insp.status !== "not_started";
  if (started && isDowngrade(from, scope) && staff.role_id !== "owner") {
    if (reason.trim().length < 5) return { error: "Write why it should be smaller now (a few words): the owner decides." };
    await admin.from("jobs").update({ inspection_scope_request: scope, inspection_scope_request_by: staff.id, inspection_scope_request_at: new Date().toISOString(), inspection_scope_request_reason: reason.trim().slice(0, 300), updated_by: staff.id }).eq("id", jobId);
    await logEvent(jobId, staff.id, "inspection_scope", `${staff.display_name} asked the owner to change the inspection from ${scopeLabel(from)} to ${scopeLabel(scope)}: ${reason.trim()}`);
    const { notifyRoles } = await import("@/lib/notifications");
    await notifyRoles(["owner"], { type: "owner_approval_needed", title: `Inspection type down to ${scopeLabel(scope)}? · ${job.job_number}`, body: `${staff.display_name}: ${reason.trim()}`, jobId, href: `/jobs/${jobId}?approval=inspection_type:${jobId}` });
    refresh(jobId);
    return { ok: true, message: "The owner is asked: the inspection stays as it is until he decides." };
  }
  await admin.from("jobs").update({ inspection_scope: scope, inspection_scope_set_by: staff.id, inspection_scope_set_at: new Date().toISOString(), inspection_scope_request: null, inspection_scope_request_by: null, inspection_scope_request_at: null, inspection_scope_request_reason: null, updated_by: staff.id }).eq("id", jobId);
  await logEvent(jobId, staff.id, "inspection_scope", from ? `Inspection type changed from ${scopeLabel(from)} to ${scopeLabel(scope)} by ${staff.display_name}${reason.trim() ? `: ${reason.trim()}` : ""}` : `Inspection type: ${scopeLabel(scope)} (${staff.display_name})`);
  refresh(jobId);
  return { ok: true, message: `${scopeLabel(scope)}.` };
}

/** The technician's first tap: the car's condition. Items it makes impossible are marked by themselves. */
export async function setCarCondition(jobId: string, condition: string): Promise<ScopeAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  if (!isCondition(condition)) return { error: "Pick the car's condition." };
  if (!(await scopeReady())) return { error: "This switches on once the database change is applied." };
  const admin = createAdminClient();
  const { data: insp } = await admin.from("inspections").select("id, car_condition, technician_id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!insp) return { error: "No inspection on this car." };
  await admin.from("inspections").update({ car_condition: condition, updated_by: staff.id }).eq("id", insp.id);
  const r = await applyCondition(insp.id as string, condition, staff.id);
  await logEvent(jobId, staff.id, "car_condition", `Car condition: ${condition.replace(/_/g, " ")} (${staff.display_name})${r.marked ? ` · ${r.marked} item${r.marked === 1 ? "" : "s"} could not be checked` : ""}`);
  // The car runs again: the technician and the advisor are told what is still to check.
  if (r.reopened) {
    const { notifyStaff } = await import("@/lib/notifications");
    const { data: job } = await admin.from("jobs").select("job_number, advisor_id").eq("id", jobId).maybeSingle();
    const to = Array.from(new Set([insp.technician_id as string | null, job?.advisor_id as string | null].filter((x): x is string => !!x)));
    if (to.length) await notifyStaff(to, { type: "owner_approval_needed", title: `${nowRunsWords(r.reopened)} · ${job?.job_number ?? ""}`, body: "Check them, then submit the report. New findings go on an additional quotation.", jobId, href: `/my-jobs/${jobId}` });
  }
  refresh(jobId);
  return { ok: true, message: r.marked ? `${r.marked} item${r.marked === 1 ? "" : "s"} marked Could not check.` : r.reopened ? nowRunsWords(r.reopened) : "Saved." };
}

/** Any one item: Could not check with a reason (one tap), or back to checking (the reason off). */
export async function markNotChecked(jobId: string, itemKey: string, reason: string | null): Promise<ScopeAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  if (!(await scopeReady())) return { error: "This switches on once the database change is applied." };
  if (reason !== null && reason.trim().length < 3) return { error: "Pick the reason it could not be checked." };
  const admin = createAdminClient();
  const { data: insp } = await admin.from("inspections").select("id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!insp) return { error: "No inspection on this car." };
  const { data: row, error } = await admin.from("inspection_items").update(reason === null ? { not_checked_reason: null, not_checked_auto: false, not_checked_resolution: null, updated_by: staff.id } : { not_checked_reason: reason.trim().slice(0, 120), not_checked_auto: false, not_checked_resolution: null, updated_by: staff.id }).eq("inspection_id", insp.id).eq("item_key", itemKey).select("item_label").maybeSingle();
  if (error || !row) return { error: "Couldn't save – try again." };
  await logEvent(jobId, staff.id, "not_checked", reason === null ? `${row.item_label}: back to check (${staff.display_name})` : `${row.item_label}: could not check – ${reason} (${staff.display_name})`);
  refresh(jobId);
  return { ok: true };
}

/** The advisor settles an item that could not be checked: the customer declined it, or it does not apply. */
export async function resolveNotChecked(jobId: string, itemKey: string, resolution: "declined" | "not_applicable"): Promise<ScopeAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  if (!(staff.role_id === "owner" || can(staff.role_id as RoleId, "editQuotes"))) return { error: "The advisor (or the owner) settles this." };
  const admin = createAdminClient();
  const { data: insp } = await admin.from("inspections").select("id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!insp) return { error: "No inspection on this car." };
  const { data: row } = await admin.from("inspection_items").update({ not_checked_resolution: resolution, not_checked_resolved_by: staff.id, not_checked_resolved_at: new Date().toISOString(), updated_by: staff.id }).eq("inspection_id", insp.id).eq("item_key", itemKey).not("not_checked_reason", "is", null).select("item_label").maybeSingle();
  if (!row) return { error: "That item is not waiting." };
  await logEvent(jobId, staff.id, "not_checked", `${row.item_label}: ${resolution === "declined" ? "customer declined the check" : "not applicable"} (${staff.display_name})`);
  refresh(jobId);
  return { ok: true };
}
