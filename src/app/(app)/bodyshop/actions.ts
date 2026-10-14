"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentStaff, requirePermission, requireStaff } from "@/lib/auth";
import { signoffKeyOf, type SignoffKey, type StageSection } from "@/lib/bodyshop-kinds";
import { addRemovedItem, addStage, assignPerson, bookArrival, clockIn, clockOut, createBodyshopJob, markUpdateSent, moveStage, notReady, recordUpdate, removeStage, reopenStage, requestDeposit, setAfterPhoto, setStageDone, setStageDue, signOff, startBodyshopWork, tickRefitted, unassignPerson } from "@/lib/bodyshop";
import { blankToNull } from "@/lib/format";
import { approvedQuotations } from "@/lib/quote-data";
import { verifyPin } from "@/lib/pin";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

const enc = encodeURIComponent;
function refresh(jobId?: string | null) {
  revalidatePath("/bodyshop");
  revalidatePath("/bodyshop/mine");
  revalidatePath("/board/bodyshop");
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
export async function createBodyshopQuote(formData: FormData) {
  const staff = await requirePermission("bodyshopQuote");
  const customerId = String(formData.get("customer_id") ?? "");
  const vehicleId = String(formData.get("vehicle_id") ?? "");
  if (!customerId || !vehicleId) redirect(`/bodyshop/new?error=${enc("Choose the customer and the car. Add the car first if it is not on the list.")}`);
  const r = await createBodyshopJob(customerId, vehicleId, staff, await getSettings());
  if (r.error || !r.jobId) redirect(`/bodyshop/new?error=${enc(r.error ?? "Could not start the quotation.")}`);
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
  const out = formData.get("out") === "1";
  if (out) await clockOut(staffId, staff.id);
  else await clockIn(jobId, staffId, "leader", staff.id);
  refresh(jobId);
  back(jobId, null, out ? "Clocked out." : "Clocked in.", "#people");
}

export async function removedItemAction(jobId: string, formData: FormData) {
  const staff = await leader();
  const r = await addRemovedItem(jobId, String(formData.get("label") ?? ""), blankToNull(formData.get("photo_path")), staff);
  refresh(jobId);
  back(jobId, r, "Written down.", "#removed");
}
export async function refitTickAction(jobId: string, itemId: string, formData: FormData) {
  const staff = await leader();
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
  const kind = String(formData.get("kind") ?? "") as "arrived" | "film" | "ready";
  if (!["arrived", "film", "ready"].includes(kind)) back(jobId, { error: "Which update?" }, "");
  await recordUpdate(jobId, kind, blankToNull(formData.get("photo_id")), staff);
  refresh(jobId);
  back(jobId, null, "Photo chosen. Send the message from the Updates box.", "#updates");
}
export async function updateSentAction(jobId: string, formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff) return;
  const kind = String(formData.get("kind") ?? "") as "arrived" | "film" | "ready";
  if (["arrived", "film", "ready"].includes(kind)) await markUpdateSent(jobId, kind, staff);
  refresh(jobId);
}
export async function afterPhotoAction(jobId: string, formData: FormData) {
  const staff = await leader();
  await setAfterPhoto(jobId, blankToNull(formData.get("photo_id")), staff);
  refresh(jobId);
  back(jobId, null, "After photo chosen for the handover page.", "#updates");
}

/** The electricians' Done on the mechanical side. */
export async function electricalDoneAction(jobId: string, stageId: string) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "manageWork") || role === "technician") || staff.viewingAs) redirect("/assign");
  const r = await setStageDone(stageId, staff, await getSettings());
  refresh(jobId);
  redirect(`/assign?${r.error ? `error=${enc(r.error)}` : `message=${enc("Electrical reset done; the bodyshop has been told.")}`}`);
}
