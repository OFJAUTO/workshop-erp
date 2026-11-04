import "server-only";
import { supplierInvoicesToCheckCount } from "./supplier-invoices";
import { signCarPictures } from "./car-pictures";
import { INVOICE_SELECT, PAYMENT_SELECT, creditsOnDocs, toInvoice, toPayment, type InvoiceRow, type PaymentRow } from "./invoice-data";
import { dubaiDate } from "./jobs";
import { round2 } from "./money";
import { moneyState, type MoneyInvoice, type MoneyState } from "./money-steps";
import { countsAsCollected, moneyTilesOf, recentlyPaid, rowMatches, type AuthMissingPayment, type CollectedPayment, type MoneyListTiles, type MoneyRowData } from "./money-list";
import { authCodeMissing, authMissingFilter } from "./auth-code";
import { jobMoneyMany, liveDocOf, unallocatedOf, type JobMoneyFacts } from "./customer-money";
import { customerName } from "./customer-view";
import { loadChargeEntries } from "./charges";
import { loadEstimateMoneyRows } from "./estimate-money";
import { pageAll, pageAllIn } from "./page-all";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

export type { MoneyRowData } from "./money-list";

/**
 * Invoices and payments (3 November 2026, section 4): THE list of every job with money paid or owed, and the tiles made
 * from it. Before this the list was built from invoices only, so an advance before the proforma (J-00969's AED 30,000)
 * was in "Collected today" and in no row: "Part paid · 0", "Awaiting payment AED 0".
 *
 * A job is a row when it is open and has any payment, an approved quotation, a live proforma or tax invoice (a deposit
 * document too) or stands at Ready / waiting for payment / in delivery; when it has an advance with no invoice; when it
 * left with its invoice still owing (credit notes taken off), or paid in full in the last RECENT_PAID_DAYS days; and,
 * whatever its state, when money came in today or a tax invoice was issued today. Its figures are THE job money rule
 * (jobMoneyMany): the live document's balance less its credit notes, or before it the approved total less every advance.
 * Customers' credit not allocated and pending charges are rows of their own.
 */

type Vehicle = { id: string; kind: string | null; photo_path: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };
type JobRow = JobMoneyFacts & { gated_in_at: string | null; declined_out_at: string | null; vehicle: Vehicle | null; customer: { full_name: string | null; company_name: string | null; credit_terms_days: number | null } | null };
const JOB_COLS = "id, job_number, status, is_open, gated_out_at, gated_in_at, declined_out_at, customer_id, vehicle_id, vehicle:vehicles(id, kind, photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), customer:customers(full_name, company_name, credit_terms_days)";
type ListInvoice = InvoiceRow & { expected_payment_method: string | null; customer_says_paid_at: string | null; pay_now_enabled: boolean; sent_at: string | null };
const INV_COLS = INVOICE_SELECT + ", expected_payment_method, customer_says_paid_at, pay_now_enabled, sent_at";
const toListInvoice = (r: Record<string, unknown>): ListInvoice => ({ ...toInvoice(r), expected_payment_method: (r.expected_payment_method as string | null) ?? null, customer_says_paid_at: (r.customer_says_paid_at as string | null) ?? null, pay_now_enabled: !!r.pay_now_enabled, sent_at: (r.sent_at as string | null) ?? null });
type LightPay = CollectedPayment & { id: string; job_id: string | null; invoice_id: string | null; customer_id: string; amount_aed: number | string };
const LIGHT_PAY = "id, job_id, invoice_id, customer_id, amount_aed, method, cheque_status, status, is_active, received_at, cleared_at";
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
type MissingPay = { id: string; number: string; job_id: string | null; invoice_id: string | null; customer_id: string; method: string; amount_aed: number | string; received_at: string; auth_code: string | null };
const MISSING_PAY = "id, number, job_id, invoice_id, customer_id, method, amount_aed, received_at, auth_code";

