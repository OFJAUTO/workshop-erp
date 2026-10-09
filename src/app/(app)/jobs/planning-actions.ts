"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission, requireStaff } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { dubaiDate } from "@/lib/jobs";
import { newLabelCode } from "@/lib/parts-data";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { loadPlanning } from "@/lib/planning";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import type { JobRow } from "@/lib/types";
import { ensureWorkLines } from "@/lib/work-data";
import { addTechnician } from "@/lib/work-flow";

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/work`);
  revalidatePath(`/parts/${jobId}`);
  revalidatePath("/parts");
  revalidatePath("/dashboard");
  revalidatePath("/my-jobs");
}
async function jobOf(jobId: string) {
  const { data } = await createAdminClient().from("jobs").select("*").eq("id", jobId).maybeSingle();
  return (data as JobRow | null) ?? null;
}
async function advisorIds(jobId: string, gatedInBy: string | null) {
  const { data: appr } = await createAdminClient().from("approval_requests").select("sent_by").eq("job_id", jobId);
  return Array.from(new Set([gatedInBy, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
}
const back = (jobId: string, from: string | null, msg: string, ok: boolean) => redirect(`${from === "parts" ? `/parts/${jobId}` : `/jobs/${jobId}`}?${ok ? "message" : "error"}=${encodeURIComponent(msg)}`);

/** Parts: every part has its choice (in stock, or to order with a date); the workshop manager is next. */
export async function partsPlanned(jobId: string, formData: FormData) {
  const staff = await requirePermission("priceParts");
  const from = blankToNull(formData.get("from"));
  const admin = createAdminClient();
  const job = await jobOf(jobId);
  if (!job || !job.is_open) back(jobId, from, "This job is closed.", false);
  if (!["approved", "waiting_parts"].includes(job!.status)) back(jobId, from, "This car is not in planning.", false);
  const settings = await getSettings();
  const plan = await loadPlanning(job!, settings);
  if (plan.unplanned.length) back(jobId, from, `${plan.unplanned.length} part${plan.unplanned.length === 1 ? " has" : "s have"} no choice yet: tap In stock or To order with the date (${plan.unplanned.map((p) => p.description).join(", ")}).`, false);
  const now = new Date().toISOString();
  await admin.from("jobs").update({ status: "waiting_parts", stage: "parts", plan_parts_done_at: now, plan_parts_by: staff.id, plan_parts_ready_date: plan.partsReadyDate ?? dubaiDate() }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "planning", note: `Parts planned by ${staff.display_name}: ${plan.missing.length ? `all parts here by ${plan.partsReadyDate}` : "everything in stock"}`, created_by: staff.id });
  await notifyManagers(job!.department ?? null, { type: "planning", title: `Plan the work · ${job!.job_number}`, body: `${plan.missing.length ? `Parts all here by ${plan.partsReadyDate}` : "All parts in stock"}. Pick the start day and the technicians, then Release to workshop.`, jobId, href: `/jobs/${jobId}#planning` });
  refresh(jobId);
  back(jobId, from, "Parts planned. The workshop manager is next.", true);
}

/** Parts: one approved part is in stock (ready, with its label) or to order with the days until it arrives. */
export async function setPartPlan(partId: string, formData: FormData) {
  const staff = await requirePermission("priceParts");
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id, quantity, confirmed_quantity, order_status, po_id, label_code, description").eq("id", partId).maybeSingle();
  if (!p) redirect("/parts");
  const choice = String(formData.get("choice") ?? "");
  const fail = (m: string) => redirect(`/parts/${p.job_id}?error=${encodeURIComponent(m)}#planning`);
  if (p.po_id || p.order_status === "received" || p.order_status === "ordered" || p.order_status === "partly_received") fail(`${p.description} is already ordered or here.`);
  if (choice === "in_stock") {
    await admin.from("part_items").update({ availability: "in_stock", delivery_date: null, order_status: "received", received_qty: Number(p.confirmed_quantity ?? p.quantity) || 1, label_code: p.label_code ?? newLabelCode(), updated_by: staff.id }).eq("id", partId);
  } else if (choice === "to_order") {
    const days = Number(String(formData.get("days") ?? "").replace(/[^\d]/g, ""));
    if (!Number.isFinite(days) || days < 1) fail(`How many days until ${p.description} arrives?`);
    const date = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    await admin.from("part_items").update({ availability: "to_order", delivery_date: date, order_status: "to_order", updated_by: staff.id }).eq("id", partId);
  } else fail("Choose In stock or To order.");
  refresh(p.job_id);
  redirect(`/parts/${p.job_id}?message=${encodeURIComponent(choice === "in_stock" ? `${p.description}: in stock.` : `${p.description}: to order.`)}#planning`);
}

