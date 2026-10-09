import "server-only";
import { createAdminClient } from "./supabase/admin";
import { notifyManagers, notifyRoles, notifyStaff } from "./notifications";
import { newLabelCode } from "./parts-data";
import { ensureWorkLines } from "./work-data";
import { LINE_SELECT, PART_SELECT, logQuoteEvent, refreshQuoteTotals, toLine, toPart } from "./quote-data";
import { aed, type QuoteLine, type QuoteRow } from "./quotes";
import { getSettings } from "./settings";

/** Everyone who should hear about a customer's answer: the advisor(s) of the job and the person who sent it. */
export async function advisorsOf(q: Pick<QuoteRow, "job_id" | "created_by" | "sent_by">): Promise<string[]> {
  const admin = createAdminClient();
  const ids = new Set<string>();
  if (q.created_by) ids.add(q.created_by);
  if (q.sent_by) ids.add(q.sent_by);
  if (q.job_id) {
    const { data: job } = await admin.from("jobs").select("gated_in_by").eq("id", q.job_id).maybeSingle();
    if (job?.gated_in_by) ids.add(job.gated_in_by);
    const { data: appr } = await admin.from("approval_requests").select("sent_by").eq("job_id", q.job_id);
    for (const a of appr ?? []) if (a.sent_by) ids.add(a.sent_by);
  }
  return Array.from(ids);
}

type QuoteCore = Pick<QuoteRow, "id" | "kind" | "number" | "version" | "job_id" | "customer_id" | "vehicle_id" | "status" | "created_by" | "sent_by" | "promised_at" | "sent_to_phone">;
const CORE = "id, kind, number, version, job_id, customer_id, vehicle_id, status, created_by, sent_by, promised_at, sent_to_phone";

/**
 * The customer's answer, all or nothing: approve the whole quotation, or decline it. The phone number
 * kept with the answer is the one the link was sent to. Used by the customer page and when the
 * advisor confirms an unchanged estimate.
 */
