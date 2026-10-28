"use server";

import { redirect } from "next/navigation";
import { jobAdvisorIds as advisorsInCharge } from "@/lib/notifications";
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
import { addTechnician, removeTechnician, setLeadTechnician } from "@/lib/work-flow";
import { releaseWords, sideReleased, sidesToRelease, type Side } from "@/lib/job-sides";
import { checkPickable } from "@/lib/staff-picker";
import { assignPerson, extendBodyshopStages, startBodyshopWork } from "@/lib/bodyshop";
import { sideOfDepartment } from "@/lib/inspection";
import { unassignPerson } from "@/lib/bodyshop";
import { workSidesOf } from "@/lib/staff-picker";

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
  void gatedInBy;
  return advisorsInCharge(jobId);
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
  await notifyManagers(job!.department ?? null, { type: "planning", title: `Plan the work · ${job!.job_number}`, body: `${plan.missing.length ? `Parts all here by ${plan.partsReadyDate}` : "All parts in stock"}. ${releaseWords(job!.department)}`, jobId, href: `/jobs/${jobId}#planning` });
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

/**
 * Checks shared by both releases: the job is open and in planning (or, on a mixed car, the other side already went),
 * this side is still to release, the person is this side's manager (or the owner), the start day, the parts.
 */
async function releaseChecks(jobId: string, formData: FormData, side: Side, staff: { id: string; role_id: string; department_id?: string | null }) {
  const job = await jobOf(jobId);
  const fail = (m: string): never => redirect(`/jobs/${jobId}?error=${encodeURIComponent(m)}#planning`);
  if (!job || !job.is_open) return fail("This job is closed.");
  const settings = await getSettings();
  const plan = await loadPlanning(job, settings);
  const words = side === "bodyshop" ? "the bodyshop" : "the workshop";
  if (!plan.sides.includes(side)) return fail(`This car has no ${side === "bodyshop" ? "bodyshop" : "mechanical"} work to release.`);
  if (sideReleased(job, side)) return fail(`Already released to ${words}.`);
  const otherWent = plan.sides.some((s) => s !== side && sideReleased(job, s));
  if (!["approved", "waiting_parts"].includes(job.status) && !(otherWent && !["closed", "in_delivery", "booked"].includes(job.status))) return fail("This car is not in planning.");
  if (staff.role_id !== "owner") {
    const mine = sideOfDepartment(staff.department_id);
    if (mine && mine !== side) return fail(`Only ${side === "bodyshop" ? "the bodyshop manager" : "the workshop manager"} releases ${words} side of this car.`);
  }
  const start = String(formData.get("start_date") ?? "").trim();
  const force = formData.get("force") === "on";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return fail("Pick the start day.");
  if (!job.plan_parts_done_at && staff.role_id !== "owner") return fail("Parts have not planned the parts yet. Remind Parts, or the owner can release anyway.");
  if (plan.missing.length && !force) return fail(`${plan.missing.length} part${plan.missing.length === 1 ? " is" : "s are"} not here yet (${plan.missing.map((p) => `${p.description}${p.expected_date ?? p.delivery_date ? ` · ${p.expected_date ?? p.delivery_date}` : ""}`).join(", ")}). Tick "Start with available parts" to release anyway.`);
  const picked = await checkPickable(formData.getAll("technician").map(String), [side]);
  if (picked.error) return fail(picked.error);
  return { job, plan, settings, start, force, people: picked.people, fail };
}
const partsStateOf = (plan: Awaited<ReturnType<typeof loadPlanning>>) => (plan.missing.length ? (plan.parts.some((p) => p.order_status === "ordered" || p.order_status === "partly_received") ? "ordered" : "ordering") : plan.parts.length ? "received" : "none");

