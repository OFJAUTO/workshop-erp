import "server-only";
import { notifyManagers, notifyRoles, notifyStaff } from "./notifications";
import { hasNoHome } from "./part-state";
import { PART_FULL_SELECT, toPartFull } from "./parts-data";
import { verifyPin } from "./pin";
import type { Settings } from "./settings";
import { ensureQrLink, isBatteryPart, stickerSettings, warrantyMonthsFor } from "./stickers";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

export type Actor = { id: string; display_name: string; role_id: string };
export type Result = { error?: string; ok?: boolean; message?: string };
export type HandoverItem = { id: string; description: string; part_number: string | null; quantity: number; /** The technician did not tick this one: it went back to Parts. */ not_received?: boolean };
export type StickerPlan = Record<string, { count: number; code: string; kind: "part" | "battery"; brand?: string | null; model?: string | null; serial?: string | null }>;
export type HandoverRow = {
  id: string;
  job_id: string;
  kind: "handover" | "return";
  status: "pending" | "confirmed" | "cancelled";
  from_staff: string | null;
  to_staff: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  pin_used: boolean;
  signed_for_by: string | null;
  signed_at_counter: boolean;
  device_id: string | null;
  items: HandoverItem[];
  stickers: StickerPlan;
  stickers_printed_at: string | null;
  note: string | null;
  created_at: string;
};
export const HANDOVER_SELECT = "id, job_id, kind, status, from_staff, to_staff, confirmed_by, confirmed_at, pin_used, signed_for_by, signed_at_counter, device_id, items, stickers, stickers_printed_at, note, created_at";

async function jobBrief(jobId: string) {
  const { data } = await createAdminClient().from("jobs").select("id, job_number, status, department, is_open, vehicle_id, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, mileage_unit)").eq("id", jobId).maybeSingle();
  return data as unknown as { id: string; job_number: string; status: string; department: string | null; is_open: boolean; vehicle_id: string; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; mileage_unit: string } | null } | null;
}

/**
 * Parts tap "Hand over" with the parts ticked: the handover waits for the technician's PIN, on his
 * own device or at the counter. Until then the parts still count as with Parts. Battery stickers
 * are compulsory and locked to the quantity; part stickers are optional.
 */
