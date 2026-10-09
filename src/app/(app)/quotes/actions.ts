"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentStaff, requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { loadInspection } from "@/lib/inspection-data";
import { notifyRoles, notifyStaff } from "@/lib/notifications";
import { LINE_SELECT, PART_SELECT, ensurePartRequests, labourRateFor, loadQuotation, logQuoteEvent, minMarkupFor, quoteToken, refreshQuoteTotals, suggestedLines, toLine, toPart, loadPartsWait, loadQuoteChecks, loadQuoteFindings, parentLineFor } from "@/lib/quote-data";
import { applyCustomerResponse } from "@/lib/quote-respond";
import { ownerApprovalReasons, quoteTotals, sendBlockers, type QuoteLine, blockOf, isHidden } from "@/lib/quotes";
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

/** The owner, or an advisor who is this job's advisor (or made the estimate). */
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
    admin.from("part_items").select(PART_SELECT).eq("job_id", jobId).eq("is_active", true).neq("confirm_status", "rejected").eq("order_status", "none").order("created_at"),
    admin.from("quotation_lines").select("id, part_item_id, position").eq("quotation_id", quotationId).eq("is_active", true),
  ]);
  const have = new Set((lines ?? []).map((l) => l.part_item_id).filter(Boolean));
  let position = (lines ?? []).reduce((m, l) => Math.max(m, Number(l.position) || 0), -1) + 1;
  const { data: reqs } = await admin.from("part_requests").select("id, label, source_type, source_key").eq("job_id", jobId);
  const labelOf = new Map((reqs ?? []).map((r) => [r.id, r.label]));
  const reqOf = new Map((reqs ?? []).map((r) => [r.id, r]));
  const rows: Record<string, unknown>[] = [];
  for (const p of ((parts ?? []) as Record<string, unknown>[]).map(toPart).filter((p) => !have.has(p.id))) rows.push({
    parent_line_id: await parentLineFor(quotationId, p.part_request_id ? (reqOf.get(p.part_request_id) ?? null) : null),
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
  });
  if (rows.length) await admin.from("quotation_lines").insert(rows);
}

const COPY_FIELDS = (l: QuoteLine) => ({ line_type: l.line_type, title: l.title, details: l.details, group_label: l.group_label, source_type: l.source_type, source_key: l.source_key, quantity: l.quantity, unit_cost: l.unit_cost, markup_percent: l.markup_percent, unit_price: l.unit_price, hours: l.hours, labour_rate: l.labour_rate, discount_percent: l.discount_percent, discount_reason: l.discount_reason, line_total: l.line_total, part_item_id: l.part_item_id, package_id: l.package_id, service_id: l.service_id, visible_to_customer: l.visible_to_customer, urgency: l.urgency, advisor_added: l.advisor_added, part_type: l.part_type, brand: l.brand, option_group: l.option_group, chosen: l.chosen, recovery_trips: l.recovery_trips, recovery_provider: l.recovery_provider, dangerous: l.dangerous, recovery_provider_kind: l.recovery_provider_kind, markup_confirmed: l.markup_confirmed });

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
  if (staff!.role_id === "owner" && (!bundle || bundle.inspection.status !== "approved")) {
    // The owner may go ahead of the gate; it is written down.
    await admin.from("job_events").insert({ job_id: jobId, event_type: "override", note: `Quotation started by ${staff!.display_name} before the inspection report was approved (owner override)`, created_by: staff!.id });
  }
  const { data: existing } = await admin.from("quotations").select("id, status").eq("job_id", jobId).eq("is_active", true).in("status", ["draft", "pending_owner", "sent", "opened", "urgent_requested"]).limit(1).maybeSingle();
  if (existing) redirect(`/jobs/${jobId}/quote/${existing.id}`);

  const settings = await getSettings();
  const { data: vehicle } = await admin.from("vehicles").select("make:vehicle_makes(name)").eq("id", job!.vehicle_id).maybeSingle();
  const makeName = (vehicle?.make as unknown as { name: string } | null)?.name ?? null;
  const rate = labourRateFor(settings, job!.department, makeName);
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
    lines = ((estLines ?? []) as Record<string, unknown>[]).map(toLine).filter((l) => !l.fee_kind).map((l) => ({ quotation_id: created!.id, position: l.position, ...COPY_FIELDS(l), source_type: "estimate", source_key: l.id, part_item_id: null, created_by: staff!.id, updated_by: staff!.id }));
  } else {
    lines = (await suggestedLines(jobId, rate)).map((l) => ({ ...l, quotation_id: created!.id, created_by: staff!.id, updated_by: staff!.id }));
  }
  if (lines.length) await admin.from("quotation_lines").insert(lines);
  // A car that came on our recovery truck: the recovery line is suggested, the advisor fills in the price or hides it.
  const { data: gateIn } = await admin.from("gate_ins").select("arrived_by").eq("job_id", jobId).maybeSingle();
  if (gateIn?.arrived_by === "our_recovery" && !lines.some((l) => l.line_type === "recovery")) {
    await admin.from("quotation_lines").insert({ quotation_id: created!.id, position: lines.length + 1, line_type: "recovery", title: "Recovery", details: "One way to the workshop", source_type: "manual", quantity: 1, recovery_trips: 1, markup_percent: minMarkup, visible_to_customer: true, created_by: staff!.id, updated_by: staff!.id });
  }
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

