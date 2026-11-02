"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { startersOf } from "@/lib/quote-lead";
import { formValues, type FormState } from "@/lib/form-state";
import { notifyStaff } from "@/lib/notifications";
import { logQuoteEvent, refreshQuoteTotals } from "@/lib/quote-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { aed } from "@/lib/quotes";
import { flagBelowCost } from "@/lib/below-cost";
import { NO_PART_NUMBER, OUR_STOCK, cleanPartNumber, isOurStock, isPlaceholderSupplier, partNumberProblem, placeholderSupplierWords, realPartNumber } from "@/lib/parts-rows";
import { costCheckForLine } from "@/lib/part-cost-history";
import { lineCostConfirmReady } from "@/lib/schema-ready";

/*
 * The parts desk prices an estimate's parts (30 October 2026). The car is not here yet, so there is no job and no part
 * request: the estimate's part LINE takes the price (cost each before VAT, supplier, part number, type, availability).
 * The advisor's markup then gives the selling price. When the last part sent is priced, the advisor is told.
 * An estimate already with the customer is not repriced from here: the desk checks the price or tells the advisor.
 */

const PREPARING = ["draft", "pending_owner"];

async function deskStaff() {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return null;
  if (!can(staff.role_id as RoleId, "priceParts")) return null;
  return staff;
}

async function estimateLine(quotationId: string, lineId: string) {
  const admin = createAdminClient();
  const [{ data: q }, { data: l }] = await Promise.all([
    admin.from("quotations").select("id, number, kind, status, created_by, is_active").eq("id", quotationId).maybeSingle(),
    admin.from("quotation_lines").select("id, quotation_id, title, quantity, unit_cost, line_type, part_item_id, is_active, priced_by_advisor, price_requested_by, supplier_text").eq("id", lineId).maybeSingle(),
  ]);
  if (!q || q.kind !== "estimate" || !q.is_active || !l || l.quotation_id !== q.id || !l.is_active || l.line_type !== "part" || l.part_item_id) return null;
  return { q, l };
}

/** The advisors to tell: whoever made the estimate and whoever sent the parts to the desk. */
async function advisorsOf(quotationId: string, createdBy: string | null, number?: string): Promise<string[]> {
  const { data } = await createAdminClient().from("quotation_lines").select("price_requested_by").eq("quotation_id", quotationId).not("price_requested_by", "is", null);
  // 1 November 2026: the advisor who started the estimate stays in charge, whoever made the newest version.
  const starter = number ? ((await startersOf([number])).get(number) ?? createdBy) : createdBy;
  return Array.from(new Set([starter, ...(data ?? []).map((r) => r.price_requested_by as string)].filter((x): x is string => !!x)));
}