/** Parts: one tap for everything on the shelf. Parts that are already ordered keep their order. */
export async function allInStock(jobId: string, formData: FormData) {
  const staff = await requirePermission("priceParts");
  const from = blankToNull(formData.get("from"));
  const admin = createAdminClient();
  const { data: parts } = await admin.from("part_items").select("id, quantity, confirmed_quantity, order_status, po_id, received_qty, label_code").eq("job_id", jobId).eq("is_active", true).neq("order_status", "none").neq("return_status", "returned");
  for (const p of parts ?? []) {
    if (p.po_id || p.order_status === "received") continue;
    await admin.from("part_items").update({ availability: "in_stock", delivery_date: null, order_status: "received", received_qty: Number(p.confirmed_quantity ?? p.quantity) || 1, label_code: p.label_code ?? newLabelCode(), updated_by: staff.id }).eq("id", p.id);
  }
  await admin.from("job_events").insert({ job_id: jobId, event_type: "planning", note: `All parts marked in stock by ${staff.display_name}`, created_by: staff.id });
  refresh(jobId);
  await partsPlanned(jobId, formData);
  back(jobId, from, "All parts in stock.", true);
}

/** The workshop manager picks the start day and the technicians and releases the car; only then does the technician get it. */
export async function releaseToWorkshop(jobId: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  const admin = createAdminClient();
  const job = await jobOf(jobId);
  const fail = (m: string) => redirect(`/jobs/${jobId}?error=${encodeURIComponent(m)}#planning`);
  if (!job || !job.is_open) fail("This job is closed.");
  if (!["approved", "waiting_parts"].includes(job!.status)) fail("This car is not in planning.");
  const settings = await getSettings();
  const plan = await loadPlanning(job!, settings);
  const techIds = formData.getAll("technician").map(String).filter(Boolean);
  const start = String(formData.get("start_date") ?? "").trim();
  const force = formData.get("force") === "on";
  if (!techIds.length) fail("Tick at least one technician.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) fail("Pick the start day.");
  if (!job!.plan_parts_done_at && staff.role_id !== "owner") fail("Parts have not planned the parts yet. Remind Parts, or the owner can release anyway.");
  if (plan.missing.length && !force) fail(`${plan.missing.length} part${plan.missing.length === 1 ? " is" : "s are"} not here yet (${plan.missing.map((p) => `${p.description}${p.expected_date ?? p.delivery_date ? ` · ${p.expected_date ?? p.delivery_date}` : ""}`).join(", ")}). Tick "Start with available parts" to release anyway.`);
  const { data: techs } = await admin.from("staff").select("id, display_name").in("id", techIds).eq("role_id", "technician").eq("is_active", true);
  if (!(techs ?? []).length) fail("Choose technicians.");
  const now = new Date().toISOString();
  await admin.from("jobs").update({ status: "in_work", stage: "work", stage_entered_at: now, plan_released_at: now, plan_released_by: staff.id, plan_start_date: start, plan_release_note: force && plan.missing.length ? `Started with available parts; missing: ${plan.missing.map((p) => p.description).join(", ")}` : null, work_started_at: now, assigned_to: techs![0].id, parts_state: plan.missing.length ? (plan.parts.some((p) => p.order_status === "ordered" || p.order_status === "partly_received") ? "ordered" : "ordering") : plan.parts.length ? "received" : "none" }).eq("id", jobId);
  for (const t of techs ?? []) await addTechnician(jobId, t.id, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  const made = await ensureWorkLines(jobId, staff.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: job!.status, to_status: "in_work", note: `Released to the workshop by ${staff.display_name}: start ${start}, ${(techs ?? []).map((t) => t.display_name).join(", ")}${force && plan.missing.length ? ` · started with available parts (${plan.missing.length} missing)` : ""}${made ? ` · ${made} work line${made === 1 ? "" : "s"}` : ""}`, created_by: staff.id });
  await notifyStaff((techs ?? []).map((t) => t.id), { type: "work_assigned", title: `Car for you · ${job!.job_number}`, body: `${staff.display_name} released it: start ${start}. Open it on the tablet.`, jobId, href: `/my-jobs/${jobId}` });
  await notifyStaff(await advisorIds(jobId, job!.gated_in_by), { type: "planning", title: `Confirm the finish date · ${job!.job_number}`, body: `Work starts ${start}${plan.suggestedFinish ? `, suggested finish ${plan.suggestedFinish}` : ""}. Confirm the date and tell the customer.`, jobId, href: `/jobs/${jobId}#planning` });
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent(`Released to ${(techs ?? []).map((t) => t.display_name).join(", ")}. The advisor confirms the finish date.`)}`);
}

/** The advisor confirms or changes the finish date and tells the customer. Never blocks the work. */
export async function confirmPromisedDate(jobId: string, formData: FormData) {
  const staff = await requirePermission("sendApproval");
  const admin = createAdminClient();
  const job = await jobOf(jobId);
  const fail = (m: string) => redirect(`/jobs/${jobId}?error=${encodeURIComponent(m)}#planning`);
  if (!job || !job.is_open) fail("This job is closed.");
  const date = String(formData.get("promised_at") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("Pick the finish date.");
  if (date < dubaiDate()) fail("The finish date cannot be in the past.");
  const now = new Date().toISOString();
  await admin.from("jobs").update({ promised_at: date, plan_date_confirmed_at: now, plan_date_confirmed_by: staff.id }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "promised_date", note: `Finish date ${date} confirmed by ${staff.display_name}${job!.promised_at && job!.promised_at !== date ? ` (was ${job!.promised_at})` : ""}`, created_by: staff.id });
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent(`Promised date ${date} saved. Tell the customer.`)}#planning`);
}

