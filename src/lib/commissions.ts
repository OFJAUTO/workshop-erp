import "server-only";
import { PAYMENT_SELECT, invoiceBalance, toInvoice, toPayment } from "./invoice-data";
import { getSettings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

/**
 * The commissions page (1.7, 21 October 2026): every commission in three buckets - waiting for the
 * owner, approved and payable (only once the customer's invoice is paid in full), and paid. Accounts
 * and the owner only.
 */

export type CommissionRow = {
  quotationId: string;
  quotation: string;
  version: number;
  jobId: string | null;
  jobNumber: string;
  plate: string;
  carTitle: string;
  recipient: string;
  phone: string | null;
  amount: number;
  invoiceNumber: string | null;
  customerPaid: boolean;
  customerPaidWhy: string;
  setByName: string | null;
  setAt: string | null;
  status: "pending" | "approved" | "paid";
  decidedAt: string | null;
  decisionNote: string | null;
  paidAt: string | null;
  paidByName: string | null;
  paidMethod: string | null;
  paidNote: string | null;
  creditNotes: number;
};

/** "Jamshaid · +971 50 123 4567" in Settings → name + phone; a bare name has no phone. */
export function recipientPhone(name: string, people: string[]): string | null {
  const hit = people.find((p) => p.toLowerCase().startsWith(name.toLowerCase()));
  if (!hit) return null;
  const m = hit.match(/(\+?\d[\d ()-]{7,})\s*$/);
  return m ? m[1].trim() : null;
}

export async function loadCommissions(): Promise<{ pending: CommissionRow[]; toPay: CommissionRow[]; paid: CommissionRow[] }> {
  const admin = createAdminClient();
  const settings = await getSettings();
  const people = ((settings.commission_people ?? []) as string[]).map(String);
  // ONE commission per job: quotations only (an estimate's commission moves over when it becomes the
  // job's quotation), never a superseded tombstone, and - belt and braces - one row per job here too.
  const { data: qs } = await admin
    .from("quotations")
    .select(`id, number, version, job_id, commission_to, commission_aed, commission_status, commission_set_by, commission_set_at, commission_decided_at, commission_decision_note, commission_paid_at, commission_paid_by, commission_paid_method, commission_paid_note, created_at, job:jobs!quotations_job_id_fkey(job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)))`)
    .eq("is_active", true)
    .eq("kind", "quotation")
    .not("job_id", "is", null)
    .not("commission_to", "is", null)
    .gt("commission_aed", 0)
    .order("commission_set_at", { ascending: false })
    .limit(400);
  const all = ((qs ?? []) as unknown as Record<string, unknown>[]).filter((r) => (r.commission_status as string | null) !== "superseded");
  // Newest version per job wins; older leftovers never show (and never offer a second "Mark paid").
  const byJob = new Map<string, Record<string, unknown>>();
  const rank = (r: Record<string, unknown>) => `${r.commission_paid_at ? 1 : 0}·${String(Number(r.version)).padStart(4, "0")}·${r.created_at}`;
  for (const r of all) {
    const k = r.job_id as string;
    const have = byJob.get(k);
    if (!have || rank(r) > rank(have)) byJob.set(k, r);
  }
  const rows = Array.from(byJob.values());
  const jobIds = Array.from(new Set(rows.map((r) => r.job_id as string | null).filter((x): x is string => !!x)));
  const [{ data: invRaw }, { data: paysRaw }, { data: cnotes }, { data: staffRows }] = await Promise.all([
    jobIds.length ? admin.from("invoices").select("*").in("job_id", jobIds).eq("is_active", true).eq("status", "issued").eq("kind", "tax_invoice").is("converted_to", null) : Promise.resolve({ data: [] }),
    jobIds.length ? admin.from("payments").select(PAYMENT_SELECT).in("job_id", jobIds).eq("is_active", true) : Promise.resolve({ data: [] }),
    jobIds.length ? admin.from("invoices").select("job_id").in("job_id", jobIds).eq("is_active", true).eq("kind", "credit_note") : Promise.resolve({ data: [] }),
    admin.from("staff").select("id, display_name"),
  ]);
  const names = new Map(((staffRows ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  const invByJob = new Map<string, Record<string, unknown>[]>();
  for (const i of (invRaw ?? []) as Record<string, unknown>[]) invByJob.set(i.job_id as string, [...(invByJob.get(i.job_id as string) ?? []), i]);
  const paysByInvoice = new Map<string, Record<string, unknown>[]>();
  for (const p of (paysRaw ?? []) as Record<string, unknown>[]) if (p.invoice_id) paysByInvoice.set(p.invoice_id as string, [...(paysByInvoice.get(p.invoice_id as string) ?? []), p]);
  const creditByJob = new Map<string, number>();
  for (const c of (cnotes ?? []) as { job_id: string | null }[]) if (c.job_id) creditByJob.set(c.job_id, (creditByJob.get(c.job_id) ?? 0) + 1);

  const out: CommissionRow[] = rows
    .filter((r) => (r.commission_status as string | null) !== "declined")
    .map((r) => {
      const job = r.job as { job_number: string; vehicle: (Parameters<typeof formatPlate>[0] & { model_year?: number | null; make?: { name: string } | null; model?: { name: string } | null }) | null } | null;
      const invs = r.job_id ? (invByJob.get(r.job_id as string) ?? []) : [];
      let invoiceNumber: string | null = null;
      let customerPaid = false;
      let why = "No tax invoice yet";
      if (invs.length) {
        const inv = toInvoice(invs[0]);
        invoiceNumber = inv.number;
        const bal = invoiceBalance(inv, (paysByInvoice.get(inv.id) ?? []).map(toPayment));
        customerPaid = bal.balance <= 0.005;
        why = customerPaid ? "Invoice paid in full" : `${inv.number} still owes AED ${bal.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
      }
      const status: CommissionRow["status"] = r.commission_paid_at ? "paid" : (r.commission_status as string | null) === "pending" ? "pending" : "approved";
      return {
        quotationId: r.id as string,
        quotation: r.number as string,
        version: Number(r.version) || 1,
        jobId: (r.job_id as string | null) ?? null,
        jobNumber: job?.job_number ?? "",
        plate: job?.vehicle ? formatPlate(job.vehicle) : (job?.job_number ?? ""),
        carTitle: [job?.vehicle?.make?.name, job?.vehicle?.model?.name, job?.vehicle?.model_year].filter(Boolean).join(" "),
        recipient: String(r.commission_to ?? ""),
        phone: recipientPhone(String(r.commission_to ?? ""), people),
        amount: Number(r.commission_aed) || 0,
        invoiceNumber,
        customerPaid,
        customerPaidWhy: why,
        setByName: r.commission_set_by ? (names.get(r.commission_set_by as string) ?? null) : null,
        setAt: (r.commission_set_at as string | null) ?? null,
        status,
        decidedAt: (r.commission_decided_at as string | null) ?? null,
        decisionNote: (r.commission_decision_note as string | null) ?? null,
        paidAt: (r.commission_paid_at as string | null) ?? null,
        paidByName: r.commission_paid_by ? (names.get(r.commission_paid_by as string) ?? null) : null,
        paidMethod: (r.commission_paid_method as string | null) ?? null,
        paidNote: (r.commission_paid_note as string | null) ?? null,
        creditNotes: r.job_id ? (creditByJob.get(r.job_id as string) ?? 0) : 0,
      };
    });
  return {
    pending: out.filter((r) => r.status === "pending"),
    toPay: out.filter((r) => r.status === "approved"),
    paid: out.filter((r) => r.status === "paid"),
  };
}

/** The payable ones (approved AND the customer's invoice paid in full), for Mathew's Waiting on you. */
export async function payableCommissions(): Promise<CommissionRow[]> {
  const { toPay } = await loadCommissions();
  return toPay.filter((r) => r.customerPaid);
}
