import "server-only";
import { BODYSHOP_KINDS } from "./bodyshop-kinds";
import { dubaiDate } from "./jobs";
import { costRateFor, jobProfits } from "./profit";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";

/**
 * The advisor bonus, automatic with the owner deciding. It counts only tax-invoiced, fully paid jobs whose
 * PURE PROFIT (the same figure as the profit target) is at least AED 12,000, with the bodyshop lines (PPF,
 * coloured PPF, tint, paint, colour change, peelable) taken out of both the check and the bonus. The bonus
 * goes to the advisor on the job at the default rate from Settings (5%), overridable per invoice by the owner
 * with a reason. The period runs from the 26th to the 25th, matching salary day. A credit note later removes
 * its bonus; one already approved is deducted from the next period.
 */

export const ADVISOR_BONUS_MIN_PROFIT = 12000;

export type BonusPeriod = { key: string; start: string; end: string; label: string };

/** The salary period a Dubai date belongs to: the 26th starts the NEXT month's period. */
export function bonusPeriodOf(date = dubaiDate()): BonusPeriod {
  const [y, m, d] = date.split("-").map(Number);
  const endMonth = d >= 26 ? new Date(Date.UTC(y, m, 25)) : new Date(Date.UTC(y, m - 1, 25));
  const start = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - 1, 26));
  const key = endMonth.toISOString().slice(0, 7);
  const words = (x: Date) => x.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const monthName = endMonth.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  return { key, start: start.toISOString().slice(0, 10), end: endMonth.toISOString().slice(0, 10), label: `${words(start)} – ${words(endMonth)} (${monthName} period)` };
}

