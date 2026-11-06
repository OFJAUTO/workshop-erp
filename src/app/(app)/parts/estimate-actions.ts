"use server";
import { dbWords } from "@/lib/app-errors";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { formValues, type FormState } from "@/lib/form-state";
import { notifyStaff } from "@/lib/notifications";
import { logQuoteEvent, refreshQuoteTotals } from "@/lib/quote-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { aed, lineUnitPrice, markupFromSell } from "@/lib/quotes";
import { quoteLeadIds } from "@/lib/quote-lead";
import { flagBelowCost } from "@/lib/below-cost";
import { NO_PART_NUMBER, cleanPartNumber, daysComplete, isOurStock, partNumberProblem, realPartNumber, rowMissing, rowState, type RowValues } from "@/lib/parts-rows";
import { costCheckForLine, costCheckValues } from "@/lib/part-cost-history";
import { estimatePricingReady, lineCostConfirmReady, partUnitsReady } from "@/lib/schema-ready";
import { checkQuantity, cleanUnit, quantityChangeWords, whoOfRole, type PartUnit, type QtyWho } from "@/lib/part-units";
import { estimateAdvisors, loadEstimateDesk } from "@/lib/estimate-parts-data";
import { pricingDoneBody, pricingDoneTitle, pricingProgress } from "@/lib/pricing-done";
import { capsText } from "@/lib/text-case";
import { formatDateTime } from "@/lib/format";
import { LINE_TEXT_MAX, tooLongWords } from "@/lib/text-limits";
import type { RowSave } from "./actions";

/*
 * The parts desk prices an estimate's parts (30 October 2026). The car is not here yet, so there is no job and no part
 * request: the estimate's part LINE takes the price (cost per unit before VAT, supplier, part number, type,
 * availability). The advisor's markup then gives the selling price.
 *
 * 3 November 2026 (sections 9 and 10): the desk prices them on the SAME Parts row as a job's parts (the quantity and
 * the unit included, every change saved as it is typed), and the advisor hears it ONCE, when the desk presses "Pricing
 * done – send to advisor" - never once per part. An estimate already with the customer is not repriced from here: the
 * desk checks the price or tells the advisor.
 */

const AFTER_SEND = ["sent", "opened", "expired", "declined", "urgent_requested"];
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
    admin.from("quotations").select("id, number, kind, status, created_by, is_active, carried_job_id").eq("id", quotationId).maybeSingle(),
    admin.from("quotation_lines").select("id, quotation_id, title, quantity, unit_cost, line_type, markup_percent, markup_mode, markup_aed, unit_price, labour_rate, visible_to_customer, part_item_id, is_active, priced_by_advisor, priced_at, priced_by, price_requested_at, price_requested_by, price_checked_at, supplier_text, part_number, part_type, brand, availability, delivery_days").eq("id", lineId).maybeSingle(),
  ]);
  if (!q || q.kind !== "estimate" || !q.is_active || !l || l.quotation_id !== q.id || !l.is_active || l.line_type !== "part" || l.part_item_id) return null;
  return { q, l };
}

