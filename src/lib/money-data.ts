import "server-only";
import { signCarPictures } from "./car-pictures";
import { INVOICE_SELECT, PAYMENT_SELECT, invoiceBalance, toInvoice, toPayment, type InvoiceRow, type PaymentRow } from "./invoice-data";
import { dubaiDate } from "./jobs";
import { round2 } from "./money";
import { moneyState, type MoneyInvoice, type MoneyState } from "./money-steps";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

/** One car on the money screens: the car, the customer, the invoices, the balance and the money step. */
export type MoneyRowData = {
  jobId: string;
  jobNumber: string;
  jobStatus: string;
  isOpen: boolean;
  plate: string;
  car: string;
  customer: string;
  pictureUrl: string | null;
  proforma: (MoneyInvoice & { total_aed: number }) | null;
  taxInvoice: (MoneyInvoice & { total_aed: number }) | null;
  creditNotes: InvoiceRow[];
  total: number;
  paid: number;
  balance: number;
  state: MoneyState;
  /** When the live document was issued, and the last money movement, for sorting and date filters. */
  issuedAt: string;
  lastAt: string;
  paidAt: string | null;
};

type InvJoin = Record<string, unknown> & {
  job: { id: string; job_number: string; status: string; is_open: boolean; gated_out_at: string | null; declined_out_at: string | null; customer_id: string; vehicle: VehicleJoin | null } | null;
  customer: { full_name: string; company_name: string | null; credit_terms_days: number | null } | null;
};
type VehicleJoin = { kind: string | null; photo_path: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };

const INV_JOIN = INVOICE_SELECT + ", expected_payment_method, customer_says_paid_at, pay_now_enabled, sent_at, job:jobs!invoices_job_id_fkey(id, job_number, status, is_open, gated_out_at, declined_out_at, customer_id, vehicle:vehicles(kind, photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name))), customer:customers(full_name, company_name, credit_terms_days)";

