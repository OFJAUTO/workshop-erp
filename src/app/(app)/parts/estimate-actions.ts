"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { formValues, type FormState } from "@/lib/form-state";
import { notifyStaff } from "@/lib/notifications";
import { logQuoteEvent, refreshQuoteTotals } from "@/lib/quote-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { aed } from "@/lib/quotes";

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
async function advisorsOf(quotationId: string, createdBy: string | null): Promise<string[]> {
  const { data } = await createAdminClient().from("quotation_lines").select("price_requested_by").eq("quotation_id", quotationId).not("price_requested_by", "is", null);
  return Array.from(new Set([createdBy, ...(data ?? []).map((r) => r.price_requested_by as string)].filter((x): x is string => !!x)));
}

export async function priceEstimatePart(quotationId: string, lineId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const staff = await deskStaff();
  if (!staff) return { error: "Only the parts desk or the owner prices parts.", values };
  const found = await estimateLine(quotationId, lineId);
  if (!found) return { error: "That part is no longer on the estimate.", values };
  const { q, l } = found;
  if (!PREPARING.includes(q.status)) return { error: `${q.number} is already with the customer: the price cannot change here. Use "Price is right" or tell the advisor.`, values };
  const cost = Number(String(values.cost ?? "").replace(/,/g, ""));
  if (!Number.isFinite(cost) || cost <= 0) return { error: "Type the cost of one part (before VAT).", values };
  const supplier = String(values.supplier ?? "").trim().slice(0, 120);
  if (!supplier) return { error: "Type the supplier.", values };
  const choice = String(values.availability ?? "");
  const days = choice === "other" ? Math.round(Number(values.days_other)) : Number(choice);
  if (choice !== "in_stock" && !(Number.isFinite(days) && days >= 0 && days <= 365)) return { error: "Choose the availability (or type the days).", values };
  const settings = await getSettings();
  const types = ((settings.part_types ?? []) as string[]).map((t) => t.toLowerCase());
  const typeRaw = String(values.part_type ?? "").toLowerCase();
  const partType = typeRaw && types.includes(typeRaw) ? typeRaw : null;
  const partNumber = String(values.part_number ?? "").trim().slice(0, 80) || null;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const previous = l.unit_cost === null || l.unit_cost === undefined ? null : Number(l.unit_cost);
  const wasAdvisor = !!l.priced_by_advisor;
  const { error } = await admin
    .from("quotation_lines")
    .update({ unit_cost: cost, supplier_text: supplier, part_number: partNumber, part_type: partType, availability: choice === "in_stock" ? "in_stock" : "to_order", delivery_days: choice === "in_stock" ? null : days, priced_at: now, priced_by: staff.id, priced_by_advisor: false, price_checked_at: wasAdvisor ? now : null, price_checked_by: wasAdvisor ? staff.id : null, updated_by: staff.id })
    .eq("id", l.id);
  if (error) return { error: error.message, values };
  await refreshQuoteTotals(q.id, settings, staff.id, { reopen: true });
  await logQuoteEvent(q.id, null, staff.id, "part_priced", `${staff.display_name} priced ${l.title}: AED ${cost.toLocaleString("en-GB")} each from ${supplier}${wasAdvisor && previous !== null && Math.abs(previous - cost) > 0.005 ? ` (the advisor had AED ${previous.toLocaleString("en-GB")})` : ""}`);
  const advisors = await advisorsOf(q.id, q.created_by);
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
  await notifyStaff(await advisorsOf(q.id, q.created_by), { type: "estimate_parts_priced", title: `Price to correct · ESTIMATE ${q.number}`, body: `${l.title}: ${note} (from ${staff.display_name}). Revise the estimate.`, href: `/estimates/${q.id}` });
  await logQuoteEvent(q.id, null, staff.id, "price_flagged", `${staff.display_name} told the advisor the price of ${l.title} is different: ${note}`);
  return { success: "The advisor was told.", values: {} };
}
