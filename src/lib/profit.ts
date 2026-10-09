import "server-only";
import { dubaiDate } from "./jobs";
import { round2 } from "./money";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { INVOICE_SELECT, PAYMENT_SELECT, invoiceBalance, toInvoice, toPayment, type InvoiceRow, type PaymentRow } from "./invoice-data";

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
  profit: number;
  provisional: boolean;
  provisionalWhy: string[];
  collected: number;
  balance: number;
};

/**
 * Profit per invoice: the selling price before VAT, minus parts cost, minus the cost of Other and
 * Recovery lines, minus stock items used, minus clocked technician time at the cost rate, minus bank
 * charges. Counted on the invoice date. Provisional while a supplier invoice is still to follow.
 */
export async function jobProfits(settings: Settings, filter: { from?: string; to?: string; jobIds?: string[]; limit?: number } = {}): Promise<JobProfit[]> {
  const admin = createAdminClient();
  let q = admin.from("invoices").select(INVOICE_SELECT + ", job:jobs(job_number, vehicle:vehicles(plate_number, plate_code, plate_emirate, has_plate, vin))").eq("is_active", true).eq("status", "issued").eq("kind", "tax_invoice").order("issued_at", { ascending: false });
  if (filter.from) q = q.gte("issued_at", filter.from);
  if (filter.to) q = q.lt("issued_at", filter.to);
  if (filter.jobIds) q = q.in("job_id", filter.jobIds);
  if (filter.limit) q = q.limit(filter.limit);
  const { data } = await q;
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  if (!rows.length) return [];
  const invoices = rows.map((r) => ({ invoice: toInvoice(r), job: r.job as { job_number: string; vehicle: { plate_number: string | null; plate_code: string | null; plate_emirate: string | null; has_plate: boolean; vin: string | null } | null } | null }));
  const ids = invoices.map((i) => i.invoice.id);
  const jobIds = Array.from(new Set(invoices.map((i) => i.invoice.job_id).filter((x): x is string => !!x)));
  const rate = Number(settings.technician_cost_rate_aed) || 0;
  const [{ data: lines }, { data: payments }, { data: sessions }, { data: stock }, { data: pos }, { data: credits }] = await Promise.all([
    admin.from("invoice_lines").select("invoice_id, section, cost_aed, amount_aed").in("invoice_id", ids).eq("is_active", true),
    admin.from("payments").select(PAYMENT_SELECT).in("invoice_id", ids).eq("is_active", true),
    jobIds.length ? admin.from("work_sessions").select("job_id, minutes, started_at, ended_at").in("job_id", jobIds).eq("is_active", true) : Promise.resolve({ data: [] }),
    jobIds.length ? admin.from("stock_issues").select("job_id, quantity, unit_cost").in("job_id", jobIds).eq("is_active", true) : Promise.resolve({ data: [] }),
    jobIds.length ? admin.from("purchase_orders").select("job_id, supplier_invoice_status, status").in("job_id", jobIds).eq("is_active", true) : Promise.resolve({ data: [] }),
    admin.from("invoices").select("credit_of, taxable_aed").in("credit_of", ids).eq("is_active", true).eq("status", "issued"),
  ]);
  const byInvoice = (id: string) => ((lines ?? []) as { invoice_id: string; section: string; cost_aed: number | string; amount_aed: number | string }[]).filter((l) => l.invoice_id === id);
  return invoices.map(({ invoice, job }) => {
    const ls = byInvoice(invoice.id);
    const partsCost = round2(ls.filter((l) => l.section === "parts").reduce((a, l) => a + Number(l.cost_aed), 0));
    const otherCost = round2(ls.filter((l) => l.section !== "parts").reduce((a, l) => a + Number(l.cost_aed), 0));
    const minutes = ((sessions ?? []) as { job_id: string; minutes: number | null; started_at: string; ended_at: string | null }[]).filter((s) => s.job_id === invoice.job_id).reduce((a, s) => a + (s.minutes ?? (s.ended_at ? Math.round((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 60000) : 0)), 0);
    const labourCost = round2((minutes / 60) * rate);
    const stockCost = round2(((stock ?? []) as { job_id: string; quantity: number | string; unit_cost: number | string }[]).filter((s) => s.job_id === invoice.job_id).reduce((a, s) => a + Number(s.quantity) * Number(s.unit_cost), 0));
    const pays = ((payments ?? []) as Record<string, unknown>[]).map(toPayment).filter((p) => p.invoice_id === invoice.id);
    const bankCharges = round2(pays.filter((p) => p.status === "recorded").reduce((a, p) => a + p.bank_charge_aed, 0));
    const credited = round2(((credits ?? []) as { credit_of: string; taxable_aed: number | string }[]).filter((c) => c.credit_of === invoice.id).reduce((a, c) => a + Number(c.taxable_aed), 0));
    const revenue = round2(invoice.taxable_aed - credited);
    const openPos = ((pos ?? []) as { job_id: string; supplier_invoice_status: string; status: string }[]).filter((p) => p.job_id === invoice.job_id && p.status !== "cancelled" && p.supplier_invoice_status !== "received");
    const pending = pays.filter((p) => p.status === "recorded" && p.method === "cheque" && p.cheque_status === "pending");
    const why: string[] = [];
    if (openPos.length) why.push(`${openPos.length} supplier invoice${openPos.length === 1 ? "" : "s"} to follow`);
    if (pending.length) why.push("cheque pending clearance");
    const bal = invoiceBalance(invoice, pays);
    return {
      invoice,
      jobNumber: job?.job_number ?? null,
      plate: job?.vehicle ? plateText(job.vehicle) : null,
      revenue,
      partsCost,
      otherCost,
      stockCost,
      labourMinutes: minutes,
      labourCost,
      bankCharges,
      profit: round2(revenue - partsCost - otherCost - stockCost - labourCost - bankCharges),
      provisional: why.length > 0,
      provisionalWhy: why,
      collected: bal.paid,
      balance: bal.balance,
    };
  });
}

function plateText(v: { plate_number: string | null; plate_code: string | null; plate_emirate: string | null; has_plate: boolean; vin: string | null }) {
  if (!v.has_plate || !v.plate_number) return v.vin ? `VIN …${v.vin.slice(-6)}` : "No plate";
  return [v.plate_emirate, v.plate_code, v.plate_number].filter(Boolean).join(" ");
}

export type DailyProfit = { date: string; target: number; yellowPercent: number; invoicedProfit: number; invoicedTotal: number; collected: number; carry: number; effective: number; percent: number; tone: "green" | "amber" | "red"; count: number; provisional: number };

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
  const [all, { data: pays }] = await Promise.all([
    jobProfits(settings, { from: dayStart(monthStart), to: dayStart(addDays(date, 1)) }),
    createAdminClient().from("payments").select("amount_aed, method, cheque_status, status, received_at, cleared_at").gte("received_at", dayStart(date)).lt("received_at", dayStart(addDays(date, 1))).eq("is_active", true),
  ]);
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const today = all.filter((p) => dayOf(p.invoice.issued_at) === date);
  const earlier = all.filter((p) => dayOf(p.invoice.issued_at) < date);
  // Working days between the month start and yesterday count against the target.
  const workingDays = new Set((settings.working_days ?? []) as string[]);
  const DAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  let days = 0;
  for (let d = monthStart; d < date; d = addDays(d, 1)) if (!workingDays.size || workingDays.has(DAY_IDS[new Date(`${d}T12:00:00Z`).getUTCDay()])) days++;
  const earlierProfit = round2(earlier.reduce((a, p) => a + p.profit, 0));
  const carry = round2(earlierProfit - days * target);
  const invoicedProfit = round2(today.reduce((a, p) => a + p.profit, 0));
  const collected = round2(((pays ?? []) as { amount_aed: number | string; method: string; cheque_status: string | null; status: string }[]).filter((p) => p.status === "recorded" && (p.method !== "cheque" || p.cheque_status === "cleared")).reduce((a, p) => a + Number(p.amount_aed), 0));
  const effective = round2(invoicedProfit + carry);
  const percent = target > 0 ? Math.round((effective / target) * 100) : 0;
  const tone: DailyProfit["tone"] = target <= 0 ? "green" : percent >= 100 ? "green" : percent >= yellowPercent ? "amber" : "red";
  return { date, target, yellowPercent, invoicedProfit, invoicedTotal: round2(today.reduce((a, p) => a + p.invoice.total_aed, 0)), collected, carry, effective, percent, tone, count: today.length, provisional: today.filter((p) => p.provisional).length };
}

export type { PaymentRow };