/** Dubai midnight of a date as an ISO instant. */
export function dayStartIso(date: string) {
  return new Date(`${date}T00:00:00+04:00`).toISOString();
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The money rows: every open car from Ready onwards (scope "open"), or every car with an invoice issued in a
 * date range (scope "range"). One row per job, with its live proforma or tax invoice and the step it is at.
 */
export async function loadMoneyRows(settings: Settings, opts: { scope: "open" | "range"; from?: string; to?: string } = { scope: "open" }): Promise<MoneyRowData[]> {
  const admin = createAdminClient();
  let q = admin.from("invoices").select(INV_JOIN).eq("is_active", true).order("issued_at", { ascending: false }).limit(600);
  if (opts.scope === "range") {
    if (opts.from) q = q.gte("issued_at", dayStartIso(opts.from));
    if (opts.to) q = q.lt("issued_at", dayStartIso(addDays(opts.to, 1)));
  }
  const { data: invRows } = await q;
  const invoices = ((invRows ?? []) as unknown as InvJoin[]).map((r) => ({ inv: toInvoice(r) as InvoiceRow & { expected_payment_method: string | null; customer_says_paid_at: string | null; pay_now_enabled: boolean; sent_at: string | null }, job: r.job, customer: r.customer }));
  // Open cars from Ready onwards without an invoice yet (the proforma still to prepare).
  const byJob = new Map<string, typeof invoices>();
  for (const i of invoices) if (i.job) byJob.set(i.job.id, [...(byJob.get(i.job.id) ?? []), i]);
  const jobsExtra: InvJoin["job"][] = [];
  const customersExtra = new Map<string, InvJoin["customer"]>();
  if (opts.scope === "open") {
    const { data: ready } = await admin.from("jobs").select("id, job_number, status, is_open, gated_out_at, declined_out_at, customer_id, vehicle:vehicles(kind, photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), customer:customers(full_name, company_name, credit_terms_days)").eq("is_open", true).in("status", ["ready", "pending_payment", "in_delivery"]);
    for (const j of (ready ?? []) as unknown as (NonNullable<InvJoin["job"]> & { customer: InvJoin["customer"] })[]) {
      if (!byJob.has(j.id)) {
        jobsExtra.push(j);
        customersExtra.set(j.id, j.customer);
      }
    }
  }
  const liveIds = invoices.filter((i) => i.inv.status === "issued" && (i.inv.kind === "tax_invoice" || (i.inv.kind === "proforma" && !i.inv.converted_to))).map((i) => i.inv.id);
  const [{ data: payRows }, { data: approved }, pictures] = await Promise.all([
    liveIds.length ? admin.from("payments").select(PAYMENT_SELECT).in("invoice_id", liveIds).eq("is_active", true) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    jobsExtra.length ? admin.from("quotations").select("job_id").in("job_id", jobsExtra.map((j) => j!.id)).eq("status", "approved").eq("is_active", true) : Promise.resolve({ data: [] as { job_id: string }[] }),
    signCarPictures([...invoices.map((i) => i.job?.vehicle?.photo_path), ...jobsExtra.map((j) => j?.vehicle?.photo_path)]),
  ]);
  const payments = ((payRows ?? []) as Record<string, unknown>[]).map(toPayment);
  const approvedJobs = new Set(((approved ?? []) as { job_id: string }[]).map((a) => a.job_id));
  const waitingHours = Number(settings.payment_waiting_hours) || 24;
  const now = Date.now();
  const rows: MoneyRowData[] = [];
  const build = (job: NonNullable<InvJoin["job"]>, customer: InvJoin["customer"], invs: typeof invoices): MoneyRowData => {
    const live = invs.map((i) => i.inv).filter((i) => i.status === "issued");
    const taxInvoice = live.find((i) => i.kind === "tax_invoice") ?? null;
    const proforma = live.find((i) => i.kind === "proforma" && !i.converted_to && !i.deposit_for_quotation_id) ?? null;
    const doc = taxInvoice ?? proforma;
    const pays = doc ? payments.filter((p) => p.invoice_id === doc.id) : [];
    const bal = doc ? invoiceBalance(doc, pays) : null;
    const state = moneyState({
      jobStatus: job.status,
      isOpen: job.is_open,
      gatedOutAt: job.gated_out_at,
      proforma,
      taxInvoice,
      total: doc?.total_aed ?? 0,
      paid: bal?.paid ?? 0,
      balance: bal?.balance ?? 0,
      chequePending: bal?.pendingAmount ?? 0,
      needsInvoice: approvedJobs.has(job.id),
      creditDays: Number(customer?.credit_terms_days) || 0,
      declinedOut: !!job.declined_out_at,
      now,
      waitingHours,
    });
    const lastAt = [doc?.issued_at, doc?.sent_at, ...pays.map((p: PaymentRow) => p.received_at)].filter((x): x is string => !!x).sort().at(-1) ?? doc?.issued_at ?? new Date(now).toISOString();
    const v = job.vehicle;
    return {
      jobId: job.id,
      jobNumber: job.job_number,
      jobStatus: job.status,
      isOpen: job.is_open,
      plate: v ? formatPlate(v) : job.job_number,
      car: [v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" "),
      customer: customer?.company_name ?? customer?.full_name ?? "",
      pictureUrl: v?.photo_path ? (pictures.get(v.photo_path) ?? null) : null,
      proforma,
      taxInvoice,
      creditNotes: live.filter((i) => i.kind === "credit_note"),
      total: doc?.total_aed ?? 0,
      paid: bal?.paid ?? 0,
      balance: bal?.balance ?? 0,
      state,
      issuedAt: doc?.issued_at ?? new Date(now).toISOString(),
      lastAt,
      paidAt: bal?.paidAt ?? null,
    };
  };
  for (const [jobId, invs] of byJob) {
    const job = invs[0].job!;
    if (opts.scope === "open" && !job.is_open) continue;
    rows.push(build(job, invs[0].customer, invs));
    void jobId;
  }
  for (const j of jobsExtra) rows.push(build(j!, customersExtra.get(j!.id) ?? null, []));
  // Invoices without a job (rare: a credit note or a manual document) are left out of the car rows.
  rows.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  return rows;
}

export type MoneyTiles = {
  awaitingCount: number;
  awaitingAed: number;
  collectedToday: number;
  collectedMonth: number;
  taxInvoicesToday: number;
  lposWaiting: number;
  supplierInvoicesToCheck: number;
};

/** The figures across the top of the accounts screens. */
export async function loadMoneyTiles(rows: MoneyRowData[]): Promise<MoneyTiles> {
  const admin = createAdminClient();
  const today = dubaiDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [{ data: pays }, { count: taxToday }, { count: lpos }, { count: toFollow }, { count: mismatches }] = await Promise.all([
    admin.from("payments").select("amount_aed, method, cheque_status, status, received_at").gte("received_at", dayStartIso(monthStart)).eq("is_active", true).eq("status", "recorded"),
    admin.from("invoices").select("id", { count: "exact", head: true }).eq("kind", "tax_invoice").eq("is_active", true).gte("issued_at", dayStartIso(today)),
    admin.from("purchase_orders").select("id", { count: "exact", head: true }).eq("status", "pending_approval").eq("is_active", true),
    admin.from("purchase_orders").select("id", { count: "exact", head: true }).eq("supplier_invoice_status", "to_follow").eq("is_active", true).neq("status", "cancelled"),
    admin.from("purchase_order_lines").select("id", { count: "exact", head: true }).eq("invoice_check", "mismatch").eq("is_active", true),
  ]);
  const counted = ((pays ?? []) as { amount_aed: number | string; method: string; cheque_status: string | null; received_at: string }[]).filter((p) => p.method !== "cheque" || p.cheque_status === "cleared");
  const todayStart = dayStartIso(today);
  const awaiting = rows.filter((r) => r.isOpen && r.state.current === "payment" && r.balance > 0.005);
  return {
    awaitingCount: awaiting.length,
    awaitingAed: round2(awaiting.reduce((a, r) => a + r.balance, 0)),
    collectedToday: round2(counted.filter((p) => p.received_at >= todayStart).reduce((a, p) => a + Number(p.amount_aed), 0)),
    collectedMonth: round2(counted.reduce((a, p) => a + Number(p.amount_aed), 0)),
    taxInvoicesToday: taxToday ?? 0,
    lposWaiting: lpos ?? 0,
    supplierInvoicesToCheck: (toFollow ?? 0) + (mismatches ?? 0),
  };
}

export type CounterPayment = PaymentRow & { byName: string; byRole: string; invoiceNumber: string | null; jobId: string | null; plate: string | null };

/** Payments recorded at the counter by an advisor that accounts have not confirmed yet. */
export async function loadCounterPaymentsToConfirm(): Promise<CounterPayment[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("payments").select(PAYMENT_SELECT + ", by:staff!payments_received_by_fkey(display_name, role_id), invoice:invoices(number), job:jobs(id, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin))").eq("is_active", true).eq("status", "recorded").is("verified_at", null).order("received_at", { ascending: false }).limit(100);
  return ((data ?? []) as unknown as (Record<string, unknown> & { by: { display_name: string; role_id: string } | null; invoice: { number: string } | null; job: { id: string; vehicle: Parameters<typeof formatPlate>[0] | null } | null })[])
    .filter((r) => r.by && r.by.role_id !== "owner" && r.by.role_id !== "accounts")
    .map((r) => ({ ...toPayment(r), byName: r.by?.display_name ?? "", byRole: r.by?.role_id ?? "", invoiceNumber: r.invoice?.number ?? null, jobId: r.job?.id ?? null, plate: r.job?.vehicle ? formatPlate(r.job.vehicle) : null }));
}