export async function requestHandover(jobId: string, actor: Actor, input: { technicianId: string; partIds: string[]; stickers: Record<string, number>; note: string | null; battery: Record<string, { brand?: string | null; model?: string | null; serial?: string | null }> }, settings: Settings): Promise<Result & { handoverId?: string; stickerCount?: number }> {
  const admin = createAdminClient();
  const ss = stickerSettings(settings);
  const job = await jobBrief(jobId);
  if (!job || !job.is_open) return { error: "This job is closed." };
  const { data: tech } = await admin.from("staff").select("id, display_name, role_id, is_active").eq("id", input.technicianId).maybeSingle();
  if (!tech || !tech.is_active || tech.role_id !== "technician") return { error: "Choose the technician who takes the parts." };
  if (!input.partIds.length) return { error: "Tick at least one part." };
  const { data: rows } = await admin.from("part_items").select(PART_FULL_SELECT + ", pending_handover_id, sticker_kind, battery_model, serial_number").in("id", input.partIds).eq("job_id", jobId).eq("is_active", true);
  const parts = ((rows ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ ...toPartFull(r), pending_handover_id: r.pending_handover_id as string | null, sticker_kind: r.sticker_kind as string | null, battery_model: r.battery_model as string | null, serial_number: r.serial_number as string | null }));
  const { data: pos } = parts.length ? await admin.from("purchase_orders").select("id, status").in("id", parts.map((p) => p.po_id).filter((x): x is string => !!x)) : { data: [] };
  const approvedPo = new Set((pos ?? []).filter((p) => !["pending_approval", "cancelled"].includes(p.status)).map((p) => p.id));
  const items: HandoverItem[] = [];
  const stickers: StickerPlan = {};
  let stickerCount = 0;
  for (const p of parts) {
    if (p.issue_status === "confirmed" || p.return_status !== "none") continue;
    if (p.pending_handover_id) return { error: `${p.description} is already in a handover waiting for a PIN.` };
    const ok = p.availability === "in_stock" || (p.po_id && approvedPo.has(p.po_id)) || p.order_status === "received";
    if (!ok || p.received_qty <= 0) return { error: `${p.description} is not here yet and cannot be handed over.` };
    const qty = p.received_qty || Number(p.confirmed_quantity ?? p.quantity) || 1;
    items.push({ id: p.id, description: p.description, part_number: p.part_number, quantity: qty });
    const battery = isBatteryPart(p);
    const wanted = battery ? (ss.batteryRequired ? qty : Math.min(qty, Math.max(0, Math.round(input.stickers[p.id] ?? qty)))) : Math.min(qty, Math.max(0, Math.round(input.stickers[p.id] ?? 0)));
    if (wanted > 0) {
      const code = await ensureQrLink(battery ? "battery" : "part", { jobId, vehicleId: job.vehicle_id, refId: p.id }, actor.id);
      const b = input.battery[p.id] ?? {};
      stickers[p.id] = { count: wanted, code, kind: battery ? "battery" : "part", brand: b.brand ?? p.brand ?? null, model: b.model ?? p.battery_model ?? null, serial: b.serial ?? p.serial_number ?? null };
      stickerCount += wanted;
      if (battery && (b.brand || b.model || b.serial)) await admin.from("part_items").update({ brand: b.brand ?? p.brand, battery_model: b.model ?? p.battery_model, serial_number: b.serial ?? p.serial_number, sticker_kind: "battery", updated_by: actor.id }).eq("id", p.id);
    }
  }
  if (!items.length) return { error: "Those parts were already handed over." };
  const { data: handover, error } = await admin.from("part_handovers").insert({ job_id: jobId, kind: "handover", status: "pending", from_staff: actor.id, to_staff: tech.id, pin_used: false, items, stickers, note: input.note, created_by: actor.id, updated_by: actor.id }).select("id").single();
  if (error || !handover) return { error: error?.message ?? "Could not start the handover." };
  await admin.from("part_items").update({ pending_handover_id: handover.id, updated_by: actor.id }).in("id", items.map((i) => i.id));
  const plate = job.vehicle ? formatPlate(job.vehicle) : job.job_number;
  await admin.from("job_events").insert({ job_id: jobId, event_type: "handover_requested", note: `${actor.display_name} is handing ${items.length} part${items.length === 1 ? "" : "s"} to ${tech.display_name}: ${items.map((i) => i.description).join(", ")}`, created_by: actor.id });
  await notifyStaff([tech.id], { type: "handover", title: `${actor.display_name} is handing you ${items.length} part${items.length === 1 ? "" : "s"} for ${plate}`, body: `${items.map((i) => `${i.description} × ${i.quantity}`).join(", ")}. Enter your PIN to confirm.`, jobId, href: `/my-jobs/${jobId}#handover` });
  return { ok: true, handoverId: handover.id, stickerCount, message: `Waiting for ${tech.display_name}'s PIN.` };
}

/**
 * The technician confirms with his PIN (on his device or at the counter), or a manager signs for him.
 * The parts move to the technician; battery warranties start; the record keeps the device and the PIN.
 */