/** The workshop manager picks the start day and the technicians and releases the mechanical work; only then does the technician get it. */
export async function releaseToWorkshop(jobId: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  const admin = createAdminClient();
  const { job, plan, start, force, people: techs } = await releaseChecks(jobId, formData, "mechanical", staff);
  const now = new Date().toISOString();
  const first = ["approved", "waiting_parts"].includes(job.status);
  const missingNote = force && plan.missing.length ? `Started with available parts; missing: ${plan.missing.map((p) => p.description).join(", ")}` : null;
  // A "both" car whose approved work is mechanical only: the bodyshop side has nothing to release.
  const bodyNothing = job.department === "both" && !plan.sides.includes("bodyshop") && !job.plan_bodyshop_released_at;
  await admin.from("jobs").update({ plan_released_at: now, plan_released_by: staff.id, plan_start_date: start, plan_release_note: missingNote, ...(bodyNothing ? { plan_bodyshop_released_at: now, plan_bodyshop_released_by: staff.id } : {}), ...(first ? { status: "in_work", stage: "work", stage_entered_at: now, work_started_at: now, parts_state: partsStateOf(plan) } : {}), assigned_to: techs[0].id }).eq("id", jobId);
  for (const t of techs) await addTechnician(jobId, t.id, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  const made = await ensureWorkLines(jobId, staff.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: first ? "status_change" : "planning", from_status: first ? job.status : null, to_status: first ? "in_work" : null, note: `Released to the workshop by ${staff.display_name}: start ${start}, ${techs.map((t) => t.display_name).join(", ")}${force && plan.missing.length ? ` · started with available parts (${plan.missing.length} missing)` : ""}${made ? ` · ${made} work line${made === 1 ? "" : "s"}` : ""}`, created_by: staff.id });
  await notifyStaff(techs.map((t) => t.id), { type: "work_assigned", title: `Car for you · ${job.job_number}`, body: `${staff.display_name} released it: start ${start}. Open it on the tablet.`, jobId, href: `/my-jobs/${jobId}` });
  await afterRelease(jobId, job, plan, start, staff);
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent(`Released to ${techs.map((t) => t.display_name).join(", ")}.${sidesToRelease({ ...job, plan_released_at: now }, plan.sides).length ? " The bodyshop manager releases the bodyshop side." : " The advisor confirms the finish date."}`)}`);
}

/**
 * The bodyshop manager picks the start day and the bodyshop team and releases the car to the bodyshop: the people are
 * put on the car in their team's section, the stages are built from the approved packages with due dates from the
 * start day, and the first stage's team is told. No mechanical work order on a bodyshop-only car.
 */
export async function releaseToBodyshop(jobId: string, formData: FormData) {
  const staff = await requirePermission("manageBodyshop");
  const admin = createAdminClient();
  const { job, plan, settings, start, force, people, fail } = await releaseChecks(jobId, formData, "bodyshop", staff);
  const actor = { id: staff.id, display_name: staff.display_name, role_id: staff.role_id };
  // The stages first (nothing is written when the approved quotation has no bodyshop work), then the people.
  // A mixed car whose mechanical side is not released yet stays in planning: the technicians get it at their own release.
  const mechanicalWaits = plan.sides.includes("mechanical") && !sideReleased(job, "mechanical");
  const started = await startBodyshopWork(jobId, actor, settings, { start, keepStatus: mechanicalWaits });
  if (started.error) fail(started.error);
  if (started.started === false) {
    await extendBodyshopStages(jobId, actor);
    if (["approved", "waiting_parts"].includes(job.status) && !mechanicalWaits) {
      const at = new Date().toISOString();
      await admin.from("jobs").update({ status: "in_work", stage: "work", stage_entered_at: at, updated_by: staff.id }).eq("id", jobId);
      await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: job.status, to_status: "in_work", note: `Back on the bodyshop stages (${staff.display_name})`, created_by: staff.id });
    }
  }
  for (const p of people) {
    const r = await assignPerson(jobId, p.id, actor);
    if (r.error) fail(r.error);
  }
  const now = new Date().toISOString();
  const missingNote = force && plan.missing.length ? `Started with available parts; missing: ${plan.missing.map((p) => p.description).join(", ")}` : null;
  // On a bodyshop-only car (or a "both" car with bodyshop work only) this IS the job's release.
  const only = !plan.sides.includes("mechanical");
  await admin.from("jobs").update({ plan_bodyshop_released_at: now, plan_bodyshop_released_by: staff.id, plan_bodyshop_start_date: start, ...(only ? { plan_released_at: now, plan_released_by: staff.id, plan_start_date: start, plan_release_note: missingNote } : {}), parts_state: partsStateOf(plan), ...(job.assigned_to ? {} : { assigned_to: people[0].id }) }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "planning", note: `Released to the bodyshop by ${staff.display_name}: start ${start}, ${people.map((p) => `${p.display_name}${p.isLeader ? " (leader)" : ""}`).join(", ")}${force && plan.missing.length ? ` · started with available parts (${plan.missing.length} missing)` : ""}`, created_by: staff.id });
  await afterRelease(jobId, { ...job, plan_bodyshop_released_at: now, ...(only ? { plan_released_at: now } : {}) }, plan, start, staff);
  refresh(jobId);
  revalidatePath("/bodyshop");
  revalidatePath(`/bodyshop/${jobId}`);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent(`Released to the bodyshop: ${people.map((p) => p.display_name).join(", ")}.${only || sideReleased(job, "mechanical") ? " The advisor confirms the finish date." : " The workshop manager releases the mechanical side."}`)}`);
}

