"use server";
/**
 * Money from the estimate (4 November 2026): the estimate page's proforma actions. Advisors (and the
 * owner/accounts) issue the proforma and send it; recording the money stays with accounts and the owner
 * (the Record payment window, which offers the proforma by itself).
 */
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createEstimateProforma, estimateMoneyOf, voidEstimateProforma } from "@/lib/estimate-money";
import type { BillTo } from "@/lib/estimate-money-rules";
import { getSettings } from "@/lib/settings";
import { formatPlate } from "@/lib/types";
import { greetingNameOf } from "@/lib/messages";
import { shortFor } from "@/lib/short-links";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePaymentRequest, validateGatewayUrl } from "@/lib/pay-page";
import { estimatePayLinkReady } from "@/lib/schema-ready";
import { notifyRoles } from "@/lib/notifications";

const MAY_SEND = ["owner", "service_advisor", "accounts"];

export type ProformaSendInfo = { error?: string; number?: string; total?: number; message?: string; phone?: string | null; short?: string; token?: string; invoiceId?: string };

/** The WhatsApp message and short link for an estimate's proforma (the template from Settings). */
async function sendInfoOf(estimateId: string, invoice: { id: string; number: string; total_aed: number; token: string }): Promise<ProformaSendInfo> {
  const admin = createAdminClient();
  const settings = await getSettings();
  const { data: e } = await admin.from("quotations").select("id, number, customer_id, vehicle_id").eq("id", estimateId).maybeSingle();
  if (!e) return { error: "Estimate not found." };
  const [{ data: customer }, { data: vehicle }] = await Promise.all([
    admin.from("customers").select("full_name, company_name, phone").eq("id", e.customer_id).maybeSingle(),
    e.vehicle_id ? admin.from("vehicles").select("kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", e.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const v = vehicle as unknown as (Parameters<typeof formatPlate>[0] & { model_year: number | null; make: { name: string } | null; model: { name: string } | null }) | null;
  const short = await shortFor(`/proforma/${invoice.token}`);
  const message = String((settings as unknown as Record<string, unknown>).whatsapp_estimate_proforma_template ?? "")
    .replaceAll("[name]", greetingNameOf(customer))
    .replaceAll("[estimate]", e.number)
    .replaceAll("[make model]", v ? [v.make?.name, v.model?.name].filter(Boolean).join(" ") : "")
    .replaceAll("[plate]", v ? formatPlate(v) : "")
    .replaceAll("[link]", short)
    .replaceAll("[amount]", invoice.total_aed.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  return { number: invoice.number, total: invoice.total_aed, message, phone: (customer?.phone as string | null) ?? null, short, token: invoice.token, invoiceId: invoice.id };
}

/** Issue the proforma (complete or partial) with the bill-to block, and hand back the filled message to send. */
export async function createEstimateProformaAction(
  estimateId: string,
  input: { mode: "complete" | "partial"; partialKind?: "percent" | "aed"; partialValue?: number; billTo?: Partial<Record<keyof BillTo, unknown>> | null; validityDays?: number | null; combineIds?: string[] },
): Promise<ProformaSendInfo> {
  const staff = await requireStaff();
  if (!MAY_SEND.includes(staff.role_id) || staff.viewingAs) return { error: "Only advisors, accounts or the owner issue a proforma." };
  const settings = await getSettings();
  const r = await createEstimateProforma(
    estimateId,
    { mode: input.mode, partial: input.mode === "partial" ? { kind: input.partialKind ?? "aed", value: Number(input.partialValue) } : undefined, billTo: input.billTo ?? null, validityDays: input.validityDays ?? null, combineIds: (input.combineIds ?? []).filter((x) => typeof x === "string").slice(0, 10) },
    { id: staff.id, display_name: staff.display_name },
    settings,
  );
  if (r.error || !r.invoice || !r.invoice.token) return { error: r.error ?? "Couldn't issue the proforma." };
  revalidatePath(`/estimates/${estimateId}`);
  return sendInfoOf(estimateId, { id: r.invoice.id, number: r.invoice.number, total_aed: r.invoice.total_aed, token: r.invoice.token });
}

/** The message for a proforma already out (Send again). */
export async function estimateProformaSendInfo(estimateId: string): Promise<ProformaSendInfo> {
  const staff = await requireStaff();
  if (!MAY_SEND.includes(staff.role_id)) return { error: "Only advisors, accounts or the owner send it." };
  const m = await estimateMoneyOf(estimateId);
  if (!m?.proforma?.token) return { error: "No proforma is out on this estimate." };
  return sendInfoOf(estimateId, { id: m.proforma.id, number: m.proforma.number, total_aed: m.proforma.total_aed, token: m.proforma.token });
}

/** The send is stamped and logged (sent on WhatsApp / copied). */
export async function markEstimateProformaSent(estimateId: string, invoiceId: string, how: string): Promise<{ error?: string }> {
  const staff = await requireStaff();
  if (!MAY_SEND.includes(staff.role_id) || staff.viewingAs) return { error: "Only advisors, accounts or the owner send it." };
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data } = await admin.from("invoices").update({ sent_by: staff.id, sent_at: now, updated_by: staff.id }).eq("id", invoiceId).eq("kind", "proforma").select("number").maybeSingle();
  if (data) await admin.from("quotation_events").insert({ quotation_id: estimateId, job_id: null, event_type: "proforma_sent", note: `${data.number} sent (${how}) by ${staff.display_name}`, created_by: staff.id });
  revalidatePath(`/estimates/${estimateId}`);
  return {};
}

/**
 * The advisor's payment link on an estimate (complete or partial amount): OUR /p/ page against the open
 * proforma, with an optional pasted gateway link. Returns the filled WhatsApp message ready to send.
 */
export async function prepareEstimatePayLink(estimateId: string, amountIn: number, gatewayUrl?: string | null): Promise<{ error?: string; message?: string; shortLink?: string; amount?: number; phone?: string | null }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "Viewing only." };
  if (!MAY_SEND.includes(staff.role_id)) return { error: "The advisor or accounts send payment links." };
  if (!(await estimatePayLinkReady())) return { error: "The estimate payment link needs the database update first (waiting for apply)." };
  const amount = Math.round(Number(amountIn) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter the amount to ask for." };
  const m = await estimateMoneyOf(estimateId);
  if (!m?.proforma) return { error: "Issue the proforma first - the link asks for money against it." };
  if (amount > m.proforma.total_aed + 0.005) return { error: `More than the proforma's total (AED ${m.proforma.total_aed.toFixed(2)}).` };
  const settings = await getSettings();
  let url: string | null | undefined = undefined;
  if (gatewayUrl !== undefined && gatewayUrl !== null) {
    const clean = String(gatewayUrl).trim();
    if (clean === "") url = null;
    else {
      const v = validateGatewayUrl(clean, settings);
      if (!v.ok) return { error: v.error };
      url = clean;
    }
  }
  const admin = createAdminClient();
  const { data: e } = await admin.from("quotations").select("id, number, customer_id, vehicle_id").eq("id", estimateId).maybeSingle();
  if (!e) return { error: "Estimate not found." };
  const [{ data: customer }, { data: vehicle }] = await Promise.all([
    admin.from("customers").select("full_name, company_name, phone").eq("id", e.customer_id).maybeSingle(),
    e.vehicle_id ? admin.from("vehicles").select("kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", e.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const v2 = vehicle as unknown as (Parameters<typeof formatPlate>[0] & { model_year: number | null; make: { name: string } | null; model: { name: string } | null }) | null;
  const car = v2 ? [v2.make?.name, v2.model?.name].filter(Boolean).join(" ") : "";
  const { shortLink } = await ensurePaymentRequest({ estimateId, kind: "advance", amount, invoiceId: m.proforma.id, purpose: `Payment for your ${car || "car"} (${e.number})`, ...(url !== undefined ? { gatewayUrl: url } : {}), by: staff.id });
  const message = String((settings as unknown as Record<string, unknown>).whatsapp_payment_request_template ?? "")
    .replaceAll("[name]", greetingNameOf(customer))
    .replaceAll("[make model]", car)
    .replaceAll("[plate]", v2 ? formatPlate(v2) : e.number)
    .replaceAll("[amount]", amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    .replaceAll("[link]", shortLink);
  return { message, shortLink, amount, phone: (customer?.phone as string | null) ?? null };
}

/** The payment link went out: logged on the estimate, accounts watch for the money. */
export async function markEstimatePayLinkSent(estimateId: string, amountIn: number): Promise<{ ok?: boolean; error?: string }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "Viewing only." };
  if (!MAY_SEND.includes(staff.role_id)) return { error: "The advisor or accounts send payment links." };
  const amount = Math.round((Number(amountIn) || 0) * 100) / 100;
  const admin = createAdminClient();
  const { data: e } = await admin.from("quotations").select("id, number").eq("id", estimateId).maybeSingle();
  if (!e) return { error: "Estimate not found." };
  await admin.from("quotation_events").insert({ quotation_id: estimateId, job_id: null, event_type: "payment_link", note: `Payment link for AED ${amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })} sent by ${staff.display_name}`, created_by: staff.id });
  await notifyRoles(["accounts"], { type: "deposit_to_collect", title: `Payment link sent · ${e.number} · AED ${amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`, body: `${staff.display_name} sent the customer a payment link for the estimate (car not here yet). Record it when it arrives - the tax invoice follows by itself.`, href: `/estimates/${estimateId}` });
  revalidatePath(`/estimates/${estimateId}`);
  return { ok: true };
}

/** Part 3: the owner settles an over-payment (a revision down) — credit note kept as credit, or to refund. */
export async function settleEstimateOverAction(estimateId: string, keep: "credit" | "refund", reason: string): Promise<{ error?: string; cnId?: string; cnNumber?: string; words?: string }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  const { settleEstimateOver } = await import("@/lib/estimate-money");
  const r = await settleEstimateOver(estimateId, { keep, reason }, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id }, await getSettings());
  if (!r.error) revalidatePath(`/estimates/${estimateId}`);
  return r;
}

/** Part 3: the owner cancels an estimate that holds money — optional fee, then refund or customer credit. */
export async function cancelEstimateMoneyAction(estimateId: string, input: { reason: string; fee: number; keep: "credit" | "refund" }): Promise<{ error?: string; cnId?: string | null; cnNumber?: string | null; words?: string }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  const { cancelEstimateWithMoney } = await import("@/lib/estimate-money");
  const r = await cancelEstimateWithMoney(estimateId, input, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id }, await getSettings());
  if (!r.error) {
    revalidatePath(`/estimates/${estimateId}`);
    revalidatePath("/estimates");
  }
  return r;
}

/** An unpaid proforma is voided with a reason (owner + accounts; logged). */
export async function voidEstimateProformaAction(estimateId: string, invoiceId: string, reason: string): Promise<{ error?: string }> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  const r = await voidEstimateProforma(invoiceId, reason, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  if (!r.error) revalidatePath(`/estimates/${estimateId}`);
  return r;
}
