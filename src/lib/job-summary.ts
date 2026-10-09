import "server-only";
import { dubaiDate } from "./jobs";
import { round2 } from "./money";
import { notifyManagers, notifyRoles } from "./notifications";
import { LINE_SELECT, PART_SELECT, approvedQuotations, toLine, toPart } from "./quote-data";
import { isHidden, isUnchosen, lineCost, lineTotal, quoteTotals } from "./quotes";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { WORK_SESSION_SELECT, sessionMinutes, type WorkSessionRow } from "./work-data";

export type Verdict = "good" | "acceptable" | "talk";
export const VERDICT_LABELS: Record<Verdict, string> = { good: "Good", acceptable: "Acceptable", talk: "Needs a talk" };

export type JobSummary = {
  hoursCharged: number;
  minutesUsed: number;
  perTechnician: { id: string; name: string; minutes: number; managerSendbacks: number; qcSendbacks: number }[];
  promisedAt: string | null;
  finishedOn: string;
  daysLate: number;
  qcRounds: number;
  managerSendbacks: number;
  pauses: { count: number; minutes: number; notAccepted: number };
  parts: { count: number; late: number };
  /** Owner only: the profit the quotation promised, and what it looks like with the real hours and parts cost. */
  quotedProfit: number | null;
  actualProfit: number | null;
  verdict: Verdict;
  reasons: string[];
};

const DAY = 86400000;

/**
 * The job summary at QC pass: hours charged against hours used (per technician), on time or not, how
 * many QC rounds and send-backs, the pauses, the parts, and the profit against the quotation. The
 * verdict is a plain rule of thumb the owner can read at a glance.
 */