/** A new version with the same lines, or with the urgent lines only; the old version is kept as replaced. */
async function makeVersion(quotationId: string, urgentOnly: boolean) {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) redirect("/dashboard");
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  const back = q.kind === "estimate" ? `/estimates/${quotationId}` : `/jobs/${q.job_id}/quote/${quotationId}`;
  if (!staff) redirect(`${back}?error=${encodeURIComponent("Not allowed.")}`);
  if (!["sent", "opened", "expired", "declined", "approved", "pending_owner", "urgent_requested"].includes(q.status)) redirect(back);
  const admin = createAdminClient();
  const { data: created, error } = await admin
    .from("quotations")
    .insert({ kind: q.kind, number: q.number, version: q.version + 1, parent_id: q.id, job_id: q.job_id, customer_id: q.customer_id, vehicle_id: q.vehicle_id, estimate_id: q.estimate_id, discount_percent: q.discount_percent, vat_percent: q.vat_percent, promised_at: q.promised_at, validity_days: q.validity_days, customer_note: q.customer_note, payment_by_card: q.payment_by_card, not_quoted: q.not_quoted ?? {}, created_by: staff.id, updated_by: staff.id })
    .select("id")
    .single();
  if (error || !created) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Could not revise.")}`);
  // Urgent only: the labour lines marked Urgent, their parts, and every other charge. The rest is kept against the car as declined work.
  const active = bundle.lines.filter((l) => l.is_active && !l.fee_kind);
  const keepLabour = active.filter((l) => blockOf(l) === "labour" && (!urgentOnly || l.urgency === "urgent"));
  const keepIds = new Set(keepLabour.map((l) => l.id));
  const kept = active.filter((l) => blockOf(l) === "other" || keepIds.has(l.id) || (blockOf(l) === "parts" && (!l.parent_line_id || keepIds.has(l.parent_line_id))));
  const keptIds = new Set(kept.map((l) => l.id));
  const left = active.filter((l) => !keptIds.has(l.id) && !isHidden(l));
  const idMap = new Map<string, string>();
  for (const l of kept.filter((x) => !x.parent_line_id)) {
    const { data: ins } = await admin.from("quotation_lines").insert({ quotation_id: created.id, position: l.position, ...COPY_FIELDS(l), parent_line_id: null, created_by: staff.id, updated_by: staff.id }).select("id").single();
    if (ins) idMap.set(l.id, ins.id);
  }
  for (const l of kept.filter((x) => x.parent_line_id)) {
    await admin.from("quotation_lines").insert({ quotation_id: created.id, position: l.position, ...COPY_FIELDS(l), parent_line_id: idMap.get(l.parent_line_id!) ?? null, created_by: staff.id, updated_by: staff.id });
  }
  const keep = kept;
  if (left.length && q.kind === "quotation") {
    await admin.from("declined_work").insert(left.map((l) => ({ vehicle_id: q.vehicle_id, customer_id: q.customer_id, job_id: q.job_id, quotation_id: q.id, title: l.title, details: `${l.group_label ?? ""}${l.group_label ? " · " : ""}left out of the urgent-only quotation`, amount_aed: l.line_total, declined_at: new Date().toISOString(), created_by: staff.id, updated_by: staff.id })));
  }
  if (["sent", "opened", "expired", "pending_owner", "urgent_requested"].includes(q.status)) await admin.from("quotations").update({ status: "superseded", updated_by: staff.id }).eq("id", q.id);
  await refreshQuoteTotals(created.id, await getSettings(), staff.id);
  await logQuoteEvent(created.id, q.job_id, staff.id, urgentOnly ? "quote_urgent_version" : "quote_revised", `${q.number} version ${q.version + 1} started by ${staff.display_name}${urgentOnly ? ` with the urgent work only (${keep.length} line${keep.length === 1 ? "" : "s"}; ${left.length} left out and kept as declined work)` : ""}`);
  refresh(q.job_id, created.id);
  redirect(q.kind === "estimate" ? `/estimates/${created.id}` : `/jobs/${q.job_id}/quote/${created.id}`);
}

