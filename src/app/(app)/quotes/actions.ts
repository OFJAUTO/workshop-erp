"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentStaff, requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { loadInspection } from "@/lib/inspection-data";
import { notifyRoles, notifyStaff } from "@/lib/notifications";
import { LINE_SELECT, PART_SELECT, ensurePartRequests, labourRateFor, loadQuotation, logQuoteEvent, minMarkupFor, quoteToken, refreshQuoteTotals, suggestedLines, toLine, toPart } from "@/lib/quote-data";
import { applyCustomerResponse } from "@/lib/quote-respond";
import { ownerApprovalReasons, quoteTotals, sendBlockers, type QuoteLine } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

function refresh(jobId: string | null, quotationId?: string) {
  if (jobId) {
    revalidatePath(`/jobs/${jobId}`);
    if (quotationId) revalidatePath(`/jobs/${jobId}/quote/${quotationId}`);
  }
  if (quotationId) revalidatePath(`/estimates/${quotationId}`);
  revalidatePath("/dashboard");
  revalidatePath("/estimates");
  revalidatePath("/parts");
}

/** The owner, or an advisor who is this job's advisor. */
async function mayEdit(jobId: string | null, createdBy: string | null) {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return null;
  const role = staff.role_id as RoleId;
  if (role === "owner") return staff;
  if (!can(role, "editQuotes")) return null;
  if (createdBy === staff.id) return staff;
  if (!jobId) return null;
  const admin = createAdminClient();
  const [{ data: job }, { data: appr }] = await Promise.all([
    admin.from("jobs").select("gated_in_by").eq("id", jobId).maybeSingle(),
    admin.from("approval_requests").select("id").eq("job_id", jobId).eq("sent_by", staff.id).limit(1),
  ]);
  return job?.gated_in_by === staff.id || (appr ?? []).length > 0 ? staff : null;
}

/** Part lines for every listed part on the job that is not yet on the quotation. */
async function syncPartLines(quotationId: string, jobId: string, by: string, minMarkup: number) {
  const admin = createAdminClient();
  const [{ data: parts }, { data: lines }] = await Promise.all([
    admin.from("part_items").select(PART_SELECT).eq("job_id", jobId).eq("is_active", true).neq("confirm_status", "rejected").order("created_at"),
    admin.from("quotation_lines").select("id, part_item_id, position").eq("quotation_id", quotationId).eq("is_active", true),
  ]);
  const have = new Set((lines ?? []).map((l) => l.part_item_id).filter(Boolean));
  let position = (lines ?? []).reduce((m, l) => Math.max(m, Number(l.position) || 0), -1) + 1;
  const { data: reqs } = await admin.from("part_requests").select("id, label").eq("job_id", jobId);
  const labelOf = new Map((reqs ?? []).map((r) => [r.id, r.label]));
  const rows = ((parts ?? []) as Record<string, unknown>[]).map(toPart).filter((p) => !have.has(p.id)).map((p) => ({
    quotation_id: quotationId,
    position: position++,
    line_type: "part",
    title: p.part_number ? `${p.description} (${p.part_number})` : p.description,
    details: null,
    group_label: p.part_request_id ? (labelOf.get(p.part_request_id) ?? "Parts") : "Parts",
    source_type: "manual",
    source_key: null,
    quantity: p.confirmed_quantity ?? p.quantity,
    unit_cost: p.cost_aed,
    markup_percent: minMarkup,
    part_item_id: p.id,
    created_by: by,
    updated_by: by,
  }));
  if (rows.length) await admin.from("quotation_lines").insert(rows);
}

