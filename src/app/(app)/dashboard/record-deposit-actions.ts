"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { greetingNameOf } from "@/lib/messages";
import { round2 } from "@/lib/money";
import { depositState } from "@/lib/deposits";
import { recordPaymentCore, type Actor } from "@/lib/payments";
import { getSettings } from "@/lib/settings";
import { shortFor } from "@/lib/short-links";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { SAVE_FAILED, logAppError } from "@/lib/app-errors";
import { isUuid } from "@/lib/uuid";

export type RecordDepositResult =
  | { error: string }
  | {
      ok: true;
      number: string;
      paymentId: string;
      /** How much more than the requested deposit arrived (kept as an advance on the job). */
      overBy: number;
      receiptMessage: string;
      phoneDigits: string;
      pdfHref: string;
    };

/**
 * The RECORD DEPOSIT panel on "Waiting on you" (1.1, 21 October 2026): records the money right there,
 * no page change. Proof files were already uploaded (job_files kind payment_proof, ref_id = the panel's key, a
 * uuid); card and transfer refuse without one, cash, payment link and cheque may have one.
 * All or nothing: everything is checked before the receipt is written; the receipt (with its number) is one insert;
 * a Retry with the same key gives back the same receipt, never a second one. Staff see a plain sentence on any
 * failure, the technical error goes to app_errors (26 October 2026). The answer carries the receipt number and the ready WhatsApp
 * message, so "Send receipt" works from the same panel.
 */
export async function recordDepositPanel(formData: FormData): Promise<RecordDepositResult> {
  const staff = await requirePermission("recordPayments");
  try {
    return await recordDeposit(staff, formData);
  } catch (err) {
    await logAppError("record deposit", err, { staffId: staff.id, jobId: String(formData.get("job_id") ?? ""), detail: { method: String(formData.get("method") ?? "") } });
    return { error: SAVE_FAILED };
  }
}

async function recordDeposit(staff: Awaited<ReturnType<typeof requirePermission>>, formData: FormData): Promise<RecordDepositResult> {
  if (staff.viewingAs) return { error: "Viewing only." };
  const admin = createAdminClient();
  const settings = await getSettings();
  const jobId = String(formData.get("job_id") ?? "");
  const method = String(formData.get("method") ?? "");
  const amount = round2(Number(String(formData.get("amount") ?? "").replace(/[^\d.]/g, "")) || 0);
  const clientKey = blankToNull(formData.get("client_key"));
  const reference = blankToNull(formData.get("reference"));
  const receivedDate = blankToNull(formData.get("received_date"));
  if (!jobId) return { error: "Job missing." };
  if (!["cash", "card", "link", "transfer", "cheque"].includes(method)) return { error: "Pick how the money came." };
  if (!(amount > 0)) return { error: "Enter the amount received." };
  const cheque = method === "cheque" ? { number: blankToNull(formData.get("cheque_number")), bank: blankToNull(formData.get("cheque_bank")), date: blankToNull(formData.get("cheque_date")) } : null;
  if (method === "cheque" && !cheque?.number) return { error: "Enter the cheque number." };
  // The proof: uploaded before this call, tied to the panel's client key.
  const { data: proofRows, error: proofError } = isUuid(clientKey) ? await admin.from("job_files").select("id, storage_path").eq("job_id", jobId).eq("kind", "payment_proof").eq("ref_id", clientKey).is("removed_at", null).order("created_at") : { data: [], error: null };
  if (proofError) {
    await logAppError("record deposit: proof lookup", proofError, { staffId: staff.id, jobId });
    return { error: SAVE_FAILED };
  }
  const proofs = (proofRows ?? []) as { id: string; storage_path: string }[];
  if ((method === "card" || method === "transfer") && proofs.length === 0) return { error: method === "card" ? "Attach a photo of the card slip first." : "Attach the transfer proof (screenshot or photo) first." };

  const before = await depositState(jobId);
  const actor: Actor = { id: staff.id, display_name: staff.display_name, role_id: staff.role_id, is_head_accountant: staff.is_head_accountant };
  const r = await recordPaymentCore(actor, { invoiceId: null, jobId, method, amount, reference, authCode: blankToNull(formData.get("auth_code")), cheque, clientKey }, settings);
  if (r.error || !r.paymentId) return { error: r.error ?? "Could not record the deposit." };
  if (r.pendingOwner) return { error: "The amount is above the job's balance: it went to the owner for approval." };
  const paymentId = r.paymentId;
  const number = r.number ?? "";
  const overBy = round2(Math.max(0, amount - Math.max(0, before.required - before.received)));
  // The receipt is written: a hiccup in what follows is logged, never shown as "nothing was recorded".
  try {
    return await afterReceipt();
  } catch (err) {
    await logAppError(`record deposit: after ${number}`, err, { staffId: staff.id, jobId, detail: { paymentId } });
    revalidatePath("/dashboard");
    return { ok: true, number, paymentId, overBy, receiptMessage: "", phoneDigits: "", pdfHref: `/api/pdf/receipt/${paymentId}` };
  }

  async function afterReceipt(): Promise<RecordDepositResult> {
  const patch: Record<string, unknown> = { updated_by: staff.id };
  if (proofs.length) patch.proof_path = proofs[0].storage_path;
  if (receivedDate && /^\d{4}-\d{2}-\d{2}$/.test(receivedDate)) patch.received_at = new Date(`${receivedDate}T12:00:00+04:00`).toISOString();
  await admin.from("payments").update(patch).eq("id", paymentId);
  if (proofs.length) await admin.from("job_files").update({ ref_id: paymentId }).in("id", proofs.map((p) => p.id));

  // The ready "Send receipt" message, same as the money page builds it.
  const { data: job } = await admin.from("jobs").select(`job_number, customer:customers(full_name, company_name, phone), vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name))`).eq("id", jobId).maybeSingle();
  const customer = (job?.customer as unknown as { full_name: string; company_name: string | null; phone: string | null } | null) ?? null;
  const v = (job?.vehicle as unknown as (Parameters<typeof formatPlate>[0] & { model_year?: number | null; make?: { name: string } | null; model?: { name: string } | null }) | null) ?? null;
  const { data: q } = await admin.from("quotations").select("token").eq("job_id", jobId).eq("kind", "quotation").eq("status", "approved").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle();
  const pdfHref = `/api/pdf/receipt/${paymentId}${q?.token ? `?q=${q.token}` : ""}`;
  const link = await shortFor(`${PRODUCTION_SITE_URL}${pdfHref}`);
  const receiptMessage = String(settings.whatsapp_deposit_receipt_template ?? "")
    .replaceAll("[name]", greetingNameOf(customer))
    .replaceAll("[make model]", [v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" "))
    .replaceAll("[plate]", v ? formatPlate(v) : (job?.job_number ?? ""))
    .replaceAll("[amount]", amount.toLocaleString("en-GB", { minimumFractionDigits: 2 }))
    .replaceAll("[link]", link);

  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${jobId}/invoice`);
  return { ok: true, number, paymentId, overBy, receiptMessage, phoneDigits: (customer?.phone ?? "").replace(/[^\d]/g, ""), pdfHref };
  }
}
