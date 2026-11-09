import "server-only";
import { createAdminClient } from "./supabase/admin";
import { logAppError, SAVE_FAILED } from "./app-errors";
import { schemaReady } from "./schema-ready";
import type { Settings } from "./settings";
import { DEFAULT_LATHE_LPO_THRESHOLD, DEFAULT_LATHE_MIN_MARKUP, billProblem, customerServiceName, latheCost, nextTicket, parsePriceList, skipsLpo, splitBill, type BillTicket } from "./lathe-rules";
import { round2 } from "./money";

/*
 * Outsourced lathe work (9 November 2026, Section 8). A lathe job is a PART on the car's parts list (it flows into the
 * quotation, the invoice and the profit like every part) carrying a ticket (SUB-), the item, when it was sent and who
 * took it; Back when it returns; Billed when the month-end bill covers it (the actual cost then replaces the estimate).
 * The customer reads only the service name. Under the threshold it skips LPO approval (marked ordered at once).
 */

export const latheReady = () => schemaReady("part_items", "lathe_ticket, lathe_sent_at");
type Actor = { id: string; display_name: string; role_id: string };

export function latheSettingsOf(settings: Settings) {
  const s = settings as unknown as Record<string, unknown>;
  return {
    items: parsePriceList(s.lathe_price_list),
    minMarkup: Number(s.lathe_min_markup_percent ?? DEFAULT_LATHE_MIN_MARKUP) || DEFAULT_LATHE_MIN_MARKUP,
    threshold: Number(s.lathe_lpo_threshold_aed ?? DEFAULT_LATHE_LPO_THRESHOLD) || DEFAULT_LATHE_LPO_THRESHOLD,
  };
}

/** The minimum markup of a quotation line: a lathe ticket's part at least the lathe minimum, every other the usual one. */
export async function latheFloorFor(jobId: string | null, settings: Settings, minMarkup: number): Promise<(partId: string | null) => number> {
  if (!jobId || !(await latheReady())) return () => minMarkup;
  const { data } = await createAdminClient().from("part_items").select("id").eq("job_id", jobId).not("lathe_ticket", "is", null);
  const ids = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  const lathe = Math.max(minMarkup, latheSettingsOf(settings).minMarkup);
  return (partId) => (partId && ids.has(partId) ? lathe : minMarkup);
}

export type LatheInput = { item: string; service?: string | null; qty: number; cost?: number | null; supplier: string; sentOn: string; takenBy: string };

