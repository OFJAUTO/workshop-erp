import { replaceProformaAfterRevision } from "./invoice-flow";
import { jobAdvisorIds as advisorsInCharge } from "@/lib/notifications";
import { createTrip, loadDrivers } from "./delivery";
import { dropParts } from "@/lib/drop-parts";
import "server-only";
import { finishPartsPlanning } from "./lpo";
import { createAdminClient } from "./supabase/admin";
import { notifyManagers, notifyRoles, notifyStaff } from "./notifications";
import { newLabelCode } from "./parts-data";
import { ensureWorkLines } from "./work-data";
import { LINE_SELECT, PART_SELECT, logQuoteEvent, refreshQuoteTotals, toLine, toPart } from "./quote-data";
import { aed, isUnchosen, type QuoteLine, type QuoteRow } from "./quotes";
import { getSettings } from "./settings";
import { formatPlate } from "./types";
import { releaseWords } from "./job-sides";
import { extendBodyshopStages } from "./bodyshop";

/** Everyone who should hear about a customer's answer: the advisor(s) of the job and the person who sent it. */
export async function advisorsOf(q: Pick<QuoteRow, "job_id" | "created_by" | "sent_by">): Promise<string[]> {
  const ids = new Set<string>();
  if (q.created_by) ids.add(q.created_by);
  if (q.sent_by) ids.add(q.sent_by);
  if (q.job_id) {
    for (const id of await advisorsInCharge(q.job_id)) ids.add(id);
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
export async function applyCustomerResponse(quotationId: string, answer: { approve: boolean; name: string; by?: string | null; via: "customer" | "estimate" | "warranty" | "advisor"; dangerAck?: boolean; note?: string | null }): Promise<{ error?: string; status?: string }> {
  const admin = createAdminClient();
  const settings = await getSettings();
  const { data: qRaw } = await admin.from("quotations").select(CORE).eq("id", quotationId).maybeSingle();
  if (!qRaw) return { error: "Quotation not found." };
  const q = qRaw as unknown as QuoteCore;
  if (!["sent", "opened", "draft", "urgent_requested", ...(answer.via === "advisor" ? ["expired"] : [])].includes(q.status)) return { error: "This quotation has already been answered." };
  const { data: lineRows } = await admin.from("quotation_lines").select(LINE_SELECT).eq("quotation_id", quotationId).eq("is_active", true).order("position");
  // Options the advisor did not pick count for nothing.
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map(toLine).filter((l) => !isUnchosen(l));
  const now = new Date().toISOString();
  const status: QuoteRow["status"] = answer.approve ? "approved" : "declined";

  for (const l of lines) await admin.from("quotation_lines").update({ customer_approved: answer.approve }).eq("id", l.id);
  await admin.from("quotations").update({ status, responded_at: now, approver_name: answer.name, approver_phone: q.sent_to_phone, opened_at: now, declined_note: answer.approve ? null : (answer.note ?? null), declined_by: !answer.approve && answer.via === "advisor" ? (answer.by ?? null) : null, updated_by: answer.by ?? null, ...(!answer.approve && answer.dangerAck ? { danger_acknowledged_at: now, danger_acknowledged_by: answer.name } : {}) }).eq("id", quotationId);
  // A revised quotation approved again: an earlier version of the same number was already approved. The car never moves
  // backwards; unchanged lines carry on; the parts of lines that left the quotation leave the parts list below.
  const { data: olderApproved } = answer.approve ? await admin.from("quotations").select("id").eq("number", q.number).eq("kind", q.kind).lt("version", q.version).eq("is_active", true).eq("status", "approved") : { data: [] as { id: string }[] };
  const revisionOfApproved = (olderApproved ?? []).length > 0;
  // One approved version per number: the older versions are replaced, so nothing is counted twice on the work order or the invoice.
  if (answer.approve) await admin.from("quotations").update({ status: "superseded", updated_by: answer.by ?? null }).eq("number", q.number).eq("kind", q.kind).lt("version", q.version).eq("is_active", true).neq("status", "superseded");
  if (answer.approve && revisionOfApproved && q.job_id) {
    const { data: oldLines } = await admin.from("quotation_lines").select("part_item_id").in("quotation_id", (olderApproved ?? []).map((o) => o.id)).eq("is_active", true).eq("customer_approved", true).not("part_item_id", "is", null);
    const keep = new Set(lines.map((l) => l.part_item_id).filter((x): x is string => !!x));
    const gone = Array.from(new Set((oldLines ?? []).map((l) => String(l.part_item_id)).filter((id) => !keep.has(id))));
    if (gone.length) await dropParts(q.job_id, gone, { id: answer.by ?? null, display_name: answer.name }, "revised");
  }
  await refreshQuoteTotals(quotationId, settings, answer.by ?? "");
  // A revised quotation approved after the proforma went out: the proforma is remade from the approved lines, payments carried across.
  if (answer.approve && revisionOfApproved && q.job_id) await replaceProformaAfterRevision(q.job_id, answer.by ?? null, settings);
  const { data: fresh } = await admin.from("quotations").select("approved_total_aed, total_aed").eq("id", quotationId).maybeSingle();
  const totalText = aed(Number(fresh?.approved_total_aed ?? fresh?.total_aed ?? 0));
  const who = answer.via === "estimate" ? "the advisor (unchanged estimate)" : answer.via === "warranty" ? "the owner (warranty repair, free of charge)" : answer.via === "advisor" ? `${answer.name} (advisor, after talking to the customer)` : `${answer.name} (customer link)`;
  await logQuoteEvent(quotationId, q.job_id, answer.by ?? null, answer.approve ? "quote_approved" : "quote_declined", `${q.number} v${q.version}: ${answer.approve ? `approved, ${totalText} with VAT` : `declined${answer.dangerAck ? " (safety warning acknowledged)" : ""}`} by ${who}`);

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
  const { data: job } = await admin.from("jobs").select("id, job_number, status, department, assigned_to, bodyshop_started_at").eq("id", q.job_id).maybeSingle();
  if (!job) return { status };

  // A package with "Complimentary pick-up & drop-off" approved: both recovery trips are made at once
  // (our truck, the saved driver). The advisor fills the pin and date; the customer sees "Complimentary",
  // and the truck's cost still counts against this job's profit.
  if (answer.approve && lines.some((l) => (l.package_items as { pickup_dropoff?: boolean } | null)?.pickup_dropoff)) {
    const { data: existing } = await admin.from("recovery_trips").select("id").eq("job_id", job.id).eq("is_active", true).limit(1);
    if (!(existing ?? []).length) {
      const drivers = await loadDrivers();
      const ours = drivers.filter((d) => !d.company);
      const driver = ours.find((d) => d.is_default) ?? ours[0] ?? null;
      for (const kind of ["pickup", "delivery"] as const) {
        await createTrip({ jobId: job.id, kind, company: null, driverId: driver?.id ?? null, driverName: driver?.name ?? null, driverPhone: driver?.phone ?? null, truckPlate: driver?.truck_plate ?? null, locationUrl: null, locationDetails: "Complimentary (package)", date: null, slot: null, by: answer.by ?? null });
      }
      await admin.from("job_events").insert({ job_id: job.id, event_type: "recovery", note: "Complimentary pick-up and drop-off trips created with the package approval; the advisor fills the pin and date", created_by: answer.by ?? null });
    }
  }

  // A bodyshop quotation answered before the car arrives: nothing moves in the workshop. Approved: the advisor books the
  // arrival and the handover (and a deposit if wanted); declined: the advisor hears, no inspection fee.
  if (job.status === "booked") {
    if (answer.approve) {
      await admin.from("jobs").update({ first_approval_at: now }).eq("id", job.id);
      await admin.from("job_events").insert({ job_id: job.id, event_type: "quote_approved", note: `Quotation ${q.number} approved by ${answer.name} before the car arrived (${totalText} with VAT)`, created_by: answer.by ?? null });
      await notifyStaff(advisors, { type: "bodyshop_booked", title: `Approved before arrival · ${job.job_number}`, body: `${answer.name} approved ${q.number} (${totalText}). Book the arrival and the handover date; request a deposit if you want one.`, jobId: job.id, href: `/bodyshop/${job.id}` });
    } else {
      await admin.from("job_events").insert({ job_id: job.id, event_type: "quote_declined", note: `Quotation ${q.number} declined by ${answer.name} before the car arrived`, created_by: answer.by ?? null });
      await notifyStaff(advisors, { type: "quote_declined", title: `Quotation declined · ${job.job_number}`, body: `${answer.name} declined ${q.number}. Make a revised quotation or close the booking.`, jobId: job.id, href: `/bodyshop/${job.id}` });
    }
    return { status };
  }

  if (!answer.approve) {
    // Nothing moves in the workshop: the advisor makes a revised quotation, or the car leaves with the inspection fee due.
    await admin.from("jobs").update({ inspection_fee_due: true }).eq("id", job.id);
    await admin.from("job_events").insert({ job_id: job.id, event_type: "quote_declined", note: `Quotation ${q.number} declined by ${answer.name}${answer.note ? `: "${answer.note}"` : ""}. Inspection fee of AED ${Number(settings.inspection_fee_aed).toLocaleString("en-GB")} due unless work is approved later.`, created_by: answer.by ?? null });
    const why = answer.note ? ` Reason: "${answer.note}".` : "";
    await notifyStaff(advisors, { type: "quote_declined", title: `Quotation declined · ${job.job_number}`, body: `${answer.name} declined ${q.number}.${why} Make a revised quotation, or gate the car out with the inspection fee.`, jobId: job.id, href: `/jobs/${job.id}/quote/${quotationId}` });
    await notifyRoles(["owner"], { type: "quote_declined", title: `Quotation declined · ${job.job_number}`, body: `${answer.name} declined ${q.number}.${why}`, jobId: job.id, href: `/jobs/${job.id}` });
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
      // A part already in the ordering flow (a revised quotation approved again) carries on where it is.
      if (p.order_status && p.order_status !== "none") continue;
      const toOrder = p.availability !== "in_stock";
      if (toOrder) needsOrder = true;
      // A part on the shelf needs no LPO: it counts as received from stock, with its label, ready to issue.
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
  // An additional quotation (the car is already in work, QC or wash) joins the work order; a first approval goes to Planning inside the Parts step.
  // A revised quotation approved again while the car is past the quote stage keeps its stage: nothing is reset.
  const revisionKeepsStage = revisionOfApproved && !["pending_quote", "pending_customer_approval"].includes(job.status);
  const extra = ["in_work", "pending_qc", "pending_wash"].includes(job.status);
  const toStatus = revisionKeepsStage ? job.status : extra ? "in_work" : "waiting_parts";
  if (revisionKeepsStage) await admin.from("jobs").update({ inspection_fee_due: false }).eq("id", job.id);
  else await admin.from("jobs").update({ status: toStatus, stage: extra ? "work" : "parts", stage_entered_at: now, inspection_fee_due: false, ...(extra ? {} : { plan_parts_done_at: null, plan_released_at: null, plan_date_confirmed_at: null, plan_start_date: null, plan_bodyshop_released_at: null, plan_bodyshop_released_by: null, plan_bodyshop_start_date: null }) }).eq("id", job.id);
  const madeLines = extra ? await ensureWorkLines(job.id, answer.by ?? null) : 0;
  const newStages = extra && job.bodyshop_started_at ? (await extendBodyshopStages(job.id, { id: (answer.by ?? null) as unknown as string, display_name: answer.name })).added : [];
  // No parts on the approved work: the Parts circle is done at once and the workshop manager plans the work.
  const noParts = !extra && !lines.some((l) => l.line_type === "part") && !parts.some((p) => p.order_status !== "none");
  if (noParts) await admin.from("jobs").update({ plan_parts_done_at: now, plan_parts_by: null, plan_parts_ready_date: now.slice(0, 10) }).eq("id", job.id);
  await admin.from("job_events").insert({ job_id: job.id, event_type: "status_change", from_status: job.status, to_status: toStatus, note: `Quotation ${q.number} approved by ${answer.name}: ${lines.length} line${lines.length === 1 ? "" : "s"}, ${totalText} with VAT${extra ? ` (additional work, ${madeLines} new line${madeLines === 1 ? "" : "s"} on the work order)` : " · planning starts with Parts"}`, created_by: answer.by ?? null });
  const body = `${answer.name} approved ${q.number} (${totalText}). ${extra ? [madeLines ? "Additional work: the new lines are on the work order." : "", newStages.length ? `New bodyshop stages: ${newStages.join(", ")}.` : ""].filter(Boolean).join(" ") || "Additional work approved." : "Planning: Parts first, then the managers, then the advisor."}`;
  await notifyStaff(advisors, { type: "quote_approved", title: `Quotation approved · ${job.job_number}`, body, jobId: job.id, href: `/jobs/${job.id}` });
  await notifyManagers(job.department ?? null, { type: "quote_approved", title: `Quotation approved · ${job.job_number}`, body, jobId: job.id, href: `/jobs/${job.id}` });
  if (!extra && noParts) await notifyManagers(job.department ?? null, { type: "planning", title: `Plan the work · ${job.job_number}`, body: `${answer.name} approved ${q.number}; no parts needed. ${releaseWords(job.department)}`, jobId: job.id, href: `/jobs/${job.id}#planning` });
  else if (!extra && !needsOrder) {
    // Every approved part is from our stock: nothing to order, the workshop manager plans the work; Parts hear so the parts are ready for the handover.
    await finishPartsPlanning(job.id, null);
    await notifyRoles(["parts"], { type: "planning", title: `Approved parts from stock · ${job.job_number}`, body: `${answer.name} approved ${q.number}. Every part is from our stock, nothing to order: have them ready for the handover.`, jobId: job.id, href: `/parts/${job.id}#lpo` });
  }
  else if (!extra) await notifyRoles(["parts"], { type: "planning", title: `Send the LPO for approval · ${job.job_number}`, body: `${answer.name} approved ${q.number}. The approved parts are on the Parts list: open the car and press Send LPO for approval.`, jobId: job.id, href: `/parts/${job.id}#lpo` });
  else if (needsOrder) await notifyRoles(["parts"], { type: "parts_to_order", title: `Parts to order · ${job.job_number}`, body: `${answer.name} approved additional work. Open the car and press Send LPO for approval.`, jobId: job.id, href: `/parts/${job.id}#lpo` });
  if (job.assigned_to && extra) await notifyStaff([job.assigned_to], { type: "quote_approved", title: `Additional work approved · ${job.job_number}`, body: "The customer approved the additional work. The new lines are on your work order.", jobId: job.id, href: `/my-jobs/${job.id}` });
  // A deposit was asked for on the quotation: the advisor and accounts collect it; the LPO waits for it.
  const { data: dq } = await admin.from("quotations").select("deposit_aed").eq("id", quotationId).maybeSingle();
  const depositAed = Number(dq?.deposit_aed) || 0;
  if (depositAed > 0) {
    const { data: jc } = await admin.from("jobs").select("customer:customers(full_name, company_name), vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant)").eq("id", job.id).maybeSingle();
    const jcv = jc as unknown as { customer: { full_name: string; company_name: string | null } | null; vehicle: Parameters<typeof formatPlate>[0] | null } | null;
    const plate = jcv?.vehicle ? formatPlate(jcv.vehicle) : job.job_number;
    const who = jcv?.customer?.company_name ?? jcv?.customer?.full_name ?? answer.name;
    const msg = { type: "deposit_to_collect", title: `Deposit AED ${depositAed.toLocaleString("en-GB")} to collect: ${plate}, ${who}`, body: `${q.number} approved by ${answer.name}. Record the deposit on the job's money page; the LPO waits for it.`, jobId: job.id, href: `/jobs/${job.id}/invoice` };
    await notifyStaff(advisors, msg);
    await notifyRoles(["accounts"], msg);
  }
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
