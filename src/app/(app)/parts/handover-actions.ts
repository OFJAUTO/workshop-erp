"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission, requireStaff } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { notifyManagers, notifyStaff } from "@/lib/notifications";
import { PART_FULL_SELECT, toPartFull } from "@/lib/parts-data";
import { verifyPin } from "@/lib/pin";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

function refresh(jobId: string) {
  revalidatePath(`/parts/handover/${jobId}`);
  revalidatePath(`/parts/trail/${jobId}`);
  revalidatePath(`/parts/${jobId}`);
  revalidatePath("/parts");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/work`);
  revalidatePath(`/my-jobs/${jobId}`);
}
const fail = (jobId: string, msg: string): never => redirect(`/parts/handover/${jobId}?error=${encodeURIComponent(msg)}`);

/**
 * Parts hand the ticked parts to one technician: one PIN for the lot, or a manager or the owner signs
 * for the technician from their own login. Every handover is written down with the parts, who gave,
 * who took, and when.
 */
export async function handoverParts(jobId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const admin = createAdminClient();
  const ids = formData.getAll("part").map(String).filter(Boolean);
  const technicianId = String(formData.get("technician") ?? "");
  const pin = String(formData.get("pin") ?? "").trim();
  const signFor = formData.get("sign_for") === "on";
  if (!ids.length) fail(jobId, "Tick at least one part.");
  const [{ data: tech }, { data: priv }, { data: job }] = await Promise.all([
    admin.from("staff").select("id, display_name, role_id, is_active").eq("id", technicianId).maybeSingle(),
    admin.from("staff_private").select("pin_hash").eq("staff_id", technicianId).maybeSingle(),
    admin.from("jobs").select("id, job_number, status, department, is_open").eq("id", jobId).maybeSingle(),
  ]);
  if (!job || !job.is_open) fail(jobId, "This job is closed.");
  if (!tech || !tech.is_active || tech.role_id !== "technician") fail(jobId, "Choose the technician who takes the parts.");
  let signedForBy: string | null = null;
  if (signFor) {
    const role = staff.role_id as RoleId;
    if (!(role === "owner" || can(role, "manageWork"))) fail(jobId, "Only the workshop manager or the owner can sign for a technician.");
    signedForBy = staff.id;
  } else if (!verifyPin(pin, priv?.pin_hash)) fail(jobId, `${tech!.display_name}'s PIN is wrong.`);
  const { data: rows } = await admin.from("part_items").select(PART_FULL_SELECT).in("id", ids).eq("job_id", jobId).eq("is_active", true);
  const parts = ((rows ?? []) as unknown as Record<string, unknown>[]).map(toPartFull);
  const { data: pos } = parts.length ? await admin.from("purchase_orders").select("id, status").in("id", parts.map((p) => p.po_id).filter((x): x is string => !!x)) : { data: [] };
  const approvedPo = new Set((pos ?? []).filter((p) => !["pending_approval", "cancelled"].includes(p.status)).map((p) => p.id));
  const items: { id: string; description: string; part_number: string | null; quantity: number }[] = [];
  for (const p of parts) {
    if (p.issue_status === "confirmed" || p.return_status !== "none") continue;
    const ok = p.availability === "in_stock" || (p.po_id && approvedPo.has(p.po_id)) || p.order_status === "received";
    if (!ok || p.received_qty <= 0) fail(jobId, `${p.description} is not here yet and cannot be handed over.`);
    items.push({ id: p.id, description: p.description, part_number: p.part_number, quantity: p.received_qty || Number(p.confirmed_quantity ?? p.quantity) || 1 });
  }
  if (!items.length) fail(jobId, "Those parts were already handed over.");
  const now = new Date().toISOString();
  const { data: handover, error } = await admin.from("part_handovers").insert({ job_id: jobId, kind: "handover", from_staff: staff.id, to_staff: tech!.id, confirmed_by: signedForBy ? staff.id : tech!.id, pin_used: !signedForBy, signed_for_by: signedForBy, items, note: blankToNull(formData.get("note")), created_by: staff.id, updated_by: staff.id }).select("id").single();
  if (error || !handover) return fail(jobId, error?.message ?? "Could not record the handover.");
  for (const it of items) await admin.from("part_items").update({ issue_status: "confirmed", issued_qty: it.quantity, issued_at: now, issued_by: staff.id, issue_confirmed_at: now, issue_confirmed_by: tech!.id, handover_id: handover.id, updated_by: staff.id }).eq("id", it.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_issued", note: `${items.length} part${items.length === 1 ? "" : "s"} handed to ${tech!.display_name} by ${staff.display_name}${signedForBy ? ` (signed for by ${staff.display_name})` : " (technician's PIN)"}: ${items.map((i) => i.description).join(", ")}`, created_by: staff.id });
  await notifyStaff([tech!.id], { type: "handover", title: `Parts handed to you · ${job!.job_number}`, body: `${items.length} part${items.length === 1 ? "" : "s"}: ${items.map((i) => i.description).join(", ")}`, jobId, href: `/my-jobs/${jobId}` });
  await notifyManagers(job!.department ?? null, { type: "handover", title: `Parts handed over · ${job!.job_number}`, body: `${items.length} part${items.length === 1 ? "" : "s"} to ${tech!.display_name}.`, jobId, href: `/jobs/${jobId}/work` });
  refresh(jobId);
  redirect(`/parts/handover/${jobId}?message=${encodeURIComponent(`${items.length} part${items.length === 1 ? "" : "s"} handed to ${tech!.display_name}.`)}`);
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
  const { data: handover } = await admin.from("part_handovers").insert({ job_id: jobId, kind: "return", from_staff: parts[0].issue_confirmed_by, to_staff: staff.id, confirmed_by: staff.id, pin_used: !!priv?.pin_hash, items, note, created_by: staff.id, updated_by: staff.id }).select("id").single();
  for (const p of parts) await admin.from("part_items").update({ issue_status: "none", issued_qty: 0, issued_at: null, issued_by: null, issue_confirmed_at: null, issue_confirmed_by: null, handover_id: handover?.id ?? null, return_note: note, updated_by: staff.id }).eq("id", p.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "part_return", note: `${items.length} part${items.length === 1 ? "" : "s"} back with Parts (${staff.display_name}): ${items.map((i) => i.description).join(", ")} · ${note}`, created_by: staff.id });
  refresh(jobId);
  redirect(`/parts/handover/${jobId}?message=${encodeURIComponent(`${items.length} part${items.length === 1 ? "" : "s"} back with Parts.`)}`);
}
