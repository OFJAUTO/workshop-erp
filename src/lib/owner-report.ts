import "server-only";
import { addDays, dayStartIso } from "./calendar";
import { jobBalance } from "./invoice-data";
import { STAGES, STAGE_LABELS, STATUS_STAGE, dubaiDate, workingTimeOf, type JobStatus, type Stage } from "./jobs";
import { VERDICT_LABELS, buildJobSummary, type JobSummary, type Verdict } from "./job-summary";
import { round2 } from "./money";
import { notifyRoles } from "./notifications";
import { jobProfits } from "./profit";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";
import { workingHoursBetween } from "./working-time";

/**
 * The owner's report on one job, written at gate-out: the verdict, the money, the time, the people,
 * where it waited, who the customer is, and anything that deserves a look. Stored on the job and
 * reused by the Finished cars list, the People page and the monthly summary.
 */
export type OwnerReport = {
  jobId: string;
  jobNumber: string;
  loose: boolean;
  plate: string;
  title: string;
  verdict: Verdict;
  reasons: string[];
  money: {
    invoiceNumber: string | null;
    invoiceKind: string | null;
    /** Before VAT. */
    invoiced: number;
    total: number;
    discount: number;
    partsCost: number;
    labourCost: number;
    otherCost: number;
    profit: number | null;
    marginPercent: number | null;
    collected: number;
    balance: number;
    provisional: boolean;
  };
  time: {
    gatedInAt: string;
    promisedAt: string | null;
    gatedOutAt: string | null;
    /** Calendar days from gate-in to gate-out. */
    days: number;
    /** Working hours from gate-in to gate-out. */
    workingHours: number;
    hoursCharged: number;
    minutesUsed: number;
    daysLate: number;
  };
  /** Working hours spent on each step, in track order; steps never entered are left out. */
  stages: { stage: Stage; label: string; hours: number; targetHours: number | null; over: boolean }[];
  people: {
    advisor: string | null;
    manager: string | null;
    technicians: { name: string; minutes: number }[];
    qc: string | null;
    gateIn: string | null;
    gateOut: string | null;
  };
  /** Steps that took longer than their target, in words. */
  delays: string[];
  customer: { name: string; phone: string | null; vip: boolean; visits: number; comebackOf: string | null; cameBack: string[] };
  flags: string[];
  summary: JobSummary;
  generatedAt: string;
};