export async function applyCustomerResponse(quotationId: string, answer: { approve: boolean; name: string; by?: string | null; via: "customer" | "estimate" }): Promise<{ error?: string; status?: string }> {
  const admin = createAdminClient();
  const settings = await getSettings();
  const { data: qRaw } = await admin.from("quotations").select(CORE).eq("id", quotationId).maybeSingle();
  if (!qRaw) return { error: "Quotation not found." };
  const q = qRaw as unknown as QuoteCore;
  if (!["sent", "opened", "draft", "urgent_requested"].includes(q.status)) return { error: "This quotation has already been answered." };
  const { data: lineRows } = await admin.from("quotation_lines").select(LINE_SELECT).eq("quotation_id", quotationId).eq("is_active", true).order("position");
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map(toLine);
  const now = new Date().toISOString();
  const status: QuoteRow["status"] = answer.approve ? "approved" : "declined";

  for (const l of lines) await admin.from("quotation_lines").update({ customer_approved: answer.approve }).eq("id", l.id);
  await admin.from("quotations").update({ status, responded_at: now, approver_name: answer.name, approver_phone: q.sent_to_phone, opened_at: now, updated_by: answer.by ?? null }).eq("id", quotationId);
  await refreshQuoteTotals(quotationId, settings, answer.by ?? "");
  const { data: fresh } = await admin.from("quotations").select("approved_total_aed, total_aed").eq("id", quotationId).maybeSingle();
  const totalText = aed(Number(fresh?.approved_total_aed ?? fresh?.total_aed ?? 0));
  const who = answer.via === "estimate" ? "the advisor (unchanged estimate)" : `${answer.name} (customer link)`;
  await logQuoteEvent(quotationId, q.job_id, answer.by ?? null, answer.approve ? "quote_approved" : "quote_declined", `${q.number} v${q.version}: ${answer.approve ? `approved, ${totalText} with VAT` : "declined"} by ${who}`);

  // Declined work stays against the car for its next visit.
  if (!answer.approve && q.kind === "quotation") {
    await admin.from("declined_work").insert(lines.filter((l) => l.visible_to_customer).map((l) => ({ vehicle_id: q.vehicle_id, customer_id: q.customer_id, job_id: q.job_id, quotation_id: quotationId, title: l.title, details: l.group_label, amount_aed: l.line_total, declined_at: now })));
  }

  const advisors = await advisorsOf(q);
  if (q.kind === "estimate") {
    await notifyStaff(advisors, {
      type: answer.approve ? "estimate_accepted" : "quote_declined",
      title: answer.approve ? `Estimate accepted · ${q.number}` : `Estimate declined · ${q.number}`,
      body: answer.approve ? `${answer.name} accepted the estimate (${totalText}). Offer to book the car in.` : `${answer.name} declined the estimate.`,
      href: `/estimates/${quotationId}`,
    });
    return { status };
  }
  if (!q.job_id) return { status };
  const { data: job } = await admin.from("jobs").select("id, job_number, status, department, assigned_to").eq("id", q.job_id).maybeSingle();
  if (!job) return { status };

  if (!answer.approve) {
    await admin.from("jobs").update({ status: "ready", stage: "ready", inspection_fee_due: true }).eq("id", job.id);
    await admin.from("job_events").insert({ job_id: job.id, event_type: "status_change", from_status: job.status, to_status: "ready", note: `Quotation ${q.number} declined by ${answer.name}. Inspection fee of AED ${Number(settings.inspection_fee_aed).toLocaleString("en-GB")} due at gate-out.`, created_by: answer.by ?? null });
    await notifyStaff(advisors, { type: "quote_declined", title: `Quotation declined · ${job.job_number}`, body: `${answer.name} declined ${q.number}. The car goes to gate-out with the inspection fee due.`, jobId: job.id, href: `/jobs/${job.id}` });
    await notifyRoles(["owner"], { type: "quote_declined", title: `Quotation declined · ${job.job_number}`, body: `${answer.name} declined ${q.number}.`, jobId: job.id, href: `/jobs/${job.id}` });
    return { status };
  }

  // Approved parts: to order if they are not on the shelf.
  const { data: partRows } = await admin.from("part_items").select(PART_SELECT).eq("job_id", job.id).eq("is_active", true);
  const parts = ((partRows ?? []) as Record<string, unknown>[]).map(toPart);
  let needsOrder = false;
  for (const l of lines) {
    if (l.line_type !== "part") continue;
    if (l.part_item_id) {
      const p = parts.find((x) => x.id === l.part_item_id);
      if (!p) continue;
      const toOrder = p.availability !== "in_stock";
      if (toOrder) needsOrder = true;
      // A part on the shelf needs no purchase order: it counts as received from stock, with its label, ready to issue.
      const fromStock = toOrder ? {} : { received_qty: Number(p.confirmed_quantity ?? p.quantity) || 1, label_code: newLabelCode() };
      await admin.from("part_items").update({ order_status: toOrder ? "to_order" : "received", ...fromStock, updated_by: answer.by ?? null }).eq("id", p.id);
    } else if (l.advisor_added || l.unit_cost !== null) {
      // A part typed on the quotation (advisor's small part, or the owner's): it still has to be bought.
      needsOrder = true;
      await admin.from("part_items").insert({ job_id: job.id, description: l.title, quantity: l.quantity, cost_aed: l.unit_cost, availability: "to_order", confirm_status: "confirmed", confirmed_at: now, priced_at: now, order_status: "to_order", added_by_role: l.advisor_added ? "service_advisor" : "owner", created_by: answer.by ?? null, updated_by: answer.by ?? null });
    }
  }
  // An additional quotation (the car is already in work, QC or wash): the job never moves backwards.
  // The new lines join the work order, the promised date can only move later, and the parts follow the normal ordering path.
  const extra = ["in_work", "pending_qc", "pending_wash"].includes(job.status);
  const { data: jobDates } = await admin.from("jobs").select("promised_at").eq("id", job.id).maybeSingle();
  const laterPromise = q.promised_at && (!jobDates?.promised_at || q.promised_at > jobDates.promised_at) ? { promised_at: q.promised_at } : {};
  const toStatus = extra ? "in_work" : needsOrder ? "waiting_parts" : "in_work";
  await admin.from("jobs").update({ status: toStatus, stage: toStatus === "in_work" ? "work" : "parts", ...(extra ? laterPromise : q.promised_at ? { promised_at: q.promised_at } : {}) }).eq("id", job.id);
  const madeLines = toStatus === "in_work" ? await ensureWorkLines(job.id, answer.by ?? null) : 0;
  await admin.from("job_events").insert({ job_id: job.id, event_type: "status_change", from_status: job.status, to_status: toStatus, note: `Quotation ${q.number} approved by ${answer.name}: ${lines.length} line${lines.length === 1 ? "" : "s"}, ${totalText} with VAT${extra ? ` (additional work, ${madeLines} new line${madeLines === 1 ? "" : "s"} on the work order)` : ""}`, created_by: answer.by ?? null });
  const body = `${answer.name} approved ${q.number} (${totalText}). ${extra ? "Additional work: the new lines are on the work order." : needsOrder ? "Parts to order." : "Work can start."}`;
  await notifyStaff(advisors, { type: "quote_approved", title: `Quotation approved · ${job.job_number}`, body, jobId: job.id, href: `/jobs/${job.id}` });
  await notifyManagers(job.department ?? null, { type: "quote_approved", title: `Quotation approved · ${job.job_number}`, body, jobId: job.id, href: `/jobs/${job.id}` });
  if (needsOrder) await notifyRoles(["parts"], { type: "parts_to_order", title: `Parts to order · ${job.job_number}`, body: `${answer.name} approved the quotation. See the To order list.`, jobId: job.id, href: "/parts" });
  if (job.assigned_to && toStatus === "in_work") await notifyStaff([job.assigned_to], { type: "quote_approved", title: extra ? `Additional work approved · ${job.job_number}` : `Work approved · ${job.job_number}`, body: extra ? "The customer approved the additional work. The new lines are on your work order." : "The customer approved the quotation. Work can start.", jobId: job.id, href: `/my-jobs/${job.id}` });
  return { status };
}

