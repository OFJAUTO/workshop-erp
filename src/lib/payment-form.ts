import "server-only";
import { proofMissingWords, proofRequired } from "@/lib/payment-proof";
import { blankToNull } from "./format";
import { loadInvoice } from "./invoice-data";
import { PAYMENT_METHODS, methodsFor } from "./money-steps";
import { recordPaymentCore, type Actor, type PaymentResult } from "./payments";
import { currentPaymentLink, ensureAutoPayLink, paymentLinksOf } from "./payment-links";
import type { Settings } from "./settings";
import { getSiteUrl } from "./site";
import { createAdminClient } from "./supabase/admin";
import { isUuid } from "./uuid";
import { photoSizesLater } from "./photo-sizes";

export type FormPaymentOutcome = PaymentResult & { jobId: string | null; invoiceId: string | null };

/**
 * THE reading of a "Record payment" form (1 November 2026: shared by the money page, the invoice page and the Record
 * payment window on every car and customer page). The method must be one this person may record; card and transfer
 * carry their proof; the same tap twice is the same receipt; a payment with no job or invoice is an unallocated advance
 * on the customer's account; more than what is left needs a note.
 */
export async function paymentFromForm(staff: { id: string; display_name: string; role_id: string; is_head_accountant?: boolean }, formData: FormData, settings: Settings): Promise<FormPaymentOutcome> {
  const actor: Actor = { id: staff.id, display_name: staff.display_name, role_id: staff.role_id, is_head_accountant: staff.is_head_accountant };
  const invoiceId = blankToNull(formData.get("invoice_id"));
  const jobIdIn = blankToNull(formData.get("job_id"));
  const unallocatedCustomer = !invoiceId && !jobIdIn && formData.get("unallocated") === "1" ? blankToNull(formData.get("customer_id")) : null;
  const vehicleIn = blankToNull(formData.get("vehicle_id"));
  const amount = Number(String(formData.get("amount") ?? "").replace(/[^\d.]/g, ""));
  const method = String(formData.get("method") ?? "");
  const out = (r: PaymentResult, jobId: string | null = jobIdIn): FormPaymentOutcome => ({ ...r, jobId, invoiceId });
  if (!methodsFor(staff.role_id).includes(method as (typeof PAYMENT_METHODS)[number])) return out({ error: "Not allowed: payments are recorded by accounts or the owner only." });
  const proof = formData.get("proof");
  const proofFile = proof instanceof File && proof.size > 0 ? proof : null;
  const clientKeyIn = blankToNull(formData.get("client_key"));
  const admin = createAdminClient();
  // The same tap again (its answer was lost): the receipt it already made, before the proof check (its proof already moved
  // onto that receipt). A different payment on a used key is never put on that receipt.
  if (isUuid(clientKeyIn)) {
    const { data: same } = await admin.from("payments").select("id, number, amount_aed, method, job_id, token").eq("client_key", clientKeyIn).maybeSingle();
    if (same) {
      const differs = Math.abs(Number(same.amount_aed) - amount) > 0.005 || String(same.method) !== method;
      // A reported payment whose receipt was made but whose report was not closed (the answer was lost): closed now.
      if (!differs && formData.get("report_id") === clientKeyIn) {
        const { closeReportWithPayment } = await import("./payment-reports");
        await closeReportWithPayment(clientKeyIn as string, { id: String(same.id), number: String(same.number), amount: Number(same.amount_aed), method: String(same.method) }, { id: staff.id, display_name: staff.display_name }).catch(() => null);
      }
      return out(differs ? { error: `This form was already used for ${same.number}. Nothing new was recorded – reload the page and record it again.` } : { ok: true, number: same.number, paymentId: same.id, token: (same.token as string | null) ?? null, message: `${same.number} was already recorded.`, repeat: { amount: Number(same.amount_aed), method: String(same.method) } }, (same.job_id as string | null) ?? jobIdIn);
    }
  }
  const proofJobId = jobIdIn ?? (invoiceId ? ((await loadInvoice(invoiceId))?.invoice.job_id ?? null) : null);
  // A payment an advisor sent to accounts (2 November 2026, section 3): it is recorded once, on its own car, under the
  // report's own id as the receipt's key; the advisor's slip is its proof.
  const reportId = blankToNull(formData.get("report_id"));
  let report: { id: string; jobId: string | null; estimateId?: string | null; proofPath: string } | null = null;
  if (reportId) {
    const { reportToRecord } = await import("./payment-reports");
    const r = await reportToRecord(reportId, clientKeyIn);
    if (r.error || !r.report) return out({ error: r.error ?? "The reported payment was not found." }, proofJobId);
    if (r.report.jobId) {
      if (unallocatedCustomer || proofJobId !== r.report.jobId) return out({ error: "This payment was reported on another car: record it on that car's job." }, proofJobId);
    } else if (r.report.estimateId) {
      // A report on an ESTIMATE (car not here yet): the money goes against that estimate's proforma.
      const { estimateOfInvoice } = await import("./estimate-money");
      const est = invoiceId ? await estimateOfInvoice(invoiceId) : null;
      if (unallocatedCustomer || !est || est.estimateId !== r.report.estimateId) return out({ error: "This payment was reported on an estimate: record it against that estimate's proforma." }, proofJobId);
    } else {
      return out({ error: "This payment was reported on another car: record it on that car's job." }, proofJobId);
    }
    report = r.report;
  }
  const { data: proofRows } = !proofFile && proofJobId && isUuid(clientKeyIn) ? await admin.from("job_files").select("id, storage_path, kind").eq("job_id", proofJobId).in("kind", ["payment_proof", "payment_report"]).eq("ref_id", clientKeyIn).is("removed_at", null).order("created_at") : { data: [] };
  const found = (proofRows ?? []) as { id: string; storage_path: string; kind: string }[];
  // Accounts' own proofs move onto the receipt; the advisor's slips stay with his report (its record of what he sent).
  const uploaded = found.filter((f) => f.kind === "payment_proof");
  const proofPath = found[0]?.storage_path ?? report?.proofPath ?? null;
  if (proofRequired(method) && !proofFile && !proofPath) return out({ error: proofMissingWords(method) }, proofJobId);
  if (proofFile && proofFile.size > 25 * 1024 * 1024) return out({ error: "The proof photo is too large (over 25 MB)." }, proofJobId);
  const r = await recordPaymentCore(actor, {
    invoiceId,
    jobId: jobIdIn,
    method,
    amount,
    reference: blankToNull(formData.get("reference")),
    authCode: blankToNull(formData.get("auth_code")),
    cheque: { number: blankToNull(formData.get("cheque_number")), bank: blankToNull(formData.get("cheque_bank")), date: blankToNull(formData.get("cheque_date")) },
    notes: blankToNull(formData.get("notes")),
    clientKey: clientKeyIn,
    unallocated: unallocatedCustomer ? { customerId: unallocatedCustomer, vehicleId: vehicleIn } : null,
    overNote: blankToNull(formData.get("over_note")),
    duplicateReason: blankToNull(formData.get("duplicate_reason")),
    overCheck: true,
    // The report is closed by this receipt and its advisor told "Recorded ✓ RCT-…" (recordPaymentCore).
    reportId: report?.id ?? null,
  }, settings);
  // The form's key was already used for another receipt (a copied tab): that earlier receipt is never touched.
  if (r.repeat && (Math.abs(r.repeat.amount - amount) > 0.005 || r.repeat.method !== method)) return out({ error: `This form was already used for ${r.number ?? "an earlier receipt"}. Nothing new was recorded – reload the page and record it again.` }, proofJobId);
  if (!r.error && r.paymentId && !r.repeat && !proofFile && proofPath) {
    await admin.from("payments").update({ proof_path: proofPath, updated_by: staff.id }).eq("id", r.paymentId);
    if (uploaded.length) await admin.from("job_files").update({ ref_id: r.paymentId }).in("id", uploaded.map((u) => u.id));
  }
  if (!r.error && r.paymentId && !r.repeat && proofFile) {
    const ext = proofFile.type.includes("png") ? "png" : proofFile.type.includes("webp") ? "webp" : proofFile.type.includes("pdf") ? "pdf" : "jpg";
    const path = `payments/${r.paymentId}.${ext}`;
    const { error: upErr } = await admin.storage.from("job-files").upload(path, Buffer.from(await proofFile.arrayBuffer()), { contentType: proofFile.type || "image/jpeg", upsert: true });
    if (!upErr) photoSizesLater("job-files", path, proofFile.type || "image/jpeg");
    if (!upErr) await admin.from("payments").update({ proof_path: path, updated_by: staff.id }).eq("id", r.paymentId);
  }
  // A part payment: the Pay now order (if any) is remade for what is left.
  if (invoiceId && !r.error) {
    const cur = currentPaymentLink(await paymentLinksOf(invoiceId));
    if (cur?.provider === "ngenius" && !cur.paid_at) await ensureAutoPayLink(invoiceId, { id: staff.id, display_name: staff.display_name }, await getSiteUrl());
  }
  return out(r, proofJobId);
}