export async function reviseQuotation(quotationId: string) {
  await makeVersion(quotationId, false);
}

/** "Create urgent-only version": the Urgent lines carry over; the rest is saved against the car as declined work. */
export async function urgentOnlyVersion(quotationId: string) {
  await makeVersion(quotationId, true);
}

export type SendQuoteState = { error?: string; ok?: boolean; token?: string; pendingOwner?: string[]; /** A free comeback: approved on sending, nothing goes to the customer. */ warranty?: boolean };

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
  const checks = await loadQuoteChecks(q.job_id);
  const blockers = await quoteBlockers(bundle, settings, checks);
  if (blockers.length) return { error: blockers.map((b) => b.label).join(" · ") };
  const admin = createAdminClient();
  if (!q.completed_at) {
    // The advisor presses "Quotation complete" first. The owner may send straight away; it is written down.
    if (staff.role_id !== "owner") return { error: "Press \"Quotation complete\" first, then send it." };
    await admin.from("quotations").update({ completed_at: new Date().toISOString(), completed_by: staff.id, updated_by: staff.id }).eq("id", q.id);
    await logQuoteEvent(q.id, q.job_id, staff.id, "quote_complete", `${q.number} v${q.version} marked complete by ${staff.display_name} on sending (owner)`);
  }
  const totals = quoteTotals(bundle.lines, q, { depositThreshold: Number(settings.deposit_threshold_aed) || 0, depositPercent: Number(settings.deposit_percent) || 50 });
  const reasons = ownerApprovalReasons(q, bundle.lines, totals, { discountLimit: Number(settings.discount_limit_percent) || 0, approvalAbove: Number(settings.quote_owner_approval_above_aed) || 0 });
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
  // The link goes to the customer on file; that name and number stay with the answer.
  const patch: Record<string, unknown> = { token, valid_until: validUntil, status: "draft", sent_to_name: bundle.customer?.company_name ?? bundle.customer?.full_name ?? null, sent_to_phone: bundle.customer?.phone ?? null, updated_by: staff.id };
  if (reasons.length && staff.role_id === "owner") Object.assign(patch, { owner_approved_by: staff.id, owner_approved_at: new Date().toISOString(), owner_approval_reason: reasons.join("; ") });
  const { error } = await admin.from("quotations").update(patch).eq("id", q.id);
  if (error) return { error: error.message };
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_link_created", `${q.number} v${q.version} link created by ${staff.display_name}`);
  // A free comeback (warranty repair): the owner has decided; the quotation is approved on sending, nothing goes to the customer.
  if (q.job_id && bundle.job && (bundle.job as { comeback_free?: boolean }).comeback_free) {
    const r = await applyCustomerResponse(q.id, { approve: true, name: `Warranty repair (${staff.display_name})`, by: staff.id, via: "warranty" });
    if (r.error) return { error: r.error };
    refresh(q.job_id, q.id);
    return { ok: true, token, warranty: true };
  }
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
      await admin.from("jobs").update({ status: "pending_customer_approval", stage: "approval", stage_entered_at: new Date().toISOString() }).eq("id", q.job_id);
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
  const { data: est } = await admin.from("quotations").select("status, approver_name, sent_to_phone").eq("id", q.estimate_id).maybeSingle();
  if (!est || est.status !== "approved") redirect(`${back}?error=${encodeURIComponent("The estimate was not accepted by the customer.")}`);
  const settings = await getSettings();
  const blockers = await quoteBlockers(bundle, settings, { openRequests: 0, workshopEstimate: null });
  if (blockers.length) redirect(`${back}?error=${encodeURIComponent(blockers.map((b) => b.label).join(" · "))}`);
  await admin.from("quotations").update({ token: q.token ?? quoteToken(), sent_to_phone: est.sent_to_phone ?? bundle.customer?.phone ?? null, updated_by: staff.id }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_confirmed_from_estimate", `${q.number} confirmed by ${staff.display_name} as unchanged from the accepted estimate`);
  const res = await applyCustomerResponse(q.id, { approve: true, name: est.approver_name ?? "Customer", by: staff.id, via: "estimate" });
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

/** The checks before completing or sending: the findings not yet quoted and the markups to confirm are counted in. */
async function quoteBlockers(bundle: NonNullable<Awaited<ReturnType<typeof loadQuotation>>>, settings: Awaited<ReturnType<typeof getSettings>>, checks: { openRequests: number; workshopEstimate: { hours: number | null; managerHours: number | null; agreed: boolean } | null }) {
  const q = bundle.quotation;
  const findings = q.kind === "quotation" && q.job_id ? await loadQuoteFindings(q.job_id) : [];
  const unquoted = findings.filter((f) => !bundle.lines.some((l) => l.is_active && blockOf(l) === "labour" && l.source_type === f.source_type && l.source_key === f.source_key) && !(q.not_quoted ?? {})[f.key]).length;
  return sendBlockers(q, bundle.lines, bundle.parts, { minMarkup: minMarkupFor(settings, bundle.vehicle?.make?.name ?? null), ...checks, unquotedFindings: unquoted, confirmPercent: Number(settings.markup_confirm_percent) || 100 });
}

/**
 * "Quotation complete": every check passes, the labour hours are remembered for the next quotation on
 * the same work, and descriptions typed by hand are counted so the owner can add them to the list.
 */
export async function completeQuotation(quotationId: string): Promise<{ error?: string; ok?: boolean }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Only the job's advisor or the owner can complete it." };
  if (q.status !== "draft" && q.status !== "pending_owner") return { error: "This version has been sent." };
  const settings = await getSettings();
  const admin = createAdminClient();
  const checks = await loadQuoteChecks(q.job_id);
  const blockers = await quoteBlockers(bundle, settings, checks);
  if (blockers.length) return { error: `Not complete yet: ${blockers.map((b) => b.label).join(" · ")}` };
  const active = bundle.lines.filter((l) => l.is_active);
  const workLines = active.filter((l) => l.line_type !== "part" && !l.fee_kind);
  // Descriptions typed by hand: after the second use they are offered again; the owner adds them to the permanent list.
  const known = new Set(Object.values((settings.labour_jobs ?? {}) as Record<string, string[]>).flat().map((t) => t.toLowerCase()));
  const cand = { ...((settings.labour_job_candidates ?? {}) as Record<string, number>) };
  let candChanged = false;
  for (const l of workLines) {
    if (l.line_type !== "labour" || !l.title.trim()) continue;
    const t = l.title.trim().replace(/,\s*(front and rear|front|rear|left|right)$/i, "");
    if (known.has(t.toLowerCase())) continue;
    const k = Object.keys(cand).find((x) => x.toLowerCase() === t.toLowerCase()) ?? t;
    cand[k] = (cand[k] ?? 0) + 1;
    candChanged = true;
  }
  if (candChanged) await admin.from("settings").update({ value: cand }).eq("key", "labour_job_candidates");
  const memory = { ...((settings.labour_hours_memory ?? {}) as Record<string, number>) };
  const model = [bundle.vehicle?.make?.name, bundle.vehicle?.model?.name].filter(Boolean).join(" ").toLowerCase();
  let remembered = false;
  for (const l of workLines) {
    if (l.line_type !== "labour" || !l.hours || l.hours <= 0) continue;
    const k = l.title.trim().toLowerCase();
    for (const key of [k, model ? `${model}|${k}` : ""]) {
      if (key && memory[key] !== l.hours) {
        memory[key] = l.hours;
        remembered = true;
      }
    }
  }
  if (remembered) await admin.from("settings").update({ value: memory }).eq("key", "labour_hours_memory");
  await admin.from("quotations").update({ completed_at: new Date().toISOString(), completed_by: staff.id, updated_by: staff.id }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_complete", `${q.number} v${q.version} marked complete by ${staff.display_name}`);
  refresh(q.job_id, q.id);
  return { ok: true };
}

/** Back to editing after "Quotation complete". */
export async function reopenQuotation(quotationId: string): Promise<{ error?: string; ok?: boolean }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  if (!q.completed_at) return { ok: true };
  const admin = createAdminClient();
  await admin.from("quotations").update({ completed_at: null, completed_by: null, updated_by: staff.id }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_reopened", `${q.number} v${q.version} reopened by ${staff.display_name}`);
  refresh(q.job_id, q.id);
  return { ok: true };
}

/** "Remind Parts": after the set number of minutes, one tap tells Parts the quotation is waiting on them. */
export async function remindParts(quotationId: string): Promise<{ error?: string; ok?: boolean }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle || !bundle.job) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  const settings = await getSettings();
  const wait = await loadPartsWait(bundle.job.id);
  if (!wait.count) return { error: "Nothing is waiting on Parts." };
  const after = Number(settings.parts_remind_minutes) || 30;
  if (wait.minutes < after) return { error: `Remind Parts after ${after} minutes (${wait.minutes} so far).` };
  const admin = createAdminClient();
  await notifyRoles(["parts"], { type: "parts_reminder", title: `Reminder: parts to price · ${bundle.job.job_number}`, body: `${staff.display_name} is waiting for ${wait.count} price${wait.count === 1 ? "" : "s"} on ${q.number} (${wait.minutes} min).`, jobId: bundle.job.id, href: `/parts/${bundle.job.id}` });
  await admin.from("quotations").update({ parts_reminded_at: new Date().toISOString(), updated_by: staff.id }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "parts_reminded", `${staff.display_name} reminded Parts about ${q.number} after ${wait.minutes} min`);
  refresh(q.job_id, q.id);
  return { ok: true };
}