/** Remind whoever holds the planning now. */
export async function remindPlanning(jobId: string) {
  const staff = await requireStaff();
  const admin = createAdminClient();
  const job = await jobOf(jobId);
  if (!job) redirect("/dashboard");
  const settings = await getSettings();
  const plan = await loadPlanning(job!, settings);
  const n = { type: "planning", title: `Reminder: planning waits on you · ${job!.job_number}`, body: `${staff.display_name} is waiting. ${plan.circles.find((c) => c.key === plan.waitingOn)?.line ?? ""}`, jobId, href: plan.waitingOn === "parts" ? `/parts/${jobId}` : `/jobs/${jobId}#planning` };
  if (plan.waitingOn === "parts") await notifyRoles(["parts"], n);
  else if (plan.waitingOn === "workshop") await notifyManagers(job!.department ?? null, n);
  else if (plan.waitingOn === "advisor") await notifyStaff(await advisorIds(jobId, job!.gated_in_by), n);
  else redirect(`/jobs/${jobId}?message=${encodeURIComponent("Planning is complete; nobody to remind.")}`);
  await admin.from("jobs").update({ plan_reminded_at: new Date().toISOString() }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "planning", note: `${staff.display_name} reminded ${plan.waitingOn === "parts" ? "Parts" : plan.waitingOn === "workshop" ? "the workshop manager" : "the advisor"} about the planning`, created_by: staff.id });
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent("Reminder sent.")}#planning`);
}

/** A technician put on the car by the manager from the job card or the work order (also back after leaving). */
export async function putTechnicianOnCar(jobId: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  const role = staff.role_id as RoleId;
  if (!can(role, "manageWork")) redirect(`/jobs/${jobId}`);
  const res = await addTechnician(jobId, String(formData.get("technician") ?? ""), { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  refresh(jobId);
  redirect(`/jobs/${jobId}/work?${res.error ? "error" : "message"}=${encodeURIComponent(res.error ?? res.message ?? "Done.")}`);
}