export async function confirmHandover(handoverId: string, who: { actor: Actor; pin?: string | null; deviceId?: string | null; atCounter?: boolean; signedFor?: boolean; /** The parts the technician ticked; anything else goes back to Parts as "not received". Null: everything. */ receivedIds?: string[] | null }, settings: Settings): Promise<Result> {
  const admin = createAdminClient();
  const ss = stickerSettings(settings);
  const { data: raw } = await admin.from("part_handovers").select(HANDOVER_SELECT).eq("id", handoverId).maybeSingle();
  const h = raw as unknown as HandoverRow | null;
  if (!h) return { error: "Handover not found." };
  if (h.status !== "pending") return { error: h.status === "confirmed" ? "Already confirmed." : "This handover was cancelled." };
  const job = await jobBrief(h.job_id);
  if (!job || !job.is_open) return { error: "This job is closed." };
  const [{ data: tech }, { data: priv }] = await Promise.all([
    admin.from("staff").select("id, display_name").eq("id", h.to_staff ?? "").maybeSingle(),
    admin.from("staff_private").select("pin_hash").eq("staff_id", h.to_staff ?? "").maybeSingle(),
  ]);
  if (!tech) return { error: "Technician not found." };
  let signedForBy: string | null = null;
  if (who.signedFor) {
    // Signing on behalf: the owner with no PIN, the workshop manager with his own PIN. Never with another person's PIN.
    if (who.actor.role_id === "owner") signedForBy = who.actor.id;
    else if (who.actor.role_id === "workshop_manager") {
      const { data: mine } = await admin.from("staff_private").select("pin_hash").eq("staff_id", who.actor.id).maybeSingle();
      if (!mine?.pin_hash) return { error: "You have no PIN yet, so you cannot sign for a technician. The owner sets one on the Team page." };
      if (!verifyPin(String(who.pin ?? ""), mine.pin_hash)) return { error: "That is not your PIN. To sign for the technician, type your own PIN." };
      signedForBy = who.actor.id;
    } else return { error: "Only the workshop manager or the owner can sign for a technician." };
  } else {
    if (!priv?.pin_hash) return { error: `${tech.display_name} has no PIN yet. The owner sets one on the Team page, or a manager ticks "I sign instead".` };
    if (!verifyPin(String(who.pin ?? ""), priv.pin_hash)) return { error: `That PIN doesn't match ${tech.display_name}. Try again, or tick "I sign instead".` };
    if (!who.atCounter && who.actor.id !== tech.id) return { error: `Only ${tech.display_name} confirms from his own device. At the counter, use "Sign here".` };
  }
  const batteries = Object.values(h.stickers ?? {}).filter((s) => s.kind === "battery");
  if (batteries.length && ss.batteryRequired && !h.stickers_printed_at) return { error: "Print the battery warranty sticker first; then confirm." };
  // Line by line: what the technician ticked is received; the rest goes back to Parts as "Not received by the technician".
  const wanted = who.receivedIds ? new Set(who.receivedIds) : null;
  const received = h.items.filter((it) => !wanted || wanted.has(it.id));
  const refused = h.items.filter((it) => wanted && !wanted.has(it.id));
  if (!received.length) return { error: "Tick at least one part you received. If nothing arrived, ask Parts to cancel the handover." };
  const now = new Date().toISOString();
  for (const it of received) {
    const plan = h.stickers?.[it.id];
    await admin.from("part_items").update({ issue_status: "confirmed", issued_qty: it.quantity, tech_received_qty: it.quantity, not_received_at: null, issued_at: now, issued_by: h.from_staff, issue_confirmed_at: now, issue_confirmed_by: tech.id, handover_id: h.id, pending_handover_id: null, ...(plan ? { stickers_printed: plan.count } : {}), updated_by: who.actor.id }).eq("id", it.id);
  }
  for (const it of refused) await admin.from("part_items").update({ pending_handover_id: null, not_received_at: now, tech_received_qty: 0, updated_by: who.actor.id }).eq("id", it.id);
  const items = h.items.map((it) => (refused.some((r) => r.id === it.id) ? { ...it, not_received: true } : it));
  await admin.from("part_handovers").update({ status: "confirmed", confirmed_at: now, confirmed_by: signedForBy ? who.actor.id : tech.id, pin_used: !signedForBy, signed_for_by: signedForBy, signed_at_counter: !!who.atCounter, device_id: who.deviceId ?? null, items, updated_by: who.actor.id }).eq("id", h.id);
  // Batteries: the warranty starts today, per brand, for this car only.
  for (const [partId, plan] of Object.entries(h.stickers ?? {})) {
    if (plan.kind !== "battery" || refused.some((r) => r.id === partId)) continue;
    const months = warrantyMonthsFor(ss, plan.brand);
    const until = new Date(now);
    until.setUTCMonth(until.getUTCMonth() + months);
    const { data: existing } = await admin.from("battery_warranties").select("id").eq("part_item_id", partId).eq("is_active", true).limit(1);
    if (!(existing ?? []).length) await admin.from("battery_warranties").insert({ job_id: h.job_id, vehicle_id: job.vehicle_id, part_item_id: partId, handover_id: h.id, brand: plan.brand ?? null, model: plan.model ?? null, serial_number: plan.serial ?? null, installed_on: now.slice(0, 10), warranty_until: until.toISOString().slice(0, 10), qr_code: plan.code, created_by: who.actor.id, updated_by: who.actor.id });
  }
  const how = signedForBy ? `signed for by ${who.actor.display_name}` : who.atCounter ? "PIN at the counter" : "PIN on his device";
  const refusedText = refused.length ? ` Not received: ${refused.map((i) => i.description).join(", ")}.` : "";
  await admin.from("job_events").insert({ job_id: h.job_id, event_type: "parts_issued", note: `${received.length} part${received.length === 1 ? "" : "s"} handed to ${tech.display_name} (${how}): ${received.map((i) => i.description).join(", ")}.${refusedText}`, created_by: who.actor.id });
  await notifyManagers(job.department ?? null, { type: "handover", title: `Parts handed over · ${job.job_number}`, body: `${received.length} part${received.length === 1 ? "" : "s"} to ${tech.display_name} (${how}).${refusedText}`, jobId: h.job_id, href: `/jobs/${h.job_id}/work` });
  if (h.from_staff) await notifyStaff([h.from_staff], { type: refused.length ? "parts_not_received" : "handover", title: refused.length ? `${tech.display_name} did not receive ${refused.length} part${refused.length === 1 ? "" : "s"} · ${job.job_number}` : `${tech.display_name} confirmed · ${job.job_number}`, body: `${received.length} part${received.length === 1 ? "" : "s"} taken (${how}).${refusedText}`, jobId: h.job_id, href: `/parts/handover/${h.job_id}` });
  return { ok: true, message: refused.length ? `${tech.display_name} has ${received.length} part${received.length === 1 ? "" : "s"}. ${refused.length} not received, back with Parts.` : `${tech.display_name} has the parts.` };
}

