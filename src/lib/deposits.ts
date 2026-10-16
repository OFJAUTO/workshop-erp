import "server-only";
import { PAYMENT_SELECT, toPayment, type PaymentRow } from "./invoice-data";
import { round2 } from "./money";
import { notifyRoles } from "./notifications";
import { approvedQuotations } from "./quote-data";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

export type DepositState = {
  /** What the approved quotation(s) asked for. */
  required: number;
  /** Recorded payments on the job (cleared cheques only), deposits and invoice payments alike. */
  received: number;
  short: boolean;
  quotationNumbers: string[];
  quotationTotal: number;
  quotationId: string | null;
};

const PLATE_SELECT = "kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant";
type PlateRow = Parameters<typeof formatPlate>[0];

/** The deposit asked for on the job's approved quotation(s) and what has arrived so far. */
export async function depositState(jobId: string): Promise<DepositState> {
  const admin = createAdminClient();
  const [qs, { data: pays }] = await Promise.all([approvedQuotations(jobId), admin.from("payments").select(PAYMENT_SELECT).eq("job_id", jobId).eq("is_active", true)]);
  const required = round2(qs.reduce((a, q) => a + (Number(q.deposit_aed) || 0), 0));
  const received = round2(((pays ?? []) as Record<string, unknown>[]).map(toPayment).filter((p) => p.status === "recorded" && (p.method !== "cheque" || p.cheque_status === "cleared")).reduce((a, p) => a + p.amount_aed, 0));
  return {
    required,
    received,
    short: required > 0 && received + 0.005 < required,
    quotationNumbers: qs.map((q) => q.number),
    quotationTotal: round2(qs.reduce((a, q) => a + (Number(q.total_aed) || 0), 0)),
    quotationId: qs[0]?.id ?? null,
  };
}

/** The words for the LPO page and the refusal: "Deposit AED 28,027 not received yet (AED 5,000 received so far)." */
export function depositShortText(st: DepositState): string | null {
  if (!st.short) return null;
  return `Deposit AED ${st.required.toLocaleString("en-GB")} not received yet${st.received > 0 ? ` (AED ${st.received.toLocaleString("en-GB")} received so far)` : ""}.`;
}

export type DepositWaiting = {
  quotationId: string;
  quotation: string;
  jobId: string;
  jobNumber: string;
  plate: string;
  customer: string;
  required: number;
  received: number;
  approvedAt: string | null;
  hours: number;
  reminded: boolean;
  advisorIds: string[];
};

/** Approved quotations whose deposit has not arrived, on open jobs: the owner's dashboard list and the daily reminder. */
export async function depositsWaiting(): Promise<DepositWaiting[]> {
  const admin = createAdminClient();
  const { data: qs } = await admin.from("quotations").select("id, number, job_id, deposit_aed, responded_at, deposit_reminded_at, created_by, sent_by").eq("kind", "quotation").eq("status", "approved").eq("is_active", true).gt("deposit_aed", 0);
  const rows = (qs ?? []).filter((q) => q.job_id);
  if (!rows.length) return [];
  const jobIds = Array.from(new Set(rows.map((q) => q.job_id as string)));
  const [{ data: jobs }, { data: pays }] = await Promise.all([
    admin.from("jobs").select(`id, job_number, is_open, gated_in_by, customer:customers(full_name, company_name), vehicle:vehicles(${PLATE_SELECT})`).in("id", jobIds),
    admin.from("payments").select(PAYMENT_SELECT).in("job_id", jobIds).eq("is_active", true),
  ]);
  const payments = ((pays ?? []) as Record<string, unknown>[]).map(toPayment).filter((p) => p.status === "recorded" && (p.method !== "cheque" || p.cheque_status === "cleared"));
  const out: DepositWaiting[] = [];
  for (const j of (jobs ?? []) as unknown as { id: string; job_number: string; is_open: boolean; gated_in_by: string | null; customer: { full_name: string; company_name: string | null } | null; vehicle: PlateRow | null }[]) {
    if (!j.is_open) continue;
    const mine = rows.filter((q) => q.job_id === j.id);
    const required = round2(mine.reduce((a, q) => a + (Number(q.deposit_aed) || 0), 0));
    const received = round2(payments.filter((p) => p.job_id === j.id).reduce((a, p) => a + p.amount_aed, 0));
    if (received + 0.005 >= required) continue;
    const first = mine[0];
    const approvedAt = (first.responded_at as string | null) ?? null;
    out.push({
      quotationId: first.id,
      quotation: mine.map((q) => q.number).join(", "),
      jobId: j.id,
      jobNumber: j.job_number,
      plate: j.vehicle ? formatPlate(j.vehicle) : j.job_number,
      customer: j.customer?.company_name ?? j.customer?.full_name ?? "Customer",
      required,
      received,
      approvedAt,
      hours: approvedAt ? Math.floor((Date.now() - Date.parse(approvedAt)) / 3600000) : 0,
      reminded: mine.every((q) => !!q.deposit_reminded_at),
      advisorIds: Array.from(new Set([j.gated_in_by, ...mine.map((q) => q.created_by as string | null), ...mine.map((q) => q.sent_by as string | null)].filter((x): x is string => !!x))),
    });
  }
  return out.sort((a, b) => b.hours - a.hours);
}