/** A lathe ticket on the car: the part (cost from the price list), its SUB- number, on the quotation at 3 × the cost. */
export async function createLatheTicket(jobId: string, input: LatheInput, settings: Settings, actor: Actor): Promise<{ error?: string; ok?: boolean; ticket?: string; partId?: string; words?: string }> {
  if (!["owner", "parts", "service_advisor", "workshop_manager"].includes(actor.role_id)) return { error: "Parts, the advisor, the manager or the owner record lathe work." };
  if (!(await latheReady())) return { error: "Lathe tickets switch on with the database update of 9 November (WAITING FOR APPLY)." };
  const cfg = latheSettingsOf(settings);
  const item = String(input.item ?? "").trim();
  if (!item) return { error: "Pick or type what goes to the lathe." };
  const listed = cfg.items.find((i) => i.item.toLowerCase() === item.toLowerCase()) ?? null;
  const cost = listed ? latheCost(listed) : round2(Number(input.cost) || 0);
  if (!(cost > 0)) return { error: `${item} is not on the lathe price list: type its cost (or add it to the list).` };
  const qty = Math.max(1, Math.round(Number(input.qty) || 1));
  const supplier = String(input.supplier ?? "").trim();
  if (supplier.length < 2) return { error: "Which lathe shop?" };
  const sentOn = String(input.sentOn ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sentOn)) return { error: "Pick the day it was sent." };
  const takenBy = String(input.takenBy ?? "").trim();
  if (takenBy.length < 2) return { error: "Who took it to the lathe?" };
  const service = (input.service ?? "").trim() || customerServiceName(listed ?? { item, service: null });
  const admin = createAdminClient();
  const { data: top } = await admin.from("part_items").select("lathe_ticket").like("lathe_ticket", "SUB-%").order("lathe_ticket", { ascending: false }).limit(1);
  let ticket = nextTicket((top?.[0] as { lathe_ticket: string } | undefined)?.lathe_ticket ?? null);
  const skip = skipsLpo(cost, qty, cfg.threshold);
  let made: { id: string } | null = null;
  for (let i = 0; i < 3 && !made; i++) {
    const { data, error } = await admin.from("part_items").insert({
      job_id: jobId, description: service, quantity: qty, confirmed_quantity: qty, cost_aed: cost, supplier, availability: "to_order", delivery_date: sentOn,
      order_status: skip ? "ordered" : "none", priced_at: new Date().toISOString(), added_by_role: actor.role_id,
      lathe_ticket: ticket, lathe_item: item, lathe_sent_at: `${sentOn}T08:00:00.000Z`, lathe_sent_by: actor.id, lathe_taken_by: takenBy.slice(0, 80),
      created_by: actor.id, updated_by: actor.id,
    }).select("id").single();
    if (data) made = data as { id: string };
    else if (error && /duplicate|unique/i.test(error.message)) ticket = nextTicket(ticket);
    else { await logAppError("lathe: ticket", error ?? "no row", { staffId: actor.id, jobId }); return { error: SAVE_FAILED }; }
  }
  if (!made) return { error: SAVE_FAILED };
  await admin.from("job_events").insert({ job_id: jobId, event_type: "lathe_sent", note: `${ticket}: ${item} × ${qty} sent to ${supplier} on ${sentOn} (taken by ${takenBy}) – cost AED ${(cost * qty).toFixed(2)}${skip ? ", under the limit: no LPO approval" : ""} (${actor.display_name})`, created_by: actor.id });
  // On the quotation like any part, at no less than the lathe minimum (3 × the cost).
  try {
    const { syncPartLine } = await import("./quote-versions");
    const r = await syncPartLine(jobId, made.id, actor.id);
    if (r.quotationId) {
      const { data: line } = await admin.from("quotation_lines").select("id, markup_percent, markup_mode").eq("quotation_id", r.quotationId).eq("part_item_id", made.id).eq("is_active", true).maybeSingle();
      if (line && (line.markup_mode === "aed" || Number(line.markup_percent) < cfg.minMarkup)) await admin.from("quotation_lines").update({ markup_mode: "percent", markup_percent: cfg.minMarkup, updated_by: actor.id }).eq("id", line.id);
      const { refreshQuoteTotals } = await import("./quote-data");
      await refreshQuoteTotals(r.quotationId, settings, actor.id).catch(() => null);
    }
  } catch (e) {
    await logAppError("lathe: quotation", e, { staffId: actor.id, jobId });
  }
  return { ok: true, ticket, partId: made.id, words: `${ticket}: ${service} (${item} × ${qty}) – cost AED ${(cost * qty).toFixed(2)}, on the quotation at no less than AED ${(cost * qty * (1 + cfg.minMarkup / 100)).toFixed(2)}.${skip ? " Under the limit: no LPO approval needed." : " Above the limit: it goes on the LPO for approval."}` };
}

export async function markLatheBack(partId: string, actor: Actor): Promise<{ error?: string; ok?: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("part_items").update({ lathe_back_at: new Date().toISOString(), lathe_back_by: actor.id, updated_by: actor.id }).eq("id", partId).not("lathe_ticket", "is", null).is("lathe_back_at", null).select("id, job_id, lathe_ticket, quantity");
  if (error) { await logAppError("lathe: back", error, { staffId: actor.id }); return { error: SAVE_FAILED }; }
  const p = (data ?? [])[0] as { id: string; job_id: string; lathe_ticket: string; quantity: number } | undefined;
  if (!p) return { error: "That ticket is already back." };
  await admin.from("part_items").update({ received_qty: p.quantity, order_status: "received" }).eq("id", p.id);
  await admin.from("job_events").insert({ job_id: p.job_id, event_type: "lathe_back", note: `${p.lathe_ticket} back from the lathe (${actor.display_name})`, created_by: actor.id });
  return { ok: true };
}

export type LatheTicketRow = { partId: string; ticket: string; item: string; service: string; qty: number; estimate: number; supplier: string; sentAt: string | null; takenBy: string | null; backAt: string | null; billId: string | null; billAmount: number | null; jobId: string; jobNumber: string; plate: string; charged: number | null };