type JobRowLite = { id: string; job_number: string; job_kind: string; status: string; department: string | null; gated_in_at: string; gated_out_at: string | null; gated_in_by: string | null; gated_out_by: string | null; promised_at: string | null; customer_id: string; comeback_of: string | null; comeback_cause: string | null; plan_released_by: string | null; owner_report: OwnerReport | null; owner_report_at: string | null; vehicle: { kind: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null };

const JOB_LITE = "id, job_number, job_kind, status, department, gated_in_at, gated_out_at, gated_in_by, gated_out_by, promised_at, customer_id, comeback_of, comeback_cause, plan_released_by, owner_report, owner_report_at, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name))";

const DAY = 86400000;

export async function buildOwnerReport(jobId: string, settings: Settings): Promise<OwnerReport | null> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("jobs").select(JOB_LITE).eq("id", jobId).maybeSingle();
  if (!raw) return null;
  const job = raw as unknown as JobRowLite;
  const side = job.department === "bodyshop" ? "bodyshop" : "mechanical";
  const wt = workingTimeOf(settings, side);
  const [summary, bal, profits, { data: customer }, { data: events }, { data: insp }, { data: qcRows }, { data: gateOut }, { data: visits }, { data: cameBack }, { data: approvals }] = await Promise.all([
    buildJobSummary(jobId, settings),
    jobBalance(jobId),
    jobProfits(settings, { jobIds: [jobId] }),
    admin.from("customers").select("full_name, company_name, phone, is_vip").eq("id", job.customer_id).maybeSingle(),
    admin.from("job_events").select("event_type, to_status, note, created_at, created_by").eq("job_id", jobId).order("created_at"),
    admin.from("inspections").select("approved_by").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("qc_checks").select("inspector_id, status").eq("job_id", jobId).eq("is_active", true).order("round", { ascending: false }).limit(1),
    admin.from("gate_outs").select("release_approved_by, keys_override_by, balance_due_aed").eq("job_id", jobId).maybeSingle(),
    admin.from("jobs").select("id").eq("customer_id", job.customer_id).eq("is_open", false).neq("id", jobId),
    admin.from("jobs").select("job_number, comeback_cause").eq("comeback_of", jobId),
    admin.from("approval_requests").select("sent_by").eq("job_id", jobId).order("created_at").limit(1),
  ]);
  // Names
  const ids = new Set<string>();
  for (const x of [job.gated_in_by, job.gated_out_by, job.plan_released_by, insp?.approved_by, qcRows?.[0]?.inspector_id, approvals?.[0]?.sent_by]) if (x) ids.add(x);
  const { data: people } = ids.size ? await admin.from("staff").select("id, display_name").in("id", Array.from(ids)) : { data: [] as { id: string; display_name: string }[] };
  const nameOf = (id: string | null | undefined) => (id ? ((people ?? []).find((p) => p.id === id)?.display_name ?? null) : null);

  // Time on each step, from the status trail.
  const trail: { status: string; at: string }[] = [{ status: "gate_in_pending", at: job.gated_in_at }];
  for (const e of events ?? []) if (e.to_status && e.to_status !== trail[trail.length - 1].status) trail.push({ status: e.to_status, at: e.created_at });
  const endAt = job.gated_out_at ?? new Date().toISOString();
  const perStage = new Map<Stage, number>();
  for (let i = 0; i < trail.length; i++) {
    const stage = STATUS_STAGE[trail[i].status as JobStatus];
    if (!stage) continue;
    const to = i + 1 < trail.length ? trail[i + 1].at : endAt;
    perStage.set(stage, (perStage.get(stage) ?? 0) + workingHoursBetween(trail[i].at, to, wt));
  }
  const targets = (settings.stage_target_hours ?? {}) as Record<string, number>;
  const stages = STAGES.filter((s) => perStage.has(s)).map((s) => {
    const hours = round2(perStage.get(s) ?? 0);
    const target = targets[s] !== undefined ? Number(targets[s]) : null;
    return { stage: s, label: STAGE_LABELS[s], hours, targetHours: target, over: target !== null && target > 0 && hours > target * 1.25 };
  });
  const delays = stages.filter((s) => s.over).map((s) => `${s.label} took ${hoursText(s.hours)} against a target of ${hoursText(s.targetHours ?? 0)}`);

  // Money
  const p = profits[0] ?? null;
  const inv = bal.invoice;
  const invoiced = p ? p.revenue : inv ? inv.taxable_aed : 0;
  const profit = p ? p.profit : summary.actualProfit;
  const marginPercent = profit !== null && invoiced > 0 ? Math.round((profit / invoiced) * 100) : null;
  const goodMargin = Number(settings.report_good_margin_percent) || 25;

  // Flags: anything that deserves a look.
  const flags: string[] = [];
  const overrides = (events ?? []).filter((e) => e.event_type === "override").length;
  if (overrides) flags.push(`${overrides} override${overrides === 1 ? "" : "s"} on this job`);
  if (gateOut?.release_approved_by) flags.push(`Released with ${Number(gateOut.balance_due_aed) > 0 ? `AED ${Number(gateOut.balance_due_aed).toLocaleString("en-GB")} still due` : "no invoice"} (approved)`);
  if (gateOut?.keys_override_by) flags.push("Keys did not match the gate-in record (override)");
  if (job.comeback_of) flags.push(`A comeback${job.comeback_cause ? ` (${job.comeback_cause.replace(/_/g, " ")})` : ""}`);
  for (const c of cameBack ?? []) flags.push(`Came back on ${c.job_number}${c.comeback_cause ? ` (${String(c.comeback_cause).replace(/_/g, " ")})` : ""}`);
  if (summary.qcRounds > 1) flags.push(`QC failed ${summary.qcRounds - 1} time${summary.qcRounds === 2 ? "" : "s"}`);
  if (summary.managerSendbacks) flags.push(`Sent back by the manager ${summary.managerSendbacks} time${summary.managerSendbacks === 1 ? "" : "s"}`);
  if (summary.pauses.notAccepted) flags.push(`${summary.pauses.notAccepted} pause${summary.pauses.notAccepted === 1 ? "" : "s"} not accepted`);
  if (summary.parts.late) flags.push(`${summary.parts.late} part${summary.parts.late === 1 ? "" : "s"} arrived late`);
  if (summary.daysLate) flags.push(`${summary.daysLate} day${summary.daysLate === 1 ? "" : "s"} after the promised date`);
  if (inv && inv.discount_aed > 0) flags.push(`Discount AED ${inv.discount_aed.toLocaleString("en-GB")} given`);
  if (marginPercent !== null && marginPercent < goodMargin) flags.push(marginPercent < 0 ? "Sold at a loss" : `Margin ${marginPercent}% is under the ${goodMargin}% you expect`);
  if (bal.balance > 0) flags.push(`AED ${bal.balance.toLocaleString("en-GB")} still to collect`);
  if (p?.provisional) flags.push(`Profit is provisional: ${p.provisionalWhy.join(", ")}`);

  // Verdict: the job summary's rule of thumb, then the money.
  let verdict: Verdict = summary.verdict;
  const reasons = [...summary.reasons];
  if (marginPercent !== null && marginPercent < 0) { verdict = "talk"; reasons.push("Sold at a loss"); }
  else if (marginPercent !== null && marginPercent < goodMargin && verdict === "good") { verdict = "acceptable"; reasons.push(`Margin ${marginPercent}% under ${goodMargin}%`); }

  const days = Math.max(0, Math.round((Date.parse(endAt) - Date.parse(job.gated_in_at)) / DAY));
  const v = job.vehicle;
  return {
    jobId,
    jobNumber: job.job_number,
    loose: job.job_kind === "loose",
    plate: v ? formatPlate(v) : job.job_number,
    title: v ? (v.kind === "loose" ? "Loose items" : [v.make?.name, v.model?.name, v.variant, v.model_year].filter(Boolean).join(" ")) : "",
    verdict,
    reasons,
    money: {
      invoiceNumber: inv?.number ?? null,
      invoiceKind: inv?.kind ?? null,
      invoiced: round2(invoiced),
      total: inv ? inv.total_aed : 0,
      discount: inv ? inv.discount_aed : 0,
      partsCost: p ? p.partsCost : 0,
      labourCost: p ? p.labourCost : 0,
      otherCost: p ? round2(p.otherCost + p.stockCost + p.bankCharges) : 0,
      profit: profit === null ? null : round2(profit),
      marginPercent,
      collected: bal.paid,
      balance: bal.balance,
      provisional: p ? p.provisional : true,
    },
    time: { gatedInAt: job.gated_in_at, promisedAt: job.promised_at, gatedOutAt: job.gated_out_at, days, workingHours: round2(workingHoursBetween(job.gated_in_at, endAt, wt)), hoursCharged: summary.hoursCharged, minutesUsed: summary.minutesUsed, daysLate: summary.daysLate },
    stages,
    people: {
      advisor: nameOf(approvals?.[0]?.sent_by) ?? nameOf(job.gated_in_by),
      manager: nameOf(insp?.approved_by) ?? nameOf(job.plan_released_by),
      technicians: summary.perTechnician.map((t) => ({ name: t.name, minutes: t.minutes })),
      qc: nameOf(qcRows?.[0]?.inspector_id),
      gateIn: nameOf(job.gated_in_by),
      gateOut: nameOf(job.gated_out_by),
    },
    delays,
    customer: { name: customer?.company_name ?? customer?.full_name ?? "Customer", phone: customer?.phone ?? null, vip: !!customer?.is_vip, visits: (visits ?? []).length + 1, comebackOf: job.comeback_of, cameBack: (cameBack ?? []).map((c) => c.job_number as string) },
    flags,
    summary,
    generatedAt: new Date().toISOString(),
  };
}