/** "Escalate": after a longer wait, the owner hears about it too. */
export async function escalateParts(quotationId: string): Promise<{ error?: string; ok?: boolean }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle || !bundle.job) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  const settings = await getSettings();
  const wait = await loadPartsWait(bundle.job.id);
  if (!wait.count) return { error: "Nothing is waiting on Parts." };
  const after = Number(settings.parts_escalate_minutes) || 60;
  if (wait.minutes < after) return { error: `Escalate after ${after} minutes (${wait.minutes} so far).` };
  const admin = createAdminClient();
  const body = `${q.number} on ${bundle.job.job_number} has waited ${wait.minutes} min for ${wait.count} price${wait.count === 1 ? "" : "s"} from Parts (${wait.names.join(", ") || "Parts"}).`;
  await notifyRoles(["owner"], { type: "parts_escalation", title: `Parts are holding a quotation · ${bundle.job.job_number}`, body, jobId: bundle.job.id, href: `/parts/${bundle.job.id}` });
  await notifyRoles(["parts"], { type: "parts_escalation", title: `Escalated to the owner · ${bundle.job.job_number}`, body, jobId: bundle.job.id, href: `/parts/${bundle.job.id}` });
  await admin.from("quotations").update({ parts_escalated_at: new Date().toISOString(), updated_by: staff.id }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "parts_escalated", `${staff.display_name} escalated the parts wait on ${q.number} to the owner after ${wait.minutes} min`);
  refresh(q.job_id, q.id);
  return { ok: true };
}