const numOrNull = (v: string | number | undefined | null) => {
  if (v === undefined || v === null) return null;
  const t = String(v).replace(",", ".").replace(/[^\d.]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * One estimate part line as the desk types it on the shared Parts row (3 November 2026): the same values as a job's
 * row (part number, type, brand, list, discount, net per unit, supplier, availability, quantity and unit), saved as
 * they are typed. The line is priced (priced_at) only when the whole row is - the ONE rule of src/lib/parts-rows.ts -
 * so the advisor never sees a half-typed price as "Priced by the parts desk". A quantity changed here is written in the
 * one wording ("Advisor asked 1, Parts changed to 8 L") and the advisor's own words are kept. Nobody is notified
 * per line: the advisor hears it with "Pricing done – send to advisor".
 */
export async function saveEstimatePartRow(quotationId: string, row: RowSave): Promise<{ error?: string; partId?: string; complete?: boolean; server?: Partial<RowValues> }> {
  const staff = await deskStaff();
  if (!staff) return { error: "Only the parts desk or the owner prices parts." };
  const found = row.partId ? await estimateLine(quotationId, row.partId) : null;
  if (!found) return { error: "That part is no longer on the estimate." };
  const { q, l } = found;
  // Section 3 (6 November 2026, E-00074): the desk may change the price and the supplier after the estimate went to the
  // customer, until the customer accepts it (its lines lock then) or it becomes a job's quotation.
  if (q.carried_job_id) return { error: `${q.number} became the job's quotation: change the price on the job's parts page.` };
  if (q.status === "approved") return { error: `${q.number} was accepted by the customer: its lines are locked. The advisor revises it to pass a new price on.` };
  if (!PREPARING.includes(q.status) && !AFTER_SEND.includes(q.status)) return { error: `${q.number} cannot change any more.` };
  const afterSend = AFTER_SEND.includes(q.status);
  const admin = createAdminClient();
  const settings = await getSettings();
  const [unitsReady, lineReady] = await Promise.all([partUnitsReady(), lineCostConfirmReady()]);
  // 2 November 2026: line numbers and "OFJ" are never part numbers; "None" (NO NUMBER) is the honest answer.
  const pnProblem = partNumberProblem(row.part_number);
  if (pnProblem) return { error: pnProblem };
  let partNumber = cleanPartNumber(row.part_number);
  const allowed = ((settings.part_types ?? []) as string[]).map((t) => t.toLowerCase());
  const typeRaw = String(row.part_type ?? "").toLowerCase();
  const partType = typeRaw && allowed.includes(typeRaw) ? typeRaw : null;
  const brand = partType && partType !== "genuine" ? String(row.brand ?? "").trim().slice(0, 80) || null : null;
  let cost = numOrNull(row.cost_aed);
  let list = numOrNull(row.list_price);
  const discRaw = numOrNull(row.discount);
  let discount = discRaw === null ? null : Math.min(100, Math.max(0, discRaw));
  const supplier = String(row.supplier ?? "").trim().slice(0, 120) || null;
  const fromStock = isOurStock(supplier);
  let availability: string | null = fromStock ? "in_stock" : row.availability === "to_order" ? "to_order" : row.availability === "in_stock" ? "in_stock" : null;
  const daysText = fromStock ? "" : String(row.days ?? "").trim();
  const days = availability === "to_order" && daysComplete(daysText) ? Math.min(365, Number(daysText)) : null;
  // "From our stock…" (2.3): the stock item's average cost per unit is the price; the supplier is Our stock, in stock.
  const { data: stored } = lineReady ? await admin.from("quotation_lines").select("stock_item_id, cost_confirmed_aed").eq("id", l.id).maybeSingle() : { data: null };
  let stockId: string | null = fromStock ? (row.stockItemId === undefined ? ((stored?.stock_item_id as string | null) ?? null) : row.stockItemId ?? null) : null;
  if (fromStock && !stockId) return { error: "From our stock: pick the stock item (From our stock…), so the cost is the stock list's." };
  let stockWords = "";
  let stockOnHand: number | null = null;
  if (stockId) {
    const { data: item } = await admin.from("stock_items").select("id, name, unit, quantity, unit_cost, part_number, is_active").eq("id", stockId).maybeSingle();
    if (!item || !item.is_active) return { error: "That stock item is no longer on the stock list. Pick it again (From our stock…)." };
    if (!(Number(item.unit_cost) > 0)) return { error: `${String(item.name).toUpperCase()} has no cost on the stock list yet: type its cost each when you pick it.` };
    cost = Number(item.unit_cost);
    list = null;
    discount = null;
    availability = "in_stock";
    if (!partNumber) partNumber = cleanPartNumber(item.part_number as string | null) ?? NO_PART_NUMBER;
    stockId = item.id as string;
    stockWords = `${String(item.name).toUpperCase()} · ${(Number(item.quantity) || 0).toLocaleString("en-GB")} ${item.unit || "pc"} on hand · AED ${(Number(item.unit_cost) || 0).toFixed(2)} average`;
    stockOnHand = Number(item.quantity) || 0;
  }
  if (cost !== null && cost < 0) return { error: "The cost must be a number." };
  // The name: the desk may correct it (the advisor's words stay in the estimate's history).
  const name = String(row.name ?? "").trim();
  if (name.length > LINE_TEXT_MAX) return { error: tooLongWords(name.length) };
  const renamed = !!name && name.toUpperCase() !== String(l.title ?? "").toUpperCase();
  // THE quantity rule: above zero; pieces and sets whole; litres to two decimals.
  const { data: extraRow } = unitsReady ? await admin.from("quotation_lines").select("unit, asked_quantity, quantity_changed_by").eq("id", l.id).maybeSingle() : { data: null };
  const curUnit: PartUnit = cleanUnit(extraRow?.unit) ?? "pc";
  const unit: PartUnit = unitsReady ? (cleanUnit(row.unit) ?? curUnit) : "pc";
  const curQty = Number(l.quantity) || 1;
  const qty = numOrNull(row.quantity) ?? curQty;
  const qProblem = checkQuantity(qty, unitsReady ? unit : "l");
  if (qProblem) return { error: qProblem };
  const qtyChanged = Math.abs(qty - curQty) > 0.005 || (unitsReady && unit !== curUnit);
  // THE cost check (2.1): a cheap price, or one far under what the same part number was bought at, is asked once.
  const confirmNow = lineReady && row.costConfirmed !== null && row.costConfirmed !== undefined && cost !== null && Math.abs(Number(row.costConfirmed) - cost) < 0.005;
  const storedConfirmed = stored?.cost_confirmed_aed === null || stored?.cost_confirmed_aed === undefined ? null : Number(stored.cost_confirmed_aed);
  const { data: siblings } = await admin.from("quotation_lines").select("id, title, part_number, unit_cost, supplier_text").eq("quotation_id", q.id).eq("line_type", "part").eq("is_active", true);
  const check = cost === null ? null : await costCheckForLine({ id: l.id, title: name || l.title, part_number: partNumber, cost, supplier, confirmedCost: confirmNow ? cost : storedConfirmed, stockItemId: stockId }, (siblings ?? []) as { id: string; title: string; part_number: string | null; unit_cost: number | null; supplier_text: string | null }[]);
  const checkValues = costCheckValues(check, cost);
  // Priced means the same here as on a job's row and on the screen.
  const values: RowValues = { part_number: partNumber ?? "", part_type: partType ?? "", brand: brand ?? "", list_price: list === null ? "" : String(list), discount: discount === null ? "" : String(discount), cost_aed: cost === null ? "" : String(cost), supplier: supplier ?? "", availability: availability ?? "", days: days === null ? "" : String(days), qty: String(qty), unit, ...checkValues, ...(stockId ? { stock_item: stockId } : {}) };
  const complete = rowState(values) === "priced";
  const now = new Date().toISOString();
  const wasAdvisor = !!l.priced_by_advisor;
  const previous = l.unit_cost === null || l.unit_cost === undefined ? null : Number(l.unit_cost);
  const wasPriced = !!l.priced_at && !wasAdvisor;
  const sellBefore = lineUnitPrice(l as unknown as Parameters<typeof lineUnitPrice>[0]);
  const costMoved = previous === null ? cost !== null : cost === null || Math.abs(previous - cost) > 0.005;
  const keepPrice = afterSend && costMoved && cost !== null && sellBefore > 0 ? markupFromSell({ unit_cost: cost, markup_mode: (l.markup_mode as "percent" | "aed" | null) ?? "percent" } as Parameters<typeof markupFromSell>[0], sellBefore) : {};
  const patch: Record<string, unknown> = {
    ...keepPrice,
    unit_cost: cost,
    supplier_text: supplier,
    part_number: partNumber,
    part_type: partType,
    brand,
    availability,
    delivery_days: availability === "to_order" ? days : null,
    quantity: qty,
    // The desk takes the line over: an advisor's own price becomes the desk's (checked by the same save).
    priced_by_advisor: false,
    priced_at: complete ? now : null,
    priced_by: complete ? staff.id : null,
    ...(wasAdvisor ? { price_checked_at: now, price_checked_by: staff.id } : {}),
    // An advisor's own price the desk takes over is with the desk from now on (never "priced" while half-typed); the
    // advisor who priced it stays the one to tell.
    ...(l.price_requested_at ? {} : { price_requested_at: now, price_requested_by: (l.priced_by as string | null) ?? q.created_by }),
    ...(renamed ? { title: capsText(name) } : {}),
    ...(unitsReady ? { unit, list_price_aed: list, supplier_discount_percent: discount, ...(qtyChanged ? { quantity_changed_at: now, quantity_changed_by: staff.id, ...(extraRow?.asked_quantity === null || extraRow?.asked_quantity === undefined ? { asked_quantity: curQty } : {}) } : {}) } : {}),
    ...(lineReady ? { stock_item_id: stockId, ...(confirmNow ? { cost_confirmed_aed: cost, cost_confirmed_at: now, cost_confirmed_by: staff.id } : {}) } : {}),
    updated_by: staff.id,
  };
  const { error } = await admin.from("quotation_lines").update(patch).eq("id", l.id);
  if (error) return { error: dbWords(error, "parts/estimate-actions") };
  const title = (renamed ? name : l.title).toUpperCase();
  if (renamed) await logQuoteEvent(q.id, null, staff.id, "part_renamed", `${staff.display_name} renamed ${String(l.title).toUpperCase()} to ${title} (the advisor wrote: ${String(l.title).toUpperCase()})`);
  if (qtyChanged) {
    // Who set the quantity it had: the last person who changed it, else the advisor who named the part.
    let askedBy: QtyWho = "advisor";
    if (extraRow?.quantity_changed_by) {
      const { data: who } = await admin.from("staff").select("role_id").eq("id", extraRow.quantity_changed_by).maybeSingle();
      if (who?.role_id) askedBy = whoOfRole(who.role_id as string);
    }
    await logQuoteEvent(q.id, null, staff.id, "part_quantity", `${title}: ${quantityChangeWords({ askedBy, asked: curQty, askedUnit: unitsReady ? curUnit : null, changedBy: whoOfRole(staff.role_id), now: qty, unit: unitsReady ? unit : "pc" })} (${staff.display_name})`);
  }
  if (confirmNow && check?.hold && storedConfirmed !== cost) await logQuoteEvent(q.id, null, staff.id, "part_cost_confirmed", `${staff.display_name} confirmed AED ${Number(cost).toFixed(2)} is the real price of ${title}${realPartNumber(partNumber) ? ` (${realPartNumber(partNumber)})` : ""} from ${supplier ?? "the supplier"}`);
  // The price in the estimate's history once the row is priced (and again only when the cost changes).
  if (complete && (!wasPriced || previous === null || Math.abs((previous ?? 0) - (cost ?? 0)) > 0.005)) {
    await logQuoteEvent(q.id, null, staff.id, wasAdvisor && previous !== null && Math.abs(previous - (cost ?? 0)) > 0.005 ? "part_price_replaced" : "part_priced", `${staff.display_name} priced ${title}: AED ${(cost ?? 0).toLocaleString("en-GB")} per ${unit === "l" ? "litre" : unit === "set" ? "set" : "unit"} from ${supplier ?? "?"}${wasAdvisor && previous !== null && Math.abs(previous - (cost ?? 0)) > 0.005 ? ` (the advisor had AED ${previous.toLocaleString("en-GB")})` : ""}`);
  }
  // After the send: "Changed by Peter, 6 Nov 14:05: 6,180.00 → 5,900.00 · Al Tayer → Gargash" on the row, and the advisor's bell.
  const prevSupplier = String(l.supplier_text ?? "").trim() || null;
  const supplierMoved = (prevSupplier ?? "").toUpperCase() !== (supplier ?? "").toUpperCase();
  if (afterSend && (costMoved || supplierMoved)) {
    const fmt = (n: number | null) => (n === null ? "no price" : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const when = new Date().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
    const what = [costMoved ? `${fmt(previous)} → ${fmt(cost)}` : null, supplierMoved ? `${prevSupplier ?? "no supplier"} → ${supplier ?? "no supplier"}` : null].filter(Boolean).join(" · ");
    await logQuoteEvent(q.id, null, staff.id, "desk_price_changed", `Changed by ${staff.display_name}, ${when}: ${title}: ${what}`);
    await notifyStaff(await quoteLeadIds({ kind: q.kind ?? "estimate", number: q.number, job_id: null, created_by: q.created_by ?? null }), {
      type: "estimate_price_changed",
      title: `${q.number}: ${staff.display_name} changed ${title}`,
      body: `${what}. The customer's price is kept (AED ${fmt(sellBefore)} each); revise the estimate to pass it on.`,
      href: `/estimates/${q.id}`,
    });
  }
  await refreshQuoteTotals(q.id, settings, staff.id, { reopen: !afterSend });
  // A line this cost puts below its selling price is written down and stops the send (2 November 2026).
  if (cost !== null && (previous === null || Math.abs(previous - cost) > 0.005)) await flagBelowCost(q.id, [l.id], staff.id, `the parts desk priced it at ${aed(cost)} each`);
  revalidatePath(`/parts/estimate/${q.id}`);
  revalidatePath(`/estimates/${q.id}`);
  revalidatePath("/parts");
  const server: Partial<RowValues> = { ...checkValues, part_number: partNumber ?? "", advisor_price: "", ...(fromStock ? { stock_item: stockId ?? undefined, stock_words: stockWords, stock_on_hand: stockOnHand === null ? undefined : String(stockOnHand), availability: "in_stock", days: "", ...(stockId ? { cost_aed: String(cost ?? ""), list_price: "", discount: "" } : {}) } : { stock_item: undefined, stock_words: "", stock_on_hand: undefined }) };
  return { partId: l.id, complete, server };
}

/** The estimate events folded into the one notification (what the desk changed while pricing). */
const FOLDED = ["part_quantity", "part_price_replaced", "part_renamed"];

/**
 * "Pricing done – send to advisor" on an estimate (section 10, 3 November 2026): the advisors in charge get ONE
 * notification ("All parts priced on E-00058") with what changed folded in, and the estimate leaves the parts desk's
 * list (and Parts' Waiting on you). With a line not priced yet nothing is sent unless the desk chose "Send what you
 * have". Answered in the bar.
 */
export async function estimatePricingDone(quotationId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await deskStaff();
  if (!staff) return { error: "Only the parts desk or the owner sends the prices." };
  const desk = await loadEstimateDesk(quotationId);
  if (!desk) return { error: "That estimate is no longer active." };
  const { q } = desk;
  if (!desk.preparing) return { error: `${q.number} is already with the customer: tell the advisor about a different price on its line.` };
  const progress = pricingProgress(desk.lines.map((l) => ({ key: l.id, name: l.title, state: l.rowState, missing: l.rowState === "not_finished" ? rowMissing(l.values).map((m) => m.long) : [] })));
  if (!desk.lines.length) return { error: "Nothing was sent to the parts desk on this estimate." };
  if (progress.open && String(formData.get("force") ?? "") !== "1") {
    const first = progress.openLines.slice(0, 3).map((l) => `${l.name.toUpperCase()}${l.missing.length ? ` (${l.missing.join(", ")})` : ""}`).join("; ");
    return { error: `${progress.open} part${progress.open === 1 ? " is" : "s are"} not priced yet: ${first}${progress.open > 3 ? "; and more" : ""}. Finish ${progress.open === 1 ? "it" : "them"}, or choose Send what you have.` };
  }
  const admin = createAdminClient();
  const stampReady = await estimatePricingReady();
  const now = new Date().toISOString();
  // The last send: the estimate's stamp, or before that database change its "Pricing done" event (loadEstimateDesk).
  const since = q.parts_priced_at;
  const again = !!since;
  // What the desk changed while pricing, in the words already in the estimate's history.
  let eq = admin.from("quotation_events").select("note, created_at").eq("quotation_id", q.id).in("event_type", FOLDED).order("created_at", { ascending: false }).limit(20);
  if (since) eq = eq.gt("created_at", since);
  const { data: evs } = await eq;
  const changes = ((evs ?? []) as { note: string | null }[]).map((e) => String(e.note ?? "").trim()).filter(Boolean).reverse();
  // Sent already and nothing changed since (a second tap, an old tab): nothing goes to the advisor again.
  if (since && !changes.length && !desk.lines.some((l) => (l.moment ?? "") > since)) {
    return { success: `Already sent to the advisor ${formatDateTime(since)}. Nothing changed since.` };
  }
  if (stampReady) {
    const { error } = await admin.from("quotations").update({ parts_priced_at: now, parts_priced_by: staff.id, updated_by: staff.id }).eq("id", q.id);
    if (error) return { error: "Could not save. Try again." };
  }
  await logQuoteEvent(q.id, null, staff.id, "parts_pricing_done", `${staff.display_name} sent the parts prices to the advisor: ${progress.words}${progress.detail ? ` (${progress.detail})` : ""}`);
  const ids = await estimateAdvisors(q.id, q.created_by, q.number);
  const title = pricingDoneTitle(q.number, progress, again);
  await notifyStaff(ids, { type: "estimate_parts_priced", title, body: pricingDoneBody({ by: staff.display_name, p: progress, changes, estimate: true }), href: `/estimates/${q.id}` });
  const { data: people } = ids.length ? await admin.from("staff").select("display_name").in("id", ids) : { data: [] as { display_name: string }[] };
  revalidatePath(`/parts/estimate/${q.id}`);
  revalidatePath(`/estimates/${q.id}`);
  revalidatePath("/parts");
  return { success: `${title} – sent to ${(people ?? []).map((p) => p.display_name as string).join(", ") || "the advisor"}.` };
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
  if (error) return { error: dbWords(error, "parts/estimate-actions") };
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
  await notifyStaff(await estimateAdvisors(q.id, q.created_by, q.number), { type: "estimate_parts_priced", title: `Price to correct · ESTIMATE ${q.number}`, body: `${l.title}: ${note} (from ${staff.display_name}). Revise the estimate.`, href: `/estimates/${q.id}` });
  await logQuoteEvent(q.id, null, staff.id, "price_flagged", `${staff.display_name} told the advisor the price of ${l.title} is different: ${note}`);
  return { success: "The advisor was told.", values: {} };
}