/** "Start quotation": suggested lines from the approved report (or the estimate), one part line per listed part. */
export async function startQuotation(jobId: string) {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, customer_id, vehicle_id, department, is_open, status, estimate_id, gated_in_by").eq("id", jobId).maybeSingle();
  const err = (m: string) => redirect(`/jobs/${jobId}?error=${encodeURIComponent(m)}`);
  if (!job || !job.is_open) err("This job is closed.");
  const staff = await mayEdit(jobId, null);
  if (!staff) err("Only the job's advisor or the owner can start the quotation.");
  const bundle = await loadInspection(jobId);
  if (staff!.role_id !== "owner" && (!bundle || bundle.inspection.status !== "approved")) err("The quotation opens once the workshop manager has approved the inspection report.");
  const { data: existing } = await admin.from("quotations").select("id, status").eq("job_id", jobId).eq("is_active", true).in("status", ["draft", "pending_owner", "sent", "opened"]).limit(1).maybeSingle();
  if (existing) redirect(`/jobs/${jobId}/quote/${existing.id}`);

  const settings = await getSettings();
  const { data: vehicle } = await admin.from("vehicles").select("make:vehicle_makes(name)").eq("id", job!.vehicle_id).maybeSingle();
  const makeName = (vehicle?.make as unknown as { name: string } | null)?.name ?? null;
  const rate = labourRateFor(settings, job!.department);
  const minMarkup = minMarkupFor(settings, makeName);
  const { data: created, error } = await admin
    .from("quotations")
    .insert({ kind: "quotation", job_id: jobId, customer_id: job!.customer_id, vehicle_id: job!.vehicle_id, estimate_id: job!.estimate_id, validity_days: Number(settings.quote_validity_days) || 7, vat_percent: 5, created_by: staff!.id, updated_by: staff!.id })
    .select("id, number")
    .single();
  if (error || !created) err(error?.message ?? "Could not start the quotation.");

  let lines: Record<string, unknown>[] = [];
  if (job!.estimate_id) {
    const { data: estLines } = await admin.from("quotation_lines").select(LINE_SELECT).eq("quotation_id", job!.estimate_id).eq("is_active", true).order("position");
    lines = ((estLines ?? []) as Record<string, unknown>[]).map(toLine).map((l) => ({ quotation_id: created!.id, position: l.position, line_type: l.line_type, title: l.title, details: l.details, group_label: l.group_label, source_type: "estimate", source_key: l.id, quantity: l.quantity, unit_cost: l.unit_cost, markup_percent: l.markup_percent, unit_price: l.unit_price, hours: l.hours, labour_rate: l.labour_rate, discount_percent: l.discount_percent, package_id: l.package_id, created_by: staff!.id, updated_by: staff!.id }));
  } else {
    lines = (await suggestedLines(jobId, rate)).map((l) => ({ ...l, quotation_id: created!.id, created_by: staff!.id, updated_by: staff!.id }));
  }
  if (lines.length) await admin.from("quotation_lines").insert(lines);
  await ensurePartRequests(jobId, staff!.id);
  await syncPartLines(created!.id, jobId, staff!.id, minMarkup);
  await refreshQuoteTotals(created!.id, settings, staff!.id);
  await logQuoteEvent(created!.id, jobId, staff!.id, "quote_started", `Quotation ${created!.number} started by ${staff!.display_name}${job!.estimate_id ? " from the estimate" : ""}`);
  refresh(jobId, created!.id);
  redirect(`/jobs/${jobId}/quote/${created!.id}`);
}

/** A further quotation on the same job, for extra work found later. */
export async function newQuotation(jobId: string) {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, customer_id, vehicle_id, department, is_open").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) redirect(`/jobs/${jobId}?error=${encodeURIComponent("This job is closed.")}`);
  const staff = await mayEdit(jobId, null);
  if (!staff) redirect(`/jobs/${jobId}?error=${encodeURIComponent("Only the job's advisor or the owner can add a quotation.")}`);
  const settings = await getSettings();
  const { data: created, error } = await admin
    .from("quotations")
    .insert({ kind: "quotation", job_id: jobId, customer_id: job.customer_id, vehicle_id: job.vehicle_id, validity_days: Number(settings.quote_validity_days) || 7, created_by: staff.id, updated_by: staff.id })
    .select("id, number")
    .single();
  if (error || !created) redirect(`/jobs/${jobId}?error=${encodeURIComponent(error?.message ?? "Could not add the quotation.")}`);
  await logQuoteEvent(created.id, jobId, staff.id, "quote_started", `Quotation ${created.number} started by ${staff.display_name} for extra work`);
  refresh(jobId, created.id);
  redirect(`/jobs/${jobId}/quote/${created.id}`);
}

/** A new version of a sent or answered quotation. The old one is kept as replaced. */
export async function reviseQuotation(quotationId: string) {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) redirect("/dashboard");
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  const back = q.kind === "estimate" ? `/estimates/${quotationId}` : `/jobs/${q.job_id}/quote/${quotationId}`;
  if (!staff) redirect(`${back}?error=${encodeURIComponent("Not allowed.")}`);
  if (!["sent", "opened", "expired", "declined", "partly_approved", "approved", "pending_owner"].includes(q.status)) redirect(back);
  const admin = createAdminClient();
  const { data: created, error } = await admin
    .from("quotations")
    .insert({ kind: q.kind, number: q.number, version: q.version + 1, parent_id: q.id, job_id: q.job_id, customer_id: q.customer_id, vehicle_id: q.vehicle_id, estimate_id: q.estimate_id, discount_percent: q.discount_percent, vat_percent: q.vat_percent, promised_at: q.promised_at, validity_days: q.validity_days, customer_note: q.customer_note, created_by: staff.id, updated_by: staff.id })
    .select("id")
    .single();
  if (error || !created) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Could not revise.")}`);
  const rows = bundle.lines.map((l) => ({ quotation_id: created.id, position: l.position, line_type: l.line_type, title: l.title, details: l.details, group_label: l.group_label, source_type: l.source_type, source_key: l.source_key, quantity: l.quantity, unit_cost: l.unit_cost, markup_percent: l.markup_percent, unit_price: l.unit_price, hours: l.hours, labour_rate: l.labour_rate, discount_percent: l.discount_percent, line_total: l.line_total, part_item_id: l.part_item_id, package_id: l.package_id, created_by: staff.id, updated_by: staff.id }));
  if (rows.length) await admin.from("quotation_lines").insert(rows);
  if (["sent", "opened", "expired", "pending_owner"].includes(q.status)) await admin.from("quotations").update({ status: "superseded", updated_by: staff.id }).eq("id", q.id);
  await refreshQuoteTotals(created.id, await getSettings(), staff.id);
  await logQuoteEvent(created.id, q.job_id, staff.id, "quote_revised", `${q.number} version ${q.version + 1} started by ${staff.display_name}`);
  refresh(q.job_id, created.id);
  redirect(q.kind === "estimate" ? `/estimates/${created.id}` : `/jobs/${q.job_id}/quote/${created.id}`);
}