/** When every side is released, the advisor is asked to confirm the finish date. */
async function afterRelease(jobId: string, job: JobRow, plan: Awaited<ReturnType<typeof loadPlanning>>, start: string, staff: { id: string }) {
  void staff;
  const fresh = await jobOf(jobId);
  if (!fresh || sidesToRelease(fresh, plan.sides).length) return;
  await notifyStaff(await advisorIds(jobId, job.gated_in_by), { type: "planning", title: `Confirm the finish date · ${job.job_number}`, body: `Work starts ${start}${plan.suggestedFinish ? `, suggested finish ${plan.suggestedFinish}` : ""}. Confirm the date and tell the customer.`, jobId, href: `/jobs/${jobId}#planning` });
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
  else if (plan.waitingOn === "workshop") await notifyManagers("mechanical", n);
  else if (plan.waitingOn === "bodyshop") await notifyManagers("bodyshop", n);
  else if (plan.waitingOn === "both_sides") await notifyManagers("both", n);
  else if (plan.waitingOn === "advisor") await notifyStaff(await advisorIds(jobId, job!.gated_in_by), n);
  else redirect(`/jobs/${jobId}?message=${encodeURIComponent("Planning is complete; nobody to remind.")}`);
  await admin.from("jobs").update({ plan_reminded_at: new Date().toISOString() }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "planning", note: `${staff.display_name} reminded ${plan.waitingOn === "parts" ? "Parts" : plan.waitingOn === "workshop" ? "the workshop manager" : plan.waitingOn === "bodyshop" ? "the bodyshop manager" : plan.waitingOn === "both_sides" ? "the workshop and bodyshop managers" : "the advisor"} about the planning`, created_by: staff.id });
  refresh(jobId);
  redirect(`/jobs/${jobId}?message=${encodeURIComponent("Reminder sent.")}#planning`);
}

const techBack = (jobId: string, formData: FormData, res: { error?: string; message?: string }) => {
  const from = String(formData.get("from") ?? "job");
  const base = from === "work" ? `/jobs/${jobId}/work` : `/jobs/${jobId}`;
  redirect(`${base}?${res.error ? "error" : "message"}=${encodeURIComponent(res.error ?? res.message ?? "Done.")}#technicians`);
};

/**
 * One tap on a name in the shared picker (job card or work order): a mechanical person goes onto the car's technicians,
 * a bodyshop person onto the bodyshop board in their team's section. Only the car's sides; a side's manager adds only
 * their own side's people.
 */
export async function addTechnicianToJob(jobId: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  const actor = { id: staff.id, display_name: staff.display_name, role_id: staff.role_id };
  const job = await jobOf(jobId);
  if (!job || !job.is_open) return techBack(jobId, formData, { error: "This job is closed." });
  const sides = await workSidesOf(jobId, job.department);
  const mySide = staff.role_id === "owner" ? null : sideOfDepartment(staff.department_id);
  const picked = await checkPickable([String(formData.get("technician") ?? "")], mySide ? sides.filter((s) => s === mySide) : sides);
  if (picked.error) return techBack(jobId, formData, { error: picked.error });
  const person = picked.people[0];
  if (person.side === "mechanical" && ["gate_in_pending", "pending_approval"].includes(job.status)) return techBack(jobId, formData, { error: "Use Assign technician for the first mechanic: it sets the inspection and the road test." });
  const res = person.side === "bodyshop" ? await assignPerson(jobId, person.id, actor).then((r) => (r.error ? r : { message: `${person.display_name} is on the car (${person.section === "strip_refit" ? "Dismantle & refit" : person.section === "ppf" ? "PPF" : person.section === "paint" ? "Painting" : "Detailing & cleaning"}).` })) : await addTechnician(jobId, person.id, actor);
  refresh(jobId);
  revalidatePath(`/bodyshop/${jobId}`);
  techBack(jobId, formData, res);
}

/** "Take off" for a bodyshop person on the car (job card or work order). */
export async function removeBodyshopPersonFromJob(jobId: string, staffId: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  if (staff.role_id !== "owner" && sideOfDepartment(staff.department_id) === "mechanical") return techBack(jobId, formData, { error: "The bodyshop manager takes bodyshop people off the car." });
  await unassignPerson(jobId, staffId, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  refresh(jobId);
  revalidatePath(`/bodyshop/${jobId}`);
  techBack(jobId, formData, { message: "Taken off the car." });
}

/** "Take off": the technician leaves the car; the lead passes on if needed. */
export async function removeTechnicianFromJob(jobId: string, staffId: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  if (staff.role_id !== "owner" && sideOfDepartment(staff.department_id) === "bodyshop") return techBack(jobId, formData, { error: "The workshop manager changes the mechanical technicians." });
  const res = await removeTechnician(jobId, staffId, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  refresh(jobId);
  techBack(jobId, formData, res);
}

/** "Make lead": another technician on the car carries the job and the inspection. */
export async function makeLeadTechnician(jobId: string, staffId: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  if (staff.role_id !== "owner" && sideOfDepartment(staff.department_id) === "bodyshop") return techBack(jobId, formData, { error: "The workshop manager changes the mechanical lead." });
  const res = await setLeadTechnician(jobId, staffId, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  refresh(jobId);
  techBack(jobId, formData, res);
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
