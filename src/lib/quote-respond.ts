import "server-only";
import { createAdminClient } from "./supabase/admin";
import { notifyManagers, notifyRoles, notifyStaff } from "./notifications";
import { LINE_SELECT, PART_SELECT, logQuoteEvent, refreshQuoteTotals, toLine, toPart } from "./quote-data";
import { quoteTotals, type QuoteLine, type QuoteRow } from "./quotes";
import { getSettings } from "./settings";

/** Everyone who should hear about a customer's answer: the advisor(s) of the job and the person who sent it. */
async function advisorsOf(q: Pick<QuoteRow, "job_id" | "created_by" | "sent_by">): Promise<string[]> {
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

/**
 * Records the customer's answer line by line (or a decline of everything), moves the job on,
 * keeps declined lines against the car, and tells the people involved. Used by the customer
 * page and when the advisor confirms an unchanged estimate.
 */
export async function applyCustomerResponse(
  quotationId: string,
  answer: { approvedLineIds: string[] | "all"; declineAll: boolean; name: string; phone: string | null; by?: string | null; via: "customer" | "estimate" },
): Promise<{ error?: string; status?: string }> {
  const admin = createAdminClient();
  const settings = await getSettings();
  const { data: qRaw } = await admin.from("quotations").select("id, kind, number, version, job_id, customer_id, vehicle_id, status, created_by, sent_by, promised_at").eq("id", quotationId).maybeSingle();
  if (!qRaw) return { error: "Quotation not found." };
  const q = qRaw as unknown as Pick<QuoteRow, "id" | "kind" | "number" | "version" | "job_id" | "customer_id" | "vehicle_id" | "status" | "created_by" | "sent_by" | "promised_at">;
  if (!["sent", "opened", "draft"].includes(q.status)) return { error: "This quotation has already been answered." };
  const { data: lineRows } = await admin.from("quotation_lines").select(LINE_SELECT).eq("quotation_id", quotationId).eq("is_active", true).order("position");
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map(toLine);
  const now = new Date().toISOString();
  const approvedIds = new Set(answer.declineAll ? [] : answer.approvedLineIds === "all" ? lines.map((l) => l.id) : answer.approvedLineIds);
  const approved = lines.filter((l) => approvedIds.has(l.id));
  const declined = lines.filter((l) => !approvedIds.has(l.id));
  const status: QuoteRow["status"] = approved.length === 0 ? "declined" : declined.length === 0 ? "approved" : "partly_approved";

  for (const l of lines) await admin.from("quotation_lines").update({ customer_approved: approvedIds.has(l.id) }).eq("id", l.id);
  await admin.from("quotations").update({ status, responded_at: now, approver_name: answer.name, approver_phone: answer.phone, opened_at: now, updated_by: answer.by ?? null }).eq("id", quotationId);
  await refreshQuoteTotals(quotationId, settings, answer.by ?? "");
  const totals = quoteTotals(approved.map((l) => ({ ...l, customer_approved: true })), { discount_percent: 0, vat_percent: Number((await admin.from("quotations").select("vat_percent").eq("id", quotationId).maybeSingle()).data?.vat_percent) || 5 }, { onlyApproved: true });
  const who = answer.via === "estimate" ? "the advisor (unchanged estimate)" : `${answer.name} (customer link)`;
  await logQuoteEvent(quotationId, q.job_id, answer.by ?? null, status === "declined" ? "quote_declined" : "quote_approved", `${q.number} v${q.version}: ${status === "declined" ? "declined" : status === "approved" ? "approved in full" : `partly approved (${approved.length} of ${lines.length} lines)`} by ${who}`);

  // Declined lines stay against the car for its next visit.
  if (declined.length && q.kind === "quotation") {
    await admin.from("declined_work").insert(
      declined.map((l) => ({ vehicle_id: q.vehicle_id, customer_id: q.customer_id, job_id: q.job_id, quotation_id: quotationId, title: l.title, details: l.group_label, amount_aed: l.line_total, declined_at: now })),
    );
  }

  const advisors = await advisorsOf(q);
  const admin2 = admin;
  if (q.kind === "estimate") {
    await notifyStaff(advisors, {
      type: status === "declined" ? "quote_declined" : "estimate_accepted",
      title: status === "declined" ? `Estimate declined · ${q.number}` : `Estimate accepted · ${q.number}`,
      body: status === "declined" ? `${answer.name} declined the estimate.` : `${answer.name} accepted ${status === "approved" ? "everything" : `${approved.length} of ${lines.length} lines`}. Offer to book the car in.`,
      href: `/estimates/${quotationId}`,
    });
    return { status };
  }

  if (!q.job_id) return { status };
  const { data: job } = await admin2.from("jobs").select("id, job_number, status, department, assigned_to").eq("id", q.job_id).maybeSingle();
  if (!job) return { status };

  if (status === "declined") {
    // Declined all: the car goes to the gate-out route with the inspection fee due.
    await admin2.from("jobs").update({ status: "ready", stage: "ready", inspection_fee_due: true }).eq("id", job.id);
    await admin2.from("job_events").insert({ job_id: job.id, event_type: "status_change", from_status: job.status, to_status: "ready", note: `Quotation ${q.number} declined by ${answer.name}. Inspection fee of AED ${Number(settings.inspection_fee_aed).toLocaleString("en-GB")} due at gate-out.`, created_by: answer.by ?? null });
    await notifyStaff(advisors, { type: "quote_declined", title: `Quotation declined · ${job.job_number}`, body: `${answer.name} declined all lines. The car goes to gate-out with the inspection fee due.`, jobId: job.id, href: `/jobs/${job.id}` });
    await notifyRoles(["owner"], { type: "quote_declined", title: `Quotation declined · ${job.job_number}`, body: `${answer.name} declined ${q.number}.`, jobId: job.id, href: `/jobs/${job.id}` });
    return { status };
  }

  // Approved parts: to order if they are not on the shelf.
  const { data: partRows } = await admin2.from("part_items").select(PART_SELECT).eq("job_id", job.id).eq("is_active", true);
  const parts = ((partRows ?? []) as Record<string, unknown>[]).map(toPart);
  let needsOrder = false;
  for (const l of approved) {
    if (l.line_type !== "part" || !l.part_item_id) continue;
    const p = parts.find((x) => x.id === l.part_item_id);
    if (!p) continue;
    const toOrder = p.availability !== "in_stock";
    if (toOrder) needsOrder = true;
    await admin2.from("part_items").update({ order_status: toOrder ? "to_order" : "received", updated_by: answer.by ?? null }).eq("id", p.id);
  }
  const toStatus = needsOrder ? "waiting_parts" : "in_work";
  // The promised date set on the quotation now shows on the job card and the dashboard.
  await admin2.from("jobs").update({ status: toStatus, stage: needsOrder ? "parts" : "work", ...(q.promised_at ? { promised_at: q.promised_at } : {}) }).eq("id", job.id);
  await admin2.from("job_events").insert({ job_id: job.id, event_type: "status_change", from_status: job.status, to_status: toStatus, note: `Quotation ${q.number} ${status === "approved" ? "approved" : "partly approved"} by ${answer.name}: ${approved.length} line${approved.length === 1 ? "" : "s"}, AED ${totals.total.toLocaleString("en-GB")} with VAT`, created_by: answer.by ?? null });
  const body = `${answer.name} approved ${status === "approved" ? "everything" : `${approved.length} of ${lines.length} lines`} on ${q.number}. ${needsOrder ? "Parts to order." : "Work can start."}`;
  await notifyStaff(advisors, { type: "quote_approved", title: `Quotation approved · ${job.job_number}`, body, jobId: job.id, href: `/jobs/${job.id}` });
  await notifyManagers(job.department ?? null, { type: "quote_approved", title: `Quotation approved · ${job.job_number}`, body, jobId: job.id, href: `/jobs/${job.id}` });
  if (needsOrder) await notifyRoles(["parts"], { type: "parts_to_order", title: `Parts to order · ${job.job_number}`, body: `${answer.name} approved the quotation. See the To order list.`, jobId: job.id, href: "/parts" });
  if (job.assigned_to && !needsOrder) await notifyStaff([job.assigned_to], { type: "quote_approved", title: `Work approved · ${job.job_number}`, body: "The customer approved the quotation. Work can start.", jobId: job.id, href: `/my-jobs/${job.id}` });
  return { status };
}

export type { QuoteLine };