/** Dubai midnight of a date as an ISO instant. */
export function dayStartIso(date: string) {
  return new Date(`${date}T00:00:00+04:00`).toISOString();
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type MoneyListScope = { scope: "now" } | { scope: "range"; from: string; to: string } | { scope: "search"; q: string };

/** A synthetic step for the rows that are not a job (credit, pending charge): only the chip is read. */
const plainState = (text: string, tone: MoneyState["chip"]["tone"]): MoneyState => ({ current: "payment", done: [], chip: { text, tone }, action: "none", actionLabel: "", waitingHours: null, live: null });
const aedWords = (n: number) => `AED ${round2(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * THE money list. Scope "now" (the default page, the tiles, the accounts dashboard), "range" (history: every job with a
 * document issued between two dates, nothing else) or "search" (what the search box found: jobs by plate, VIN, job or
 * document number, customer name or mobile, any time; and those customers' credit and pending charges).
 */
export async function loadMoneyList(settings: Settings, opts: MoneyListScope = { scope: "now" }): Promise<MoneyRowData[]> {
  const admin = createAdminClient();
  const today = dubaiDate();
  const todayStart = dayStartIso(today);
  const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);

  // Today's money and today's tax invoices: every row carries its own "today", in every scope.
  const [todayPays, taxTodayRows] = await Promise.all([
    safe(pageAll<LightPay>((a, b) => admin.from("payments").select(LIGHT_PAY).eq("is_active", true).eq("status", "recorded").or(`received_at.gte.${todayStart},cleared_at.gte.${todayStart}`).order("id").range(a, b) as unknown as Page<LightPay>)),
    safe(pageAll<{ id: string; number: string; job_id: string | null }>((a, b) => admin.from("invoices").select("id, number, job_id").eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true).is("deposit_for_quotation_id", null).gte("issued_at", todayStart).order("id").range(a, b) as unknown as Page<{ id: string; number: string; job_id: string | null }>)),
  ]);
  const collected = todayPays.filter((p) => countsAsCollected(p, todayStart));

  // 3 November 2026 (section 5): every card or payment-link payment saved without a real auth code (empty or made up),
  // by job, by invoice (a pending charge) and by customer (money not allocated). Its row carries the amber flag, and in the
  // list without dates its job is a row until the code is added.
  const missingPays = (await safe(pageAll<MissingPay>((a, b) => admin.from("payments").select(MISSING_PAY).eq("is_active", true).in("status", ["recorded", "pending_owner"]).in("method", ["card", "link"]).or(authMissingFilter()).order("id").range(a, b) as unknown as Page<MissingPay>))).filter((p) => authCodeMissing(p));
  const missingOfJob = new Map<string, AuthMissingPayment[]>();
  const missingOfInvoice = new Map<string, AuthMissingPayment[]>();
  const missingOfCustomer = new Map<string, AuthMissingPayment[]>();
  const into = (m: Map<string, AuthMissingPayment[]>, k: string, p: MissingPay) => m.set(k, [...(m.get(k) ?? []), { id: p.id, number: p.number, method: p.method, amount: round2(Number(p.amount_aed) || 0), receivedAt: p.received_at, code: p.auth_code }]);
  for (const p of missingPays) {
    if (p.job_id) into(missingOfJob, p.job_id, p);
    else if (p.invoice_id) into(missingOfInvoice, p.invoice_id, p);
    else into(missingOfCustomer, p.customer_id, p);
  }

  // The candidate jobs of the scope, with what is already read about them. Today's money and tax invoices make a job a
  // candidate in the "now" list only: the history list keeps to its dates, the search to what it found (review, 3 Nov).
  const candidates = new Set<string>();
  if (opts.scope === "now") {
    for (const p of collected) if (p.job_id) candidates.add(p.job_id);
    for (const t of taxTodayRows) if (t.job_id) candidates.add(t.job_id);
    for (const jobId of missingOfJob.keys()) candidates.add(jobId);
  }
  let preInvoices: ListInvoice[] = [];
  let prePayments: PaymentRow[] = [];
  const preLoaded = new Set<string>();
  let rangeInvoiceIds = new Set<string>();
  // Cars that left paid in full lately (the "now" list keeps them for RECENT_PAID_DAYS: Paid, Tax invoices, Released).
  const recentPaid = new Set<string>();
  let found: SearchMatches = { jobIds: [], customerIds: new Set(), vehicleIds: new Set() };
  const reported = await import("./payment-reports").then((m) => m.waitingReportByJob()).catch(() => new Map<string, { by: string; amount: number }>());

  if (opts.scope === "now") {
    const openJobs = await safe(pageAll<{ id: string; status: string }>((a, b) => admin.from("jobs").select("id, status").eq("is_open", true).order("id").range(a, b) as unknown as Page<{ id: string; status: string }>));
    const openIds = openJobs.map((j) => j.id);
    type ClosedDoc = { id: string; job_id: string; kind: string; total_aed: number | string; issued_at: string };
    const [openPays, openInvs, approvedRows, advanceRows, closedDocs] = await Promise.all([
      safe(pageAllIn<Record<string, unknown>>(openIds, (ids, a, b) => admin.from("payments").select(PAYMENT_SELECT).in("job_id", ids).eq("is_active", true).order("id").range(a, b))).then((r) => r.map(toPayment)),
      safe(pageAllIn<Record<string, unknown>>(openIds, (ids, a, b) => admin.from("invoices").select(INV_COLS).in("job_id", ids).eq("is_active", true).order("issued_at", { ascending: false }).order("id").range(a, b) as unknown as Page<Record<string, unknown>>)).then((r) => r.map(toListInvoice)),
      safe(pageAllIn<{ job_id: string }>(openIds, (ids, a, b) => admin.from("quotations").select("job_id").in("job_id", ids).eq("kind", "quotation").eq("status", "approved").eq("is_active", true).order("id").range(a, b) as unknown as Page<{ job_id: string }>)),
      // Advances still waiting for their invoice, on any job (a closed job's advance with no invoice is money to place).
      safe(pageAll<{ job_id: string }>((a, b) => admin.from("payments").select("job_id").is("invoice_id", null).not("job_id", "is", null).eq("is_active", true).eq("status", "recorded").order("id").range(a, b) as unknown as Page<{ job_id: string }>)),
      // Every live document of a job that has left: the ones still owing are rows.
      safe(pageAll<ClosedDoc>((a, b) => admin.from("invoices").select("id, job_id, kind, total_aed, issued_at, job:jobs!invoices_job_id_fkey!inner(is_open)").eq("job.is_open", false).eq("is_active", true).eq("status", "issued").in("kind", ["proforma", "tax_invoice"]).is("converted_to", null).is("deposit_for_quotation_id", null).order("id").range(a, b) as unknown as Page<ClosedDoc>)),
    ]);
    const statusOf = new Map(openJobs.map((j) => [j.id, j.status]));
    const hasApproved = new Set(approvedRows.map((r) => r.job_id));
    for (const id of openIds) {
      const live = openInvs.some((i) => i.job_id === id && i.status === "issued" && !i.converted_to && (i.kind === "proforma" || i.kind === "tax_invoice"));
      const anyPay = openPays.some((p) => p.job_id === id && (p.status === "recorded" || p.status === "pending_owner"));
      if (anyPay || live || hasApproved.has(id) || reported.has(id) || ["ready", "pending_payment", "in_delivery"].includes(statusOf.get(id) ?? "")) candidates.add(id);
    }
    for (const r of advanceRows) candidates.add(r.job_id);
    // A job that left: its live document's balance (cleared money only) decides.
    const docOfJob = new Map<string, ClosedDoc>();
    const byJob = new Map<string, ClosedDoc[]>();
    for (const d of closedDocs) byJob.set(d.job_id, [...(byJob.get(d.job_id) ?? []), d]);
    for (const [jobId, docs] of byJob) {
      const pick = liveDocOf(docs.map((d) => ({ ...d, status: "issued" as const, converted_to: null, deposit_for_quotation_id: null, kind: d.kind as InvoiceRow["kind"] })));
      if (pick) docOfJob.set(jobId, pick);
    }
    const docIds = Array.from(docOfJob.values()).map((d) => d.id);
    const [docPays, docCredits] = await Promise.all([
      safe(pageAllIn<LightPay>(docIds, (ids, a, b) => admin.from("payments").select(LIGHT_PAY).in("invoice_id", ids).eq("is_active", true).eq("status", "recorded").order("id").range(a, b) as unknown as Page<LightPay>)),
      // What credit notes took off a tax invoice is not owed (the same rule as jobMoneyFrom).
      creditsOnDocs(Array.from(docOfJob.values()).filter((d) => d.kind === "tax_invoice").map((d) => d.id)),
    ]);
    const clearedOn = new Map<string, number>();
    const lastMoneyOn = new Map<string, string>();
    for (const p of docPays) if (p.invoice_id && (p.method !== "cheque" || p.cheque_status === "cleared")) {
      clearedOn.set(p.invoice_id, round2((clearedOn.get(p.invoice_id) ?? 0) + Number(p.amount_aed)));
      const at = p.cleared_at ?? p.received_at;
      if (at > (lastMoneyOn.get(p.invoice_id) ?? "")) lastMoneyOn.set(p.invoice_id, at);
    }
    for (const [jobId, d] of docOfJob) {
      if (Number(d.total_aed) - (clearedOn.get(d.id) ?? 0) - (docCredits.get(d.id) ?? 0) > 0.005) candidates.add(jobId);
      else if (recentlyPaid([d.issued_at, lastMoneyOn.get(d.id) ?? ""].sort().at(-1) ?? null, Date.now())) {
        candidates.add(jobId);
        recentPaid.add(jobId);
      }
    }
    preInvoices = openInvs;
    prePayments = openPays;
    for (const id of openIds) preLoaded.add(id);
  } else if (opts.scope === "range") {
    const from = dayStartIso(opts.from || "2020-01-01");
    const to = dayStartIso(addDays(opts.to || today, 1));
    const inRange = await safe(pageAll<{ id: string; job_id: string | null }>((a, b) => admin.from("invoices").select("id, job_id").eq("is_active", true).gte("issued_at", from).lt("issued_at", to).order("id").range(a, b) as unknown as Page<{ id: string; job_id: string | null }>));
    for (const i of inRange) if (i.job_id) candidates.add(i.job_id);
    rangeInvoiceIds = new Set(inRange.map((i) => i.id));
  } else {
    found = await searchMatches(opts.q);
    for (const id of found.jobIds) candidates.add(id);
  }

  // Everything about the candidates that is not read yet: the jobs, their documents (all kinds) and their payments.
  const ids = Array.from(candidates);
  const rest = ids.filter((id) => !preLoaded.has(id));
  const [jobs, moreInvs, morePays] = await Promise.all([
    safe(pageAllIn<JobRow>(ids, (piece, a, b) => admin.from("jobs").select(JOB_COLS).in("id", piece).order("id").range(a, b) as unknown as Page<JobRow>)),
    safe(pageAllIn<Record<string, unknown>>(rest, (piece, a, b) => admin.from("invoices").select(INV_COLS).in("job_id", piece).eq("is_active", true).order("issued_at", { ascending: false }).order("id").range(a, b) as unknown as Page<Record<string, unknown>>)).then((r) => r.map(toListInvoice)),
    safe(pageAllIn<Record<string, unknown>>(rest, (piece, a, b) => admin.from("payments").select(PAYMENT_SELECT).in("job_id", piece).eq("is_active", true).order("id").range(a, b))).then((r) => r.map(toPayment)),
  ]);
  const wanted = new Set(ids);
  const invoices = [...preInvoices.filter((i) => i.job_id && wanted.has(i.job_id)), ...moreInvs];
  const payments = [...prePayments.filter((p) => p.job_id && wanted.has(p.job_id)), ...morePays];
  // THE money rule for every job at once (the documents it reads are the live ones; the drafts only where none stands).
  const money = await jobMoneyMany(ids, settings, { jobs, invoices: invoices.filter((i) => i.status === "issued" && !i.converted_to && (i.kind === "proforma" || i.kind === "tax_invoice")), payments });
  const invOf = new Map<string, ListInvoice[]>();
  for (const i of invoices) if (i.job_id) invOf.set(i.job_id, [...(invOf.get(i.job_id) ?? []), i]);
  const payOf = new Map<string, PaymentRow[]>();
  for (const p of payments) if (p.job_id) payOf.set(p.job_id, [...(payOf.get(p.job_id) ?? []), p]);
  const todayOfJob = new Map<string, { aed: number; count: number }>();
  for (const p of collected) if (p.job_id) {
    const t = todayOfJob.get(p.job_id) ?? { aed: 0, count: 0 };
    todayOfJob.set(p.job_id, { aed: round2(t.aed + Number(p.amount_aed)), count: t.count + 1 });
  }
  const taxTodayOf = new Map<string, string[]>();
  for (const t of taxTodayRows) if (t.job_id) taxTodayOf.set(t.job_id, [...(taxTodayOf.get(t.job_id) ?? []), t.number]);
  const pictures = await signCarPictures(jobs.map((j) => j.vehicle?.photo_path));
  const waitingHours = Number(settings.payment_waiting_hours) || 24;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const rows: MoneyRowData[] = [];

  for (const job of jobs) {
    const jm = money.get(job.id);
    if (!jm) continue;
    const invs = invOf.get(job.id) ?? [];
    const issued = invs.filter((i) => i.status === "issued");
    const taxInvoice = (issued.find((i) => i.kind === "tax_invoice" && !i.deposit_for_quotation_id) ?? null) as (MoneyInvoice & ListInvoice) | null;
    const proforma = (issued.find((i) => i.kind === "proforma" && !i.converted_to && !i.deposit_for_quotation_id) ?? null) as (MoneyInvoice & ListInvoice) | null;
    const doc = taxInvoice ?? proforma;
    const pays = payOf.get(job.id) ?? [];
    const counted = (doc ? pays.filter((p) => p.invoice_id === doc.id) : pays).filter((p) => p.status === "recorded" && (p.method !== "cheque" || p.cheque_status === "cleared"));
    const paidAt = counted.map((p) => p.cleared_at ?? p.received_at).sort().at(-1) ?? null;
    const today = todayOfJob.get(job.id) ?? { aed: 0, count: 0 };
    const taxToday = taxTodayOf.get(job.id) ?? [];
    const report = reported.get(job.id) ?? null;
    const authMissing = missingOfJob.get(job.id) ?? [];
    // A job that left is a row while it still owes, when today's money or tax invoice is on it, or for
    // RECENT_PAID_DAYS after it was paid in full (Paid, Tax invoices and Released keep the recent ones) - and after that
    // while a payment of it still has its auth code missing (3 November 2026).
    const leftWithMoney = (jm.balance ?? 0) > 0.005 || today.aed > 0.005 || taxToday.length > 0 || (!doc && jm.paid > 0.005);
    const recentPaidOnly = opts.scope === "now" && !job.is_open && !leftWithMoney && (recentPaid.has(job.id) || authMissing.length > 0);
    if (opts.scope === "now" && !job.is_open && !leftWithMoney && !recentPaidOnly) continue;
    const state = moneyState({
      jobStatus: job.status,
      isOpen: job.is_open,
      gatedOutAt: job.gated_out_at,
      proforma,
      taxInvoice,
      total: doc?.total_aed ?? 0,
      paid: doc ? jm.paid : 0,
      balance: doc ? (jm.balance ?? 0) : 0,
      chequePending: jm.pendingCheque,
      needsInvoice: !doc && jm.total !== null,
      creditDays: Number(job.customer?.credit_terms_days) || 0,
      declinedOut: !!job.declined_out_at,
      now,
      waitingHours,
      reported: report ? { by: report.by } : null,
      advance: doc ? null : { paid: jm.paid, left: jm.balance },
    });
    const v = job.vehicle;
    const lastAt = [doc?.issued_at, doc?.sent_at, ...pays.map((p) => p.received_at), job.gated_in_at].filter((x): x is string => !!x).sort().at(-1) ?? nowIso;
    rows.push({
      kind: "job",
      key: job.id,
      href: `/jobs/${job.id}/invoice`,
      jobId: job.id,
      jobNumber: job.job_number,
      jobStatus: job.status,
      isOpen: job.is_open,
      plate: v ? formatPlate(v) : job.job_number,
      car: [v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" "),
      customer: job.customer ? customerName(job.customer) : "",
      customerId: job.customer_id,
      pictureUrl: v?.photo_path ? (pictures.get(v.photo_path) ?? null) : null,
      proforma,
      taxInvoice,
      docNumber: doc?.number ?? null,
      total: jm.total,
      paid: jm.paid,
      balance: jm.balance,
      pendingCheque: jm.pendingCheque,
      credited: jm.credited,
      recentPaidOnly,
      advance: doc ? 0 : jm.paid,
      paidToday: today.aed,
      paidTodayCount: today.count,
      taxToday,
      state,
      issuedAt: doc?.issued_at ?? job.gated_in_at ?? nowIso,
      lastAt,
      paidAt,
      reportedBy: report?.by ?? null,
      ageDays: 0,
      what: null,
      authMissing,
    });
  }

  // Customers' money not allocated yet (one row each), in the "now" and search lists.
  if (opts.scope !== "range") {
    const credit = await unallocatedOf().catch(() => []);
    const byCustomer = new Map<string, typeof credit>();
    for (const p of credit.filter((x) => x.status === "recorded")) byCustomer.set(p.customer_id, [...(byCustomer.get(p.customer_id) ?? []), p]);
    for (const [customerId, list] of byCustomer) {
      const paid = round2(list.reduce((a, p) => a + p.amount_aed, 0));
      const todayList = collected.filter((p) => !p.job_id && !p.invoice_id && p.customer_id === customerId);
      const cars = Array.from(new Set(list.map((p) => p.plate).filter((x): x is string => !!x)));
      const age = Math.max(...list.map((p) => p.ageDays));
      const row: MoneyRowData = {
        kind: "credit",
        key: `credit:${customerId}`,
        href: `/customers/${customerId}#money`,
        jobId: "",
        jobNumber: "",
        jobStatus: "",
        isOpen: true,
        plate: cars.join(", "),
        car: list.find((p) => p.car)?.car ?? "",
        customer: list[0].customerName,
        customerId,
        pictureUrl: null,
        proforma: null,
        taxInvoice: null,
        docNumber: list.map((p) => p.number).join(", "),
        total: null,
        paid,
        balance: null,
        pendingCheque: round2(list.filter((p) => p.method === "cheque" && p.cheque_status === "pending").reduce((a, p) => a + p.amount_aed, 0)),
        credited: 0,
        recentPaidOnly: false,
        advance: 0,
        paidToday: round2(todayList.reduce((a, p) => a + Number(p.amount_aed), 0)),
        paidTodayCount: todayList.length,
        taxToday: [],
        state: plainState(`Credit ${aedWords(paid)} · not allocated`, age >= 7 ? "red" : "amber"),
        issuedAt: list.map((p) => p.received_at).sort()[0],
        lastAt: list.map((p) => p.received_at).sort().at(-1) ?? nowIso,
        paidAt: null,
        reportedBy: null,
        ageDays: age,
        what: list.map((p) => p.notes).filter(Boolean).join(" · ") || null,
        authMissing: (missingOfCustomer.get(customerId) ?? []).filter((m) => list.some((p) => p.id === m.id)),
      };
      // A search keeps the credit of a customer it found (name or mobile), of a car it found, or that matches itself.
      if (opts.scope === "search" && !(found.customerIds.has(customerId) || list.some((p) => !!p.vehicle_id && found.vehicleIds.has(p.vehicle_id)) || rowMatches(row, opts.q))) continue;
      rows.push(row);
    }
  }

  // Pending charges with their own proforma: owed until paid, and today's money on them.
  const entries = await loadChargeEntries().catch(() => []);
  for (const e of entries) {
    const docIds = [e.proforma_id, e.tax_invoice_id].filter((x): x is string => !!x);
    if (!docIds.length || e.status === "cancelled") continue;
    const todayList = collected.filter((p) => !p.job_id && p.invoice_id && docIds.includes(p.invoice_id));
    const taxToday = taxTodayRows.filter((t) => !t.job_id && t.id === e.tax_invoice_id).map((t) => t.number);
    const authMissing = docIds.flatMap((id) => missingOfInvoice.get(id) ?? []);
    const keep = opts.scope === "range" ? docIds.some((id) => rangeInvoiceIds.has(id)) : opts.scope === "search" ? true : (e.status === "pending" && e.balance > 0.005) || todayList.length > 0 || taxToday.length > 0 || authMissing.length > 0;
    if (!keep) continue;
    const row: MoneyRowData = {
      kind: "charge",
      key: `charge:${e.id}`,
      href: `/pending-charges?open=${e.id}`,
      jobId: "",
      jobNumber: e.jobNumber ?? "",
      jobStatus: "",
      isOpen: true,
      plate: e.plate ?? "",
      car: e.car ?? "",
      customer: e.customer,
      customerId: e.customer_id,
      pictureUrl: null,
      proforma: null,
      taxInvoice: null,
      docNumber: e.taxNumber ?? e.proformaNumber,
      total: e.total,
      paid: e.paid,
      balance: e.balance,
      pendingCheque: 0,
      credited: 0,
      recentPaidOnly: false,
      advance: 0,
      paidToday: round2(todayList.reduce((a, p) => a + Number(p.amount_aed), 0)),
      paidTodayCount: todayList.length,
      taxToday,
      state: plainState(e.balance > 0.005 ? `Pending charge · ${aedWords(e.balance)} due` : "Pending charge · paid", e.balance > 0.005 ? "amber" : "green"),
      issuedAt: e.created_at,
      lastAt: e.created_at,
      paidAt: null,
      reportedBy: null,
      ageDays: Math.max(0, Math.floor((now - Date.parse(e.created_at)) / 86400000)),
      what: e.what,
      authMissing,
    };
    // A search keeps the charges of a customer or car it found, or one that matches itself (its PRO-/INV- number).
    if (opts.scope === "search" && !(found.customerIds.has(e.customer_id) || (!!e.vehicle_id && found.vehicleIds.has(e.vehicle_id)) || rowMatches(row, opts.q))) continue;
    rows.push(row);
  }

  // 4 November 2026: an estimate paid (or billed) before the car arrives - "Car not here yet · E-00061".
  for (const e of await loadEstimateMoneyRows().catch(() => [])) {
    const todayList = collected.filter((p) => !p.job_id && p.invoice_id && e.docIds.includes(p.invoice_id));
    const taxToday = taxTodayRows.filter((t) => !t.job_id && e.taxIds.includes(t.id)).map((t) => t.number);
    const authMissing = e.docIds.flatMap((id) => missingOfInvoice.get(id) ?? []);
    const keep = opts.scope === "range" ? e.docIds.some((id) => rangeInvoiceIds.has(id)) : opts.scope === "search" ? true : e.balance > 0.005 || todayList.length > 0 || taxToday.length > 0 || authMissing.length > 0 || e.paid > 0.005;
    if (!keep) continue;
    const row: MoneyRowData = {
      kind: "estimate",
      key: `estimate:${e.estimateId}`,
      href: `/estimates/${e.estimateId}`,
      jobId: "",
      jobNumber: e.number,
      jobStatus: "",
      isOpen: true,
      plate: e.plate ?? "",
      car: e.car ?? "",
      customer: e.customer,
      customerId: e.customerId,
      pictureUrl: null,
      proforma: null,
      taxInvoice: null,
      docNumber: e.proformaNumber ?? null,
      total: e.total > 0 ? e.total : null,
      paid: e.paid,
      balance: e.total > 0 ? round2(Math.max(0, e.total - e.paid)) : null,
      pendingCheque: e.pendingCheque,
      credited: 0,
      recentPaidOnly: false,
      advance: 0,
      paidToday: round2(todayList.reduce((a, p) => a + Number(p.amount_aed), 0)),
      paidTodayCount: todayList.length,
      taxToday,
      state: plainState(e.balance > 0.005 ? `Car not here yet · ${e.number} · ${aedWords(e.balance)} due` : `Car not here yet · ${e.number} · paid`, e.balance > 0.005 ? "amber" : "green"),
      issuedAt: e.createdAt,
      lastAt: e.payments.map((p) => p.received_at).sort().at(-1) ?? e.createdAt,
      paidAt: null,
      reportedBy: null,
      ageDays: Math.max(0, Math.floor((now - Date.parse(e.createdAt)) / 86400000)),
      what: `Car not here yet · ${e.number}`,
      authMissing,
    };
    if (opts.scope === "search" && !(found.customerIds.has(e.customerId) || (!!e.vehicleId && found.vehicleIds.has(e.vehicleId)) || rowMatches(row, opts.q))) continue;
    rows.push(row);
  }

  rows.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  return rows;
}