export async function buildJobSummary(jobId: string, settings: Settings): Promise<JobSummary> {
  const admin = createAdminClient();
  const quotes = await approvedQuotations(jobId);
  const qids = quotes.map((q) => q.id);
  const [{ data: job }, { data: lines }, { data: sessions }, { data: techRows }, { data: pauses }, { data: qcs }, { data: parts }, { data: qLines }, { data: pos }] = await Promise.all([
    admin.from("jobs").select("promised_at, work_sendbacks, plan_start_date, department").eq("id", jobId).maybeSingle(),
    admin.from("work_lines").select("hours_quoted").eq("job_id", jobId).eq("is_active", true),
    admin.from("work_sessions").select(WORK_SESSION_SELECT).eq("job_id", jobId).eq("is_active", true),
    admin.from("job_technicians").select("staff_id, manager_sendbacks, qc_sendbacks, staff:staff!job_technicians_staff_id_fkey(display_name)").eq("job_id", jobId).eq("is_active", true),
    admin.from("work_pauses").select("minutes, accepted, ended_at, started_at").eq("job_id", jobId).eq("is_active", true),
    admin.from("qc_checks").select("round, status").eq("job_id", jobId).eq("is_active", true),
    admin.from("part_items").select(PART_SELECT + ", expected_date, received_qty, final_cost_aed, return_status").eq("job_id", jobId).eq("is_active", true).neq("order_status", "none"),
    qids.length ? admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", qids).eq("is_active", true) : Promise.resolve({ data: [] }),
    admin.from("purchase_orders").select("id, status").eq("job_id", jobId).eq("is_active", true),
  ]);
  const hoursCharged = round2((lines ?? []).reduce((a, l) => a + (Number(l.hours_quoted) || 0), 0));
  const ss = (sessions ?? []) as WorkSessionRow[];
  const byTech = new Map<string, number>();
  for (const s of ss) byTech.set(s.technician_id, (byTech.get(s.technician_id) ?? 0) + sessionMinutes(s));
  const minutesUsed = Array.from(byTech.values()).reduce((a, b) => a + b, 0);
  type TechRow = { staff_id: string; manager_sendbacks: number | string; qc_sendbacks: number | string; staff: { display_name: string } | null };
  const techs = ((techRows ?? []) as unknown as TechRow[]).map((t) => ({ id: t.staff_id, name: t.staff?.display_name ?? "Technician", minutes: byTech.get(t.staff_id) ?? 0, managerSendbacks: Number(t.manager_sendbacks) || 0, qcSendbacks: Number(t.qc_sendbacks) || 0 }));
  for (const [id, minutes] of byTech) if (!techs.some((t) => t.id === id)) techs.push({ id, name: "Technician", minutes, managerSendbacks: 0, qcSendbacks: 0 });
  const today = dubaiDate();
  const promisedAt = job?.promised_at ?? null;
  const daysLate = promisedAt ? Math.max(0, Math.round((Date.parse(today) - Date.parse(promisedAt)) / DAY)) : 0;
  const qcRounds = Math.max(1, (qcs ?? []).length);
  const pauseRows = (pauses ?? []) as { minutes: number | string | null; accepted: boolean; ended_at: string | null; started_at: string }[];
  const pauseMinutes = pauseRows.reduce((a, p) => a + (p.minutes !== null ? Number(p.minutes) : p.ended_at ? 0 : Math.round((Date.now() - Date.parse(p.started_at)) / 60000)), 0);
  const partRows = ((parts ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ ...toPart(r), expected_date: (r.expected_date as string | null) ?? null, final_cost_aed: r.final_cost_aed === null || r.final_cost_aed === undefined ? null : Number(r.final_cost_aed), return_status: String(r.return_status ?? "none") })).filter((p) => p.return_status !== "returned");
  const lateParts = partRows.filter((p) => p.expected_date && job?.plan_start_date && p.expected_date > job.plan_start_date).length;
  // Profit: the quotation's own figure, then the same with the real hours and the real parts cost.
  const rate = Number((settings.technician_cost_rate_by_department as Record<string, number> | undefined)?.[job?.department ?? ""] ?? settings.technician_cost_rate_aed) || 0;
  let quotedProfit: number | null = null;
  let actualProfit: number | null = null;
  if (quotes.length) {
    const all = ((qLines ?? []) as Record<string, unknown>[]).map(toLine);
    let quoted = 0;
    let revenue = 0;
    let otherCost = 0;
    let partsCostQuoted = 0;
    for (const q of quotes) {
      const qls = all.filter((l) => l.quotation_id === q.id && !isUnchosen(l));
      const t = quoteTotals(qls, { discount_percent: q.discount_percent, vat_percent: q.vat_percent }, { technicianCostRate: rate, bankChargePercent: Number(settings.bank_charge_fee_percent) || 0 });
      quoted += t.profit;
      revenue += t.net;
      partsCostQuoted += t.partsCost;
      otherCost += t.otherCost + t.bankCharge;
      void isHidden;
      void lineTotal;
      void lineCost;
    }
    const partsCostActual = round2(partRows.reduce((a, p) => a + (p.final_cost_aed ?? p.cost_aed ?? 0) * (Number(p.confirmed_quantity ?? p.quantity) || 1), 0)) || partsCostQuoted;
    quotedProfit = round2(quoted);
    actualProfit = round2(revenue - partsCostActual - otherCost - (minutesUsed / 60) * rate);
  }
  const reasons: string[] = [];
  const overBy = hoursCharged > 0 ? minutesUsed / (hoursCharged * 60) : 0;
  if (hoursCharged > 0 && overBy > 1.3) reasons.push(`Used ${Math.round((overBy - 1) * 100)}% more time than charged`);
  if (qcRounds >= 3) reasons.push(`QC failed ${qcRounds - 1} times`);
  if ((Number(job?.work_sendbacks) || 0) >= 2) reasons.push(`Sent back by the manager ${job?.work_sendbacks} times`);
  if (daysLate > 1) reasons.push(`${daysLate} days after the promised date`);
  const notAccepted = pauseRows.filter((p) => p.accepted === false).length;
  if (notAccepted) reasons.push(`${notAccepted} pause${notAccepted === 1 ? "" : "s"} not accepted`);
  const good = (hoursCharged <= 0 || overBy <= 1.1) && qcRounds === 1 && daysLate === 0 && !(Number(job?.work_sendbacks) || 0) && !notAccepted;
  const verdict: Verdict = reasons.length ? "talk" : good ? "good" : "acceptable";
  if (verdict === "acceptable") {
    if (hoursCharged > 0 && overBy > 1.1) reasons.push(`Used ${Math.round((overBy - 1) * 100)}% more time than charged`);
    if (qcRounds === 2) reasons.push("QC failed once");
    if ((Number(job?.work_sendbacks) || 0) === 1) reasons.push("Sent back by the manager once");
    if (daysLate === 1) reasons.push("One day after the promised date");
  }
  void pos;
  return {
    hoursCharged,
    minutesUsed,
    perTechnician: techs,
    promisedAt,
    finishedOn: today,
    daysLate,
    qcRounds,
    managerSendbacks: Number(job?.work_sendbacks) || 0,
    pauses: { count: pauseRows.length, minutes: pauseMinutes, notAccepted },
    parts: { count: partRows.length, late: lateParts },
    quotedProfit,
    actualProfit,
    verdict,
    reasons,
  };
}

/** Builds the summary at QC pass, stores it on the job and tells the owner and the manager. */
export async function recordJobSummary(jobId: string, jobNumber: string, department: string | null, settings: Settings): Promise<JobSummary> {
  const admin = createAdminClient();
  const s = await buildJobSummary(jobId, settings);
  await admin.from("jobs").update({ summary: s, summary_verdict: s.verdict, summary_at: new Date().toISOString() }).eq("id", jobId);
  const hm = (m: number) => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")} min`;
  const body = `${VERDICT_LABELS[s.verdict]}. Hours ${s.hoursCharged} charged, ${hm(s.minutesUsed)} used${s.daysLate ? `, ${s.daysLate} day${s.daysLate === 1 ? "" : "s"} late` : ", on time"}, QC round${s.qcRounds === 1 ? "" : "s"} ${s.qcRounds}.${s.reasons.length ? ` ${s.reasons.join("; ")}.` : ""}`;
  const n = { type: "job_summary", title: `Job summary · ${jobNumber}`, body, jobId, href: `/jobs/${jobId}#summary` };
  await notifyRoles(["owner"], n);
  await notifyManagers(department, n);
  return s;
}