/** Builds the report at gate-out, stores it on the job and tells the owner. */
export async function recordOwnerReport(jobId: string, settings: Settings): Promise<OwnerReport | null> {
  const r = await buildOwnerReport(jobId, settings);
  if (!r) return null;
  await createAdminClient().from("jobs").update({ owner_report: r, owner_report_at: r.generatedAt }).eq("id", jobId);
  const money = r.money.profit === null ? `invoiced AED ${r.money.invoiced.toLocaleString("en-GB")}` : `profit AED ${r.money.profit.toLocaleString("en-GB")}${r.money.marginPercent !== null ? ` (${r.money.marginPercent}%)` : ""}`;
  await notifyRoles(["owner"], { type: "owner_report", title: `Job report · ${r.jobNumber} · ${VERDICT_LABELS[r.verdict]}`, body: `${r.plate}: ${money}, ${r.time.days} day${r.time.days === 1 ? "" : "s"} in the workshop${r.flags.length ? `. ${r.flags.length} thing${r.flags.length === 1 ? "" : "s"} to look at` : ""}.`, jobId, href: `/reports/jobs/${jobId}` });
  return r;
}

/** The stored report, or a fresh one for a job that closed before reports existed (stored then). */
export async function ownerReportFor(jobId: string, settings: Settings): Promise<OwnerReport | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("jobs").select("owner_report, is_open").eq("id", jobId).maybeSingle();
  if (!data) return null;
  if (data.owner_report) return data.owner_report as OwnerReport;
  const r = await buildOwnerReport(jobId, settings);
  if (r && !data.is_open) await admin.from("jobs").update({ owner_report: r, owner_report_at: r.generatedAt }).eq("id", jobId);
  return r;
}