export async function loadLatheTickets(opts: { open?: boolean; month?: string; jobId?: string } = {}): Promise<LatheTicketRow[]> {
  if (!(await latheReady())) return [];
  const admin = createAdminClient();
  let q = admin.from("part_items").select("id, job_id, description, quantity, cost_aed, supplier, lathe_ticket, lathe_item, lathe_sent_at, lathe_taken_by, lathe_back_at, lathe_bill_id, lathe_bill_amount_aed, is_active").not("lathe_ticket", "is", null).eq("is_active", true).order("lathe_sent_at");
  if (opts.open) q = q.is("lathe_bill_id", null);
  if (opts.jobId) q = q.eq("job_id", opts.jobId);
  if (opts.month) q = q.gte("lathe_sent_at", `${opts.month}-01T00:00:00+04:00`).lt("lathe_sent_at", `${nextMonth(opts.month)}-01T00:00:00+04:00`);
  const { data } = await q;
  const rows = (data ?? []) as { id: string; job_id: string; description: string; quantity: number | string; cost_aed: number | string | null; supplier: string | null; lathe_ticket: string; lathe_item: string | null; lathe_sent_at: string | null; lathe_taken_by: string | null; lathe_back_at: string | null; lathe_bill_id: string | null; lathe_bill_amount_aed: number | string | null }[];
  const jobIds = Array.from(new Set(rows.map((r) => r.job_id)));
  const { data: jobs } = jobIds.length ? await admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant)").in("id", jobIds) : { data: [] };
  const { formatPlate } = await import("./types");
  const jobOf = new Map(((jobs ?? []) as unknown as { id: string; job_number: string; vehicle: Parameters<typeof formatPlate>[0] | null }[]).map((j) => [j.id, j]));
  // What the customer is charged for it: the line on an approved quotation (incl. markup, before VAT).
  const { data: lines } = rows.length ? await admin.from("quotation_lines").select("part_item_id, line_total, quotation:quotations!inner(status)").in("part_item_id", rows.map((r) => r.id)).eq("is_active", true).eq("quotation.status", "approved") : { data: [] };
  const charged = new Map(((lines ?? []) as { part_item_id: string; line_total: number | string }[]).map((l) => [l.part_item_id, Number(l.line_total) || 0]));
  return rows.map((r) => {
    const j = jobOf.get(r.job_id);
    return { partId: r.id, ticket: r.lathe_ticket, item: r.lathe_item ?? r.description, service: r.description, qty: Number(r.quantity) || 1, estimate: round2((Number(r.cost_aed) || 0) * (Number(r.quantity) || 1)), supplier: r.supplier ?? "", sentAt: r.lathe_sent_at, takenBy: r.lathe_taken_by, backAt: r.lathe_back_at, billId: r.lathe_bill_id, billAmount: r.lathe_bill_amount_aed === null ? null : Number(r.lathe_bill_amount_aed), jobId: r.job_id, jobNumber: j?.job_number ?? "", plate: j?.vehicle ? formatPlate(j.vehicle) : "", charged: charged.get(r.id) ?? null };
  });
}

function nextMonth(m: string): string {
  const [y, mm] = m.split("-").map(Number);
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
}

export type BillInput = { supplier: string; billNumber: string; billDate: string; beforeVat: number; vat: number; tickets: BillTicket[]; extraLines: { description: string; amount: number }[] };