/** Parts take a waiting handover back (wrong technician, wrong parts): the parts are free again. */
export async function cancelHandover(handoverId: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("part_handovers").select(HANDOVER_SELECT).eq("id", handoverId).maybeSingle();
  const h = raw as unknown as HandoverRow | null;
  if (!h || h.status !== "pending") return { error: "Nothing to cancel." };
  await admin.from("part_items").update({ pending_handover_id: null, updated_by: actor.id }).eq("pending_handover_id", h.id);
  await admin.from("part_handovers").update({ status: "cancelled", updated_by: actor.id }).eq("id", h.id);
  await admin.from("job_events").insert({ job_id: h.job_id, event_type: "handover_cancelled", note: `Handover cancelled by ${actor.display_name}`, created_by: actor.id });
  return { ok: true, message: "Handover cancelled; the parts are back on the list." };
}

/** The handovers waiting for a technician's PIN, with the car and who is giving. */
export async function pendingHandoversFor(technicianId: string | null, jobId?: string) {
  const admin = createAdminClient();
  let q = admin.from("part_handovers").select(HANDOVER_SELECT + ", job:jobs(job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin)), giver:staff!part_handovers_from_staff_fkey(display_name), taker:staff!part_handovers_to_staff_fkey(display_name)").eq("status", "pending").eq("kind", "handover").order("created_at");
  if (technicianId) q = q.eq("to_staff", technicianId);
  if (jobId) q = q.eq("job_id", jobId);
  const { data } = await q;
  return ((data ?? []) as unknown as (HandoverRow & { job: { job_number: string; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null } | null } | null; giver: { display_name: string } | null; taker: { display_name: string } | null })[]).map((h) => ({ ...h, plate: h.job?.vehicle ? formatPlate(h.job.vehicle) : (h.job?.job_number ?? ""), giverName: h.giver?.display_name ?? "Parts", takerName: h.taker?.display_name ?? "the technician" }));
}

/* ------------------------------------------------------------------------------------------------
   Wrong or faulty parts, parts not needed, and where they end up. Exactly one state per part.
   ------------------------------------------------------------------------------------------------ */

async function fullPart(partId: string, jobId: string) {
  const { data } = await createAdminClient().from("part_items").select(PART_FULL_SELECT + ", pending_handover_id").eq("id", partId).eq("job_id", jobId).eq("is_active", true).maybeSingle();
  return data ? { ...toPartFull(data as unknown as Record<string, unknown>), pending_handover_id: (data as { pending_handover_id?: string | null }).pending_handover_id ?? null } : null;
}

/** The part comes back to Parts (from the technician or at the counter): a return row for the trail, the issue undone. */
async function takeBack(p: { id: string; description: string; part_number: string | null; issued_qty: number; issue_confirmed_by: string | null; issue_status: string; pending_handover_id: string | null; job_id: string }, actor: Actor, note: string) {
  const admin = createAdminClient();
  if (p.pending_handover_id) await admin.from("part_items").update({ pending_handover_id: null, updated_by: actor.id }).eq("id", p.id);
  if (p.issue_status === "confirmed") {
    await admin.from("part_handovers").insert({ job_id: p.job_id, kind: "return", status: "confirmed", confirmed_at: new Date().toISOString(), from_staff: p.issue_confirmed_by, to_staff: actor.id, confirmed_by: actor.id, pin_used: false, items: [{ id: p.id, description: p.description, part_number: p.part_number, quantity: p.issued_qty || 1 }], note, created_by: actor.id, updated_by: actor.id });
  }
  await admin.from("part_items").update({ issue_status: "none", issued_qty: 0, issued_at: null, issued_by: null, issue_confirmed_at: null, issue_confirmed_by: null, return_status: "returned", returned_qty: p.issued_qty || 0, return_note: note, updated_by: actor.id }).eq("id", p.id);
}

