import "server-only";
import { createAdminClient } from "./supabase/admin";
import type { Settings } from "./settings";
import { finalBlock, JOB_DONE_STATUSES, type AdvanceInvoice, type FinalBlock } from "./final-invoice-rules";

/**
 * The final tax invoice after an advance tax invoice (21 November 2026, J-01013). The rules are pure in
 * final-invoice-rules.ts; this file reads the database.
 */

type AdvRow = AdvanceInvoice & { converted_to: string | null };

function toAdv(r: Record<string, unknown>): AdvRow {
  return { id: String(r.id), number: String(r.number), issued_at: String(r.issued_at), taxable_aed: Number(r.taxable_aed) || 0, vat_aed: Number(r.vat_aed) || 0, total_aed: Number(r.total_aed) || 0, converted_to: (r.converted_to as string | null) ?? null };
}

/** Every live advance tax invoice of the job (folded into its final document or not). */
export async function jobAdvanceInvoices(jobId: string): Promise<AdvRow[]> {
  const { data } = await createAdminClient().from("invoices").select("id, number, issued_at, taxable_aed, vat_aed, total_aed, converted_to").eq("job_id", jobId).eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true).not("deposit_for_quotation_id", "is", null).order("issued_at");
  return ((data ?? []) as Record<string, unknown>[]).map(toAdv);
}

/** The advance tax invoices a final document takes off: those folded into it (or into the proforma it came from). */
export async function advanceInvoicesForDoc(doc: { id: string; job_id: string | null; kind: string; deposit_for_quotation_id?: string | null; converted_from?: string | null }): Promise<AdvRow[]> {
  if (!doc.job_id || doc.deposit_for_quotation_id || (doc.kind !== "tax_invoice" && doc.kind !== "proforma")) return [];
  const ids = [doc.id, doc.converted_from].filter((x): x is string => !!x);
  return (await jobAdvanceInvoices(doc.job_id)).filter((a) => !!a.converted_to && ids.includes(a.converted_to));
}

/** THE money block of a final document, or null when it follows no advance tax invoice. */
export async function finalBlockOf(doc: { id: string; job_id: string | null; kind: string; deposit_for_quotation_id?: string | null; converted_from?: string | null; taxable_aed: number; vat_aed: number; total_aed: number }): Promise<FinalBlock | null> {
  const adv = await advanceInvoicesForDoc(doc);
  return finalBlock({ taxable: doc.taxable_aed, vat: doc.vat_aed, total: doc.total_aed }, adv);
}

/** The job's final (non-advance) tax invoice, if one exists. */
export async function finalTaxInvoiceOf(jobId: string): Promise<{ id: string; number: string } | null> {
  const { data } = await createAdminClient().from("invoices").select("id, number").eq("job_id", jobId).eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true).is("deposit_for_quotation_id", null).order("issued_at", { ascending: false }).limit(1).maybeSingle();
  return data ? { id: String(data.id), number: String(data.number) } : null;
}

/**
 * "Generate the final tax invoice" (accounts and the owner): once the job is done, whether or not the balance is paid.
 * The final proforma is made from the job's real lines (the advance tax invoices and every payment fold into it), then
 * it becomes the final tax invoice at once - the advance taken off, the balance (if any) still due on it.
 */
export async function generateFinalTaxInvoice(jobId: string, actor: { id: string; display_name: string; role_id: string }, settings: Settings): Promise<{ number: string; words: string } | { error: string }> {
  if (!["owner", "accounts"].includes(actor.role_id)) return { error: "Only accounts or the owner generate the final tax invoice." };
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, status, is_open, gated_out_at").eq("id", jobId).maybeSingle();
  if (!job) return { error: "This job is not there any more. Reload the page." };
  if (!job.is_open) return { error: `${job.job_number} is closed: the final tax invoice cannot be generated from here. Tell the owner.` };
  if (!JOB_DONE_STATUSES.includes(String(job.status)) && !job.gated_out_at) return { error: `The job is not done yet: the final tax invoice comes once the car is Ready.` };
  const advances = await jobAdvanceInvoices(jobId);
  if (!advances.length) return { error: "This job has no advance tax invoice: its tax invoice follows the payment as usual." };
  const already = await finalTaxInvoiceOf(jobId);
  if (already) return { error: `${already.number} is already the final tax invoice of ${job.job_number}.` };
  const { ensureProforma, convertProformaIfPaid } = await import("./invoice-flow");
  const doc = await ensureProforma(jobId, { id: actor.id, display_name: actor.display_name }, settings);
  if (!doc) return { error: "There is no approved work to invoice on this job." };
  const numbers = advances.map((a) => a.number).join(", ");
  const tax = doc.kind === "tax_invoice" ? doc : await convertProformaIfPaid(jobId, actor.id, settings, { force: { reason: `Final tax invoice after the advance ${numbers}` } });
  if (!tax) return { error: "Couldn't generate the final tax invoice – nothing was issued. Try again or tell the owner." };
  return { number: tax.number, words: `${tax.number} generated: the final tax invoice of ${job.job_number}, the advance ${numbers} taken off.` };
}
