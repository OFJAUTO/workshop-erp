import { uninvoicedCompCost } from "./comp-data";
import "server-only";
import { dubaiDate } from "./jobs";
import { round2 } from "./money";
import { isHidden, isUnchosen, lineCost, type LineType } from "./quotes";
import { expectedFeeCost, expectedFeeRule, type Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { chargeTotalsByJob } from "./supplier-charges";
import { feeOf, isClearing } from "./card-settlement-rules";
import { INVOICE_SELECT, PAYMENT_SELECT, invoiceBalance, toInvoice, toPayment, type InvoiceRow, type PaymentRow } from "./invoice-data";
import { LINE_SELECT, toLine, toQuote } from "./quote-data";
import { hasPackageLine, quoteTotals, type QuoteLine } from "./quotes";
import { sideOfDepartment } from "./inspection";

/** The hourly cost rate for a job's department: the department's own figure, else its side's, else the base rate. */
export function costRateFor(settings: Settings, department: string | null | undefined): number {
  const byDept = (settings.technician_cost_rate_by_department ?? {}) as Record<string, number>;
  const dept = String(department ?? "mechanical");
  const side = sideOfDepartment(dept) ?? "mechanical";
  return Number(byDept[dept]) || Number(byDept[side]) || Number(settings.technician_cost_rate_aed) || 0;
}

export type JobProfit = {
  invoice: InvoiceRow;
  jobNumber: string | null;
  plate: string | null;
  revenue: number;
  partsCost: number;
  otherCost: number;
  stockCost: number;
  labourMinutes: number;
  labourCost: number;
  bankCharges: number;
  /** True when the bank charges are the bank's ACTUAL fee (every card/link payment settled); false while estimated. */
  bankChargesActual: boolean;
  /** The real recovery cost: the drivers' prices on the job's trips; the quotation's recovery lines until one exists. */
  recoveryCost: number;
  /** Commissions the owner approved on the job's quotations. */
  commission: number;
  /** 30 October 2026: a package car's installer hours counted because nobody clocked (bodyshop work: the advisor bonus adds it back). */
  packageLabour: number;
  /** Bodyshop materials (film, paint, consumables) from the internal box. */
  materialsCost: number;
  /** 30 October 2026: the free PPF recheck visits of this job - their clocked time and film, a cost of THIS job. */
  recheckCost: number;
  profit: number;
  provisional: boolean;
  provisionalWhy: string[];
  collected: number;
  balance: number;
  /** This invoice is for a car that came back for our workmanship or a part we supplied: a loss, not a sale. */
  comeback: { of: string | null; ours: boolean; claimPaid: number } | null;
  /** For the original job: the losses on its comebacks, taken off. Null when it never came back. */
  profitAfterComeback: number | null;
};

/**
 * Profit per invoice: the selling price before VAT, minus parts cost, minus the cost of Other and
 * Recovery lines, minus stock items used, minus clocked technician time at the cost rate, minus bank
 * charges. Counted on the invoice date. Provisional while a supplier invoice is still to follow.
 */
export async function jobProfits(settings: Settings, filter: { from?: string; to?: string; jobIds?: string[]; limit?: number; noComebacks?: boolean } = {}): Promise<JobProfit[]> {
  const admin = createAdminClient();
  let q = admin.from("invoices").select(INVOICE_SELECT + ", job:jobs!invoices_job_id_fkey(job_number, department, comeback_of, comeback_cause, comeback_claim_status, comeback_claim_amount, vehicle:vehicles(kind, plate_number, plate_code, plate_emirate, has_plate, vin))").eq("is_active", true).eq("status", "issued").eq("kind", "tax_invoice").order("issued_at", { ascending: false });
  if (filter.from) q = q.gte("issued_at", filter.from);
  if (filter.to) q = q.lt("issued_at", filter.to);
  if (filter.jobIds) q = q.in("job_id", filter.jobIds);
  if (filter.limit) q = q.limit(filter.limit);
  const { data } = await q;
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  if (!rows.length) return [];
  const invoices = rows.map((r) => ({ invoice: toInvoice(r), job: r.job as { job_number: string; department: string | null; comeback_of: string | null; comeback_cause: string | null; comeback_claim_status: string | null; comeback_claim_amount: number | string | null; vehicle: { plate_number: string | null; plate_code: string | null; plate_emirate: string | null; has_plate: boolean; vin: string | null } | null } | null }));
  const ids = invoices.map((i) => i.invoice.id);
  const jobIds = Array.from(new Set(invoices.map((i) => i.invoice.job_id).filter((x): x is string => !!x)));
  const [{ data: lines }, { data: payments }, { data: sessions }, { data: stock }, { data: pos }, { data: credits }, { data: hiddenRows }, { data: trips }, { data: clockings }, { data: quotes }, { data: comRows }] = await Promise.all([
    admin.from("invoice_lines").select("invoice_id, section, cost_aed, amount_aed, description").in("invoice_id", ids).eq("is_active", true),
    admin.from("payments").select(PAYMENT_SELECT).in("invoice_id", ids).eq("is_active", true),
    jobIds.length ? admin.from("work_sessions").select("job_id, minutes, started_at, ended_at").in("job_id", jobIds).eq("is_active", true) : Promise.resolve({ data: [] }),
    jobIds.length ? admin.from("stock_issues").select("job_id, quantity, unit_cost").in("job_id", jobIds).eq("is_active", true) : Promise.resolve({ data: [] }),
    jobIds.length ? admin.from("purchase_orders").select("job_id, supplier_invoice_status, status").in("job_id", jobIds).eq("is_active", true) : Promise.resolve({ data: [] }),
    admin.from("invoices").select("credit_of, taxable_aed").in("credit_of", ids).eq("is_active", true).eq("status", "issued"),
    // Hidden lines of the approved quotations: hidden Recovery or Other costs, and the automatic bank charge line.
    jobIds.length ? admin.from("quotation_lines").select("id, line_type, quantity, unit_cost, visible_to_customer, fee_kind, option_group, chosen, quotation:quotations!inner(job_id, status)").eq("is_active", true).in("quotation.job_id", jobIds).eq("quotation.status", "approved") : Promise.resolve({ data: [] }),
    // The real recovery costs: the drivers' prices on the job's trips (Recovery page).
    jobIds.length ? admin.from("recovery_trips").select("job_id, price_aed, delivered_at, status").in("job_id", jobIds).eq("is_active", true) : Promise.resolve({ data: [] }),
    // Bodyshop cars clock on the section tablets, not on work sessions.
    jobIds.length ? admin.from("bodyshop_clockings").select("job_id, minutes").in("job_id", jobIds).eq("is_active", true) : Promise.resolve({ data: [] }),
    // Bodyshop materials from the approved quotations; the commission is read separately below, because
    // the job's ONE commission rides on the newest version, whatever its quotation status is right now.
    jobIds.length ? admin.from("quotations").select("job_id, commission_aed, commission_status, materials_cost_aed, version, created_at, commission_to, commission_paid_at, expected_payment_method").in("job_id", jobIds).eq("kind", "quotation").eq("is_active", true).eq("status", "approved") : Promise.resolve({ data: [] }),
    jobIds.length ? admin.from("quotations").select("job_id, commission_aed, commission_status, version, created_at, commission_to, commission_paid_at").in("job_id", jobIds).eq("kind", "quotation").eq("is_active", true).not("commission_to", "is", null) : Promise.resolve({ data: [] }),
  ]);
  const chargeTotals = await chargeTotalsByJob(jobIds);
  const { recheckCostsFor } = await import("./recheck");
  const rechecks = await recheckCostsFor(jobIds, settings);
  // ONE profit calculation (30 October 2026, section 3): the packages' film, tint, ceramic, consumables and installer
  // hours - the real film and ceramic once recorded on the job, the package's own estimate until then.
  const pkgCosts = await packageCostsForJobs(settings, jobIds);
  // A car the customer declined (or an invoice that is only INSPECTION CHARGES, the manual way): its cost is the real
  // clocked time on the car - gate-in, inspection, road test, QC, work - booked as labour, never a typed "our cost".
  const { data: declinedJobs } = jobIds.length ? await admin.from("jobs").select("id").in("id", jobIds).not("declined_out_at", "is", null) : { data: [] as { id: string }[] };
  const declinedSet = new Set((declinedJobs ?? []).map((j) => j.id as string));
  const isInspectionOnly = (jobId: string | null, ls: { section: string; description?: string | null }[]) => !!jobId && (declinedSet.has(jobId) || (ls.length > 0 && ls.every((l) => l.section !== "parts" && /inspection charge/i.test(l.description ?? ""))));
  const inspectionJobs = invoices.filter(({ invoice }) => isInspectionOnly(invoice.job_id, ((lines ?? []) as { invoice_id: string; section: string; description: string | null }[]).filter((l) => l.invoice_id === invoice.id))).map(({ invoice }) => invoice.job_id as string);
  const { timeSpentFor } = await import("./time-spent");
  const clockedOf = await timeSpentFor(inspectionJobs, settings);
  // The comebacks of these jobs (our fault), to take their losses off the original job.
  const { data: cbJobs } = jobIds.length && !filter.noComebacks ? await admin.from("jobs").select("id, comeback_of").in("comeback_of", jobIds).in("comeback_cause", ["workmanship", "faulty_part"]) : { data: [] as { id: string; comeback_of: string }[] };
  const cbProfits = (cbJobs ?? []).length ? await jobProfits(settings, { jobIds: (cbJobs ?? []).map((c) => c.id), noComebacks: true }) : [];
  const byInvoice = (id: string) => ((lines ?? []) as { invoice_id: string; section: string; cost_aed: number | string; amount_aed: number | string; description: string | null }[]).filter((l) => l.invoice_id === id);
  return invoices.map(({ invoice, job }) => {
    const ls = byInvoice(invoice.id);
    const partsCost = round2(ls.filter((l) => l.section === "parts").reduce((a, l) => a + Number(l.cost_aed), 0));
    type HiddenRow = { line_type: string; quantity: number | string; unit_cost: number | string | null; visible_to_customer: boolean; fee_kind: string | null; option_group: string | null; chosen: boolean; quotation: { job_id: string; status: string } | null };
    const hidden = ((hiddenRows ?? []) as unknown as HiddenRow[])
      .filter((l) => l.quotation?.job_id === invoice.job_id && !isUnchosen(l) && isHidden({ line_type: l.line_type as LineType, visible_to_customer: l.visible_to_customer, fee_kind: l.fee_kind }))
      .map((l) => ({ line_type: l.line_type as LineType, fee_kind: l.fee_kind, quantity: Number(l.quantity) || 1, unit_cost: l.unit_cost === null ? null : Number(l.unit_cost) }));
    const hiddenCost = round2(hidden.filter((l) => !l.fee_kind && l.line_type !== "recovery").reduce((a, l) => a + lineCost(l), 0));
    // The suppliers' own charges on the job's parts (courier, freight) are an internal cost too.
    const inspectionOnly = isInspectionOnly(invoice.job_id, ls);
    const otherCost = round2((inspectionOnly ? 0 : ls.filter((l) => l.section !== "parts").reduce((a, l) => a + Number(l.cost_aed), 0)) + hiddenCost + (invoice.job_id ? chargeTotals.get(invoice.job_id) ?? 0 : 0));
    // The recovery cost: the drivers' real prices once any trip carries one; the quotation's hidden recovery lines until then.
    const jobTrips = ((trips ?? []) as { job_id: string; price_aed: number | string | null; delivered_at: string | null; status: string }[]).filter((t) => t.job_id === invoice.job_id);
    const tripCost = round2(jobTrips.reduce((a, t) => a + (Number(t.price_aed) || 0), 0));
    const hiddenRecovery = round2(hidden.filter((l) => !l.fee_kind && l.line_type === "recovery").reduce((a, l) => a + lineCost(l), 0));
    const recoveryCost = tripCost > 0 ? tripCost : hiddenRecovery;
    const jobQuotes = ((quotes ?? []) as { job_id: string; materials_cost_aed: number | string | null; version: number; created_at: string; expected_payment_method: string | null }[]).filter((x) => x.job_id === invoice.job_id);
    // The bank fee before a payment is recorded: the invoice total at the rule of the way the customer is expected to
    // pay (newest approved quotation), without the reclaimable VAT (29 October 2026). The quotation's own hidden fee
    // line is frozen at approval and may carry an older rate, so it only counts when there is no approved quotation.
    const newestQuote = [...jobQuotes].sort((a, b) => (`${String(a.version).padStart(4, "0")}${a.created_at}` < `${String(b.version).padStart(4, "0")}${b.created_at}` ? 1 : -1))[0] ?? null;
    const feeEstimate = newestQuote ? expectedFeeCost(settings, newestQuote.expected_payment_method, invoice.total_aed) : round2(hidden.filter((l) => l.fee_kind === "bank_charge").reduce((a, l) => a + lineCost(l), 0));
    // The job's ONE commission: the newest row still carrying one (paid first), wherever it sits.
    type ComRow = { job_id: string; commission_aed: number | string | null; commission_status: string | null; version: number; created_at: string; commission_paid_at: string | null };
    const jobComs = ((comRows ?? []) as ComRow[]).filter((x) => x.job_id === invoice.job_id && x.commission_status !== "declined" && x.commission_status !== "superseded");
    const comRank = (x: ComRow) => `${x.commission_paid_at ? 1 : 0}·${String(Number(x.version)).padStart(4, "0")}·${x.created_at}`;
    const theCom = jobComs.sort((a, b) => (comRank(a) < comRank(b) ? 1 : -1))[0] ?? null;
    const commission = round2(Number(theCom?.commission_aed) || 0);
    const pkg = invoice.job_id ? pkgCosts.get(invoice.job_id) ?? null : null;
    const materialsCost = round2(jobQuotes.reduce((a, x) => a + (Number(x.materials_cost_aed) || 0), 0) + (pkg?.materials ?? 0));
    const clockMinutes = ((clockings ?? []) as { job_id: string; minutes: number | null }[]).filter((c) => c.job_id === invoice.job_id).reduce((a, c) => a + (Number(c.minutes) || 0), 0);
    const minutes = clockMinutes + ((sessions ?? []) as { job_id: string; minutes: number | null; started_at: string; ended_at: string | null }[]).filter((s) => s.job_id === invoice.job_id).reduce((a, s) => a + (s.minutes ?? (s.ended_at ? Math.round((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 60000) : 0)), 0);
    const labourMinutes = inspectionOnly && invoice.job_id ? (clockedOf.get(invoice.job_id)?.clockedMinutes ?? minutes) : minutes;
    // A package car whose installers did not clock: the package's hours are counted (never nothing).
    const packageLabourEstimated = !!pkg && pkg.labour > 0 && clockMinutes === 0;
    const labourCost = round2((labourMinutes / 60) * costRateFor(settings, job?.department) + (packageLabourEstimated ? pkg!.labour : 0));
    const stockCost = round2(((stock ?? []) as { job_id: string; quantity: number | string; unit_cost: number | string }[]).filter((s) => s.job_id === invoice.job_id).reduce((a, s) => a + Number(s.quantity) * Number(s.unit_cost), 0));
    const pays = ((payments ?? []) as Record<string, unknown>[]).map(toPayment).filter((p) => p.invoice_id === invoice.id);
    // The bank charge: the quotation's estimate until a payment is recorded; then each payment's estimate, replaced
    // by its share of the bank's ACTUAL fee once accounts record the card/link settlement (27 October 2026).
    const recorded = pays.filter((p) => p.status === "recorded");
    const fees = recorded.map(feeOf);
    const bankCharges = recorded.length ? round2(fees.reduce((a, f) => a + f.fee, 0)) : feeEstimate;
    const unsettledCards = recorded.filter((p, i) => isClearing(p.method) && !fees[i].actual).length;
    const bankChargesActual = recorded.length > 0 && unsettledCards === 0;
    const credited = round2(((credits ?? []) as { credit_of: string; taxable_aed: number | string }[]).filter((c) => c.credit_of === invoice.id).reduce((a, c) => a + Number(c.taxable_aed), 0));
    const revenue = round2(invoice.taxable_aed - credited);
    const openPos = ((pos ?? []) as { job_id: string; supplier_invoice_status: string; status: string }[]).filter((p) => p.job_id === invoice.job_id && p.status !== "cancelled" && p.supplier_invoice_status !== "received");
    const pending = pays.filter((p) => p.status === "recorded" && p.method === "cheque" && p.cheque_status === "pending");
    const why: string[] = [];
    if (openPos.length) why.push(`${openPos.length} supplier invoice${openPos.length === 1 ? "" : "s"} to follow`);
    if (pending.length) why.push("cheque pending clearance");
    if (!recorded.length && feeEstimate > 0) why.push("bank charge estimated until payment");
    if (unsettledCards) why.push("card fee estimated until the bank settles");
    if (jobTrips.some((t) => t.delivered_at && t.price_aed === null)) why.push("the driver's recovery price to come");
    if (pkg?.estimated.length) why.push(`package ${pkg.estimated.join(", ")} estimated until recorded`);
    if (packageLabourEstimated) why.push("installer time not clocked: the package's hours are counted");
    const bal = invoiceBalance(invoice, pays);
    const recheckCost = invoice.job_id ? (rechecks.get(invoice.job_id)?.cost ?? 0) : 0;
    const profit = round2(revenue - partsCost - otherCost - stockCost - labourCost - bankCharges - recoveryCost - commission - materialsCost - recheckCost);
    const ours = job?.comeback_of ? job.comeback_cause === "workmanship" || job.comeback_cause === "faulty_part" : false;
    const claimPaid = job?.comeback_claim_status === "paid" ? Number(job.comeback_claim_amount) || 0 : 0;
    const myComebacks = (cbJobs ?? []).filter((c) => c.comeback_of === invoice.job_id).map((c) => cbProfits.find((p) => p.invoice.job_id === c.id)).filter((p): p is JobProfit => !!p);
    const comebackLoss = round2(myComebacks.reduce((a, p) => a + Math.max(0, -(p.profit + (p.comeback?.claimPaid ?? 0))), 0));
    return {
      invoice,
      jobNumber: job?.job_number ?? null,
      plate: job?.vehicle ? plateText(job.vehicle) : null,
      revenue,
      partsCost,
      otherCost,
      stockCost,
      labourMinutes,
      labourCost,
      bankCharges,
      bankChargesActual,
      recoveryCost,
      commission,
      materialsCost,
      packageLabour: packageLabourEstimated ? pkg!.labour : 0,
      recheckCost,
      profit,
      provisional: why.length > 0,
      provisionalWhy: why,
      collected: bal.paid,
      balance: bal.balance,
      comeback: job?.comeback_of ? { of: job.comeback_of, ours, claimPaid } : null,
      profitAfterComeback: myComebacks.length ? round2(profit - comebackLoss) : null,
    };
  });
}

function plateText(v: { plate_number: string | null; plate_code: string | null; plate_emirate: string | null; has_plate: boolean; vin: string | null }) {
  if (!v.has_plate || !v.plate_number) return v.vin ? `VIN …${v.vin.slice(-6)}` : "No plate";
  return [v.plate_emirate, v.plate_code, v.plate_number].filter(Boolean).join(" ");
}

export type DailyProfit = { date: string; target: number; yellowPercent: number; invoicedProfit: number; invoicedTotal: number; collected: number; carry: number; effective: number; percent: number; tone: "green" | "amber" | "red"; count: number; provisional: number; /** Profit invoiced this month so far, today included. */ monthProfit: number; /** The losses on comebacks invoiced today (our fault), shown as a red line. */ comebacks: number;
  /** The owner's target box: the month against AED target × working days passed (Sunday never counts). */
  month: { targetSoFar: number; percent: number; tone: "green" | "amber"; daysPassed: number; totalWorkingDays: number; breakEvenSoFar: number; fixedMonthly: number; aboveBreakEven: number; inProgress: number; pace: number; provisional: number } };

/** Dubai midnight of a date as an ISO instant. */
function dayStart(date: string) {
  return new Date(`${date}T00:00:00+04:00`).toISOString();
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Today's figure for the panel: profit of the invoices issued today, collections today, and the
 * carry from earlier days this month (each working day's profit minus the target). Resets monthly.
 */
export async function dailyProfit(settings: Settings, date = dubaiDate()): Promise<DailyProfit> {
  const target = Number(settings.daily_profit_target_aed) || 0;
  const yellowPercent = Number(settings.profit_target_yellow_percent) || 80;
  const monthStart = `${date.slice(0, 7)}-01`;
  const [all, { data: pays }, inProgress, comp] = await Promise.all([
    jobProfits(settings, { from: dayStart(monthStart), to: dayStart(addDays(date, 1)) }),
    createAdminClient().from("payments").select("amount_aed, method, cheque_status, status, received_at, cleared_at").gte("received_at", dayStart(date)).lt("received_at", dayStart(addDays(date, 1))).eq("is_active", true),
    approvedNotInvoicedProfit(settings),
    // Section 5.4 (30 October 2026): complimentary work that left with no tax invoice is a real cost on the day it left.
    uninvoicedCompCost(settings, dayStart(monthStart), dayStart(addDays(date, 1))),
  ]);
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const today = all.filter((p) => dayOf(p.invoice.issued_at) === date);
  const earlier = all.filter((p) => dayOf(p.invoice.issued_at) < date);
  // Working days between the month start and yesterday count against the target.
  const workingDays = new Set((settings.working_days ?? []) as string[]);
  const DAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  let days = 0;
  for (let d = monthStart; d < date; d = addDays(d, 1)) if (!workingDays.size || workingDays.has(DAY_IDS[new Date(`${d}T12:00:00Z`).getUTCDay()])) days++;
  const compToday = comp.byDay.get(date) ?? 0;
  const compEarlier = round2(comp.total - compToday);
  const earlierProfit = round2(earlier.reduce((a, p) => a + p.profit, 0) - compEarlier);
  const carry = round2(earlierProfit - days * target);
  const invoicedProfit = round2(today.reduce((a, p) => a + p.profit, 0) - compToday);
  const collected = round2(((pays ?? []) as { amount_aed: number | string; method: string; cheque_status: string | null; status: string }[]).filter((p) => p.status === "recorded" && (p.method !== "cheque" || p.cheque_status === "cleared")).reduce((a, p) => a + Number(p.amount_aed), 0));
  const effective = round2(invoicedProfit + carry);
  const percent = target > 0 ? Math.round((effective / target) * 100) : 0;
  const tone: DailyProfit["tone"] = target <= 0 ? "green" : percent >= 100 ? "green" : percent >= yellowPercent ? "amber" : "red";
  const comebacks = round2(today.filter((p) => p.comeback?.ours).reduce((a, p) => a + Math.max(0, -(p.profit + (p.comeback?.claimPaid ?? 0))), 0));
  // The month against the target: working days passed (today included) and the whole month's working days; Sunday never counts.
  const monthProfit = round2(earlierProfit + invoicedProfit);
  const isWorking = (d: string) => { const id = DAY_IDS[new Date(`${d}T12:00:00Z`).getUTCDay()]; return id !== "sun" && (!workingDays.size || workingDays.has(id)); };
  let daysPassed = 0;
  for (let d = monthStart; d <= date; d = addDays(d, 1)) if (isWorking(d)) daysPassed++;
  let totalWorkingDays = 0;
  for (let d = monthStart; d.slice(0, 7) === date.slice(0, 7); d = addDays(d, 1)) if (isWorking(d)) totalWorkingDays++;
  const targetSoFar = round2(target * daysPassed);
  const monthPct = targetSoFar > 0 ? Math.round((Math.max(0, monthProfit) / targetSoFar) * 100) : 100;
  const fixedMonthly = Number(settings.monthly_fixed_costs_aed) || 0;
  const breakEvenSoFar = totalWorkingDays > 0 ? round2((fixedMonthly * daysPassed) / totalWorkingDays) : 0;
  const pace = daysPassed > 0 ? round2((monthProfit / daysPassed) * totalWorkingDays) : 0;
  const month: DailyProfit["month"] = {
    targetSoFar, percent: monthPct, tone: monthPct >= 100 ? "green" : "amber", daysPassed, totalWorkingDays,
    breakEvenSoFar, fixedMonthly, aboveBreakEven: round2(monthProfit - breakEvenSoFar), inProgress, pace,
    provisional: all.filter((p) => p.provisional).length,
  };
  return { date, target, yellowPercent, invoicedProfit, invoicedTotal: round2(today.reduce((a, p) => a + p.invoice.total_aed, 0)), collected, carry, effective, percent, tone, monthProfit, count: today.length, provisional: today.filter((p) => p.provisional).length, comebacks, month };
}

/** The bank fee options for quoteTotals from the way the customer is expected to pay (the one rule, without VAT). */
function feeOpts(settings: Settings, method: unknown): { bankChargePercent: number; bankChargeFixed: number } {
  const rule = expectedFeeRule(settings, typeof method === "string" ? method : null);
  return { bankChargePercent: rule.msfPercent, bankChargeFixed: rule.txnFee };
}

/** "In progress (approved, not invoiced)": the expected profit of approved quotations on open jobs with no tax invoice yet. */
export async function approvedNotInvoicedProfit(settings: Settings): Promise<number> {
  const admin = createAdminClient();
  const { data: qs } = await admin.from("quotations").select("id, job_id, vehicle_id, film_rolls_est, tint_spec, discount_percent, vat_percent, payment_by_card, rounded_total_aed, expected_payment_method, discount_kind, discount_value, discount_scope, commission_kind, commission_value, commission_status, materials_cost_aed, deposit_mode, deposit_value, job:jobs!quotations_job_id_fkey!inner(id, is_open, department)").eq("kind", "quotation").eq("status", "approved").eq("is_active", true).eq("job.is_open", true);
  const rows = ((qs ?? []) as unknown as (Record<string, unknown> & { job: { id: string; is_open: boolean; department: string | null } })[]);
  if (!rows.length) return 0;
  const jobIds = Array.from(new Set(rows.map((r) => r.job.id)));
  const { data: taxed } = await admin.from("invoices").select("job_id").in("job_id", jobIds).eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true);
  const taxedSet = new Set((taxed ?? []).map((t) => t.job_id as string));
  const open = rows.filter((r) => !taxedSet.has(r.job.id));
  if (!open.length) return 0;
  const { data: lineRows } = await admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", open.map((r) => String(r.id))).eq("is_active", true);
  const charges = await chargeTotalsByJob(Array.from(new Set(open.map((r) => r.job.id))));
  let total = 0;
  // A job with an original and an additional quotation: the suppliers' charges on its parts count once, not per quotation.
  const charged = new Set<string>();
  for (const r of open) {
    const lines = ((lineRows ?? []) as Record<string, unknown>[]).filter((l) => l.quotation_id === r.id).map(toLine);
    const supplierCharges = charged.has(r.job.id) ? 0 : (charges.get(r.job.id) ?? 0);
    charged.add(r.job.id);
    const totals = quoteTotals(lines, toQuote(r), { technicianCostRate: costRateFor(settings, r.job.department), supplierCharges, ...feeOpts(settings, r.expected_payment_method), packageCosting: await costingOf(settings, r, lines) });
    total += totals.profit;
  }
  return round2(total);
}

export type { PaymentRow };

export type AdvisorDay = {
  date: string;
  /** Profit before VAT, after every job cost, of the quotations customers approved today. One team figure. */
  todayProfit: number;
  dailyTarget: number;
  percent: number;
  /** Approved so far this month (the whole team). */
  monthApproved: number;
  /** What must be approved per working day from now to land the month on target. */
  perDayNeeded: number;
  workingDaysLeft: number;
};

const ADVISOR_QUOTE_SELECT = "id, job_id, vehicle_id, film_rolls_est, tint_spec, discount_percent, vat_percent, payment_by_card, rounded_total_aed, expected_payment_method, discount_kind, discount_value, discount_scope, commission_kind, commission_value, commission_status, materials_cost_aed, deposit_mode, deposit_value, responded_at, sent_by, status, number, version, job:jobs!quotations_job_id_fkey(id, department, gated_in_by)";

/** The profit of each approved quotation, from its own lines and the department's cost rate. */
export async function approvedQuoteProfits(settings: Settings, fromIso: string): Promise<{ id: string; jobId: string | null; respondedAt: string; sentBy: string | null; profit: number; net: number }[]> {
  const admin = createAdminClient();
  const { data: qs } = await admin.from("quotations").select(ADVISOR_QUOTE_SELECT).eq("kind", "quotation").eq("status", "approved").eq("is_active", true).gte("responded_at", fromIso);
  const rows = ((qs ?? []) as unknown as (Record<string, unknown> & { job: { id: string; department: string | null } | null })[]);
  if (!rows.length) return [];
  const { data: lineRows } = await admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", rows.map((r) => String(r.id))).eq("is_active", true);
  const jobIds = Array.from(new Set(rows.map((r) => r.job?.id).filter((x): x is string => !!x)));
  const charges = await chargeTotalsByJob(jobIds);
  // The suppliers' charges on a job's parts ride on its FIRST approved quotation only (an additional quotation never counts them again).
  const { data: firsts } = jobIds.length ? await admin.from("quotations").select("id, job_id, responded_at").in("job_id", jobIds).eq("kind", "quotation").eq("status", "approved").eq("is_active", true).order("responded_at") : { data: [] as { id: string; job_id: string; responded_at: string }[] };
  const firstOf = new Map<string, string>();
  for (const f of (firsts ?? []) as { id: string; job_id: string }[]) if (!firstOf.has(f.job_id)) firstOf.set(f.job_id, f.id);
  return Promise.all(rows.map(async (r) => {
    const lines = ((lineRows ?? []) as Record<string, unknown>[]).filter((l) => l.quotation_id === r.id).map(toLine);
    const supplierCharges = r.job?.id && firstOf.get(r.job.id) === String(r.id) ? (charges.get(r.job.id) ?? 0) : 0;
    const totals = quoteTotals(lines, toQuote(r), { technicianCostRate: costRateFor(settings, r.job?.department), supplierCharges, ...feeOpts(settings, r.expected_payment_method), packageCosting: await costingOf(settings, r, lines) });
    return { id: String(r.id), jobId: r.job?.id ?? null, respondedAt: String(r.responded_at), sentBy: (r.sent_by as string | null) ?? null, profit: totals.profit, net: totals.net };
  }));
}

/** ONE profit calculation (30 October 2026, section 3): a quotation with a package is costed with the same figures as the editor. */
async function costingOf(settings: Settings, r: Record<string, unknown>, lines: QuoteLine[]) {
  if (!hasPackageLine(lines)) return null;
  const { packageCostingForQuote } = await import("./quote-data");
  return packageCostingForQuote(settings, { vehicle_id: (r.vehicle_id as string | null) ?? null, film_rolls_est: (r.film_rolls_est as number | null) ?? null, tint_spec: r.tint_spec }, true);
}

/** Working days of the month on the Dubai clock: passed (today included) and the whole month. Sunday never counts. */
export function workingDaysOf(settings: Settings, date: string): { passed: number; total: number; leftFromNow: number } {
  const workingDays = new Set((settings.working_days ?? []) as string[]);
  const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const isWorking = (d: string) => { const id = DAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]; return id !== "sun" && (!workingDays.size || workingDays.has(id)); };
  const monthStart = `${date.slice(0, 7)}-01`;
  let passed = 0;
  let total = 0;
  for (let d = monthStart; d.slice(0, 7) === date.slice(0, 7); d = addDays(d, 1)) {
    if (!isWorking(d)) continue;
    total++;
    if (d <= date) passed++;
  }
  const leftFromNow = total - passed + (isWorking(date) ? 1 : 0);
  return { passed, total, leftFromNow: Math.max(1, leftFromNow) };
}

/**
 * The advisors' day: the profit of the work customers approved (never sales value), one team figure, against the
 * owner's daily target; and what must be approved per working day from now to land the month. No costs are exposed.
 */
export async function advisorDay(settings: Settings, date = dubaiDate()): Promise<AdvisorDay> {
  const monthStart = `${date.slice(0, 7)}-01`;
  const all = await approvedQuoteProfits(settings, dayStart(monthStart));
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const todayProfit = round2(all.filter((p) => dayOf(p.respondedAt) === date).reduce((a, p) => a + p.profit, 0));
  const monthApproved = round2(all.reduce((a, p) => a + p.profit, 0));
  const dailyTarget = Number(settings.daily_profit_target_aed) || 0;
  const days = workingDaysOf(settings, date);
  const monthlyTarget = dailyTarget * days.total;
  const perDayNeeded = round2(Math.max(0, monthlyTarget - monthApproved) / days.leftFromNow);
  return { date, todayProfit, dailyTarget, percent: dailyTarget > 0 ? Math.max(0, Math.round((todayProfit / dailyTarget) * 100)) : 0, monthApproved, perDayNeeded, workingDaysLeft: days.leftFromNow };
}

export type AdvisorMonth = { sent: number; approved: number; approvalPercent: number; profitApproved: number; avgMarginPercent: number; deliveredOnTime: number; deliveredWithDate: number };

/** "My month": one advisor's own figures, shown only to him. Never a ranking, never a comparison. */
export async function advisorMonthOf(settings: Settings, staffId: string, date = dubaiDate()): Promise<AdvisorMonth> {
  const admin = createAdminClient();
  const monthStart = dayStart(`${date.slice(0, 7)}-01`);
  const [{ count: sent }, approvedAll, { data: outs }] = await Promise.all([
    admin.from("quotations").select("id", { count: "exact", head: true }).eq("kind", "quotation").eq("is_active", true).eq("sent_by", staffId).gte("sent_at", monthStart),
    approvedQuoteProfits(settings, monthStart),
    admin.from("jobs").select("gated_out_at, promised_at").eq("gated_in_by", staffId).gte("gated_out_at", monthStart).not("gated_out_at", "is", null),
  ]);
  const mine = approvedAll.filter((p) => p.sentBy === staffId);
  const profitApproved = round2(mine.reduce((a, p) => a + p.profit, 0));
  const net = mine.reduce((a, p) => a + p.net, 0);
  const withDate = ((outs ?? []) as { gated_out_at: string; promised_at: string | null }[]).filter((j) => !!j.promised_at);
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const onTime = withDate.filter((j) => dayOf(j.gated_out_at) <= String(j.promised_at).slice(0, 10)).length;
  return {
    sent: sent ?? 0,
    approved: mine.length,
    approvalPercent: sent ? Math.round((mine.length / sent) * 100) : 0,
    profitApproved,
    avgMarginPercent: net > 0 ? Math.round((profitApproved / net) * 100) : 0,
    deliveredOnTime: onTime,
    deliveredWithDate: withDate.length,
  };
}

/**
 * The package costs of these jobs (30 October 2026, section 3), from their approved quotations' package lines costed
 * with the shared figures: film, tint and ceramic replaced by what was really recorded on the job (film rolls, the
 * ceramic used), consumables and the installer hours from the package. ONE calculation with the editor's.
 */
export async function packageCostsForJobs(settings: Settings, jobIds: string[]): Promise<Map<string, { materials: number; labour: number; estimated: string[] }>> {
  const out = new Map<string, { materials: number; labour: number; estimated: string[] }>();
  if (!jobIds.length) return out;
  const admin = createAdminClient();
  const { data: qs } = await admin.from("quotations").select("id, job_id, vehicle_id, film_rolls_est, tint_spec, discount_percent, vat_percent").in("job_id", jobIds).eq("kind", "quotation").eq("status", "approved").eq("is_active", true);
  const quotes = (qs ?? []) as { id: string; job_id: string; vehicle_id: string | null; film_rolls_est: number | null; tint_spec: unknown; discount_percent: number; vat_percent: number }[];
  if (!quotes.length) return out;
  const { data: lineRows } = await admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", quotes.map((q) => q.id)).eq("is_active", true).not("package_key", "is", null);
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map(toLine);
  if (!lines.length) return out;
  const withPkg = Array.from(new Set(quotes.filter((q) => lines.some((l) => l.quotation_id === q.id)).map((q) => q.job_id)));
  const [{ data: film }, { data: cer }] = await Promise.all([
    admin.from("film_usage").select("job_id, cost_aed, roll:film_rolls(kind)").in("job_id", withPkg).eq("is_active", true),
    admin.from("ceramic_usage").select("job_id, cost_aed").in("job_id", withPkg).eq("is_active", true),
  ]);
  const { packageCostingForQuote } = await import("./quote-data");
  for (const q of quotes) {
    const ls = lines.filter((l) => l.quotation_id === q.id);
    if (!ls.length) continue;
    const costing = await packageCostingForQuote(settings, q, true);
    const t = quoteTotals(ls, { discount_percent: Number(q.discount_percent) || 0, vat_percent: Number(q.vat_percent) || 5 }, { packageCosting: costing });
    const cur = out.get(q.job_id) ?? { materials: 0, labour: 0, estimated: [] as string[], est: { film: 0, tint: 0, ceramic: 0, consumables: 0 } };
    const e = (cur as unknown as { est: { film: number; tint: number; ceramic: number; consumables: number } }).est;
    e.film += t.packageMaterials.film;
    e.tint += t.packageMaterials.tint;
    e.ceramic += t.packageMaterials.ceramic;
    e.consumables += t.packageMaterials.consumables;
    cur.labour = round2(cur.labour + t.bodyshopLabourCost);
    out.set(q.job_id, cur);
  }
  for (const [jobId, cur] of out) {
    const e = (cur as unknown as { est: { film: number; tint: number; ceramic: number; consumables: number } }).est;
    const realFilm = round2(((film ?? []) as unknown as { job_id: string; cost_aed: number | string; roll: { kind: string } | null }[]).filter((u) => u.job_id === jobId && u.roll?.kind !== "tint").reduce((a, u) => a + (Number(u.cost_aed) || 0), 0));
    const realTint = round2(((film ?? []) as unknown as { job_id: string; cost_aed: number | string; roll: { kind: string } | null }[]).filter((u) => u.job_id === jobId && u.roll?.kind === "tint").reduce((a, u) => a + (Number(u.cost_aed) || 0), 0));
    const realCeramic = round2(((cer ?? []) as { job_id: string; cost_aed: number | string }[]).filter((u) => u.job_id === jobId).reduce((a, u) => a + (Number(u.cost_aed) || 0), 0));
    const estimated: string[] = [];
    const pick = (real: number, est: number, word: string) => {
      if (real > 0) return real;
      if (est > 0) estimated.push(word);
      return est;
    };
    const materials = round2(pick(realFilm, e.film, "film") + pick(realTint, e.tint, "tint") + pick(realCeramic, e.ceramic, "ceramic") + e.consumables);
    out.set(jobId, { materials, labour: cur.labour, estimated });
  }
  return out;
}