/**
 * "Wrong or faulty part": the part goes back to Parts to return to the supplier, and a replacement
 * row is raised at once so Parts order the correct part. The job shows "waiting for the correct part".
 */
export async function exchangePart(jobId: string, partId: string, actor: Actor, input: { reason: string; note: string | null }): Promise<Result> {
  const admin = createAdminClient();
  const p = await fullPart(partId, jobId);
  if (!p) return { error: "Part not found." };
  if (p.exchange_status === "needed" || p.exchange_status === "ordered") return { error: "This part is already being exchanged." };
  if (!["wrong_part", "damaged", "does_not_fit", "faulty"].includes(input.reason)) return { error: "Say what is wrong with it: wrong part, damaged, does not fit, or faulty." };
  const job = await jobBrief(jobId);
  if (!job || !job.is_open) return { error: "This job is closed." };
  const reasonText = input.reason === "wrong_part" ? "Wrong part" : input.reason === "damaged" ? "Damaged" : input.reason === "does_not_fit" ? "Does not fit" : "Faulty";
  const note = `${reasonText}${input.note ? `: ${input.note}` : ""}`;
  await takeBack(p, actor, `Wrong or faulty part. ${note}`);
  const qty = Number(p.confirmed_quantity ?? p.quantity) || 1;
  const { data: replacement, error } = await admin.from("part_items").insert({ job_id: jobId, part_request_id: p.part_request_id, part_number: p.part_number, description: p.description, quantity: qty, supplier: p.supplier, cost_aed: p.cost_aed, availability: "to_order", confirm_status: "confirmed", confirmed_quantity: qty, confirmed_at: new Date().toISOString(), priced_by: p.priced_by, priced_at: p.priced_at, order_status: "to_order", part_type: p.part_type, brand: p.brand, positions: p.positions ?? null, replaced_part_id: p.id, added_by_role: actor.role_id, created_by: actor.id, updated_by: actor.id }).select("id").single();
  if (error || !replacement) return { error: error?.message ?? "Could not raise the replacement." };
  const now = new Date().toISOString();
  await admin.from("part_items").update({ exchange_status: "needed", exchange_reason: input.reason, exchange_note: input.note, exchange_at: now, exchange_by: actor.id, replacement_part_id: replacement.id, updated_by: actor.id }).eq("id", p.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "part_exchange", note: `${p.description}: ${note.toLowerCase()} (${actor.display_name}). Back to the supplier; the correct part is raised for ordering.`, created_by: actor.id });
  const n = { type: "parts_exchange", title: `Wrong or faulty part · ${job.job_number}`, body: `${p.description}: ${reasonText.toLowerCase()}. Order the correct part and return this one to the supplier.`, jobId, href: `/parts/handover/${jobId}` };
  await notifyRoles(["parts"], n);
  await notifyManagers(job.department ?? null, { ...n, href: `/jobs/${jobId}/work` });
  return { ok: true, message: `${p.description} goes back to the supplier. The correct part is on the Parts desk to order.` };
}

/** "Not needed": the part is not used on this car. Parts then choose its ending. */
export async function partNotNeeded(jobId: string, partId: string, actor: Actor, reason: string, opts: { /** The question Parts are asked instead of the usual wording. */ question?: string } = {}): Promise<Result> {
  const admin = createAdminClient();
  const p = await fullPart(partId, jobId);
  if (!p) return { error: "Part not found." };
  if (p.not_needed_at) return { error: "Already marked not needed." };
  if (!reason.trim()) return { error: "Say why the part is not needed." };
  const job = await jobBrief(jobId);
  if (!job) return { error: "Job not found." };
  await takeBack(p, actor, `Not needed: ${reason.trim()}`);
  await admin.from("part_items").update({ not_needed_at: new Date().toISOString(), not_needed_by: actor.id, not_needed_reason: reason.trim().slice(0, 300), updated_by: actor.id }).eq("id", p.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "part_not_needed", note: `${p.description} not needed (${actor.display_name}): ${reason.trim()}`, created_by: actor.id });
  await notifyRoles(["parts"], { type: "parts_no_home", title: `Part not needed · ${job.job_number}`, body: opts.question ? `${opts.question} Decide on the Parts without a home page.` : `${p.description}: ${reason.trim()}. Decide its ending: back to the supplier, to stock, or fit it with the owner's approval.`, jobId, href: `/parts/no-home` });
  return { ok: true, message: `${p.description} marked not needed. Choose where it goes under "Parts without a home".` };
}