/** The customer asks for a quotation with the urgent work only. Nothing is approved; the advisor builds the urgent-only version. */
export async function requestUrgentOnly(quotationId: string, answer: { name: string; note: string | null }): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: qRaw } = await admin.from("quotations").select(CORE).eq("id", quotationId).maybeSingle();
  if (!qRaw) return { error: "Quotation not found." };
  const q = qRaw as unknown as QuoteCore;
  if (!["sent", "opened"].includes(q.status)) return { error: "This quotation has already been answered." };
  const now = new Date().toISOString();
  await admin.from("quotations").update({ status: "urgent_requested", responded_at: now, approver_name: answer.name, approver_phone: q.sent_to_phone, customer_request_note: answer.note, opened_at: now }).eq("id", quotationId);
  await logQuoteEvent(quotationId, q.job_id, null, "quote_urgent_requested", `${q.number} v${q.version}: ${answer.name} asked for a quotation with the urgent work only${answer.note ? `: ${answer.note}` : ""}`);
  const advisors = await advisorsOf(q);
  await notifyStaff(advisors, { type: "quote_urgent_requested", title: `Urgent work only · ${q.number}`, body: `${answer.name} asked for a quotation with the urgent work only.${answer.note ? ` Note: ${answer.note}` : ""} Create the urgent-only version from the quotation.`, jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}/quote/${quotationId}` : `/estimates/${quotationId}` });
  return {};
}

export type { QuoteLine };
