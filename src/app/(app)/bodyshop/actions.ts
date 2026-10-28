"use server";

import { chooserValues, resolveCustomerCar } from "@/lib/customer-car";
import { formValues, type FormState } from "@/lib/form-state";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentStaff, requirePermission, requireStaff } from "@/lib/auth";
import { signoffKeyOf, type SignoffKey, type StageSection } from "@/lib/bodyshop-kinds";
import { addRemovedItem, addStage, assignPerson, bodyshopPeople, bookArrival, clockIn, clockOut, createBodyshopJob, markUpdateSent, moveStage, notReady, recordUpdate, removeStage, reopenStage, requestDeposit, setAfterPhoto, setStageDone, setStageDue, signOff, startBodyshopWork, tickRefitted, unassignPerson } from "@/lib/bodyshop";
import { blankToNull } from "@/lib/format";
import { approvedQuotations } from "@/lib/quote-data";
import { verifyPin } from "@/lib/pin";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { bodyshopScopeOf, isBodyshopManagerScope, mayActOnSection, mayPickPerson } from "@/lib/team-scope";
import { jobAdvisorIds, notifyStaff } from "@/lib/notifications";

const enc = encodeURIComponent;
function refresh(jobId?: string | null) {
  revalidatePath("/bodyshop");
  revalidatePath("/bodyshop/mine");
  revalidatePath("/tablet/bodyshop");
  revalidatePath("/assign");
  revalidatePath("/dashboard");
  if (jobId) {
    revalidatePath(`/bodyshop/${jobId}`);
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/gate-out`);
  }
}
const back = (jobId: string, res: { error?: string } | null, message: string, hash = "") => redirect(`/bodyshop/${jobId}?${res?.error ? `error=${enc(res.error)}` : `message=${enc(message)}`}${hash}`);

/** The advisor's quotation before the car arrives: customer and car, then the usual builder. */
export async function createBodyshopQuote(_state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("bodyshopQuote");
  const values = formValues(formData);
  // The customer and the car from the three-choice chooser (created here when they are new).
  const picked = await resolveCustomerCar(formData, staff);
  if ("error" in picked) return { error: picked.error, values: chooserValues(values, picked) };
  const r = await createBodyshopJob(picked.customerId, picked.vehicleId, staff, await getSettings());
  if (r.error || !r.jobId) return { error: r.error ?? "Could not start the quotation.", values };
  refresh(r.jobId);
  redirect(`/jobs/${r.jobId}/quote/${r.quotationId}`);
}

/** The arrival and the promised handover, on the job and the calendar. */
export async function bookArrivalAction(jobId: string, formData: FormData) {
  const staff = await requirePermission("bodyshopQuote");
  const date = String(formData.get("arrival_date") ?? "").trim();
  const time = String(formData.get("arrival_time") ?? "10:00").trim() || "10:00";
  const promised = String(formData.get("promised_at") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(promised)) back(jobId, { error: "Pick the arrival day and the handover day." }, "");
  if (promised < date) back(jobId, { error: "The handover cannot be before the arrival." }, "");
  const r = await bookArrival(jobId, new Date(`${date}T${time}:00+04:00`).toISOString(), promised, staff);
  refresh(jobId);
  revalidatePath("/calendar");
  back(jobId, r, "Booked: the arrival is on the calendar and the handover date is on the job.");
}

/** "Request deposit": an amount, or a percentage of the approved quotation. */
export async function requestDepositAction(jobId: string, formData: FormData) {
  const staff = await requirePermission("bodyshopQuote");
  const settings = await getSettings();
  const quotes = await approvedQuotations(jobId);
  const total = quotes[0]?.total_aed ?? 0;
  const raw = String(formData.get("amount") ?? "").trim().replace(",", ".");
  const kind = String(formData.get("kind") ?? "aed");
  const n = Number(raw.replace(/[^\d.]/g, ""));
  const amount = kind === "percent" ? Math.round(total * (Math.min(100, Math.max(0, n)) / 100) * 100) / 100 : Math.round(n * 100) / 100;
  const r = await requestDeposit(jobId, amount, staff, settings);
  refresh(jobId);
  back(jobId, r, r.number ? `${r.number} prepared for AED ${amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}. Send the proforma link from the job card; the payment is recorded against it and deducted from the final invoice.` : "", "#deposit");
}

/** "Start the work" by hand (the gate-in normally starts it by itself once the photos are in). */
export async function startWorkAction(jobId: string) {
  const staff = await requirePermission("manageBodyshop");
  const { data: jp } = await createAdminClient().from("jobs").select("status").eq("id", jobId).maybeSingle();
  if (jp && ["approved", "waiting_parts"].includes(String(jp.status))) back(jobId, { error: "This car is in planning: release it from the Planning card on the job card (Release to bodyshop)." }, "");
  const r = await startBodyshopWork(jobId, staff, await getSettings());
  refresh(jobId);
  back(jobId, r, r.started ? "The stages are set and the first section has been told." : "The work had already started.");
}

async function leader() {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!can(role, "leadSection") || staff.viewingAs) redirect("/home");
  return staff;
}

export async function stageDoneAction(jobId: string, stageId: string) {
  const staff = await leader();
  if (!isBodyshopManagerScope(bodyshopScopeOf(staff))) back(jobId, { error: "A team signs its stage off with photos and the leader's PIN (Done on the stage)." }, "", "#stages");
  const r = await setStageDone(stageId, staff, await getSettings());
  refresh(jobId);
  back(jobId, r, "Stage done. The next section has been told.", "#stages");
}
export async function reopenStageAction(jobId: string, stageId: string) {
  const staff = await requirePermission("manageBodyshop");
  const r = await reopenStage(stageId, staff);
  refresh(jobId);
  back(jobId, r, "Stage reopened.", "#stages");
}
export async function setStageDueAction(jobId: string, stageId: string, formData: FormData) {
  const staff = await requirePermission("manageBodyshop");
  const r = await setStageDue(stageId, String(formData.get("date") ?? ""), staff);
  refresh(jobId);
  back(jobId, r, "Due date saved.", "#stages");
}
export async function addStageAction(jobId: string, formData: FormData) {
  const staff = await requirePermission("manageBodyshop");
  const key = blankToNull(formData.get("key"));
  const label = blankToNull(formData.get("label"));
  const section = String(formData.get("section") ?? "detailing") as StageSection;
  const r = await addStage(jobId, key && key !== "custom" ? key : null, label ? { label, section } : null, staff);
  refresh(jobId);
  back(jobId, r, "Stage added.", "#stages");
}
export async function removeStageAction(jobId: string, stageId: string) {
  const staff = await requirePermission("manageBodyshop");
  const r = await removeStage(stageId, staff);
  refresh(jobId);
  back(jobId, r, "Stage removed.", "#stages");
}
export async function moveStageAction(jobId: string, stageId: string, direction: -1 | 1) {
  const staff = await requirePermission("manageBodyshop");
  const r = await moveStage(stageId, direction, staff);
  refresh(jobId);
  back(jobId, r, "Order changed.", "#stages");
}

/** A leader puts someone on a car (their own team or anyone, "Need help"), or takes them off. */
export async function assignAction(jobId: string, formData: FormData) {
  const staff = await leader();
  const staffId = String(formData.get("staff_id") ?? "");
  const off = formData.get("off") === "1";
  const refusal = await personRefusal(staff, jobId, staffId);
  if (refusal) {
    if (String(formData.get("from") ?? "") === "mine") redirect(`/bodyshop/mine?error=${enc(refusal)}`);
    back(jobId, { error: refusal }, "", "#people");
  }
  const r = off ? await unassignPerson(jobId, staffId, staff) : await assignPerson(jobId, staffId, staff);
  refresh(jobId);
  const from = String(formData.get("from") ?? "");
  const err = (r as { error?: string }).error;
  if (from === "mine") redirect(`/bodyshop/mine?${err ? `error=${enc(err)}` : `message=${enc(off ? "Taken off the car." : "On the car.")}`}`);
  back(jobId, r, off ? "Taken off the car." : "On the car.", "#people");
}

/** The leader clocks someone in or out from the job page (the tablet does the same with a PIN). */
export async function clockAction(jobId: string, formData: FormData) {
  const staff = await leader();
  const staffId = String(formData.get("staff_id") ?? "");
  const refusal = await personRefusal(staff, jobId, staffId);
  if (refusal) return sendBack(jobId, formData, { error: refusal }, "", "#people");
  const out = formData.get("out") === "1";
  if (out) await clockOut(staffId, staff.id);
  else await clockIn(jobId, staffId, "leader", staff.id);
  refresh(jobId);
  revalidatePath("/bodyshop/mine");
  return sendBack(jobId, formData, null, out ? "Clocked off." : "Clocked on.", "#people");
}

export async function removedItemAction(jobId: string, formData: FormData) {
  const staff = await leader();
  if (!isBodyshopManagerScope(bodyshopScopeOf(staff))) back(jobId, { error: "The bodyshop manager records what came off the car." }, "", "#removed");
  const r = await addRemovedItem(jobId, String(formData.get("label") ?? ""), blankToNull(formData.get("photo_path")), staff);
  refresh(jobId);
  back(jobId, r, "Written down.", "#removed");
}
export async function refitTickAction(jobId: string, itemId: string, formData: FormData) {
  const staff = await leader();
  if (!isBodyshopManagerScope(bodyshopScopeOf(staff))) back(jobId, { error: "The bodyshop manager ticks the items back on." }, "", "#removed");
  await tickRefitted(itemId, formData.get("on") === "1", staff);
  refresh(jobId);
  back(jobId, null, "Saved.", "#removed");
}

/** One tap with the PIN: the sign-off for the role the person holds; the owner signs for anyone, no PIN. */
export async function signOffAction(jobId: string, formData: FormData) {
  const staff = await requireStaff();
  if (staff.viewingAs) redirect(`/bodyshop/${jobId}`);
  const role = staff.role_id as RoleId;
  const wanted = String(formData.get("role_key") ?? "") as SignoffKey;
  const own = signoffKeyOf(role, staff.department_id);
  const onBehalf = role === "owner" && own !== wanted;
  if (role !== "owner" && own !== wanted) back(jobId, { error: "That sign-off is for another person." }, "", "#signoff");
  if (role !== "owner") {
    const pin = String(formData.get("pin") ?? "").trim();
    const { data: priv } = await createAdminClient().from("staff_private").select("pin_hash").eq("staff_id", staff.id).maybeSingle();
    if (!verifyPin(pin, priv?.pin_hash)) back(jobId, { error: "The PIN is wrong." }, "", "#signoff");
  }
  const r = await signOff(jobId, wanted, staff, onBehalf);
  refresh(jobId);
  back(jobId, r, r.complete ? "Signed. Every sign-off is in: the car can be handed over." : "Signed.", "#signoff");
}

export async function notReadyAction(jobId: string, formData: FormData) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const own = signoffKeyOf(role, staff.department_id);
  const wanted = String(formData.get("role_key") ?? "") as SignoffKey;
  if (!(role === "owner" || own === wanted)) back(jobId, { error: "That decision is for another person." }, "", "#signoff");
  const r = await notReady(jobId, wanted, String(formData.get("reason") ?? ""), staff, await getSettings());
  refresh(jobId);
  back(jobId, r, "Sent back. Everyone involved has been told and the handover moved.", "#signoff");
}

/** A customer update: the chosen photo is saved and the link made; "Sent" is written down after the WhatsApp. */
export async function updatePhotoAction(jobId: string, formData: FormData) {
  const staff = await leader();
  if (!isBodyshopManagerScope(bodyshopScopeOf(staff))) back(jobId, { error: "The customer's updates go out from the bodyshop manager or the advisor." }, "", "#updates");
  const kind = String(formData.get("kind") ?? "") as "arrived" | "film" | "ready";
  if (!["arrived", "film", "ready"].includes(kind)) back(jobId, { error: "Which update?" }, "");
  await recordUpdate(jobId, kind, blankToNull(formData.get("photo_id")), staff);
  refresh(jobId);
  back(jobId, null, "Photo chosen. Send the message from the Updates box.", "#updates");
}
export async function updateSentAction(jobId: string, formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return;
  if (!isBodyshopManagerScope(bodyshopScopeOf(staff)) && !can(staff.role_id as RoleId, "bodyshopQuote")) return;
  const kind = String(formData.get("kind") ?? "") as "arrived" | "film" | "ready";
  if (["arrived", "film", "ready"].includes(kind)) await markUpdateSent(jobId, kind, staff);
  refresh(jobId);
}
export async function afterPhotoAction(jobId: string, formData: FormData) {
  const staff = await leader();
  if (!isBodyshopManagerScope(bodyshopScopeOf(staff))) back(jobId, { error: "The customer's after photo is chosen by the bodyshop manager or the advisor." }, "", "#updates");
  await setAfterPhoto(jobId, blankToNull(formData.get("photo_id")), staff);
  refresh(jobId);
  back(jobId, null, "After photo chosen for the handover page.", "#updates");
}

/** The electricians' Done on the mechanical side. */
export async function electricalDoneAction(jobId: string, stageId: string) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "manageWork") || role === "technician") || staff.viewingAs) redirect("/assign");
  const { data: es } = await createAdminClient().from("bodyshop_stages").select("job_id, section, status").eq("id", stageId).maybeSingle();
  if (!es || es.job_id !== jobId || es.section !== "electrical" || es.status !== "active") redirect(`/assign?error=${enc("That is not the electrical reset running on this car.")}`);
  const r = await setStageDone(stageId, staff, await getSettings());
  refresh(jobId);
  redirect(`/assign?${r.error ? `error=${enc(r.error)}` : `message=${enc("Electrical reset done; the bodyshop has been told.")}`}`);
}

/** The one server check for putting a person on a car or clocking them: an open job, and a person the actor may pick. */
async function personRefusal(staff: { role_id: string; department_id?: string | null; team?: string | null; viewingAs?: unknown }, jobId: string, staffId: string): Promise<string | null> {
  const admin = createAdminClient();
  const [{ data: job }, { data: person }] = await Promise.all([
    admin.from("jobs").select("is_open").eq("id", jobId).maybeSingle(),
    admin.from("staff").select("role_id, department_id, team, is_active").eq("id", staffId).maybeSingle(),
  ]);
  if (!job?.is_open) return "This job is closed.";
  if (!person?.is_active) return "Person not found.";
  const scope = bodyshopScopeOf(staff);
  if (!mayPickPerson(scope, person)) return scope.kind === "team" ? "You can put only your own team on a car." : "Only bodyshop people go on the bodyshop board.";
  return null;
}

const fromMine = (formData: FormData) => String(formData.get("from") ?? "") === "mine";
const sendBack = (jobId: string, formData: FormData, res: { error?: string } | null, message: string, hash: string) =>
  fromMine(formData) ? redirect(`/bodyshop/mine?${res?.error ? `error=${enc(res.error)}` : `message=${enc(message)}`}`) : back(jobId, res, message, hash);

/**
 * THE stage hand-over (B2): the team signs its stage off with photos of the finished work and the leader's own PIN
 * (the owner needs no PIN); only the stage's own team or a manager. The next team is told by setStageDone.
 */
export async function handOverStageAction(jobId: string, stageId: string, formData: FormData) {
  const staff = await leader();
  const admin = createAdminClient();
  const { data: st } = await admin.from("bodyshop_stages").select("id, job_id, key, label, section, status").eq("id", stageId).eq("is_active", true).maybeSingle();
  if (!st || st.job_id !== jobId) return sendBack(jobId, formData, { error: "Stage not found." }, "", "#stages");
  if (st.status !== "active") return sendBack(jobId, formData, { error: `${st.label} is not the stage running now.` }, "", "#stages");
  if (!mayActOnSection(bodyshopScopeOf(staff), st.section)) return sendBack(jobId, formData, { error: `${st.label} belongs to another team: its leader signs it off.` }, "", "#stages");
  const { count } = await admin.from("job_files").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "bodyshop_photo").eq("ref_id", stageId).is("removed_at", null);
  if (!count) return sendBack(jobId, formData, { error: "Add at least one photo of the finished work." }, "", "#stages");
  if (staff.role_id !== "owner") {
    const { data: priv } = await admin.from("staff_private").select("pin_hash").eq("staff_id", staff.id).maybeSingle();
    if (!verifyPin(String(formData.get("pin") ?? "").trim(), priv?.pin_hash)) return sendBack(jobId, formData, { error: "That is not your PIN. Try again." }, "", "#stages");
  }
  const r = await setStageDone(stageId, staff, await getSettings());
  if (r.error) return sendBack(jobId, formData, r, "", "#stages");
  await admin.from("bodyshop_stages").update({ handover_pin_at: staff.role_id === "owner" ? null : new Date().toISOString(), handover_by: staff.id, updated_by: staff.id }).eq("id", stageId);
  refresh(jobId);
  revalidatePath("/bodyshop/mine");
  return sendBack(jobId, formData, null, `${st.label} signed off (${count} photo${count === 1 ? "" : "s"}). The next team has been told.`, "#stages");
}

/** "Problem – needs manager": a leader (or a manager) raises it with words and a photo; the manager and the advisor in charge are told. */
export async function raiseProblemAction(jobId: string, formData: FormData) {
  const staff = await leader();
  const scope = bodyshopScopeOf(staff);
  if (scope.kind === "none") return sendBack(jobId, formData, { error: "Not allowed." }, "", "#problems");
  const id = String(formData.get("problem_id") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return sendBack(jobId, formData, { error: "Something went wrong. Open the problem window again." }, "", "#problems");
  if (text.length < 3) return sendBack(jobId, formData, { error: "Say what is wrong." }, "", "#problems");
  if (text.length > 1000) return sendBack(jobId, formData, { error: "Keep it under 1,000 characters." }, "", "#problems");
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, is_open").eq("id", jobId).maybeSingle();
  if (!job?.is_open) return sendBack(jobId, formData, { error: "This job is closed." }, "", "#problems");
  const stageId = String(formData.get("stage_id") ?? "") || null;
  const { data: photo } = await admin.from("job_files").select("storage_path").eq("job_id", jobId).eq("ref_id", id).eq("kind", "bodyshop_photo").eq("uploaded_by", staff.id).is("removed_at", null).order("created_at").limit(1).maybeSingle();
  const { error } = await admin.from("bodyshop_problems").insert({ id, job_id: jobId, stage_id: stageId, section: scope.kind === "team" ? scope.section : null, text, photo_path: photo?.storage_path ?? null, raised_by: staff.id, created_by: staff.id, updated_by: staff.id });
  if (error && /duplicate/i.test(error.message)) return sendBack(jobId, formData, null, "Already sent to the bodyshop manager and the advisor.", "#problems");
  if (error) return sendBack(jobId, formData, { error: "Couldn't save the problem. Try again." }, "", "#problems");
  await admin.from("job_events").insert({ job_id: jobId, event_type: "bodyshop_problem", note: `Problem raised by ${staff.display_name}: ${text}`, created_by: staff.id });
  const { managers } = await bodyshopPeople();
  const ids = Array.from(new Set([...managers.map((m) => m.id), ...(await jobAdvisorIds(jobId))])).filter((x) => x !== staff.id);
  await notifyStaff(ids, { type: "bodyshop_problem", title: `Problem · ${job.job_number}`, body: `${staff.display_name}: ${text}`, jobId, href: `/bodyshop/${jobId}#problems` });
  refresh(jobId);
  revalidatePath("/bodyshop/mine");
  return sendBack(jobId, formData, null, "Sent to the bodyshop manager and the advisor.", "#problems");
}

/** The bodyshop manager (or the owner) answers a problem; the leader who raised it is told. */
export async function answerProblemAction(jobId: string, problemId: string, formData: FormData) {
  const staff = await leader();
  if (!isBodyshopManagerScope(bodyshopScopeOf(staff))) back(jobId, { error: "The bodyshop manager answers problems." }, "", "#problems");
  const answer = String(formData.get("answer") ?? "").trim();
  if (answer.length < 2) back(jobId, { error: "Write the answer." }, "", "#problems");
  if (answer.length > 1000) back(jobId, { error: "Keep the answer under 1,000 characters." }, "", "#problems");
  const admin = createAdminClient();
  const { data: p } = await admin.from("bodyshop_problems").select("id, job_id, raised_by, text, answered_at").eq("id", problemId).maybeSingle();
  if (!p || p.job_id !== jobId) back(jobId, { error: "Problem not found." }, "", "#problems");
  const { data: changed } = await admin.from("bodyshop_problems").update({ answer, answered_at: new Date().toISOString(), answered_by: staff.id, updated_by: staff.id }).eq("id", problemId).is("answered_at", null).select("id");
  if (!(changed ?? []).length) back(jobId, null, "This problem was already answered.", "#problems");
  const { data: job } = await admin.from("jobs").select("job_number").eq("id", jobId).maybeSingle();
  await admin.from("job_events").insert({ job_id: jobId, event_type: "bodyshop_problem", note: `Problem answered by ${staff.display_name}: ${answer}`, created_by: staff.id });
  if (p!.raised_by && p!.raised_by !== staff.id) await notifyStaff([p!.raised_by], { type: "bodyshop_problem_answered", title: `Problem answered · ${job?.job_number ?? ""}`, body: `${staff.display_name}: ${answer}`, jobId, href: `/bodyshop/${jobId}#problems` });
  refresh(jobId);
  revalidatePath("/bodyshop/mine");
  back(jobId, null, "Answer sent.", "#problems");
}
