"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentStaff, requireStaff } from "@/lib/auth";
import { partNotNeeded } from "@/lib/handover";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { loadPricingRows } from "@/lib/parts-pricing";
import { supplierDiscount, type SupplierOption } from "@/lib/parts-rows";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncLineForPart } from "./actions";

type Result = { error?: string; ok?: boolean; message?: string };

function refresh(jobId: string) {
  revalidatePath("/parts");
  revalidatePath(`/parts/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/quote`, "layout");
  revalidatePath("/dashboard");
}

async function jobBrief(jobId: string) {
  const { data } = await createAdminClient().from("jobs").select("id, job_number, department, gated_in_by, is_open").eq("id", jobId).maybeSingle();
  return data;
}

async function advisorsOf(jobId: string, gatedInBy: string | null) {
  const { data: appr } = await createAdminClient().from("approval_requests").select("sent_by").eq("job_id", jobId);
  return Array.from(new Set([gatedInBy, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
}

/** A sent quotation of the job is flagged for the advisor, like a price change. */
async function flagSent(jobId: string, by: string) {
  await createAdminClient().from("quotations").update({ parts_price_changed_at: new Date().toISOString(), updated_by: by }).eq("job_id", jobId).eq("is_active", true).in("status", ["sent", "opened", "approved", "urgent_requested", "pending_owner"]);
}

/** Every row Priced or Not available: the advisor is told (the same state function as the Parts table). */
async function tellAdvisorIfComplete(jobId: string) {
  const [{ summary }, job] = await Promise.all([loadPricingRows(jobId), jobBrief(jobId)]);
  if (summary.open || !summary.total || !job) return;
  await notifyStaff(await advisorsOf(jobId, job.gated_in_by), { type: "parts_priced", title: `Parts priced · ${job.job_number}`, body: `Every part on this car is priced or marked not available (${summary.text}). Finish the quotation.`, jobId, href: `/jobs/${jobId}` });
}

async function partsPerson(): Promise<{ id: string; display_name: string; role_id: string } | { error: string }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "Please sign in again." };
  if (!can(staff.role_id as RoleId, "priceParts")) return { error: "Not allowed." };
  return { id: staff.id, display_name: staff.display_name, role_id: staff.role_id };
}

/**
 * "Remove: not needed" (evening of 12 October 2026, item 10), before the part is ordered: it comes off the list and
 * the quotation, stays greyed with "Removed by <name>: <reason>" and Put back; the advisor and the workshop manager
 * are told; a sent quotation is flagged. "Not available" keeps its own meaning (wanted, but the supplier cannot supply it).
 */
export async function removeNotNeeded(jobId: string, target: { partId?: string | null; requestId?: string | null }, formData: FormData): Promise<Result> {
  const staff = await partsPerson();
  if ("error" in staff) return staff;
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  if (!reason) return { error: "Say why the part is not needed." };
  const admin = createAdminClient();
  const job = await jobBrief(jobId);
  if (!job || !job.is_open) return { error: "This job is closed." };
  const now = new Date().toISOString();
  let name = "";
  if (target.partId) {
    const { data: p } = await admin.from("part_items").select("id, description, order_status").eq("id", target.partId).eq("job_id", jobId).maybeSingle();
    if (!p) return { error: "Part not found." };
    if (p.order_status !== "none") return { error: "This part is already ordered: give it an ending on the handover page." };
    await admin.from("part_items").update({ is_active: false, removed_at: now, removed_by: staff.id, removed_reason: reason, updated_by: staff.id }).eq("id", p.id);
    await syncLineForPart(jobId, p.id, staff.id);
    name = p.description;
  } else if (target.requestId) {
    const { data: r } = await admin.from("part_requests").select("id, label").eq("id", target.requestId).eq("job_id", jobId).maybeSingle();
    if (!r) return { error: "Request not found." };
    await admin.from("part_requests").update({ status: "rejected", closed_reason: `Not needed: ${reason}`, removed_at: now, removed_by: staff.id, removed_reason: reason, updated_by: staff.id }).eq("id", r.id);
    name = r.label;
  } else return { error: "Nothing to remove." };
  await admin.from("job_events").insert({ job_id: jobId, event_type: "part_removed", note: `${name} removed by ${staff.display_name}: ${reason}`, created_by: staff.id });
  const n = { type: "parts_priced", title: `Part removed · ${job.job_number}`, body: `${name}: removed by ${staff.display_name} (${reason}). It is off the list and the quotation; Put back is on the Parts page.`, jobId, href: `/parts/${jobId}` };
  await notifyStaff(await advisorsOf(jobId, job.gated_in_by), { ...n, href: `/jobs/${jobId}` });
  await notifyManagers(job.department ?? null, n);
  await flagSent(jobId, staff.id);
  await tellAdvisorIfComplete(jobId);
  refresh(jobId);
  return { ok: true };
}

/** Undo or Put back: the removed part or request comes back onto the list and the quotation. */
export async function putBackPart(jobId: string, target: { partId?: string | null; requestId?: string | null }): Promise<Result> {
  const staff = await partsPerson();
  if ("error" in staff) return staff;
  const admin = createAdminClient();
  const job = await jobBrief(jobId);
  if (!job || !job.is_open) return { error: "This job is closed." };
  let name = "";
  if (target.partId) {
    const { data: p } = await admin.from("part_items").select("id, description").eq("id", target.partId).eq("job_id", jobId).maybeSingle();
    if (!p) return { error: "Part not found." };
    await admin.from("part_items").update({ is_active: true, removed_at: null, removed_by: null, removed_reason: null, updated_by: staff.id }).eq("id", p.id);
    await syncLineForPart(jobId, p.id, staff.id);
    name = p.description;
  } else if (target.requestId) {
    const { data: r } = await admin.from("part_requests").select("id, label").eq("id", target.requestId).eq("job_id", jobId).maybeSingle();
    if (!r) return { error: "Request not found." };
    await admin.from("part_requests").update({ status: "open", closed_reason: null, removed_at: null, removed_by: null, removed_reason: null, updated_by: staff.id }).eq("id", r.id);
    name = r.label;
  } else return { error: "Nothing to put back." };
  await admin.from("job_events").insert({ job_id: jobId, event_type: "part_put_back", note: `${name} put back by ${staff.display_name}`, created_by: staff.id });
  await flagSent(jobId, staff.id);
  refresh(jobId);
  return { ok: true };
}

/** "Remove: not needed" after the part is ordered: the three endings already agreed (return, stock, fit with approval). */
export async function notNeededFromParts(jobId: string, partId: string, formData: FormData): Promise<Result> {
  const staff = await partsPerson();
  if ("error" in staff) return staff;
  const r = await partNotNeeded(jobId, partId, staff, String(formData.get("reason") ?? ""));
  refresh(jobId);
  return r;
}

/**
 * The owner approves or refuses a supplier discount above the limit (item 11). Approved: the part counts as priced
 * when the rest is there. Refused: the discount goes back to the supplier's standard and Parts are told.
 */
export async function decideDiscountApproval(partId: string, formData: FormData) {
  const staff = await requireStaff();
  const back = (msg: string, ok: boolean): never => redirect(`/parts/approvals?${ok ? "message" : "error"}=${encodeURIComponent(msg)}`);
  if (staff.role_id !== "owner" || staff.viewingAs) return back("Only the owner decides supplier discounts.", false);
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 300) || null;
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id, description, supplier, part_type, list_price_aed, discount_percent, part_number, cost_aed, availability, discount_approval_status").eq("id", partId).maybeSingle();
  if (!p) return back("Part not found.", false);
  if (p.discount_approval_status !== "pending") return back("This part is not waiting for approval.", false);
  const now = new Date().toISOString();
  const job = await jobBrief(p.job_id);
  if (decision === "approve") {
    await admin.from("part_items").update({ discount_approval_status: "approved", discount_approval_at: now, discount_approval_by: staff.id, discount_approval_note: note, updated_by: staff.id }).eq("id", p.id);
    const { rows } = await loadPricingRows(p.job_id);
    const row = rows.find((r) => r.partId === p.id);
    if (row?.state === "priced") {
      await admin.from("part_items").update({ priced_by: staff.id, priced_at: now, updated_by: staff.id }).eq("id", p.id);
      if (row.requestId) await admin.from("part_requests").update({ status: "done", updated_by: staff.id }).eq("id", row.requestId).in("status", ["open", "listed", "done"]);
      await syncLineForPart(p.job_id, p.id, staff.id);
      await tellAdvisorIfComplete(p.job_id);
    }
    await admin.from("job_events").insert({ job_id: p.job_id, event_type: "discount_approval", note: `${p.description}: ${p.discount_percent}% discount from ${p.supplier ?? "?"} approved by ${staff.display_name}${note ? `: ${note}` : ""}`, created_by: staff.id });
    await notifyRoles(["parts"], { type: "parts_priced", title: `Discount approved · ${job?.job_number ?? ""}`, body: `${p.description}: ${p.discount_percent}% from ${p.supplier ?? "?"} approved by the owner.`, jobId: p.job_id, href: `/parts/${p.job_id}` });
    refresh(p.job_id);
    back(`${p.description}: ${p.discount_percent}% approved.`, true);
  }
  if (decision === "refuse") {
    // Back to the supplier's standard discount, the net following when a list price is there.
    const { data: s } = p.supplier ? await admin.from("suppliers").select("id, name, default_discount_percent, discount_by_type").ilike("name", p.supplier).maybeSingle() : { data: null };
    const option: SupplierOption | undefined = s ? { id: s.id, name: s.name, discount: Number(s.default_discount_percent) || 0, byType: (s.discount_by_type as Record<string, number> | null) ?? {} } : undefined;
    const standard = supplierDiscount(option, String(p.part_type ?? ""));
    const list = p.list_price_aed === null ? null : Number(p.list_price_aed);
    const patch: Record<string, unknown> = { discount_approval_status: "refused", discount_approval_at: now, discount_approval_by: staff.id, discount_approval_note: note, discount_percent: standard, updated_by: staff.id };
    if (list !== null) patch.cost_aed = Math.round(list * (1 - Math.min(100, standard) / 100) * 100) / 100;
    await admin.from("part_items").update(patch).eq("id", p.id);
    await syncLineForPart(p.job_id, p.id, staff.id);
    await admin.from("job_events").insert({ job_id: p.job_id, event_type: "discount_approval", note: `${p.description}: ${p.discount_percent}% discount refused by ${staff.display_name}, back to the standard ${standard}%${note ? `: ${note}` : ""}`, created_by: staff.id });
    await notifyRoles(["parts"], { type: "parts_priced", title: `Discount refused · ${job?.job_number ?? ""}`, body: `${p.description}: ${p.discount_percent}% from ${p.supplier ?? "?"} refused by the owner${note ? ` (${note})` : ""}. The standard ${standard}% applies.`, jobId: p.job_id, href: `/parts/${p.job_id}` });
    refresh(p.job_id);
    back(`${p.description}: refused, back to ${standard}%.`, true);
  }
  back("Choose Approve or Refuse.", false);
}