/** What the search box found: the jobs (newest first), and the customers and cars, for the credit and charge rows. */
type SearchMatches = { jobIds: string[]; customerIds: Set<string>; vehicleIds: Set<string> };

/**
 * The search box: job or document number (credit notes and old proformas too), plate or VIN, customer or contact name, or
 * mobile, any time. Everything it finds is a row of the search list as it stands; the page never filters it again.
 */
async function searchMatches(q: string): Promise<SearchMatches> {
  const { cleanNeedle, vehicleOrFilter } = await import("./plate-search");
  const needle = cleanNeedle(q);
  if (needle.length < 2) return { jobIds: [], customerIds: new Set(), vehicleIds: new Set() };
  const admin = createAdminClient();
  const like = `%${needle}%`;
  const digits = needle.replace(/\D/g, "");
  const [{ data: byNumber }, { data: byDoc }, { data: cars }, { data: custs }, { data: phones }] = await Promise.all([
    admin.from("jobs").select("id").ilike("job_number", like).limit(40),
    admin.from("invoices").select("job_id").ilike("number", like).not("job_id", "is", null).limit(40),
    admin.from("vehicles").select("id").or(vehicleOrFilter(needle)).limit(20),
    admin.from("customers").select("id").or(`full_name.ilike.${like},company_name.ilike.${like}`).limit(20),
    digits.length >= 5 ? admin.from("customers").select("id").ilike("phone", `%${digits.slice(-9)}%`).limit(20) : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  const carIds = (cars ?? []).map((v) => String(v.id));
  const custIds = Array.from(new Set([...(custs ?? []), ...(phones ?? [])].map((c) => String(c.id))));
  const ors = [carIds.length ? `vehicle_id.in.(${carIds.join(",")})` : "", custIds.length ? `customer_id.in.(${custIds.join(",")})` : ""].filter(Boolean);
  const { data: theirs } = ors.length ? await admin.from("jobs").select("id").or(ors.join(",")).order("gated_in_at", { ascending: false }).limit(80) : { data: [] as { id: string }[] };
  return {
    jobIds: Array.from(new Set([...(byNumber ?? []).map((j) => String(j.id)), ...(byDoc ?? []).map((i) => String(i.job_id)), ...(theirs ?? []).map((j) => String(j.id))])).slice(0, 120),
    customerIds: new Set(custIds),
    vehicleIds: new Set(carIds),
  };
}

export type MoneyTiles = MoneyListTiles & {
  collectedMonth: number;
  lposWaiting: number;
  supplierInvoicesToCheck: number;
};

/** The figures across the top of the accounts screens: the money ones FROM the rows, the month and the counts read here. */
export async function loadMoneyTiles(rows: MoneyRowData[]): Promise<MoneyTiles> {
  const admin = createAdminClient();
  const today = dubaiDate();
  const monthStart = dayStartIso(`${today.slice(0, 7)}-01`);
  const [month, { count: lpos }, { count: toFollow }, { count: mismatches }] = await Promise.all([
    pageAll<LightPay>((a, b) => admin.from("payments").select(LIGHT_PAY).eq("is_active", true).eq("status", "recorded").or(`received_at.gte.${monthStart},cleared_at.gte.${monthStart}`).order("id").range(a, b) as unknown as Page<LightPay>).catch(() => [] as LightPay[]),
    admin.from("purchase_orders").select("id", { count: "exact", head: true }).eq("status", "pending_approval").eq("is_active", true),
    admin.from("purchase_orders").select("id", { count: "exact", head: true }).eq("supplier_invoice_status", "to_follow").eq("is_active", true).neq("status", "cancelled"),
    admin.from("purchase_order_lines").select("id", { count: "exact", head: true }).eq("invoice_check", "mismatch").eq("is_active", true),
  ]);
  return {
    ...moneyTilesOf(rows),
    // Nothing links to a month list: the month is the same collected rule, read straight from the payments.
    collectedMonth: round2(month.filter((p) => countsAsCollected(p, monthStart)).reduce((a, p) => a + Number(p.amount_aed), 0)),
    lposWaiting: lpos ?? 0,
    // 1 November 2026: the Supplier invoices tab's own count (new, waiting for the invoice, queried, price differs).
    supplierInvoicesToCheck: await supplierInvoicesToCheckCount().catch(() => (toFollow ?? 0) + (mismatches ?? 0)),
  };
}