/** The month-end bill: the ticked tickets take their actual cost (typed, or a share by estimate); extra lines flagged. */
export async function recordLatheBill(input: BillInput, actor: Actor): Promise<{ error?: string; ok?: boolean; words?: string }> {
  if (!(actor.role_id === "owner" || actor.role_id === "accounts")) return { error: "Accounts or the owner enter the lathe bill." };
  if (!(await latheReady())) return { error: "Lathe bills switch on with the database update of 9 November (WAITING FOR APPLY)." };
  const extra = round2(input.extraLines.reduce((a, l) => a + (Number(l.amount) || 0), 0));
  const problem = billProblem(round2(input.beforeVat), extra, input.tickets);
  if (problem) return { error: problem };
  if (!input.billNumber.trim()) return { error: "Type the bill number." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.billDate)) return { error: "Pick the bill's date." };
  const admin = createAdminClient();
  const { data: sup } = await admin.from("suppliers").select("id, name").ilike("name", input.supplier.trim()).maybeSingle();
  const total = round2(input.beforeVat + input.vat);
  const { data: bill, error } = await admin.from("lathe_bills").insert({ supplier_id: (sup?.id as string | undefined) ?? null, supplier_name: (sup?.name as string | undefined) ?? input.supplier.trim(), bill_number: input.billNumber.trim(), bill_date: input.billDate, before_vat_aed: round2(input.beforeVat), vat_aed: round2(input.vat), total_aed: total, extra_lines: input.extraLines.filter((l) => l.description.trim() && Number(l.amount)), created_by: actor.id, updated_by: actor.id }).select("id").single();
  if (error || !bill) {
    if (error && /duplicate|unique/i.test(error.message)) return { error: `Bill ${input.billNumber} of ${input.supplier} is already entered.` };
    await logAppError("lathe: bill", error ?? "no row", { staffId: actor.id });
    return { error: SAVE_FAILED };
  }
  const shares = splitBill(round2(input.beforeVat), extra, input.tickets);
  const { data: parts } = await admin.from("part_items").select("id, job_id, quantity, lathe_ticket, lathe_bill_id").in("id", input.tickets.map((t) => t.partId));
  let done = 0;
  for (const p of (parts ?? []) as { id: string; job_id: string; quantity: number | string; lathe_ticket: string; lathe_bill_id: string | null }[]) {
    if (p.lathe_bill_id) continue;
    const amount = shares.get(p.id) ?? 0;
    const qty = Number(p.quantity) || 1;
    // The actual cost replaces the estimate on the car (job profit follows); the customer's invoices never change.
    const { error: upErr } = await admin.from("part_items").update({ lathe_bill_id: bill.id, lathe_bill_amount_aed: amount, final_cost_aed: round2(amount / qty), updated_by: actor.id }).eq("id", p.id).is("lathe_bill_id", null);
    if (upErr) { await logAppError("lathe: bill part", upErr, { staffId: actor.id, jobId: p.job_id }); continue; }
    await admin.from("invoice_lines").update({ cost_aed: amount, updated_by: actor.id }).eq("part_item_id", p.id).eq("is_active", true).then(() => null, () => null);
    await admin.from("job_events").insert({ job_id: p.job_id, event_type: "lathe_billed", note: `${p.lathe_ticket}: billed AED ${amount.toFixed(2)} on ${input.billNumber} (${actor.display_name})`, created_by: actor.id });
    done++;
  }
  if (extra > 0) {
    const { notifyRoles } = await import("./notifications");
    await notifyRoles(["parts"], { type: "lathe_unmatched", title: `Lathe bill ${input.billNumber}: ${input.extraLines.length} line${input.extraLines.length === 1 ? "" : "s"} with no ticket`, body: `${input.extraLines.map((l) => `${l.description} AED ${Number(l.amount).toFixed(2)}`).join("; ")}. Find the car each was for (or ask the lathe shop).`, href: "/parts/lathe" });
  }
  const { tryEnqueueZoho } = await import("./zoho-sync");
  await tryEnqueueZoho("lathebill", bill.id as string, null, actor.id).catch(() => null);
  return { ok: true, words: `Bill ${input.billNumber}: ${done} ticket${done === 1 ? "" : "s"} billed (AED ${round2(input.beforeVat).toFixed(2)} + VAT ${round2(input.vat).toFixed(2)})${extra ? `; AED ${extra.toFixed(2)} on lines with no ticket – Parts told` : ""}.` };
}

/** The lathe report of a month: tickets, our cost (the bill, else the estimate), what we charged, the profit. */
export async function latheReport(month: string) {
  const rows = await loadLatheTickets({ month });
  const cost = round2(rows.reduce((a, r) => a + (r.billAmount ?? r.estimate), 0));
  const charged = round2(rows.reduce((a, r) => a + (r.charged ?? 0), 0));
  return { tickets: rows.length, billed: rows.filter((r) => r.billId).length, cost, charged, profit: round2(charged - cost) };
}