/* ---------------------------------------------------------------------------
   Months
   --------------------------------------------------------------------------- */

export function monthKey(date = dubaiDate()) {
  return date.slice(0, 7);
}
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}
/** The month's range as Dubai-local instants, end exclusive. */
export function monthRange(month: string) {
  const from = `${month}-01`;
  return { fromIso: dayStartIso(from), toIso: dayStartIso(addDays(`${shiftMonth(month, 1)}-01`, 0)) };
}

export type PersonLine = { name: string; jobs: number; minutes: number; hoursCharged: number; efficiencyPercent: number | null; qcSendbacks: number; managerSendbacks: number; pausesNotAccepted: number; invoiced: number; profit: number; discount: number; talk: number };

export type MonthlySummary = {
  month: string;
  label: string;
  count: number;
  cars: number;
  loose: number;
  invoiced: number;
  profit: number;
  marginPercent: number | null;
  onTime: number;
  late: number;
  avgDays: number;
  comebacks: number;
  verdicts: Record<Verdict, number>;
  technicians: PersonLine[];
  advisors: PersonLine[];
  managers: PersonLine[];
  qc: PersonLine[];
  flags: { text: string; count: number }[];
  jobs: { id: string; jobNumber: string; plate: string; title: string; customer: string; gatedOutAt: string | null; verdict: Verdict; invoiced: number; profit: number | null; marginPercent: number | null; days: number; flags: number; loose: boolean }[];
};

