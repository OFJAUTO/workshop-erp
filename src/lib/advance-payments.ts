import "server-only";
/**
 * The PAYMENTS box (16 November 2026, Section 2): the advance asked on an estimate (its proformas) and what came in,
 * on the estimate page and on the job the estimate becomes. Reads the estimate's whole family (every version of its
 * number), and on a job every estimate behind it, so the box stays the same after approval and after the car arrives.
 */
import { advanceBoxOf, type AdvanceAsk, type AdvanceBox, type AdvanceReceipt } from "./advance-payments-rules";
import { awaitsBank } from "./bank-status";
import { estimateMoneyMany, estimatesOfJob, familyIdsOf, jobOfEstimate } from "./estimate-money";
import { METHOD_LABELS } from "./invoice-data";
import { estimateMoneyReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";

export type AdvancePayments = AdvanceBox & {
  /** The estimate numbers the box reads (E-00082). */
  numbers: string[];
  /** The newest version of the first estimate (the Record button opens on it). */
  estimateId: string;
  customerId: string;
  vehicleId: string | null;
  /** The estimate's total (newest accepted version, rounded when rounded). */
  total: number;
  /** The job the money is on (car here) or will follow to (held for parts ordered first). */
  job: { id: string; number: string; booked: boolean } | null;
};

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/** The box of one estimate (newest version id) or of a job (every estimate behind it). Null when there is no estimate. */
export async function advancePaymentsFor(input: { estimateId?: string | null; jobId?: string | null }): Promise<AdvancePayments | null> {
  if (!(await estimateMoneyReady())) return null;
  const admin = createAdminClient();
  const estIds = input.estimateId ? [input.estimateId] : input.jobId ? await estimatesOfJob(input.jobId) : [];
  if (!estIds.length) return null;
  const fam = await familyIdsOf(estIds);
  const allIds = Array.from(new Set(Array.from(fam.values()).flatMap((f) => f.ids)));
  const numbers = Array.from(new Set(Array.from(fam.values()).map((f) => f.number)));
  const [{ data: est }, many, { data: docsRaw }] = await Promise.all([
    admin.from("quotations").select("id, customer_id, vehicle_id").eq("id", estIds[0]).maybeSingle(),
    estimateMoneyMany(estIds),
    admin.from("invoices").select("id, number, kind, status, total_aed, issued_at, issue_reason, converted_to").in("estimate_id", allIds).eq("is_active", true),
  ]);
  const e = est as { id: string; customer_id: string; vehicle_id: string | null } | null;
  if (!e) return null;
  const docs = (docsRaw ?? []) as { id: string; number: string; kind: string; status: string; total_aed: number | string; issued_at: string; issue_reason: string | null; converted_to: string | null }[];
  const live = docs.filter((d) => d.status === "issued");
  const asks: AdvanceAsk[] = live.filter((d) => d.kind === "proforma").map((d) => ({ id: d.id, number: d.number, amount: round2(Number(d.total_aed) || 0), at: d.issued_at, complete: !/partial/i.test(String(d.issue_reason ?? "")) }));
  const docNumber = new Map(docs.map((d) => [d.id, d.number]));
  // Receipts: on the family's documents, or moved on with the car (they keep the estimate they were an advance on).
  const docIds = docs.map((d) => d.id);
  const job = input.jobId ? await jobRow(input.jobId) : await jobOfEstimate(estIds[0]);
  const cols = "id, number, method, amount_aed, received_at, cheque_status, status, invoice_id, job_id, deposit_invoice_number, deposit_quotation_id, notes";
  const reads = [
    docIds.length ? admin.from("payments").select(cols).in("invoice_id", docIds).eq("is_active", true) : Promise.resolve({ data: [] }),
    admin.from("payments").select(cols).in("deposit_quotation_id", allIds).eq("is_active", true),
    // The extra paid beyond an estimate's proforma, kept as the customer's advance (16 November 2026).
    admin.from("payments").select(cols).eq("customer_id", e.customer_id).is("invoice_id", null).is("job_id", null).eq("is_active", true).or(numbers.map((n) => `notes.ilike."Extra paid on ${n} *"`).join(",")),
  ];
  const got = await Promise.all(reads);
  const seen = new Map<string, Record<string, unknown>>();
  for (const g of got) for (const p of ((g as { data: unknown }).data ?? []) as Record<string, unknown>[]) seen.set(String(p.id), p);
  const receipts: AdvanceReceipt[] = Array.from(seen.values())
    .filter((p) => p.status !== "voided" && p.status !== "reversed")
    .map((p) => ({
      id: String(p.id),
      number: String(p.number),
      amount: round2(Number(p.amount_aed) || 0),
      at: String(p.received_at),
      method: METHOD_LABELS[String(p.method) as keyof typeof METHOD_LABELS] ?? String(p.method),
      pending: awaitsBank({ method: String(p.method), cheque_status: (p.cheque_status as string | null) ?? null }) || p.status === "pending_owner",
      invoiceNumber: (p.deposit_invoice_number as string | null) ?? (p.invoice_id ? docNumber.get(String(p.invoice_id)) ?? null : !p.invoice_id && !p.job_id ? "kept as the customer's advance" : null),
    }));
  const total = round2(estIds.reduce((a, id) => a + (many.get(id)?.total ?? 0), 0));
  const box = advanceBoxOf({ total, asks, receipts });
  return { ...box, numbers, estimateId: estIds[0], customerId: e.customer_id, vehicleId: e.vehicle_id, total, job };
}

async function jobRow(jobId: string): Promise<{ id: string; number: string; booked: boolean } | null> {
  const { data } = await createAdminClient().from("jobs").select("id, job_number, status").eq("id", jobId).maybeSingle();
  const j = data as { id: string; job_number: string; status: string } | null;
  return j ? { id: j.id, number: j.job_number, booked: j.status === "booked" } : null;
}
