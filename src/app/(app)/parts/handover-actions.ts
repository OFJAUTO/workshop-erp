"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission, requireStaff } from "@/lib/auth";
import { getCurrentDevice } from "@/lib/devices";
import { blankToNull } from "@/lib/format";
import { approveGoodwill, cancelHandover, confirmHandover, exchangePart, partNotNeeded, requestHandover, setDisposition } from "@/lib/handover";
import { PARTS_BUCKET } from "@/lib/quote-data";
import { PART_FULL_SELECT, toPartFull } from "@/lib/parts-data";
import { verifyPin } from "@/lib/pin";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

function refresh(jobId: string) {
  revalidatePath(`/parts/handover/${jobId}`);
  revalidatePath(`/parts/trail/${jobId}`);
  revalidatePath(`/parts/${jobId}`);
  revalidatePath("/parts");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/work`);
  revalidatePath(`/my-jobs/${jobId}`);
  revalidatePath("/my-jobs");
}
const fail = (jobId: string, msg: string): never => redirect(`/parts/handover/${jobId}?error=${encodeURIComponent(msg)}`);
const actorOf = (s: { id: string; display_name: string; role_id: string }) => ({ id: s.id, display_name: s.display_name, role_id: s.role_id });

/**
 * "Hand over": Parts tick what they are giving now. The technician gets it on his own device and
 * confirms with his PIN there; or he signs at the counter; or a manager signs for him. Stickers
 * are printed on the way when any are asked for.
 */
export async function handoverParts(jobId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const settings = await getSettings();
  const ids = formData.getAll("part").map(String).filter(Boolean);
  const stickers: Record<string, number> = {};
  const battery: Record<string, { brand?: string | null; model?: string | null; serial?: string | null }> = {};
  for (const id of ids) {
    stickers[id] = Math.max(0, Math.round(Number(formData.get(`stickers__${id}`) ?? 0) || 0));
    const brand = blankToNull(formData.get(`battery_brand__${id}`));
    const model = blankToNull(formData.get(`battery_model__${id}`));
    const serial = blankToNull(formData.get(`battery_serial__${id}`));
    if (brand || model || serial) battery[id] = { brand, model, serial };
  }
  const r = await requestHandover(jobId, actorOf(staff), { technicianId: String(formData.get("technician") ?? ""), partIds: ids, stickers, note: blankToNull(formData.get("note")), battery }, settings);
  if (r.error || !r.handoverId) fail(jobId, r.error ?? "Could not start the handover.");
  refresh(jobId);
  if (formData.get("sign_for") === "on") {
    const role = staff.role_id as RoleId;
    if (!(role === "owner" || can(role, "manageWork"))) fail(jobId, "Only the workshop manager or the owner can sign for a technician.");
    if (!r.stickerCount) {
      const c = await confirmHandover(r.handoverId!, { actor: actorOf(staff), signedFor: true, pin: String(formData.get("signer_pin") ?? ""), deviceId: (await getCurrentDevice())?.id ?? null }, settings);
      refresh(jobId);
      redirect(`/parts/handover/${jobId}?${c.error ? "error" : "message"}=${encodeURIComponent(c.error ?? c.message ?? "Done.")}`);
    }
  }
  if (r.stickerCount) redirect(`/parts/handover/${jobId}?message=${encodeURIComponent(`Handover started. Print the ${r.stickerCount} sticker${r.stickerCount === 1 ? "" : "s"} from the box below (opens in a new tab); then the technician confirms.`)}`);
  redirect(`/parts/handover/${jobId}?message=${encodeURIComponent(r.message ?? "Waiting for the technician's PIN.")}`);
}

/** "Sign here" at the counter: the technician types his PIN on the Parts screen. Nothing else opens. */
export async function signHandoverAtCounter(handoverId: string, formData: FormData) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "managePurchaseOrders") || can(role, "manageWork"))) redirect("/parts");
  const settings = await getSettings();
  const jobId = String(formData.get("job_id") ?? "");
  const signFor = formData.get("sign_for") === "on";
  const receivedIds = formData.get("has_ticks") === "1" ? formData.getAll("received").map(String).filter(Boolean) : null;
  const r = await confirmHandover(handoverId, { actor: actorOf(staff), pin: signFor ? String(formData.get("signer_pin") ?? "") : String(formData.get("pin") ?? ""), atCounter: true, signedFor: signFor, receivedIds, deviceId: (await getCurrentDevice())?.id ?? null }, settings);
  refresh(jobId);
  redirect(`/parts/handover/${jobId}?${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? r.message ?? "Done.")}`);
}

/** The technician confirms on his own device, with his PIN. */
export async function confirmHandoverOnDevice(handoverId: string, formData: FormData): Promise<{ error?: string; ok?: boolean; message?: string }> {
  const staff = await requireStaff();
  const settings = await getSettings();
  const jobId = String(formData.get("job_id") ?? "");
  const receivedIds = formData.get("has_ticks") === "1" ? formData.getAll("received").map(String).filter(Boolean) : null;
  const r = await confirmHandover(handoverId, { actor: actorOf(staff), pin: String(formData.get("pin") ?? ""), receivedIds, deviceId: (await getCurrentDevice())?.id ?? null }, settings);
  if (jobId) refresh(jobId);
  return r;
}

/** Parts take a waiting handover back. */
export async function cancelHandoverAction(handoverId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const jobId = String(formData.get("job_id") ?? "");
  const r = await cancelHandover(handoverId, actorOf(staff));
  refresh(jobId);
  redirect(`/parts/handover/${jobId}?${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? r.message ?? "Done.")}`);
}

/** A part comes back from the workshop to the Parts desk: the reverse handover, with the Parts person's PIN when they have one. */
export async function returnToParts(jobId: string, formData: FormData) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "managePurchaseOrders") || can(role, "manageWork"))) fail(jobId, "Not allowed.");
  const admin = createAdminClient();
  const ids = formData.getAll("part").map(String).filter(Boolean);
  const note = blankToNull(formData.get("note"));
  const pin = String(formData.get("pin") ?? "").trim();
  if (!ids.length) fail(jobId, "Tick the parts that come back.");
  if (!note || note.length < 3) fail(jobId, "Say why the parts come back.");
  const { data: priv } = await admin.from("staff_private").select("pin_hash").eq("staff_id", staff.id).maybeSingle();
  if (priv?.pin_hash && !verifyPin(pin, priv.pin_hash)) fail(jobId, "Your PIN is wrong.");
  const { data: rows } = await admin.from("part_items").select(PART_FULL_SELECT).in("id", ids).eq("job_id", jobId).eq("is_active", true).eq("issue_status", "confirmed");
  const parts = ((rows ?? []) as unknown as Record<string, unknown>[]).map(toPartFull);
  if (!parts.length) fail(jobId, "Those parts are not with a technician.");
  const items = parts.map((p) => ({ id: p.id, description: p.description, part_number: p.part_number, quantity: p.issued_qty || 1 }));
  const { data: handover } = await admin.from("part_handovers").insert({ job_id: jobId, kind: "return", status: "confirmed", confirmed_at: new Date().toISOString(), from_staff: parts[0].issue_confirmed_by, to_staff: staff.id, confirmed_by: staff.id, pin_used: !!priv?.pin_hash, items, note, device_id: (await getCurrentDevice())?.id ?? null, created_by: staff.id, updated_by: staff.id }).select("id").single();
  for (const p of parts) await admin.from("part_items").update({ issue_status: "none", issued_qty: 0, issued_at: null, issued_by: null, issue_confirmed_at: null, issue_confirmed_by: null, handover_id: handover?.id ?? null, return_status: "none", updated_by: staff.id }).eq("id", p.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "part_return", note: `${items.length} part${items.length === 1 ? "" : "s"} back with Parts (${staff.display_name}): ${items.map((i) => i.description).join(", ")}. ${note}`, created_by: staff.id });
  refresh(jobId);
  redirect(`/parts/handover/${jobId}?message=${encodeURIComponent(`${items.length} part${items.length === 1 ? "" : "s"} back with Parts.`)}`);
}

/** A shelf label for one part, made on demand (labels are off by default). */
export async function makeLabel(jobId: string, partId: string) {
  const staff = await requirePermission("managePurchaseOrders");
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, label_code").eq("id", partId).eq("job_id", jobId).maybeSingle();
  if (!p) redirect(`/parts/${jobId}?error=${encodeURIComponent("Part not found.")}`);
  if (!p!.label_code) {
    const { newLabelCode } = await import("@/lib/parts-data");
    await admin.from("part_items").update({ label_code: newLabelCode(), updated_by: staff.id }).eq("id", partId);
  }
  redirect(`/parts/labels/${jobId}?part=${partId}`);
}

const outcome = (jobId: string, r: { error?: string; message?: string }, to = `/parts/handover/${jobId}`): never => redirect(`${to}?${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? r.message ?? "Done.")}`);
const canSettle = (role: RoleId) => role === "owner" || can(role, "managePurchaseOrders") || can(role, "manageWork") || role === "technician";

/** "Wrong or faulty part": back to the supplier, the correct one raised for ordering. Parts, the manager, the technician on the car, or the owner. */
export async function exchangePartAction(jobId: string, formData: FormData) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const to = String(formData.get("back") ?? `/parts/handover/${jobId}`);
  if (!canSettle(role) || staff.viewingAs) outcome(jobId, { error: "Not allowed." }, to);
  const r = await exchangePart(jobId, String(formData.get("part") ?? ""), actorOf(staff), { reason: String(formData.get("reason") ?? ""), note: blankToNull(formData.get("note")) });
  refresh(jobId);
  outcome(jobId, r, to);
}

/** "Not needed": the part is not used on this car; Parts decide its ending. */
export async function notNeededAction(jobId: string, formData: FormData) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const to = String(formData.get("back") ?? `/parts/handover/${jobId}`);
  if (!canSettle(role) || staff.viewingAs) outcome(jobId, { error: "Not allowed." }, to);
  const r = await partNotNeeded(jobId, String(formData.get("part") ?? ""), actorOf(staff), String(formData.get("reason") ?? ""));
  refresh(jobId);
  outcome(jobId, r, to);
}

/** Where a part without a home ends up. Parts (or the owner); a credit note scan goes to the parts bucket. */
export async function dispositionAction(jobId: string, formData: FormData) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const to = String(formData.get("back") ?? `/parts/handover/${jobId}`);
  if (!(role === "owner" || can(role, "managePurchaseOrders")) || staff.viewingAs) outcome(jobId, { error: "Only Parts or the owner decide where a part goes." }, to);
  const partId = String(formData.get("part") ?? "");
  const disposition = String(formData.get("disposition") ?? "");
  if (disposition !== "returned" && disposition !== "stock" && disposition !== "fit_pending") outcome(jobId, { error: "Choose where the part goes." }, to);
  let creditNotePath: string | null = null;
  const file = formData.get("credit_note");
  if (file instanceof File && file.size > 0) {
    if (file.size > 10 * 1024 * 1024) outcome(jobId, { error: "The scan is too big (10 MB at most)." }, to);
    const ext = (file.name.split(".").pop() ?? "pdf").toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
    creditNotePath = `credit-notes/${partId}/${Date.now()}.${ext}`;
    const { error: upError } = await createAdminClient().storage.from(PARTS_BUCKET).upload(creditNotePath, file, { contentType: file.type || "application/pdf", upsert: false });
    if (upError) outcome(jobId, { error: `Could not save the scan: ${upError.message}` }, to);
  }
  const r = await setDisposition(jobId, partId, actorOf(staff), { disposition: disposition as "returned" | "stock" | "fit_pending", note: blankToNull(formData.get("note")), creditNotePath });
  refresh(jobId);
  revalidatePath("/parts/no-home");
  outcome(jobId, r, to);
}

/** The owner approves fitting a not-needed part as goodwill. */
export async function approveGoodwillAction(jobId: string, formData: FormData) {
  const staff = await requireStaff();
  const to = String(formData.get("back") ?? "/parts/no-home");
  if (staff.role_id !== "owner" || staff.viewingAs) outcome(jobId, { error: "Only the owner approves goodwill." }, to);
  const r = await approveGoodwill(jobId, String(formData.get("part") ?? ""), actorOf(staff));
  refresh(jobId);
  revalidatePath("/parts/no-home");
  outcome(jobId, r, to);
}