export type BonusRow = {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  jobId: string | null;
  jobNumber: string | null;
  plate: string | null;
  advisorId: string | null;
  advisorName: string;
  /** The pure profit with the bodyshop lines taken out. */
  profit: number;
  ratePercent: number;
  overrideReason: string | null;
  bonus: number;
  /** A credit note took this invoice's already-approved bonus back. */
  clawback: boolean;
  /** The card/link fee in this profit is still the estimate (the bank has not settled the payment yet). */
  cardFeeEstimated?: boolean;
};
export type BonusView = { period: BonusPeriod; rows: BonusRow[]; approved: { at: string; byName: string | null } | null; total: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The live (or frozen, once approved) bonus rows of one period. */
export async function bonusRowsOf(settings: Settings, periodKey?: string): Promise<BonusView> {
  const admin = createAdminClient();
  const period = periodKey ? bonusPeriodOf(`${periodKey}-25`) : bonusPeriodOf();
  const { data: approvedRow } = await admin.from("advisor_bonus_periods").select("period, rows, total_aed, approved_at, approver:staff!advisor_bonus_periods_approved_by_fkey(display_name)").eq("period", period.key).maybeSingle();
  if (approvedRow) {
    const rows = (approvedRow.rows ?? []) as BonusRow[];
    return { period, rows, approved: { at: approvedRow.approved_at as string, byName: (approvedRow.approver as unknown as { display_name: string } | null)?.display_name ?? null }, total: Number(approvedRow.total_aed) || 0 };
  }
  const profits = await jobProfits(settings, { from: `${period.start}T00:00:00+04:00`, to: `${period.end}T23:59:59+04:00`, noComebacks: false });
  const fullyPaid = profits.filter((p) => p.invoice.kind === "tax_invoice" && p.balance <= 0.005 && !p.invoice.credit_of);
  const jobIds = Array.from(new Set(fullyPaid.map((p) => p.invoice.job_id).filter((x): x is string => !!x)));
  // The bodyshop portion of each job: its bodyshop lines' sale value, less the bodyshop-only costs (materials
  // and the bodyshop tablets' clocked labour), comes out of the profit before anything else.
  const [{ data: bsLines }, { data: clockings }, { data: jobRows }, { data: overrides }, { data: staffRows }] = await Promise.all([
    jobIds.length ? admin.from("quotation_lines").select("line_total, quotation:quotations!inner(job_id, status), service:services(bodyshop_kind)").in("quotation.job_id", jobIds).eq("quotation.status", "approved").eq("is_active", true) : Promise.resolve({ data: [] }),
    jobIds.length ? admin.from("bodyshop_clockings").select("job_id, minutes, department_id").in("job_id", jobIds) : Promise.resolve({ data: [] }),
    jobIds.length ? admin.from("jobs").select("id, gated_in_by, advisor_id").in("id", jobIds) : Promise.resolve({ data: [] }),
    admin.from("advisor_bonus_overrides").select("invoice_id, rate_percent, reason"),
    admin.from("staff").select("id, display_name"),
  ]);
  const nameOf = new Map(((staffRows ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  // Section 4: the bonus follows the ADVISOR IN CHARGE (the owner reassigns it by changing him, or by the per-invoice override).
  const advisorOf = new Map(((jobRows ?? []) as { id: string; gated_in_by: string | null; advisor_id: string | null }[]).map((j) => [j.id, j.advisor_id ?? j.gated_in_by]));
  const overrideOf = new Map(((overrides ?? []) as { invoice_id: string; rate_percent: number | string; reason: string | null }[]).map((o) => [o.invoice_id, o]));
  const bsRevenue = new Map<string, number>();
  for (const l of (bsLines ?? []) as unknown as { line_total: number | string | null; quotation: { job_id: string } | null; service: { bodyshop_kind: string | null } | null }[]) {
    const kind = l.service?.bodyshop_kind;
    if (!kind || !(BODYSHOP_KINDS as readonly string[]).includes(kind) || !l.quotation?.job_id) continue;
    bsRevenue.set(l.quotation.job_id, (bsRevenue.get(l.quotation.job_id) ?? 0) + (Number(l.line_total) || 0));
  }
  const bsLabour = new Map<string, number>();
  for (const c of (clockings ?? []) as { job_id: string; minutes: number | string | null; department_id: string | null }[]) {
    bsLabour.set(c.job_id, (bsLabour.get(c.job_id) ?? 0) + ((Number(c.minutes) || 0) / 60) * costRateFor(settings, c.department_id));
  }
  const defaultRate = Number(settings.advisor_bonus_percent) || 5;
  const rows: BonusRow[] = [];
  for (const p of fullyPaid) {
    const jobId = p.invoice.job_id;
    const bonusProfit = round2(p.profit - (jobId ? (bsRevenue.get(jobId) ?? 0) : 0) + (jobId ? bsLabour.get(jobId) ?? 0 : 0) + p.materialsCost);
    if (bonusProfit < ADVISOR_BONUS_MIN_PROFIT) continue;
    const advisorId = jobId ? (advisorOf.get(jobId) ?? null) : null;
    const o = overrideOf.get(p.invoice.id);
    const rate = o ? Number(o.rate_percent) : defaultRate;
    rows.push({
      invoiceId: p.invoice.id,
      invoiceNumber: p.invoice.number,
      date: p.invoice.issued_at.slice(0, 10),
      jobId,
      jobNumber: p.jobNumber,
      plate: p.plate,
      advisorId,
      advisorName: advisorId ? (nameOf.get(advisorId) ?? "Advisor") : "No advisor on the job",
      profit: bonusProfit,
      ratePercent: rate,
      overrideReason: o?.reason ?? null,
      bonus: round2((bonusProfit * rate) / 100),
      clawback: false,
      cardFeeEstimated: p.provisionalWhy.includes("card fee estimated until the bank settles"),
    });
  }
  // Credit notes this period against invoices whose bonus was already approved: the bonus comes back off.
  const { data: credits } = await admin.from("invoices").select("id, number, credit_of, issued_at, job_id").eq("kind", "credit_note").eq("is_active", true).eq("status", "issued").gte("issued_at", `${period.start}T00:00:00+04:00`).lte("issued_at", `${period.end}T23:59:59+04:00`);
  const creditedIds = ((credits ?? []) as { credit_of: string | null }[]).map((c) => c.credit_of).filter((x): x is string => !!x);
  if (creditedIds.length) {
    const { data: priorPeriods } = await admin.from("advisor_bonus_periods").select("period, rows");
    for (const prior of (priorPeriods ?? []) as { period: string; rows: BonusRow[] }[]) {
      for (const r of prior.rows ?? []) {
        if (!creditedIds.includes(r.invoiceId) || r.clawback || r.bonus <= 0) continue;
        rows.push({ ...r, date: period.start, bonus: -r.bonus, clawback: true, overrideReason: `Credit note on ${r.invoiceNumber}: the ${prior.period} bonus comes back off` });
      }
    }
  }
  rows.sort((a, b) => (a.advisorName + a.date).localeCompare(b.advisorName + b.date));
  return { period, rows, approved: null, total: round2(rows.reduce((a, r) => a + r.bonus, 0)) };
}
