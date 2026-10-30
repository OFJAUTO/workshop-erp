"use server";

import { chooserValues, resolveCustomerCar } from "@/lib/customer-car";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { logQuoteEvent } from "@/lib/quote-data";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentStaff } from "@/lib/auth";
import { loadQuotation } from "@/lib/quote-data";
import { COPY_FIELDS } from "@/lib/quote-versions";
import { greetingNameOf } from "@/lib/messages";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { shortFor } from "@/lib/short-links";
import { formatPlate } from "@/lib/types";
import { aed } from "@/lib/quotes";
import { amountOf, statusWords, type QuoteVersionRow } from "@/lib/quote-history";

/** Open estimates (not answered, not cancelled): a second one for the same car is asked about first. */
const OPEN_ESTIMATE = ["draft", "pending_owner", "sent", "opened", "urgent_requested"];

/**
 * The open estimates of ONE car, oldest first, with the words the question shows: "E-00035 · AED 6,615.00 · sent
 * 30 Oct". Estimates already carried over to a job at gate-in no longer count. Another car of the same customer
 * never shows here.
 */
async function openEstimatesOfCar(vehicleId: string): Promise<{ id: string; number: string; line: string }[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("quotations")
    .select("id, job_id, number, version, kind, status, total_aed, approved_total_aed, rounded_total_aed, sent_at, opened_at, responded_at, approver_name, created_at, created_by, token")
    .eq("kind", "estimate")
    .eq("is_active", true)
    .is("deleted_at", null)
    .eq("vehicle_id", vehicleId)
    .in("status", OPEN_ESTIMATE)
    .order("created_at");
  const rows = (data ?? []) as unknown as QuoteVersionRow[];
  if (!rows.length) return [];
  const { data: used } = await admin.from("jobs").select("estimate_id").in("estimate_id", rows.map((r) => r.id));
  const taken = new Set((used ?? []).map((j) => j.estimate_id as string));
  return rows
    .filter((r) => !taken.has(r.id))
    .map((r) => {
      const words = statusWords(r);
      return { id: r.id, number: r.number, line: `${r.number} · ${aed(amountOf(r))} · ${words.charAt(0).toLowerCase()}${words.slice(1)}` };
    });
}

/** An estimate before the car arrives: customer and car, then lines on the builder. */
export async function createEstimate(_state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("viewEstimates");
  const values = formValues(formData);
  const admin = createAdminClient();
  // "Make an additional estimate" (30 October 2026): the question's own estimate names the customer and the car, so
  // nothing behind the window (a box reset by the browser, a changed choice) can stop it. It always creates one.
  const confirmNew = String(formData.get("confirm_new") ?? "") === "1";
  const addToId = String(formData.get("additional_to") ?? "");
  let customerId: string;
  let vehicleId: string;
  let addTo: { id: string; number: string } | null = null;
  if (confirmNew && addToId) {
    const { data: base } = await admin.from("quotations").select("id, number, kind, customer_id, vehicle_id").eq("id", addToId).maybeSingle();
    if (!base || base.kind !== "estimate" || !base.vehicle_id) return { error: "That estimate was not found. Choose the car again.", values };
    customerId = base.customer_id as string;
    vehicleId = base.vehicle_id as string;
    addTo = { id: base.id as string, number: base.number as string };
  } else {
    // The customer and the car from the three-choice chooser (created here when they are new).
    const picked = await resolveCustomerCar(formData, staff);
    if ("error" in picked) return { error: picked.error, values: chooserValues(values, picked) };
    customerId = picked.customerId;
    vehicleId = picked.vehicleId;
    // The CHOSEN car already has an open estimate: the question names it (number, amount, sent) with Open it or
    // Make an additional estimate. Only that car counts; the customer's other cars never ask.
    if (!confirmNew) {
      const open = await openEstimatesOfCar(vehicleId);
      if (open.length) {
        const { data: car } = await admin.from("vehicles").select("kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant").eq("id", vehicleId).maybeSingle();
        return { values: { ...values, mode: "existing", customer_id: customerId, vehicle_id: vehicleId, estimate_dup_id: open[0].id, estimate_dup_number: open[0].number, estimate_dup_car: car ? formatPlate(car) : "", estimate_dup_list: JSON.stringify(open) } };
      }
    }
  }
  const settings = await getSettings();
  const { data: created, error } = await admin
    .from("quotations")
    .insert({ kind: "estimate", customer_id: customerId, vehicle_id: vehicleId, validity_days: Number(settings.quote_validity_days) || 7, created_by: staff.id, updated_by: staff.id })
    .select("id, number")
    .single();
  if (error || !created) return { error: error?.message ?? "Could not create the estimate.", values };
  await logQuoteEvent(created.id, null, staff.id, "estimate_started", `Estimate ${created.number} started by ${staff.display_name}`);
  if (addTo) await logQuoteEvent(created.id, null, staff.id, "estimate_additional", `Additional estimate ${created.number}, in addition to ${addTo.number}, started by ${staff.display_name}`);
  revalidatePath("/estimates");
  // Section 6: started from the bodyshop button - land in the editor with the package picker open.
  redirect(`/estimates/${created.id}${String(formData.get("bodyshop") ?? "") === "1" ? "?packages=1" : ""}`);
}