/** Where a part without a home ends up: returned to the supplier (credit note), moved to stock, or fitted on this car once the owner approves. */
export async function setDisposition(jobId: string, partId: string, actor: Actor, input: { disposition: "returned" | "stock" | "fit_pending"; note: string | null; creditNotePath: string | null }): Promise<Result> {
  const admin = createAdminClient();
  const p = await fullPart(partId, jobId);
  if (!p) return { error: "Part not found." };
  if (!hasNoHome(p)) return { error: "This part has a home already." };
  if (input.disposition === "returned" && !(input.note || input.creditNotePath)) return { error: "Type the credit note number, or attach its scan." };
  const job = await jobBrief(jobId);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { disposition: input.disposition, disposition_at: now, disposition_by: actor.id, disposition_note: input.note, credit_note_path: input.creditNotePath ?? p.credit_note_path, updated_by: actor.id };
  if (input.disposition === "returned" && (p.exchange_status === "needed" || p.exchange_status === "ordered")) patch.exchange_status = "done";
  await admin.from("part_items").update(patch).eq("id", p.id);
  const label = input.disposition === "returned" ? "returned to the supplier with a credit note" : input.disposition === "stock" ? "moved to stock" : "to be fitted on this car, waiting for the owner's approval";
  await admin.from("job_events").insert({ job_id: jobId, event_type: "part_disposition", note: `${p.description} ${label} (${actor.display_name})${input.note ? `: ${input.note}` : ""}`, created_by: actor.id });
  if (input.disposition === "fit_pending") await notifyRoles(["owner"], { type: "parts_no_home", title: `Fit a part as goodwill? · ${job?.job_number ?? ""}`, body: `${p.description} was marked not needed; Parts ask to fit it on this car anyway. Approve it under "Parts with no home".`, jobId, href: "/parts/no-home" });
  return { ok: true, message: `${p.description}: ${label}.` };
}

/** The owner approves fitting a part that was not needed: goodwill, its cost written against the job. */
export async function approveGoodwill(jobId: string, partId: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient();
  if (actor.role_id !== "owner") return { error: "Only the owner approves goodwill." };
  const p = await fullPart(partId, jobId);
  if (!p) return { error: "Part not found." };
  if (p.disposition !== "fit_pending") return { error: "This part is not waiting for approval." };
  const cost = Math.round((Number(p.cost_aed ?? 0) * (Number(p.confirmed_quantity ?? p.quantity) || 1)) * 100) / 100;
  await admin.from("part_items").update({ disposition: "fit_approved", disposition_at: new Date().toISOString(), disposition_by: actor.id, goodwill_cost_aed: cost, goodwill_by: actor.id, goodwill_at: new Date().toISOString(), return_status: "none", returned_qty: 0, updated_by: actor.id }).eq("id", p.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "goodwill", note: `${actor.display_name} approved fitting ${p.description} as goodwill (cost AED ${cost.toFixed(2)})`, created_by: actor.id });
  await notifyRoles(["parts"], { type: "parts_no_home", title: `Goodwill approved · ${p.description}`, body: "Hand the part to the technician as usual.", jobId, href: `/parts/handover/${jobId}` });
  return { ok: true, message: `${p.description} can be fitted. Hand it over as usual.` };
}

export type NoHomePart = ReturnType<typeof toPartFull> & { pending_handover_id: string | null; job: { id: string; job_number: string; is_open: boolean; vehicle: { kind?: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null } | null; since: string };

/** Every part without a home across the workshop: not needed, wrong or faulty, or back with Parts, with nothing decided yet. */
export async function partsWithNoHome(): Promise<NoHomePart[]> {
  const { data } = await createAdminClient().from("part_items").select(PART_FULL_SELECT + ", pending_handover_id, job:jobs(id, job_number, is_open, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)))").eq("is_active", true).is("disposition", null).or("not_needed_at.not.is.null,exchange_status.in.(needed,ordered),return_status.eq.returned").order("updated_at");
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const p = toPartFull(r) as NoHomePart;
    p.pending_handover_id = (r.pending_handover_id as string | null) ?? null;
    p.job = r.job as NoHomePart["job"];
    p.since = (p.not_needed_at ?? p.exchange_at ?? (r.updated_at as string | null) ?? p.created_at) as string;
    return p;
  }).filter((p) => hasNoHome(p));
}
