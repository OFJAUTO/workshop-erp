"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { logAppError, SAVE_FAILED } from "@/lib/app-errors";
import { requirePermission, requireStaff } from "@/lib/auth";
import { getCurrentDevice } from "@/lib/devices";
import { isExchanging } from "@/lib/part-endings";
import { blankToNull } from "@/lib/format";
import { approveGoodwill, exchangePart, markPartsReady, partNotNeeded, receivePartsByTechnician, setDisposition } from "@/lib/handover";
import { endOrderedPart, recordCreditNote } from "@/lib/part-endings-server";
import { PARTS_BUCKET } from "@/lib/quote-data";
import { PART_FULL_SELECT, toPartFull } from "@/lib/parts-data";
import { verifyPin } from "@/lib/pin";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { objectExists } from "@/lib/upload-targets/common";

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
 * Parts mark the ticked parts "Ready for handover": the car's technicians and the workshop manager are told.
 * Receiving happens only on the technician's own tablet, never at the desk.
 */
export async function markPartsReadyAction(jobId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const ids = formData.getAll("part").map(String).filter(Boolean);
  const r = await markPartsReady(jobId, actorOf(staff), ids);
  refresh(jobId);
  redirect(`/parts/handover/${jobId}?${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? r.message ?? "Done.")}`);
}

/** The technician ticks the parts on his own tablet and confirms with his own PIN. */
export async function receiveMyParts(jobId: string, formData: FormData): Promise<{ error?: string; ok?: boolean; message?: string }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "Viewing only." };
  const settings = await getSettings();
  const ids = formData.getAll("received").map(String).filter(Boolean);
  const r = await receivePartsByTechnician(jobId, { technicianId: staff.id, partIds: ids, pin: String(formData.get("pin") ?? ""), deviceId: (await getCurrentDevice())?.id ?? null }, actorOf(staff), settings);
  if (!r.error) refresh(jobId);
  return r;
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

/**
 * A credit note scan's path handed over by the page: only one in this part's own folder of the parts bucket (where the
 * send queue puts it, src/lib/upload-targets/credit-note.ts), and only once the file really arrived there.
 */
/** A scan's path before it has arrived: the shape the upload place gives it (credit-notes/<part>/<uuid>.<ext>), nothing else. */
function pendingCreditNotePath(partId: string, raw: FormDataEntryValue | null): string | null {
  const path = typeof raw === "string" ? raw.trim() : "";
  const head = `credit-notes/${partId}/`;
  if (!partId || !path.startsWith(head)) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/i.test(path.slice(head.length)) ? path : null;
}

async function creditNotePathOf(partId: string, raw: FormDataEntryValue | null): Promise<string | null> {
  const path = typeof raw === "string" ? raw.trim() : "";
  const head = `credit-notes/${partId}/`;
  const name = path.slice(head.length);
  if (!partId || !path.startsWith(head) || !name || name.length > 80 || name.includes("/") || name.includes("..")) return null;
  return (await objectExists(PARTS_BUCKET, path)) ? path : null;
}

/**
 * The answer of an ending saved from Returns and leftovers or the handover page (3 November 2026): it comes back to the
 * card that was tapped - an error inside the card, the result (and the message for the supplier) in a window on the
 * page - never to the top of the page.
 */
export type EndingAnswer = { ok?: boolean; error?: string; message?: string; supplierCopy?: { supplier: string; text: string } | null };

const SCAN_MISSING = "The credit note scan is not on the server – nothing was saved. Add the scan again, or type the credit note number.";