export type SendQuoteState = { error?: string; ok?: boolean; token?: string; pendingOwner?: string[] };

/** "Send quotation": checks everything, asks the owner when needed, otherwise makes the link for the centre window. */
export async function sendQuotation(quotationId: string, _prev: SendQuoteState, _fd?: FormData): Promise<SendQuoteState> {
  void _prev;
  void _fd;
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Only the job's advisor or the owner can send it." };
  if (q.status === "sent" || q.status === "opened") return { ok: true, token: q.token ?? undefined };
  if (q.status !== "draft" && q.status !== "pending_owner") return { error: `This quotation is ${q.status.replace("_", " ")}. Revise it to send a new version.` };
  const settings = await getSettings();
  const minMarkup = minMarkupFor(settings, bundle.vehicle?.make?.name ?? null);
  const blockers = sendBlockers(q, bundle.lines, bundle.parts, { minMarkup: () => minMarkup });
  if (blockers.length) return { error: blockers.map((b) => b.label).join(" · ") };
  const totals = quoteTotals(bundle.lines, q, { depositThreshold: Number(settings.deposit_threshold_aed) || 0, depositPercent: Number(settings.deposit_percent) || 50 });
  const reasons = ownerApprovalReasons(q, bundle.lines, totals, { discountLimit: Number(settings.discount_limit_percent) || 0, approvalAbove: Number(settings.quote_owner_approval_above_aed) || 0 });
  const admin = createAdminClient();
  if (reasons.length && staff.role_id !== "owner" && !q.owner_approved_at) {
    if (q.status !== "pending_owner") {
      await admin.from("quotations").update({ status: "pending_owner", owner_approval_reason: reasons.join("; "), updated_by: staff.id }).eq("id", q.id);
      await logQuoteEvent(q.id, q.job_id, staff.id, "quote_owner_approval", `${q.number} sent to the owner for approval: ${reasons.join("; ")}`);
      await notifyRoles(["owner"], { type: "quote_owner_approval", title: `Quotation needs your approval · ${q.number}`, body: reasons.join("; "), jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}/quote/${q.id}` : `/estimates/${q.id}` });
      refresh(q.job_id, q.id);
    }
    return { pendingOwner: reasons };
  }
  const token = q.token ?? quoteToken();
  const validUntil = new Date(Date.now() + (Number(q.validity_days) || 7) * 86400000).toISOString();
  const patch: Record<string, unknown> = { token, valid_until: validUntil, status: "draft", updated_by: staff.id };
  if (reasons.length && staff.role_id === "owner") Object.assign(patch, { owner_approved_by: staff.id, owner_approved_at: new Date().toISOString(), owner_approval_reason: reasons.join("; ") });
  const { error } = await admin.from("quotations").update(patch).eq("id", q.id);
  if (error) return { error: error.message };
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_link_created", `${q.number} v${q.version} link created by ${staff.display_name}`);
  refresh(q.job_id, q.id);
  return { ok: true, token };
}

/** Records that the link went to the customer; the quotation is now "sent" and the job waits for the customer. */
export async function markQuoteSent(quotationId: string, method: string): Promise<{ error?: string; ok?: boolean }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  const admin = createAdminClient();
  if (q.status === "draft" && q.token) {
    await admin.from("quotations").update({ status: "sent", sent_at: new Date().toISOString(), sent_by: staff.id, sent_method: method.slice(0, 20), updated_by: staff.id }).eq("id", q.id);
    await logQuoteEvent(q.id, q.job_id, staff.id, "quote_sent", `${q.number} v${q.version} sent to the customer by ${staff.display_name} (${method})`);
    if (q.job_id && bundle.job && (bundle.job.status === "pending_quote" || bundle.job.status === "in_inspection")) {
      await admin.from("jobs").update({ status: "pending_customer_approval", stage: "approval", ...(q.promised_at ? { promised_at: q.promised_at } : {}) }).eq("id", q.job_id);
      await admin.from("job_events").insert({ job_id: q.job_id, event_type: "status_change", from_status: bundle.job.status, to_status: "pending_customer_approval", note: `Quotation ${q.number} sent`, created_by: staff.id });
    }
  }
  refresh(q.job_id, q.id);
  return { ok: true };
}

/** The owner approves or refuses a quotation that needed approval. */
export async function decideQuoteApproval(quotationId: string, formData: FormData) {
  const staff = await requirePermission("approveQuotes");
  const bundle = await loadQuotation(quotationId);
  if (!bundle) redirect("/dashboard");
  const q = bundle.quotation;
  const back = q.kind === "estimate" ? `/estimates/${quotationId}` : `/jobs/${q.job_id}/quote/${quotationId}`;
  const decision = String(formData.get("decision") ?? "");
  const note = blankToNull(formData.get("note"));
  const admin = createAdminClient();
  if (decision === "approve") {
    await admin.from("quotations").update({ status: "draft", owner_approved_by: staff.id, owner_approved_at: new Date().toISOString(), updated_by: staff.id }).eq("id", q.id);
    await logQuoteEvent(q.id, q.job_id, staff.id, "quote_owner_approved", `Owner approved ${q.number}${note ? `: ${note}` : ""}`);
  } else {
    await admin.from("quotations").update({ status: "draft", owner_approval_reason: null, updated_by: staff.id }).eq("id", q.id);
    await logQuoteEvent(q.id, q.job_id, staff.id, "quote_owner_refused", `Owner asked for changes on ${q.number}${note ? `: ${note}` : ""}`);
  }
  if (q.created_by) await notifyStaff([q.created_by], { type: "quote_owner_approval", title: decision === "approve" ? `Owner approved ${q.number}: send it` : `Owner asked for changes on ${q.number}`, body: note ?? "", jobId: q.job_id, href: back });
  refresh(q.job_id, q.id);
  redirect(`${back}?message=${encodeURIComponent(decision === "approve" ? "Approved. The advisor can send it now." : "Sent back to the advisor.")}`);
}

/** A quotation made from an accepted estimate with nothing changed: the earlier acceptance counts as approval. */
export async function confirmEstimateUnchanged(quotationId: string) {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) redirect("/dashboard");
  const q = bundle.quotation;
  const back = `/jobs/${q.job_id}/quote/${quotationId}`;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) redirect(`${back}?error=${encodeURIComponent("Not allowed.")}`);
  if (!q.estimate_id || q.status !== "draft") redirect(back);
  const admin = createAdminClient();
  const { data: est } = await admin.from("quotations").select("status, approver_name, approver_phone, total_aed").eq("id", q.estimate_id).maybeSingle();
  if (!est || est.status !== "approved") redirect(`${back}?error=${encodeURIComponent("The estimate was not accepted by the customer.")}`);
  const settings = await getSettings();
  const blockers = sendBlockers(q, bundle.lines, bundle.parts, { minMarkup: () => minMarkupFor(settings, bundle.vehicle?.make?.name ?? null) });
  if (blockers.length) redirect(`${back}?error=${encodeURIComponent(blockers.map((b) => b.label).join(" · "))}`);
  await admin.from("quotations").update({ token: q.token ?? quoteToken(), updated_by: staff.id }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_confirmed_from_estimate", `${q.number} confirmed by ${staff.display_name} as unchanged from the accepted estimate`);
  const res = await applyCustomerResponse(q.id, { approvedLineIds: "all", declineAll: false, name: est.approver_name ?? "Customer", phone: est.approver_phone, by: staff.id, via: "estimate" });
  refresh(q.job_id, q.id);
  redirect(`${back}?${res.error ? `error=${encodeURIComponent(res.error)}` : `message=${encodeURIComponent("Confirmed. The estimate's acceptance counts as the customer's approval.")}`}`);
}

/** Re-sends an expired quotation: a fresh validity period on the same link. */
export async function resendQuotation(quotationId: string): Promise<SendQuoteState> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  if (q.status !== "expired") return { error: "Only an expired quotation can be re-sent." };
  const admin = createAdminClient();
  const token = q.token ?? quoteToken();
  await admin.from("quotations").update({ status: "sent", token, valid_until: new Date(Date.now() + (Number(q.validity_days) || 7) * 86400000).toISOString(), sent_at: new Date().toISOString(), sent_by: staff.id, updated_by: staff.id }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_resent", `${q.number} re-sent by ${staff.display_name}`);
  refresh(q.job_id, q.id);
  return { ok: true, token };
}

export type { QuoteLine };
