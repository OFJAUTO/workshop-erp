import "server-only";
import { notifyManagers, notifyStaff } from "./notifications";
import { PART_FULL_SELECT, toPartFull } from "./parts-data";
import { verifyPin } from "./pin";
import type { Settings } from "./settings";
import { ensureQrLink, isBatteryPart, stickerSettings, warrantyMonthsFor } from "./stickers";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

export type Actor = { id: string; display_name: string; role_id: string };
export type Result = { error?: string; ok?: boolean; message?: string };
export type HandoverItem = { id: string; description: string; part_number: string | null; quantity: number };
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
export async function confirmHandover(handoverId: string, who: { actor: Actor; pin?: string | null; deviceId?: string | null; atCounter?: boolean; signedFor?: boolean }, settings: Settings): Promise<Result> {
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
    if (!(who.actor.role_id === "owner" || who.actor.role_id === "workshop_manager")) return { error: "Only the workshop manager or the owner can sign for a technician." };
    signedForBy = who.actor.id;
  } else {
    if (!priv?.pin_hash) return { error: `${tech.display_name} has no PIN yet. The owner sets one on the Team page.` };
    if (!verifyPin(String(who.pin ?? ""), priv.pin_hash)) return { error: "Wrong PIN." };
    if (!who.atCounter && who.actor.id !== tech.id) return { error: "Only the technician confirms from his own device." };
  }
  const batteries = Object.values(h.stickers ?? {}).filter((s) => s.kind === "battery");
  if (batteries.length && ss.batteryRequired && !h.stickers_printed_at) return { error: "Print the battery warranty sticker first; then confirm." };
  const now = new Date().toISOString();
  for (const it of h.items) {
    const plan = h.stickers?.[it.id];
    await admin.from("part_items").update({ issue_status: "confirmed", issued_qty: it.quantity, issued_at: now, issued_by: h.from_staff, issue_confirmed_at: now, issue_confirmed_by: tech.id, handover_id: h.id, pending_handover_id: null, ...(plan ? { stickers_printed: plan.count } : {}), updated_by: who.actor.id }).eq("id", it.id);
  }
  await admin.from("part_handovers").update({ status: "confirmed", confirmed_at: now, confirmed_by: signedForBy ? who.actor.id : tech.id, pin_used: !signedForBy, signed_for_by: signedForBy, signed_at_counter: !!who.atCounter, device_id: who.deviceId ?? null, updated_by: who.actor.id }).eq("id", h.id);
  // Batteries: the warranty starts today, per brand, for this car only.
  for (const [partId, plan] of Object.entries(h.stickers ?? {})) {
    if (plan.kind !== "battery") continue;
    const months = warrantyMonthsFor(ss, plan.brand);
    const until = new Date(now);
    until.setUTCMonth(until.getUTCMonth() + months);
    const { data: existing } = await admin.from("battery_warranties").select("id").eq("part_item_id", partId).eq("is_active", true).limit(1);
    if (!(existing ?? []).length) await admin.from("battery_warranties").insert({ job_id: h.job_id, vehicle_id: job.vehicle_id, part_item_id: partId, handover_id: h.id, brand: plan.brand ?? null, model: plan.model ?? null, serial_number: plan.serial ?? null, installed_on: now.slice(0, 10), warranty_until: until.toISOString().slice(0, 10), qr_code: plan.code, created_by: who.actor.id, updated_by: who.actor.id });
  }
  const how = signedForBy ? `signed for by ${who.actor.display_name}` : who.atCounter ? "PIN at the counter" : "PIN on his device";
  await admin.from("job_events").insert({ job_id: h.job_id, event_type: "parts_issued", note: `${h.items.length} part${h.items.length === 1 ? "" : "s"} handed to ${tech.display_name} (${how}): ${h.items.map((i) => i.description).join(", ")}`, created_by: who.actor.id });
  await notifyManagers(job.department ?? null, { type: "handover", title: `Parts handed over · ${job.job_number}`, body: `${h.items.length} part${h.items.length === 1 ? "" : "s"} to ${tech.display_name} (${how}).`, jobId: h.job_id, href: `/jobs/${h.job_id}/work` });
  if (h.from_staff) await notifyStaff([h.from_staff], { type: "handover", title: `${tech.display_name} confirmed · ${job.job_number}`, body: `${h.items.length} part${h.items.length === 1 ? "" : "s"} taken (${how}).`, jobId: h.job_id, href: `/parts/handover/${h.job_id}` });
  return { ok: true, message: `${tech.display_name} has the parts.` };
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