export async function priceEstimatePart(quotationId: string, lineId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const staff = await deskStaff();
  if (!staff) return { error: "Only the parts desk or the owner prices parts.", values };
  const found = await estimateLine(quotationId, lineId);
  if (!found) return { error: "That part is no longer on the estimate.", values };
  const { q, l } = found;
  if (!PREPARING.includes(q.status)) return { error: `${q.number} is already with the customer: the price cannot change here. Use "Price is right" or tell the advisor.`, values };
  const admin = createAdminClient();
  // 2 November 2026: line numbers and "OFJ" are never part numbers; "None" (NO NUMBER) is the honest answer.
  const pnProblem = partNumberProblem(String(values.part_number ?? ""));
  if (pnProblem) return { error: pnProblem, values };
  let partNumber = cleanPartNumber(String(values.part_number ?? ""));
  // "From our stock…" (2.3): the stock item's average cost each is the price, the supplier is Our stock, in stock.
  const stockId = String(values.stock_item_id ?? "").trim() || null;
  let stockItem: { id: string; name: string; unit_cost: number; part_number: string | null } | null = null;
  if (stockId) {
    const { data: item } = await admin.from("stock_items").select("id, name, unit_cost, part_number, is_active").eq("id", stockId).maybeSingle();
    if (!item || !item.is_active) return { error: "That stock item is no longer on the stock list. Pick it again.", values };
    if (!(Number(item.unit_cost) > 0)) return { error: `${String(item.name).toUpperCase()} has no cost on the stock list yet: type its cost each when you pick it.`, values };
    stockItem = { id: item.id as string, name: item.name as string, unit_cost: Number(item.unit_cost), part_number: (item.part_number as string | null) ?? null };
    if (!partNumber) partNumber = cleanPartNumber(stockItem.part_number) ?? NO_PART_NUMBER;
  }
  const cost = stockItem ? stockItem.unit_cost : Number(String(values.cost ?? "").replace(/,/g, ""));
  if (!Number.isFinite(cost) || cost <= 0) return { error: "Type the cost of one part (before VAT).", values };
  const supplier = stockItem ? OUR_STOCK : String(values.supplier ?? "").trim().slice(0, 120);
  if (!supplier) return { error: "Type the supplier.", values };
  if (isPlaceholderSupplier(supplier)) return { error: `${placeholderSupplierWords(supplier)}.`, values };
  if (isOurStock(supplier) && !stockItem) return { error: "A part from our stock: tap From our stock… and pick the stock item (its cost is the stock list's).", values };
  const choice = stockItem ? "in_stock" : String(values.availability ?? "");
  const days = choice === "other" ? Math.round(Number(values.days_other)) : Number(choice);
  if (choice !== "in_stock" && !(Number.isFinite(days) && days >= 0 && days <= 365)) return { error: "Choose the availability (or type the days).", values };
  const settings = await getSettings();
  const types = ((settings.part_types ?? []) as string[]).map((t) => t.toLowerCase());
  const typeRaw = String(values.part_type ?? "").toLowerCase();
  const partType = typeRaw && types.includes(typeRaw) ? typeRaw : null;
  // THE cost check (2.1): a cheap price, or one far under what the same part number was bought at, is asked once;
  // "Yes, real price" sends the same form again with the answer for this very cost.
  const lineReady = await lineCostConfirmReady();
  const confirmed = Number(String(values.confirm_cost ?? "").replace(/,/g, ""));
  const confirmNow = Number.isFinite(confirmed) && confirmed > 0 && Math.abs(confirmed - cost) < 0.005;
  // An answer already given for this very cost stands (saving again to change the availability never asks again).
  const { data: storedAnswer } = lineReady ? await admin.from("quotation_lines").select("cost_confirmed_aed").eq("id", l.id).maybeSingle() : { data: null };
  const storedConfirmed = storedAnswer?.cost_confirmed_aed === null || storedAnswer?.cost_confirmed_aed === undefined ? null : Number(storedAnswer.cost_confirmed_aed);
  const { data: siblings } = await admin.from("quotation_lines").select("id, title, part_number, unit_cost, supplier_text").eq("quotation_id", q.id).eq("line_type", "part").eq("is_active", true);
  const check = await costCheckForLine({ id: l.id, title: l.title, part_number: partNumber, cost, supplier, confirmedCost: confirmNow ? cost : storedConfirmed, stockItemId: stockItem?.id ?? null }, (siblings ?? []) as { id: string; title: string; part_number: string | null; unit_cost: number | null; supplier_text: string | null }[]);
  if (check.ask && check.hold && !confirmNow) return { values: { ...values, ask_cost: String(cost), ask_words: check.ask.words, ask_kind: check.ask.kind } };
  const now = new Date().toISOString();
  const previous = l.unit_cost === null || l.unit_cost === undefined ? null : Number(l.unit_cost);
  const wasAdvisor = !!l.priced_by_advisor;
  const { error } = await admin
    .from("quotation_lines")
    .update({ unit_cost: cost, supplier_text: supplier, part_number: partNumber, part_type: partType, availability: choice === "in_stock" ? "in_stock" : "to_order", delivery_days: choice === "in_stock" ? null : days, priced_at: now, priced_by: staff.id, priced_by_advisor: false, price_checked_at: wasAdvisor ? now : null, price_checked_by: wasAdvisor ? staff.id : null, ...(lineReady ? { stock_item_id: stockItem?.id ?? null, ...(confirmNow ? { cost_confirmed_aed: cost, cost_confirmed_at: now, cost_confirmed_by: staff.id } : {}) } : {}), updated_by: staff.id })
    .eq("id", l.id);
  if (error) return { error: error.message, values };
  if (confirmNow && check.hold) await logQuoteEvent(q.id, null, staff.id, "part_cost_confirmed", `${staff.display_name} confirmed AED ${cost.toFixed(2)} is the real price of ${l.title.toUpperCase()}${realPartNumber(partNumber) ? ` (${realPartNumber(partNumber)})` : ""} from ${supplier}`);
  await refreshQuoteTotals(q.id, settings, staff.id, { reopen: true });
  // A line this cost puts below its selling price is written down and stops the send (2 November 2026).
  await flagBelowCost(q.id, [l.id], staff.id, `the parts desk priced it at ${aed(cost)} each`);
  await logQuoteEvent(q.id, null, staff.id, "part_priced", `${staff.display_name} priced ${l.title}: AED ${cost.toLocaleString("en-GB")} each from ${supplier}${wasAdvisor && previous !== null && Math.abs(previous - cost) > 0.005 ? ` (the advisor had AED ${previous.toLocaleString("en-GB")})` : ""}`);
  const advisors = await advisorsOf(q.id, q.created_by, q.number);
  if (wasAdvisor && previous !== null && Math.abs(previous - cost) > 0.005) {
    await notifyStaff(advisors, { type: "estimate_parts_priced", title: `The parts desk changed your price · ESTIMATE ${q.number}`, body: `${l.title}: ${aed(previous)} → ${aed(cost)} each (${supplier}). Check the estimate before sending.`, href: `/estimates/${q.id}` });
  }
  // The last part sent to the desk is priced: the advisor hears it once.
  const { data: still } = await admin.from("quotation_lines").select("id").eq("quotation_id", q.id).eq("line_type", "part").is("part_item_id", null).eq("is_active", true).not("price_requested_at", "is", null).is("unit_cost", null).limit(1);
  if (!(still ?? []).length && !wasAdvisor) {
    const { count } = await admin.from("quotation_lines").select("id", { count: "exact", head: true }).eq("quotation_id", q.id).eq("line_type", "part").is("part_item_id", null).eq("is_active", true).not("priced_at", "is", null).eq("priced_by_advisor", false);
    await notifyStaff(advisors, { type: "estimate_parts_priced", title: `Parts priced · ESTIMATE ${q.number}`, body: `The parts desk priced ${count ?? 0} part${count === 1 ? "" : "s"}. Your markup is on them: check the estimate and send it.`, href: `/estimates/${q.id}` });
  }
  revalidatePath(`/parts/estimate/${q.id}`);
  revalidatePath(`/estimates/${q.id}`);
  revalidatePath("/parts");
  return { success: `${l.title}: priced at ${aed(cost)} each.`, values: {} };
}