/* ------------------------------------------------------------------------------------------------
   Section 4 (23 October 2026): Delete a draft, Cancel a sent one with a reason, Re-send / extend an
   expired one, Copy an estimate (the commission never copied). The advisor who made it or the owner.
   ------------------------------------------------------------------------------------------------ */

async function ownEstimate(id: string): Promise<{ staff: NonNullable<Awaited<ReturnType<typeof getCurrentStaff>>>; q: Record<string, unknown> } | { error: string }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "Not allowed." };
  const { data: q } = await createAdminClient().from("quotations").select("id, kind, number, version, status, created_by, sent_at, job_id, customer_id, vehicle_id, token, validity_days, opened_at, is_active").eq("id", id).maybeSingle();
  if (!q || q.kind !== "estimate" || !q.is_active) return { error: "Estimate not found." };
  if (staff.role_id !== "owner" && q.created_by !== staff.id) return { error: "Only the advisor who made it, or the owner, can do this." };
  return { staff, q };
}

/** "Delete" on an estimate still being prepared (never sent): it goes from the list for good. */
export async function deleteEstimateDraft(id: string): Promise<{ error?: string; ok?: boolean }> {
  const r = await ownEstimate(id);
  if ("error" in r) return r;
  const { staff, q } = r;
  if (q.status !== "draft" || q.sent_at) return { error: "Only an estimate that was never sent can be deleted. A sent one is cancelled instead." };
  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin.from("quotations").update({ is_active: false, status: "cancelled", deleted_at: now, deleted_by: staff.id, cancel_reason: "Draft deleted", updated_by: staff.id }).eq("id", id);
  await admin.from("quotation_lines").update({ is_active: false, updated_by: staff.id }).eq("quotation_id", id);
  await logQuoteEvent(id, null, staff.id, "estimate_deleted", `${q.number} (never sent) deleted by ${staff.display_name}`);
  revalidatePath("/estimates");
  return { ok: true };
}

/** "Cancel" on a sent estimate the customer has not accepted: kept (the customer saw it) under Cancelled / expired, with the reason. */
export async function cancelEstimate(id: string, reason: string): Promise<{ error?: string; ok?: boolean }> {
  const r = await ownEstimate(id);
  if ("error" in r) return r;
  const { staff, q } = r;
  const why = String(reason ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (why.length < 3) return { error: "Write why it is cancelled (for example: replaced by E-00011)." };
  if (!["sent", "opened", "urgent_requested", "pending_owner", "expired", "declined"].includes(String(q.status))) return { error: q.status === "approved" ? "An accepted estimate became a job: it cannot be cancelled here." : "Only a sent estimate can be cancelled; one being prepared is deleted." };
  const admin = createAdminClient();
  await admin.from("quotations").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: staff.id, cancel_reason: why, updated_by: staff.id }).eq("id", id);
  await logQuoteEvent(id, null, staff.id, "estimate_cancelled", `${q.number} cancelled by ${staff.display_name}: ${why}`);
  revalidatePath("/estimates");
  return { ok: true };
}

/**
 * "Re-send / extend": an expired (or nearly expired) estimate gets a fresh validity from today and goes back to Sent,
 * keeping its own link; the prepared WhatsApp comes back so it can be sent at once.
 */