export type DepositNotInvoiced = PaymentRow & { jobNumber: string; plate: string; customer: string };

/** Deposits recorded on the job before any proforma or invoice exists (accounts: still to be applied to an invoice). */
export async function depositsNotInvoiced(): Promise<DepositNotInvoiced[]> {
  const admin = createAdminClient();
  const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).is("invoice_id", null).eq("is_active", true).eq("status", "recorded").not("job_id", "is", null).order("received_at", { ascending: false });
  const rows = ((pays ?? []) as Record<string, unknown>[]).map(toPayment);
  if (!rows.length) return [];
  const { data: jobs } = await admin.from("jobs").select(`id, job_number, customer:customers(full_name, company_name), vehicle:vehicles(${PLATE_SELECT})`).in("id", Array.from(new Set(rows.map((p) => p.job_id as string))));
  const byId = new Map(((jobs ?? []) as unknown as { id: string; job_number: string; customer: { full_name: string; company_name: string | null } | null; vehicle: PlateRow | null }[]).map((j) => [j.id, j]));
  return rows.map((p) => {
    const j = byId.get(p.job_id as string);
    return { ...p, jobNumber: j?.job_number ?? "", plate: j?.vehicle ? formatPlate(j.vehicle) : (j?.job_number ?? ""), customer: j?.customer?.company_name ?? j?.customer?.full_name ?? "Customer" };
  });
}

/** An LPO sent for approval while the deposit has not arrived: the owner is told once, with the override on the LPO page. */
export async function warnOwnerIfDepositShort(jobId: string, poId: string, poNumber: string) {
  const st = await depositState(jobId);
  if (!st.short) return false;
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select(`job_number, vehicle:vehicles(${PLATE_SELECT})`).eq("id", jobId).maybeSingle();
  const vehicle = (job?.vehicle as unknown as PlateRow | null) ?? null;
  const plate = vehicle ? formatPlate(vehicle) : (job?.job_number ?? "");
  await notifyRoles(["owner"], {
    type: "lpo_waiting_deposit",
    title: `LPO waiting, deposit not received: override? · ${plate}`,
    body: `${poNumber}: deposit AED ${st.required.toLocaleString("en-GB")} asked on ${st.quotationNumbers.join(", ")}, AED ${st.received.toLocaleString("en-GB")} received. Open the LPO to approve with a reason (override), or wait for the deposit.`,
    jobId,
    href: `/parts/orders/${poId}`,
  });
  await admin.from("purchase_orders").update({ deposit_waiting_notified_at: new Date().toISOString() }).eq("id", poId);
  return true;
}