/** "Price is right ✓" on a price the advisor typed: the check is written on the line (also on an estimate already sent or accepted). */
export async function checkEstimatePrice(quotationId: string, lineId: string): Promise<{ error?: string; ok?: boolean }> {
  const staff = await deskStaff();
  if (!staff) return { error: "Only the parts desk or the owner checks prices." };
  const found = await estimateLine(quotationId, lineId);
  if (!found) return { error: "That part is no longer on the estimate." };
  const { q, l } = found;
  if (!l.priced_by_advisor) return { ok: true };
  const { error } = await createAdminClient().from("quotation_lines").update({ price_checked_at: new Date().toISOString(), price_checked_by: staff.id }).eq("id", l.id);
  if (error) return { error: error.message };
  await logQuoteEvent(q.id, null, staff.id, "price_checked", `${staff.display_name} checked the advisor's price on ${l.title}: AED ${Number(l.unit_cost).toLocaleString("en-GB")} each from ${l.supplier_text ?? "the supplier"} is right`);
  revalidatePath(`/parts/estimate/${q.id}`);
  revalidatePath("/parts");
  return { ok: true };
}

/** On an estimate already with the customer: the desk's different price goes to the advisor in words (he revises). */
export async function tellAdvisorPrice(quotationId: string, lineId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const staff = await deskStaff();
  if (!staff) return { error: "Only the parts desk or the owner.", values };
  const found = await estimateLine(quotationId, lineId);
  if (!found) return { error: "That part is no longer on the estimate.", values };
  const { q, l } = found;
  const note = String(values.note ?? "").trim().slice(0, 500);
  if (note.length < 3) return { error: "Write the right price and supplier.", values };
  await notifyStaff(await advisorsOf(q.id, q.created_by, q.number), { type: "estimate_parts_priced", title: `Price to correct · ESTIMATE ${q.number}`, body: `${l.title}: ${note} (from ${staff.display_name}). Revise the estimate.`, href: `/estimates/${q.id}` });
  await logQuoteEvent(q.id, null, staff.id, "price_flagged", `${staff.display_name} told the advisor the price of ${l.title} is different: ${note}`);
  return { success: "The advisor was told.", values: {} };
}