/** Everything gated out in the month, from the stored reports (built for any job that has none yet). */
export async function monthlySummary(settings: Settings, month: string): Promise<MonthlySummary> {
  const admin = createAdminClient();
  const { fromIso, toIso } = monthRange(month);
  const { data: rows } = await admin.from("jobs").select("id, owner_report").eq("is_open", false).gte("gated_out_at", fromIso).lt("gated_out_at", toIso).order("gated_out_at", { ascending: false }).limit(400);
  const reports: OwnerReport[] = [];
  let built = 0;
  for (const j of rows ?? []) {
    if (j.owner_report) { reports.push(j.owner_report as OwnerReport); continue; }
    if (built >= 40) continue; // The rest fill in on the next visit.
    const r = await buildOwnerReport(j.id, settings);
    if (r) { await admin.from("jobs").update({ owner_report: r, owner_report_at: r.generatedAt }).eq("id", j.id); reports.push(r); built++; }
  }
  const line = (name: string): PersonLine => ({ name, jobs: 0, minutes: 0, hoursCharged: 0, efficiencyPercent: null, qcSendbacks: 0, managerSendbacks: 0, pausesNotAccepted: 0, invoiced: 0, profit: 0, discount: 0, talk: 0 });
  const techs = new Map<string, PersonLine>();
  const advisors = new Map<string, PersonLine>();
  const managers = new Map<string, PersonLine>();
  const qcs = new Map<string, PersonLine>();
  const flagCount = new Map<string, number>();
  const verdicts: Record<Verdict, number> = { good: 0, acceptable: 0, talk: 0 };
  let invoiced = 0, profit = 0, onTime = 0, late = 0, days = 0, comebacks = 0, cars = 0, loose = 0;
  for (const r of reports) {
    verdicts[r.verdict]++;
    invoiced += r.money.invoiced;
    profit += r.money.profit ?? 0;
    if (r.time.daysLate) late++; else onTime++;
    days += r.time.days;
    if (r.customer.comebackOf) comebacks++;
    if (r.loose) loose++; else cars++;
    for (const f of r.flags) {
      const key = f.replace(/\d[\d,.]*/g, "n").replace(/\(.*?\)/g, "").trim();
      flagCount.set(key, (flagCount.get(key) ?? 0) + 1);
    }
    const totalMin = r.people.technicians.reduce((a, t) => a + t.minutes, 0) || 1;
    for (const t of r.people.technicians) {
      const l = techs.get(t.name) ?? line(t.name);
      l.jobs++;
      l.minutes += t.minutes;
      l.hoursCharged += r.time.hoursCharged * (t.minutes / totalMin);
      const per = r.summary.perTechnician.find((x) => x.name === t.name);
      l.qcSendbacks += per?.qcSendbacks ?? 0;
      l.managerSendbacks += per?.managerSendbacks ?? 0;
      if (r.verdict === "talk") l.talk++;
      techs.set(t.name, l);
    }
    if (r.people.advisor) {
      const l = advisors.get(r.people.advisor) ?? line(r.people.advisor);
      l.jobs++; l.invoiced += r.money.invoiced; l.profit += r.money.profit ?? 0; l.discount += r.money.discount; if (r.verdict === "talk") l.talk++;
      advisors.set(r.people.advisor, l);
    }
    if (r.people.manager) {
      const l = managers.get(r.people.manager) ?? line(r.people.manager);
      l.jobs++; l.managerSendbacks += r.summary.managerSendbacks; l.qcSendbacks += Math.max(0, r.summary.qcRounds - 1); if (r.verdict === "talk") l.talk++;
      managers.set(r.people.manager, l);
    }
    if (r.people.qc) {
      const l = qcs.get(r.people.qc) ?? line(r.people.qc);
      l.jobs++; l.qcSendbacks += Math.max(0, r.summary.qcRounds - 1);
      qcs.set(r.people.qc, l);
    }
  }
  const finish = (m: Map<string, PersonLine>) => Array.from(m.values()).map((l) => ({ ...l, hoursCharged: round2(l.hoursCharged), invoiced: round2(l.invoiced), profit: round2(l.profit), discount: round2(l.discount), efficiencyPercent: l.minutes > 0 && l.hoursCharged > 0 ? Math.round(((l.hoursCharged * 60) / l.minutes) * 100) : null })).sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name));
  return {
    month,
    label: monthLabel(month),
    count: reports.length,
    cars,
    loose,
    invoiced: round2(invoiced),
    profit: round2(profit),
    marginPercent: invoiced > 0 ? Math.round((profit / invoiced) * 100) : null,
    onTime,
    late,
    avgDays: reports.length ? Math.round((days / reports.length) * 10) / 10 : 0,
    comebacks,
    verdicts,
    technicians: finish(techs),
    advisors: finish(advisors),
    managers: finish(managers),
    qc: finish(qcs),
    flags: Array.from(flagCount.entries()).map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 12),
    jobs: reports.map((r) => ({ id: r.jobId, jobNumber: r.jobNumber, plate: r.plate, title: r.title, customer: r.customer.name, gatedOutAt: r.time.gatedOutAt, verdict: r.verdict, invoiced: r.money.invoiced, profit: r.money.profit, marginPercent: r.money.marginPercent, days: r.time.days, flags: r.flags.length, loose: r.loose })),
  };
}

export function hoursText(h: number) {
  if (h >= 8) return `${Math.round((h / 8) * 10) / 10} working day${h >= 16 ? "s" : ""}`;
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return whole ? `${whole} h${min ? ` ${min} min` : ""}` : `${min} min`;
}
