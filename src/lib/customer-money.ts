import "server-only";
import { loadChargeEntries } from "./charges";
import { customerName } from "./customer-view";
import { INVOICE_SELECT, PAYMENT_SELECT, creditsOnDocs, draftFrom, invoiceBalance, loadDraftInputs, nextDocumentNumber, toInvoice, toPayment, type DraftInputs, type InvoiceRow, type PaymentRow } from "./invoice-data";
import { round2 } from "./money";
import { pageAllIn } from "./page-all";
import { notifyStaff, jobAdvisorIds } from "./notifications";
import { paymentsAnytimeReady } from "./schema-ready";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

/**
 * Record a payment any time (1 November 2026). THE money figures of a job and of a customer, for every screen that
 * offers "Record payment": what a job has paid so far and what is left (before the proforma: the approved total less
 * the advances; after it: the live invoice's balance), where a payment can go (the job, its proforma or invoice, or the
 * customer's account as an UNALLOCATED ADVANCE), the customer's credit not allocated, and allocating it later in one step.
 */

const VEH = "id, kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name)";
type Vehicle = Parameters<typeof formatPlate>[0] & { id: string; model_year: number | null; make: { name: string } | null; model: { name: string } | null };
const carOf = (v: Vehicle | null) => (v ? [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" ").toUpperCase() : "");
const aed = (n: number) => `AED ${round2(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type JobMoney = {
  jobId: string;
  jobNumber: string;
  status: string;
  isOpen: boolean;
  gatedOutAt: string | null;
  customerId: string;
  vehicleId: string;
  plate: string;
  car: string;
  /** The proforma or tax invoice the money goes against, when there is one. */
  live: { id: string; number: string; kind: "proforma" | "tax_invoice"; total: number } | null;
  /** The approved total incl. VAT (the live invoice's total once there is one); null while nothing is approved. */
  total: number | null;
  paid: number;
  /** What is still to pay; null while there is no total to measure against. */
  balance: number | null;
  pendingCheque: number;
  /** What issued credit notes took off the live tax invoice (3 November 2026; 0 when none). */
  credited: number;
};

/** A job's money now: the live invoice's figures, or (before the proforma) the approved total less every advance. */
export async function jobMoneyOf(jobId: string, settings: Settings): Promise<JobMoney | null> {
  return (await jobMoneyMany([jobId], settings)).get(jobId) ?? null;
}

/** The job facts the money rule needs (the list loads more of them; these are the ones it reads). */
export type JobMoneyFacts = { id: string; job_number: string; status: string; is_open: boolean; gated_out_at: string | null; customer_id: string; vehicle_id: string; vehicle: Vehicle | null };
export const JOB_MONEY_COLS = `id, job_number, status, is_open, gated_out_at, customer_id, vehicle_id, vehicle:vehicles(${VEH})`;

/** The live document a job's money goes against: its tax invoice, else its proforma (never a deposit document), newest first. */
export function liveDocOf<T extends Pick<InvoiceRow, "kind" | "status" | "converted_to" | "deposit_for_quotation_id" | "issued_at">>(invoices: T[]): T | null {
  const docs = invoices.filter((i) => i.status === "issued" && !i.converted_to && (i.kind === "tax_invoice" || i.kind === "proforma")).sort((a, b) => (a.issued_at < b.issued_at ? 1 : a.issued_at > b.issued_at ? -1 : 0));
  return docs.find((i) => i.kind === "tax_invoice" && !i.deposit_for_quotation_id) ?? docs.find((i) => i.kind === "proforma" && !i.deposit_for_quotation_id) ?? null;
}

/**
 * THE money of one job from its facts (3 November 2026, shared by the job card, the customer page, the Record payment
 * window, the money page and the money list): with a live proforma or tax invoice, that document's balance (cleared money
 * only, less what its credit notes took off: `creditOf` by document id, from `creditsOnDocs`); before it, the approved
 * draft total less every cleared recorded payment on the job (advances, deposit documents).
 */
export function jobMoneyFrom(job: JobMoneyFacts, invoices: InvoiceRow[], payments: PaymentRow[], draftTotal: number | null, creditOf: Map<string, number> = new Map()): JobMoney {
  const v = job.vehicle ?? null;
  const base = {
    jobId: job.id,
    jobNumber: String(job.job_number),
    status: String(job.status),
    isOpen: !!job.is_open,
    gatedOutAt: job.gated_out_at ?? null,
    customerId: String(job.customer_id),
    vehicleId: String(job.vehicle_id),
    plate: v ? formatPlate(v) : "",
    car: carOf(v),
  };
  const liveInv = liveDocOf(invoices);
  if (liveInv) {
    const bal = invoiceBalance(liveInv, payments.filter((p) => p.invoice_id === liveInv.id), creditOf.get(liveInv.id) ?? 0);
    return { ...base, live: { id: liveInv.id, number: liveInv.number, kind: liveInv.kind as "proforma" | "tax_invoice", total: liveInv.total_aed }, total: liveInv.total_aed, paid: bal.paid, balance: bal.balance, pendingCheque: bal.pendingAmount, credited: bal.credited };
  }
  const total = draftTotal;
  const live = payments.filter((p) => p.status === "recorded");
  const paid = round2(live.filter((p) => p.method !== "cheque" || p.cheque_status === "cleared").reduce((a, p) => a + p.amount_aed, 0));
  const pendingCheque = round2(live.filter((p) => p.method === "cheque" && p.cheque_status === "pending").reduce((a, p) => a + p.amount_aed, 0));
  return { ...base, live: null, total, paid, balance: total === null ? null : Math.max(0, round2(total - paid)), pendingCheque, credited: 0 };
}

/**
 * The money of many jobs in a few reads (3 November 2026): the jobs, their documents, their payments and (only for jobs
 * with no live document) the approved draft totals, batched. The list may pass what it has already read.
 */
export async function jobMoneyMany(jobIds: string[], settings: Settings, pre: { jobs?: JobMoneyFacts[]; invoices?: InvoiceRow[]; payments?: PaymentRow[] } = {}): Promise<Map<string, JobMoney>> {
  const admin = createAdminClient();
  const ids = Array.from(new Set(jobIds.filter(Boolean)));
  const out = new Map<string, JobMoney>();
  if (!ids.length) return out;
  // A read that fails counts as nothing (the job is left out), as the one-job reading always did.
  const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
  const [jobs, invRows, payRows] = await Promise.all([
    pre.jobs ?? safe(pageAllIn<JobMoneyFacts>(ids, (piece, a, b) => admin.from("jobs").select(JOB_MONEY_COLS).in("id", piece).order("id").range(a, b) as unknown as PromiseLike<{ data: JobMoneyFacts[] | null; error: { message: string } | null }>)),
    pre.invoices ?? safe(pageAllIn<Record<string, unknown>>(ids, (piece, a, b) => admin.from("invoices").select(INVOICE_SELECT).in("job_id", piece).in("kind", ["tax_invoice", "proforma"]).eq("status", "issued").eq("is_active", true).is("converted_to", null).order("issued_at", { ascending: false }).order("id").range(a, b))).then((r) => r.map(toInvoice)),
    pre.payments ?? safe(pageAllIn<Record<string, unknown>>(ids, (piece, a, b) => admin.from("payments").select(PAYMENT_SELECT).in("job_id", piece).eq("is_active", true).order("id").range(a, b))).then((r) => r.map(toPayment)),
  ]);
  const invOf = new Map<string, InvoiceRow[]>();
  for (const i of invRows) if (i.job_id) invOf.set(i.job_id, [...(invOf.get(i.job_id) ?? []), i]);
  const payOf = new Map<string, PaymentRow[]>();
  for (const p of payRows) if (p.job_id) payOf.set(p.job_id, [...(payOf.get(p.job_id) ?? []), p]);
  const known = jobs.filter((j) => ids.includes(j.id));
  // The approved draft only where no live document stands (one batched reading for all of them); the credit notes only
  // where a tax invoice stands (a proforma is never credited).
  const needDraft = known.filter((j) => !liveDocOf(invOf.get(j.id) ?? [])).map((j) => j.id);
  const taxDocs = known.map((j) => liveDocOf(invOf.get(j.id) ?? [])).filter((d): d is InvoiceRow => !!d && d.kind === "tax_invoice").map((d) => d.id);
  const [inputs, credits] = await Promise.all([needDraft.length ? loadDraftInputs(needDraft) : Promise.resolve(new Map<string, DraftInputs>()), creditsOnDocs(taxDocs)]);
  for (const j of known) {
    const inp = inputs.get(j.id);
    const draft = inp ? draftFrom(inp, settings) : null;
    out.set(j.id, jobMoneyFrom(j, invOf.get(j.id) ?? [], payOf.get(j.id) ?? [], draft && draft.lines.length ? draft.totals.total : null, credits));
  }
  return out;
}

export type PayTarget = {
  /** "inv:<id>", "job:<id>" or "credit". */
  key: string;
  kind: "invoice" | "job" | "unallocated";
  jobId: string | null;
  invoiceId: string | null;
  vehicleId: string | null;
  /** "J-00969 · DUBAI W 64762 · MERCEDES-BENZ S 580" or "Customer's account". */
  title: string;
  /** "Proforma PF-00012 · balance AED 37,930.00" or "Not allocated: saved on the customer's account". */
  detail: string;
  total: number | null;
  paid: number;
  balance: number | null;
  invoiceNumber: string | null;
  isProforma: boolean;
  /** The car has left (the money is still welcome: credit terms, a late payment). */
  gone: boolean;
};

export type UnallocatedPayment = PaymentRow & { vehicle_id: string | null; plate: string | null; car: string | null; customerName: string; ageDays: number };

/** The customer's money not allocated to anything yet (newest first). Empty until the database change is applied. */
export async function unallocatedOf(opts: { customerId?: string; vehicleId?: string } = {}): Promise<UnallocatedPayment[]> {
  if (!(await paymentsAnytimeReady())) return [];
  const admin = createAdminClient();
  let q = admin.from("payments").select(`${PAYMENT_SELECT}, vehicle_id, vehicle:vehicles(${VEH}), customer:customers(full_name, company_name)`).is("job_id", null).is("invoice_id", null).eq("is_active", true).in("status", ["recorded", "pending_owner"]);
  if (opts.customerId) q = q.eq("customer_id", opts.customerId);
  if (opts.vehicleId) q = q.eq("vehicle_id", opts.vehicleId);
  const { data } = await q.order("received_at", { ascending: false }).limit(200);
  const now = Date.now();
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const v = (r.vehicle as Vehicle | null) ?? null;
    const c = (r.customer as { full_name: string | null; company_name: string | null } | null) ?? { full_name: null, company_name: null };
    const p = toPayment(r);
    return { ...p, vehicle_id: (r.vehicle_id as string | null) ?? null, plate: v ? formatPlate(v) : null, car: v ? carOf(v) : null, customerName: customerName(c), ageDays: Math.max(0, Math.floor((now - Date.parse(p.received_at)) / 86400000)) };
  });
}

/** "Credit AED X (not allocated)": recorded money only (a cheque still clearing counts, it is the customer's money). */
export async function customerCredit(customerId: string): Promise<number> {
  const rows = await unallocatedOf({ customerId });
  return round2(rows.filter((p) => p.status === "recorded").reduce((a, p) => a + p.amount_aed, 0));
}

export type PaymentChoices = {
  customer: { id: string; name: string; phone: string | null };
  targets: PayTarget[];
  /** The target the dialog opens on. */
  suggested: string;
  credit: number;
  cars: { id: string; plate: string; car: string }[];
  /** The number the tax invoice will get when a payment settles a proforma. */
  nextTaxNumber: string | null;
  unallocatedReady: boolean;
};

/**
 * Where a payment can go for this customer: every open job (that car first), jobs that left with money still owed,
 * the asked-for job always, and the customer's account. A job's live proforma or invoice is the target once it exists;
 * before that the job itself (an advance that comes off the invoice by itself).
 */
export async function paymentChoices(input: { customerId?: string | null; vehicleId?: string | null; jobId?: string | null }, settings: Settings): Promise<PaymentChoices | null> {
  const admin = createAdminClient();
  let customerId = input.customerId ?? null;
  let vehicleId = input.vehicleId ?? null;
  if (input.jobId) {
    const { data: j } = await admin.from("jobs").select("customer_id, vehicle_id").eq("id", input.jobId).maybeSingle();
    if (!j) return null;
    customerId = String(j.customer_id);
    vehicleId = vehicleId ?? String(j.vehicle_id);
  }
  if (!customerId && vehicleId) {
    const { data: v } = await admin.from("vehicles").select("customer_id").eq("id", vehicleId).maybeSingle();
    customerId = (v?.customer_id as string | null) ?? null;
  }
  if (!customerId) return null;
  const [{ data: c }, { data: jobs }, { data: cars }, ready] = await Promise.all([
    admin.from("customers").select("id, full_name, company_name, phone").eq("id", customerId).maybeSingle(),
    admin.from("jobs").select("id, vehicle_id, is_open, gated_in_at").eq("customer_id", customerId).order("gated_in_at", { ascending: false }).limit(40),
    admin.from("vehicles").select(VEH).eq("customer_id", customerId).eq("is_active", true),
    paymentsAnytimeReady(),
  ]);
  if (!c) return null;
  const jobRows = (jobs ?? []) as { id: string; vehicle_id: string; is_open: boolean }[];
  // Open jobs, plus the 12 newest that left (money may still be owed on them), plus the asked-for one.
  const pick = jobRows.filter((j) => j.is_open || j.id === input.jobId).concat(jobRows.filter((j) => !j.is_open && j.id !== input.jobId).slice(0, 12));
  const many = await jobMoneyMany(pick.map((j) => j.id), settings);
  const figures = pick.map((j) => many.get(j.id)).filter((x): x is JobMoney => !!x);
  const targets: PayTarget[] = [];
  for (const m of figures) {
    const owed = m.balance === null || m.balance > 0.005;
    // A job paid in full, or one that left owing nothing, is no place for new money (unless asked for by name).
    if (!owed && m.jobId !== input.jobId) continue;
    if (!m.isOpen && m.balance === null && m.jobId !== input.jobId) continue;
    const title = [m.jobNumber, m.plate, m.car].filter(Boolean).join(" · ");
    const owedWords = m.balance === null ? "no approved total yet" : m.balance > 0.005 ? `balance ${aed(m.balance)}` : "paid in full";
    if (m.live) {
      targets.push({ key: `inv:${m.live.id}`, kind: "invoice", jobId: m.jobId, invoiceId: m.live.id, vehicleId: m.vehicleId, title, detail: `${m.live.kind === "proforma" ? "Proforma" : "Tax invoice"} ${m.live.number} · ${owedWords}${m.isOpen ? "" : " · the car has left"}`, total: m.total, paid: m.paid, balance: m.balance, invoiceNumber: m.live.number, isProforma: m.live.kind === "proforma", gone: !m.isOpen });
    } else {
      targets.push({ key: `job:${m.jobId}`, kind: "job", jobId: m.jobId, invoiceId: null, vehicleId: m.vehicleId, title, detail: `${m.paid > 0 ? `Paid so far ${aed(m.paid)} · ` : ""}${owedWords} · recorded as an advance, it comes off the invoice by itself${m.isOpen ? "" : " · the car has left"}`, total: m.total, paid: m.paid, balance: m.balance, invoiceNumber: null, isProforma: false, gone: !m.isOpen });
    }
  }
  // 1 November 2026: a pending charge (no gate-in) with its own proforma is a place for the money too.
  for (const e of await loadChargeEntries({ customerId, status: "pending" })) {
    if (!e.proforma_id || e.tax_invoice_id || e.balance <= 0.005) continue;
    targets.push({ key: `inv:${e.proforma_id}`, kind: "invoice", jobId: null, invoiceId: e.proforma_id, vehicleId: e.vehicle_id, title: `Pending charge · ${e.what}`, detail: `Proforma ${e.proformaNumber} · balance ${aed(e.balance)}${e.paid > 0 ? ` · AED ${e.paid.toLocaleString("en-GB", { minimumFractionDigits: 2 })} paid so far` : ""} · the tax invoice follows when it is paid in full`, total: e.total, paid: e.paid, balance: e.balance, invoiceNumber: e.proformaNumber, isProforma: true, gone: false });
  }
  // That car's jobs first, then the rest as they came (newest first).
  targets.sort((a, b) => Number(b.vehicleId === vehicleId) - Number(a.vehicleId === vehicleId));
  if (ready) targets.push({ key: "credit", kind: "unallocated", jobId: null, invoiceId: null, vehicleId, title: "Customer's account (not allocated)", detail: "Saved as an advance on the customer's account, with a note of what it is for. Allocated later in one step.", total: null, paid: 0, balance: null, invoiceNumber: null, isProforma: false, gone: false });
  const asked = input.jobId ? targets.find((t) => t.jobId === input.jobId) : null;
  const suggested = asked?.key ?? targets.find((t) => t.kind !== "unallocated" && t.vehicleId === vehicleId && (t.balance === null || t.balance > 0.005) && !t.gone)?.key ?? targets.find((t) => t.kind !== "unallocated" && (t.balance ?? 0) > 0.005)?.key ?? targets.at(-1)?.key ?? "";
  const nextTaxNumber = targets.some((t) => t.isProforma) ? await nextDocumentNumber("tax_invoice", settings) : null;
  return {
    customer: { id: String(c.id), name: customerName(c as { full_name: string | null; company_name: string | null }), phone: (c.phone as string | null) ?? null },
    targets,
    suggested,
    credit: await customerCredit(customerId),
    cars: ((cars ?? []) as unknown as Vehicle[]).map((v) => ({ id: v.id, plate: formatPlate(v), car: carOf(v) })),
    nextTaxNumber,
    unallocatedReady: ready,
  };
}

/** One result of the Record payment window's search: who pays, for which car and job, and what is left to pay. */
export type PayerRow = {
  key: string;
  customerId: string;
  name: string;
  phone: string | null;
  vehicleId: string | null;
  /** "Dubai GG 13706" (empty when the customer has no car on record). */
  plate: string;
  /** "MERCEDES-BENZ S 580 2023". */
  car: string;
  jobId: string | null;
  jobNumber: string | null;
  pictureUrl: string | null;
  total: number | null;
  paid: number;
  /** What is left on the job; null while nothing is approved, or with no job. */
  balance: number | null;
  /** The car has left. */
  gone: boolean;
  /** Money on the customer's account not allocated yet (rows without a job). */
  credit: number;
  /** "Balance AED 7,930.00", "Paid in full", "No approved total yet", "No open job", "Credit AED 150.00". */
  moneyWords: string;
};

/**
 * THE search of the Record payment window (2 November 2026, section 3): by customer name, mobile, customer number, plate
 * ("GG 13706" finds the code and number kept apart), VIN or job number. Every row is a customer with a car and a job, the
 * car's picture and what is left to pay. ONE car rule for every kind of hit: a car shows its open jobs, then its jobs that
 * left still owing (a balance above zero), else the car alone (the money then goes on the account). A job number typed is
 * that job, always. A customer found by name or mobile shows each of their cars by the same rule; "No car on record" only
 * when the customer has no car at all.
 */
export async function payerRows(q: string, settings: Settings): Promise<PayerRow[]> {
  const { cleanNeedle, vehicleOrFilter } = await import("./plate-search");
  const needle = cleanNeedle(q);
  if (needle.length < 2) return [];
  const admin = createAdminClient();
  const digits = needle.replace(/\D/g, "");
  const like = `%${needle}%`;
  const VPHOTO = `${VEH}, customer_id, photo_path`;
  const [{ data: custs }, { data: phones }, { data: cars }, { data: jobs }] = await Promise.all([
    admin.from("customers").select("id").or(`full_name.ilike.${like},company_name.ilike.${like},customer_number.ilike.${like}`).limit(8),
    digits.length >= 5 ? admin.from("customers").select("id").ilike("phone", `%${digits.slice(-9)}%`).limit(8) : Promise.resolve({ data: [] as { id: string }[] }),
    admin.from("vehicles").select("id").or(vehicleOrFilter(needle)).limit(8),
    admin.from("jobs").select("id").ilike("job_number", like).limit(6),
  ]);
  type J = { id: string; job_number: string; customer_id: string; vehicle_id: string; is_open: boolean };
  const custIds = Array.from(new Set([...(custs ?? []), ...(phones ?? [])].map((c) => String(c.id))));
  const carIds = (cars ?? []).map((v) => String(v.id));
  const jobIds = (jobs ?? []).map((j) => String(j.id));
  // The cars on record for the customers found (a car is on record even when every job on it is closed).
  const { data: ownCarRows } = custIds.length ? await admin.from("vehicles").select("id, customer_id").in("customer_id", custIds).eq("is_active", true).limit(40) : { data: [] as { id: string; customer_id: string }[] };
  const ownCars = (ownCarRows ?? []) as { id: string; customer_id: string }[];
  // Every job of those cars and customers (open ones first, then the newest), then their cars and people.
  const ors = [jobIds.length ? `id.in.(${jobIds.join(",")})` : "", carIds.length ? `vehicle_id.in.(${carIds.join(",")})` : "", custIds.length ? `customer_id.in.(${custIds.join(",")})` : ""].filter(Boolean);
  const { data: jobRows } = ors.length ? await admin.from("jobs").select("id, job_number, customer_id, vehicle_id, is_open").or(ors.join(",")).order("is_open", { ascending: false }).order("gated_in_at", { ascending: false }).limit(80) : { data: [] as J[] };
  const allJobs = (jobRows ?? []) as J[];
  const vehIds = Array.from(new Set([...carIds, ...ownCars.map((v) => v.id), ...allJobs.map((j) => j.vehicle_id)]));
  const peopleIds = Array.from(new Set([...custIds, ...allJobs.map((j) => j.customer_id)]));
  const [{ data: vehRows }, { data: custRows }] = await Promise.all([
    vehIds.length ? admin.from("vehicles").select(VPHOTO).in("id", vehIds) : Promise.resolve({ data: [] }),
    peopleIds.length ? admin.from("customers").select("id, full_name, company_name, phone").in("id", peopleIds) : Promise.resolve({ data: [] }),
  ]);
  const vehOf = new Map(((vehRows ?? []) as unknown as (Vehicle & { customer_id: string; photo_path: string | null })[]).map((v) => [v.id, v]));
  const extraPeople = Array.from(new Set(Array.from(vehOf.values()).map((v) => v.customer_id).filter((id) => !!id && !peopleIds.includes(id))));
  const { data: moreCust } = extraPeople.length ? await admin.from("customers").select("id, full_name, company_name, phone").in("id", extraPeople) : { data: [] };
  const custOf = new Map(([...(custRows ?? []), ...(moreCust ?? [])] as { id: string; full_name: string | null; company_name: string | null; phone: string | null }[]).map((c) => [String(c.id), c]));

  // The groups, best first: a typed job number, each car found, then each car of each customer found.
  type Group = { customerId: string; vehicleId: string | null; jobs: J[]; asked?: boolean };
  const groups: Group[] = [];
  for (const id of jobIds) {
    const j = allJobs.find((x) => x.id === id);
    if (j) groups.push({ customerId: j.customer_id, vehicleId: j.vehicle_id, jobs: [j], asked: true });
  }
  for (const vid of carIds) {
    const v = vehOf.get(vid);
    if (!v) continue;
    const mine = allJobs.filter((j) => j.vehicle_id === vid);
    groups.push({ customerId: mine.find((j) => j.is_open)?.customer_id ?? v.customer_id ?? mine[0]?.customer_id, vehicleId: vid, jobs: mine });
  }
  for (const cid of custIds) {
    const theirCars = Array.from(new Set([...ownCars.filter((v) => v.customer_id === cid).map((v) => v.id), ...allJobs.filter((j) => j.customer_id === cid).map((j) => j.vehicle_id)]));
    if (!theirCars.length) groups.push({ customerId: cid, vehicleId: null, jobs: [] });
    for (const vid of theirCars) groups.push({ customerId: cid, vehicleId: vid, jobs: allJobs.filter((j) => j.vehicle_id === vid && j.customer_id === cid) });
  }
  // A car's candidates: the typed job, or up to three open jobs and the three newest that left (shown only while owing).
  const candidates = (g: Group) => (g.asked ? g.jobs : [...g.jobs.filter((j) => j.is_open).slice(0, 3), ...g.jobs.filter((j) => !j.is_open).slice(0, 3)]);
  const wanted: string[] = [];
  for (const g of groups.slice(0, 16)) for (const j of candidates(g)) if (!wanted.includes(j.id) && wanted.length < 30) wanted.push(j.id);
  const moneyOf = await jobMoneyMany(wanted, settings);
  const owing = (m: JobMoney | undefined) => !!m && m.balance !== null && m.balance > 0.005;

  // The rows: one per job shown; the car alone when it has nothing open and nothing still owing.
  const picks: { customerId: string; vehicleId: string | null; jobId: string | null }[] = [];
  const shownJobs = new Set<string>();
  const shownCars = new Set<string>();
  for (const g of groups) {
    if (picks.length >= 10) break;
    if (!g.customerId || !custOf.has(g.customerId)) continue;
    const carKey = `${g.customerId}:${g.vehicleId ?? ""}`;
    const rows = candidates(g).filter((j) => moneyOf.has(j.id) && (g.asked || j.is_open || owing(moneyOf.get(j.id))));
    for (const j of rows) {
      if (shownJobs.has(j.id) || picks.length >= 10) continue;
      shownJobs.add(j.id);
      shownCars.add(`${j.customer_id}:${j.vehicle_id}`);
      shownCars.add(carKey);
      picks.push({ customerId: j.customer_id, vehicleId: j.vehicle_id, jobId: j.id });
    }
    if (shownCars.has(carKey) || picks.length >= 10) continue;
    shownCars.add(carKey);
    picks.push({ customerId: g.customerId, vehicleId: g.vehicleId, jobId: null });
  }
  const credits = new Map<string, number>();
  await Promise.all(Array.from(new Set(picks.filter((p) => !p.jobId).map((p) => p.customerId))).map(async (cid) => credits.set(cid, await customerCredit(cid))));
  const { thumbsFor } = await import("./media-urls");
  const pictures = await thumbsFor("vehicle-photos", picks.map((p) => (p.vehicleId ? vehOf.get(p.vehicleId)?.photo_path : null)), 160);
  return picks.map((p): PayerRow => {
    const m = p.jobId ? (moneyOf.get(p.jobId) ?? null) : null;
    const c = custOf.get(p.customerId)!;
    const v = p.vehicleId ? (vehOf.get(p.vehicleId) ?? null) : null;
    const credit = p.jobId ? 0 : (credits.get(p.customerId) ?? 0);
    const moneyWords = m ? (m.balance === null ? "No approved total yet" : m.balance > 0.005 ? `Balance ${aed(m.balance)}` : "Paid in full") : credit > 0 ? `No open job · credit ${aed(credit)}` : v ? "No open job · nothing owed" : "No open job";
    return {
      key: `${p.customerId}:${p.vehicleId ?? ""}:${m ? m.jobId : ""}`,
      customerId: p.customerId,
      name: customerName(c),
      phone: c.phone,
      vehicleId: v?.id ?? null,
      plate: v ? formatPlate(v) : "",
      car: carOf(v),
      jobId: m?.jobId ?? null,
      jobNumber: m?.jobNumber ?? null,
      pictureUrl: v?.photo_path ? (pictures.get(v.photo_path) ?? null) : null,
      total: m?.total ?? null,
      paid: m?.paid ?? 0,
      balance: m?.balance ?? null,
      gone: m ? !m.isOpen : false,
      credit,
      moneyWords: m && !m.isOpen ? `${moneyWords} · the car has left` : moneyWords,
    };
  });
}

export type AllocateResult = { error?: string; ok?: boolean; message?: string; needsNote?: { balance: number } };

/**
 * An unallocated advance goes to a job, its proforma or its tax invoice (1.8): one step, logged on the job. More than
 * what is left needs a note (refund or credit). A payment already in Zoho is applied there when its row runs again.
 */
export async function allocatePayment(paymentId: string, target: { jobId?: string | null; invoiceId?: string | null }, actor: { id: string; display_name: string }, note: string | null, settings: Settings): Promise<AllocateResult> {
  if (!(await paymentsAnytimeReady())) return { error: "This needs the database update of 1 November. Ask the owner to apply it." };
  const admin = createAdminClient();
  const { data: raw } = await admin.from("payments").select(`${PAYMENT_SELECT}, zoho_payment_id`).eq("id", paymentId).eq("is_active", true).maybeSingle();
  if (!raw) return { error: "Payment not found." };
  const p = toPayment(raw as Record<string, unknown>);
  if (p.job_id || p.invoice_id) return { error: `${p.number} is already allocated.` };
  if (p.status !== "recorded") return { error: p.status === "pending_owner" ? `${p.number} is waiting for the owner.` : `${p.number} is ${p.status}.` };
  let jobId = target.jobId ?? null;
  let invoiceId = target.invoiceId ?? null;
  if (invoiceId) {
    const { data: inv } = await admin.from("invoices").select("id, job_id, customer_id, status, kind, converted_to, number").eq("id", invoiceId).maybeSingle();
    if (!inv || inv.status !== "issued" || inv.converted_to || !["proforma", "tax_invoice"].includes(String(inv.kind))) return { error: "That invoice can't take a payment." };
    if (inv.customer_id !== p.customer_id) return { error: "That invoice is for another customer." };
    jobId = (inv.job_id as string | null) ?? null;
  }
  if (!jobId) return { error: "Choose the job or invoice." };
  const m = await jobMoneyOf(jobId, settings);
  if (!m) return { error: "Job not found." };
  if (m.customerId !== p.customer_id) return { error: "That job is for another customer." };
  if (!invoiceId && m.live) invoiceId = m.live.id;
  const left = m.balance;
  const clean = note?.trim().slice(0, 500) || null;
  if (left !== null && p.amount_aed > left + 0.005 && !clean) return { needsNote: { balance: left }, error: `${p.number} (${aed(p.amount_aed)}) is more than what is left on ${m.jobNumber} (${aed(left)}). Write why (refund or credit) – it is logged.` };
  const now = new Date().toISOString();
  const notes = clean ? [p.notes, `Allocated above the balance: ${clean}`].filter(Boolean).join(" · ") : p.notes;
  const { data: moved, error } = await admin
    .from("payments")
    .update({ job_id: jobId, invoice_id: invoiceId, vehicle_id: m.vehicleId, allocated_at: now, allocated_by: actor.id, notes, updated_by: actor.id })
    .eq("id", paymentId)
    .is("job_id", null)
    .is("invoice_id", null)
    .select("id");
  if (error) return { error: "Couldn't allocate it – nothing changed. Try again." };
  if (!(moved ?? []).length) return { error: `${p.number} was allocated a moment ago.` };
  await admin.from("job_events").insert({ job_id: jobId, event_type: "payment", note: `${p.number}: ${aed(p.amount_aed)} by ${p.method} allocated from the customer's account${invoiceId ? ` to ${m.live?.number ?? "the invoice"}` : ""} by ${actor.display_name}${clean ? ` (above the balance: ${clean})` : ""}`, created_by: actor.id });
  // The invoice may now be settled (a proforma paid in full becomes the tax invoice); a deposit may now be covered.
  const { settleJob, tellDepositCovered } = await import("./payments");
  if (invoiceId) await settleJob(jobId, invoiceId, actor.id, settings);
  else await tellDepositCovered(jobId);
  // Already in Zoho as an unapplied advance: its row runs once more and applies it to the tax invoice when that is there.
  if ((raw as { zoho_payment_id?: string | null }).zoho_payment_id) {
    const { reopenZoho } = await import("./zoho-sync");
    await reopenZoho("deposit", paymentId).catch(() => null);
  }
  await notifyStaff(await jobAdvisorIds(jobId), { type: "payment_received", title: `Payment allocated · ${p.number}`, body: `${aed(p.amount_aed)} from the customer's account is now on ${m.jobNumber}.`, jobId, href: `/jobs/${jobId}` });
  return { ok: true, message: `${p.number} is now on ${m.jobNumber}${invoiceId && m.live ? ` (${m.live.number})` : ""}.` };
}