export async function extendEstimate(id: string): Promise<{ error?: string; message?: string; phone?: string; validUntil?: string; number?: string }> {
  const r = await ownEstimate(id);
  if ("error" in r) return r;
  const { staff, q } = r;
  if (!["expired", "sent", "opened"].includes(String(q.status)) || !q.token) return { error: "Only a sent or expired estimate can be re-sent." };
  const admin = createAdminClient();
  const settings = await getSettings();
  const days = Number(q.validity_days) || Number(settings.quote_validity_days) || 7;
  const validUntil = new Date(Date.now() + days * 86400000).toISOString();
  await admin.from("quotations").update({ status: q.opened_at ? "opened" : "sent", valid_until: validUntil, extended_at: new Date().toISOString(), extended_by: staff.id, sent_at: new Date().toISOString(), sent_by: staff.id, updated_by: staff.id }).eq("id", id);
  await logQuoteEvent(id, null, staff.id, "estimate_extended", `${q.number} re-sent by ${staff.display_name}, valid for ${days} more day${days === 1 ? "" : "s"}`);
  const bundle = await loadQuotation(id);
  const v = bundle?.vehicle ?? null;
  const short = await shortFor(`${PRODUCTION_SITE_URL}/quote/${q.token}`);
  const message = String(settings.whatsapp_estimate_template ?? "")
    .replaceAll("[name]", greetingNameOf(bundle?.customer ?? null))
    .replaceAll("[make model]", [v?.make?.name, v?.model?.name].filter(Boolean).join(" "))
    .replaceAll("[plate]", v ? formatPlate(v) : "")
    .replaceAll("[advisor]", staff.display_name)
    .replaceAll("[link]", short);
  revalidatePath("/estimates");
  return { message, phone: (bundle?.customer?.phone ?? "").replace(/[^\d]/g, ""), validUntil, number: String(q.number) };
}

/**
 * "Copy estimate": a new estimate (its own number) for the same customer and car with every line and header choice -
 * for a gloss and a matte version, for example. The commission is never copied.
 */
export async function copyEstimate(id: string): Promise<{ error?: string; id?: string; number?: string }> {
  const r = await ownEstimate(id);
  if ("error" in r) return r;
  const { staff } = r;
  const bundle = await loadQuotation(id);
  if (!bundle) return { error: "Estimate not found." };
  const q = bundle.quotation;
  const admin = createAdminClient();
  const { data: created, error } = await admin
    .from("quotations")
    .insert({ kind: "estimate", customer_id: q.customer_id, vehicle_id: q.vehicle_id, discount_percent: q.discount_percent, vat_percent: q.vat_percent, validity_days: q.validity_days, customer_note: q.customer_note, payment_by_card: q.payment_by_card, discount_kind: q.discount_kind ?? null, discount_value: q.discount_value ?? null, discount_scope: q.discount_scope ?? "labour", discount_set_by: q.discount_set_by ?? null, discount_set_at: q.discount_set_at ?? null, expected_payment_method: q.expected_payment_method ?? "not_sure", materials_cost_aed: q.materials_cost_aed ?? null, tint_spec: q.tint_spec ?? null, film_rolls_est: q.film_rolls_est ?? null, copied_from_id: q.id, created_by: staff.id, updated_by: staff.id })
    .select("id, number")
    .single();
  if (error || !created) return { error: error?.message ?? "Could not copy the estimate." };
  const lines = bundle.lines.filter((l) => l.is_active && !l.fee_kind);
  const idMap = new Map<string, string>();
  for (const l of lines.filter((x) => !x.parent_line_id)) {
    const { data: ins } = await admin.from("quotation_lines").insert({ quotation_id: created.id, position: l.position, ...COPY_FIELDS(l), part_item_id: null, parent_line_id: null, created_by: staff.id, updated_by: staff.id }).select("id").single();
    if (ins) idMap.set(l.id, ins.id);
  }
  for (const l of lines.filter((x) => x.parent_line_id)) {
    await admin.from("quotation_lines").insert({ quotation_id: created.id, position: l.position, ...COPY_FIELDS(l), part_item_id: null, parent_line_id: idMap.get(l.parent_line_id!) ?? null, created_by: staff.id, updated_by: staff.id });
  }
  await logQuoteEvent(created.id, null, staff.id, "estimate_copied", `${created.number} copied from ${q.number} by ${staff.display_name} (commission not copied)`);
  await logQuoteEvent(q.id, null, staff.id, "estimate_copied", `Copied to ${created.number} by ${staff.display_name}`);
  revalidatePath("/estimates");
  return { id: created.id as string, number: created.number as string };
}
