import "server-only";
import { createAdminClient } from "./supabase/admin";
import { getSettings } from "./settings";
import { paymentChoices } from "./customer-money";
import { awaitsBank, countsAsPaid } from "./bank-status";
import { round2 } from "./money";
import { METHOD_LABELS } from "./invoice-data";

/*
 * THE customer statement (9 November 2026, Section 3): one page per customer with the open jobs, their proformas and
 * invoices, the payments, the cheques and transfers still waiting for the bank, credit not allocated, and the balance.
 * The combined bill is the same data narrowed to the chosen proformas, with each car's lines. Used by the staff screen,
 * the customer's page (/statement/[token]) and the PDF.
 */

export type StatementDoc = { invoiceId: string | null; jobId: string | null; jobNumber: string | null; title: string; docNumber: string | null; kind: "proforma" | "tax_invoice" | "approved"; issuedAt: string | null; total: number | null; paid: number; balance: number; lines: { description: string; quantity: number; amount: number }[] };
export type StatementPayment = { number: string; receivedAt: string; method: string; amount: number; pending: boolean; what: string };
export type Statement = {
  customer: { id: string; name: string; phone: string | null; email: string | null; trn: string | null };
  docs: StatementDoc[];
  payments: StatementPayment[];
  credit: number;
  totalDue: number;
  pending: number;
  balanceOnceCleared: number;
  asOf: string;
};

export async function loadStatement(customerId: string, opts: { docIds?: string[]; withLines?: boolean } = {}): Promise<Statement | null> {
  const admin = createAdminClient();
  const settings = await getSettings();
  const { data: c } = await admin.from("customers").select("id, full_name, company_name, phone, email, trn").eq("id", customerId).maybeSingle();
  if (!c) return null;
  const choices = await paymentChoices({ customerId }, settings);
  const targets = (choices?.targets ?? []).filter((t) => t.kind !== "unallocated" && (t.balance ?? 0) > 0.004 && (!opts.docIds || (t.invoiceId && opts.docIds.includes(t.invoiceId))));
  const invoiceIds = targets.map((t) => t.invoiceId).filter((x): x is string => !!x);
  const jobIds = Array.from(new Set(targets.map((t) => t.jobId).filter((x): x is string => !!x)));
  const [{ data: invs }, { data: jobs }, { data: lines }] = await Promise.all([
    invoiceIds.length ? admin.from("invoices").select("id, number, kind, issued_at").in("id", invoiceIds) : Promise.resolve({ data: [] }),
    jobIds.length ? admin.from("jobs").select("id, job_number").in("id", jobIds) : Promise.resolve({ data: [] }),
    opts.withLines && invoiceIds.length ? admin.from("invoice_lines").select("invoice_id, description, quantity, total_aed, position, is_active").in("invoice_id", invoiceIds).eq("is_active", true).order("position") : Promise.resolve({ data: [] }),
  ]);
  const invById = new Map(((invs ?? []) as { id: string; number: string; kind: string; issued_at: string | null }[]).map((i) => [i.id, i]));
  const jobNo = new Map(((jobs ?? []) as { id: string; job_number: string }[]).map((j) => [j.id, j.job_number]));
  const linesOf = (id: string) => ((lines ?? []) as { invoice_id: string; description: string; quantity: number | string; total_aed: number | string }[]).filter((l) => l.invoice_id === id).map((l) => ({ description: l.description, quantity: Number(l.quantity) || 1, amount: Number(l.total_aed) || 0 }));
  const docs: StatementDoc[] = targets.map((t): StatementDoc => {
    const inv = t.invoiceId ? invById.get(t.invoiceId) : null;
    return { invoiceId: t.invoiceId, jobId: t.jobId, jobNumber: t.jobId ? (jobNo.get(t.jobId) ?? null) : null, title: t.title, docNumber: inv?.number ?? null, kind: inv ? (inv.kind === "tax_invoice" ? "tax_invoice" : "proforma") : "approved", issuedAt: inv?.issued_at ?? null, total: t.total, paid: t.paid, balance: round2(t.balance ?? 0), lines: t.invoiceId ? linesOf(t.invoiceId) : [] };
  }).sort((a, b) => String(a.issuedAt ?? "9999").localeCompare(String(b.issuedAt ?? "9999")));

  // Payments on these jobs and documents, and money on the account not allocated; voided ones are left out.
  const ors = [jobIds.length ? `job_id.in.(${jobIds.join(",")})` : null, invoiceIds.length ? `invoice_id.in.(${invoiceIds.join(",")})` : null, opts.docIds ? null : "and(job_id.is.null,invoice_id.is.null)"].filter(Boolean).join(",");
  const { data: pays } = ors ? await admin.from("payments").select("number, received_at, method, amount_aed, cheque_status, cheque_number, reference, status, job_id, invoice_id").eq("customer_id", customerId).eq("is_active", true).eq("status", "recorded").or(ors).order("received_at") : { data: [] };
  const payments: StatementPayment[] = ((pays ?? []) as { number: string; received_at: string; method: string; amount_aed: number | string; cheque_status: string | null; cheque_number: string | null; reference: string | null; job_id: string | null; invoice_id: string | null }[]).map((p) => ({
    number: p.number,
    receivedAt: p.received_at,
    method: METHOD_LABELS[p.method as keyof typeof METHOD_LABELS] ?? p.method,
    amount: Number(p.amount_aed) || 0,
    pending: awaitsBank(p),
    what: `${p.cheque_number ? `Cheque ${p.cheque_number}` : p.reference ? `Ref ${p.reference}` : ""}${p.job_id ? ` · ${jobNo.get(p.job_id) ?? ""}` : !p.invoice_id ? " · on account (not allocated)" : ""}`.replace(/^ · /, ""),
  }));
  const raw = (pays ?? []) as { method: string; amount_aed: number | string; cheque_status: string | null; job_id: string | null; invoice_id: string | null }[];
  const credit = opts.docIds ? 0 : round2(raw.filter((p) => !p.job_id && !p.invoice_id && countsAsPaid(p)).reduce((a, p) => a + Number(p.amount_aed), 0));
  const totalDue = round2(docs.reduce((a, d) => a + d.balance, 0));
  const pending = round2(raw.filter((p) => awaitsBank(p)).reduce((a, p) => a + Number(p.amount_aed), 0));
  return {
    customer: { id: c.id as string, name: String(c.company_name || c.full_name || ""), phone: (c.phone as string | null) ?? null, email: (c.email as string | null) ?? null, trn: (c.trn as string | null) ?? null },
    docs,
    payments,
    credit,
    totalDue,
    pending,
    balanceOnceCleared: round2(Math.max(0, totalDue - pending - credit)),
    asOf: new Date().toISOString(),
  };
}