/** Where a part without a home ends up. Parts (or the owner); a credit note scan goes to the parts bucket. */
export async function dispositionAction(jobId: string, formData: FormData): Promise<EndingAnswer> {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(role === "owner" || can(role, "managePurchaseOrders")) || staff.viewingAs) return { error: "Only Parts or the owner decide where a part goes." };
  const partId = String(formData.get("part") ?? "");
  const disposition = String(formData.get("disposition") ?? "");
  if (disposition !== "returned" && disposition !== "stock" && disposition !== "fit_pending" && disposition !== "scrap" && disposition !== "cancelled") return { error: "Choose where the part goes." };
  // 3 November 2026 (section 7): an ordered part not needed (not being exchanged) takes THE ending function -
  // Cancelled with the supplier, Return to supplier (the credit note now or later, tracked) or Keep in stock.
  const { data: partRow, error: readErr } = await createAdminClient().from("part_items").select("exchange_status, not_needed_reason").eq("id", partId).eq("job_id", jobId).maybeSingle();
  if (readErr) {
    await logAppError("part_disposition", readErr, { staffId: staff.id, jobId, detail: { partId, step: "read the part" } });
    return { error: SAVE_FAILED };
  }
  // Only a wrong or faulty part in its exchange keeps its own endings (a part replaced by another supplier is not one).
  const exchanging = !!partRow && isExchanging(partRow);
  if (disposition === "cancelled" && (!partRow || exchanging)) return { error: !partRow ? "This part is not on this job any more." : "This part is being exchanged: it goes back to the supplier with its credit note." };
  if (partRow && !exchanging && (disposition === "cancelled" || disposition === "returned" || disposition === "stock")) {
    const reason = blankToNull(formData.get("reason")) ?? partRow.not_needed_reason ?? "Not needed";
    const number = disposition === "returned" ? blankToNull(formData.get("note")) : null;
    const sent = formData.get("credit_note_path");
    const scan = typeof sent === "string" && sent.trim() ? await creditNotePathOf(partId, sent) : null;
    if (typeof sent === "string" && sent.trim() && !scan) return { error: SCAN_MISSING };
    const amountText = String(formData.get("credit_amount") ?? "").replace(/[^\d.]/g, "");
    const r = await endOrderedPart(jobId, partId, { ending: disposition === "returned" ? "return" : disposition, reason, creditNote: disposition === "returned" ? { number, path: scan, amount: amountText ? Number(amountText) : null, date: blankToNull(formData.get("credit_date")) } : null }, actorOf(staff));
    // A scan still on its way lands on the part by itself once it arrives (the credit_note place attaches it to a returned part).
    if (r.error) return { error: r.error };
    refresh(jobId);
    revalidatePath("/parts/no-home");
    return { ok: true, message: r.message, supplierCopy: r.supplierCopy ?? null };
  }
  // 31 October 2026: the page sends the scan straight to storage first (it waits on the device without signal) and hands
  // over its path; a tab opened before that still sends the file itself.
  let creditNotePath: string | null = null;
  const sentPath = formData.get("credit_note_path");
  if (typeof sentPath === "string" && sentPath.trim()) {
    creditNotePath = await creditNotePathOf(partId, sentPath);
    if (!creditNotePath) return { error: SCAN_MISSING };
  } else {
    const file = formData.get("credit_note");
    if (file instanceof File && file.size > 0) {
      if (file.size > 10 * 1024 * 1024) return { error: "The scan is too big (10 MB at most)." };
      const ext = (file.name.split(".").pop() ?? "pdf").toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
      creditNotePath = `credit-notes/${partId}/${Date.now()}.${ext}`;
      const { error: upError } = await createAdminClient().storage.from(PARTS_BUCKET).upload(creditNotePath, file, { contentType: file.type || "application/pdf", upsert: false });
      if (upError) return { error: "Could not save the scan – nothing was saved. Try again." };
    }
  }
  // A scan picked a moment ago and still on its way: when it has arrived by now it goes with the ending.
  const waiting = creditNotePath ? null : formData.get("credit_note_pending");
  // Still on its way: the chosen scan's own path is kept with a part sent back, so only that scan can land on it (an
  // earlier pick that arrives first never takes its place).
  if (waiting) creditNotePath = (await creditNotePathOf(partId, waiting)) ?? (disposition === "returned" ? pendingCreditNotePath(partId, waiting) : null);
  const r = await setDisposition(jobId, partId, actorOf(staff), { disposition: disposition as "returned" | "stock" | "fit_pending" | "scrap", note: blankToNull(formData.get("note")), creditNotePath });
  // Otherwise it lands on the part by itself when it arrives; one that arrived while the ending was being saved (its record
  // step looked at the part a moment too early) is put on here.
  if (!r.error && waiting && !creditNotePath) {
    const arrived = await creditNotePathOf(partId, waiting);
    if (arrived) await createAdminClient().from("part_items").update({ credit_note_path: arrived, updated_by: staff.id }).eq("id", partId).eq("job_id", jobId).is("credit_note_path", null);
  }
  if (r.error) return { error: r.error };
  refresh(jobId);
  revalidatePath("/parts/no-home");
  return { ok: true, message: r.message ?? "Saved." };
}

/**
 * The supplier's credit note for a part returned to them (3 November 2026): the number and/or the scan, the amount and
 * the date when known. Parts or the owner, from the "Waiting for a supplier credit note" list.
 */
export async function creditNoteAction(jobId: string, formData: FormData): Promise<EndingAnswer> {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(role === "owner" || can(role, "managePurchaseOrders")) || staff.viewingAs) return { error: "Only Parts or the owner record a supplier credit note." };
  const partId = String(formData.get("part") ?? "");
  const sent = formData.get("credit_note_path");
  const scan = typeof sent === "string" && sent.trim() ? await creditNotePathOf(partId, sent) : null;
  if (typeof sent === "string" && sent.trim() && !scan) return { error: SCAN_MISSING };
  const amountText = String(formData.get("credit_amount") ?? "").replace(/[^\d.]/g, "");
  const r = await recordCreditNote(jobId, partId, { number: blankToNull(formData.get("note")), path: scan, amount: amountText ? Number(amountText) : null, date: blankToNull(formData.get("credit_date")) }, actorOf(staff));
  if (r.error) return { error: r.error };
  refresh(jobId);
  revalidatePath("/parts/no-home");
  return { ok: true, message: r.message };
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