/** The whole-dirham total chosen when sending; the pre-VAT amount takes the difference so VAT and the total agree. */
export async function roundQuotation(quotationId: string, total: number): Promise<{ error?: string; ok?: boolean }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  if (q.status !== "draft" && q.status !== "pending_owner") return { error: "This version has been sent." };
  const whole = Math.round(total);
  if (!Number.isFinite(whole) || whole <= 0 || Math.abs(whole - q.total_aed) > Math.max(10, q.total_aed * 0.02)) return { error: "That rounded total is too far from the quotation total." };
  const admin = createAdminClient();
  await admin.from("quotations").update({ rounded_total_aed: whole, updated_by: staff.id }).eq("id", q.id);
  await refreshQuoteTotals(q.id, await getSettings(), staff.id);
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_rounded", `${q.number} v${q.version} total rounded from ${q.total_aed.toFixed(2)} to ${whole} by ${staff.display_name}`);
  refresh(q.job_id, q.id);
  return { ok: true };
}

/** On a revised quotation: keep the labour lines marked Urgent and their parts; every other charge stays. The rest is removed from this version. */
export async function keepUrgentOnly(quotationId: string): Promise<{ error?: string; ok?: boolean }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  const staff = await mayEdit(q.job_id, q.created_by);
  if (!staff) return { error: "Not allowed." };
  if (q.status !== "draft" && q.status !== "pending_owner") return { error: "This version has been sent." };
  const admin = createAdminClient();
  const drop = bundle.lines.filter((l) => l.is_active && blockOf(l) === "labour" && l.urgency !== "urgent");
  const dropIds = new Set(drop.map((l) => l.id));
  const parts = bundle.lines.filter((l) => l.is_active && blockOf(l) === "parts" && l.parent_line_id && dropIds.has(l.parent_line_id));
  const ids = [...drop, ...parts].map((l) => l.id);
  if (!ids.length) return { error: "Nothing to remove." };
  await admin.from("quotation_lines").update({ is_active: false, updated_by: staff.id }).in("id", ids);
  // The removed work stays against the car for its next visit.
  await admin.from("declined_work").insert(drop.filter((l) => l.title.trim()).map((l) => ({ vehicle_id: q.vehicle_id, customer_id: q.customer_id, job_id: q.job_id, quotation_id: q.id, title: l.title, details: `${l.group_label ?? ""}${l.group_label ? " · " : ""}left out of the urgent-only quotation`, amount_aed: l.line_total, declined_at: new Date().toISOString(), created_by: staff.id, updated_by: staff.id })));
  await refreshQuoteTotals(q.id, await getSettings(), staff.id, { reopen: true });
  await logQuoteEvent(q.id, q.job_id, staff.id, "quote_urgent_version", `${q.number} v${q.version}: ${staff.display_name} kept the urgent lines only (${drop.length} line${drop.length === 1 ? "" : "s"} and ${parts.length} part${parts.length === 1 ? "" : "s"} removed)`);
  refresh(q.job_id, q.id);
  return { ok: true };
}

export type { QuoteLine };
