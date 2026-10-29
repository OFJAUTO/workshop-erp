import "server-only";
import { shiftMonth } from "./owner-report";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { timeSpentFor } from "./time-spent";
import { formatPlate } from "./types";

/**
 * The owner's "Declined cars" report (29 October 2026, batch 2 section 2): per month, the cars whose customer approved
 * nothing - how much clocked time they took, what it cost, the inspection fees charged, the net and what the time
 * would have been worth at the selling rate - and per advisor how many inspections turned into approved work.
 */
export type DeclinedCar = { jobId: string; jobNumber: string; plate: string; declinedAt: string; clockedMinutes: number; cost: number; fee: number; net: number; worth: number };
export type AdvisorConversion = { name: string; inspections: number; approved: number; percent: number };
export type DeclinedReport = { cars: DeclinedCar[]; totals: { cars: number; clockedMinutes: number; cost: number; fees: number; net: number; worth: number }; advisors: AdvisorConversion[] };

const round2 = (n: number) => Math.round(n * 100) / 100;
const monthStart = (month: string) => new Date(`${month}-01T00:00:00+04:00`).toISOString();

export async function declinedCarsReport(month: string, settings: Settings): Promise<DeclinedReport> {
  const admin = createAdminClient();
  const from = monthStart(month);
  const to = monthStart(shiftMonth(month, 1));
  const { data: jobs } = await admin
    .from("jobs")
    .select("id, job_number, declined_out_at, declined_charge_invoice_id, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin)")
    .gte("declined_out_at", from)
    .lt("declined_out_at", to)
    .order("declined_out_at");
  const ids = (jobs ?? []).map((j) => j.id as string);
  const [times, { data: invoices }] = await Promise.all([
    timeSpentFor(ids, settings),
    ids.length ? admin.from("invoices").select("id, job_id, taxable_aed").in("job_id", ids).eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true) : Promise.resolve({ data: [] as { id: string; job_id: string; taxable_aed: number }[] }),
  ]);
  const cars: DeclinedCar[] = (jobs ?? []).map((j) => {
    const t = times.get(j.id as string);
    // The inspection charge: the job's declined-charge invoice, before VAT.
    const fee = round2(((invoices ?? []) as { id: string; job_id: string; taxable_aed: number }[]).filter((i) => i.id === j.declined_charge_invoice_id).reduce((a, i) => a + Number(i.taxable_aed || 0), 0));
    const cost = t?.cost ?? 0;
    return { jobId: j.id as string, jobNumber: j.job_number as string, plate: j.vehicle ? formatPlate(j.vehicle as unknown as Parameters<typeof formatPlate>[0]) : "", declinedAt: j.declined_out_at as string, clockedMinutes: t?.clockedMinutes ?? 0, cost, fee, net: round2(fee - cost), worth: t?.worth ?? 0 };
  });
  const sum = (k: keyof DeclinedCar) => round2(cars.reduce((a, c) => a + Number(c[k] || 0), 0));
  const totals = { cars: cars.length, clockedMinutes: cars.reduce((a, c) => a + c.clockedMinutes, 0), cost: sum("cost"), fees: sum("fee"), net: sum("net"), worth: sum("worth") };

  // Per advisor: inspections approved this month, and how many of those cars went on to approved work.
  const { data: insps } = await admin.from("inspections").select("job_id, approved_at").gte("approved_at", from).lt("approved_at", to);
  const inspJobIds = [...new Set((insps ?? []).map((i) => i.job_id as string))];
  const [{ data: inspJobs }, { data: approvedQ }] = await Promise.all([
    inspJobIds.length ? admin.from("jobs").select("id, advisor_id, gated_in_by").in("id", inspJobIds) : Promise.resolve({ data: [] as { id: string; advisor_id: string | null; gated_in_by: string | null }[] }),
    inspJobIds.length ? admin.from("quotations").select("job_id").in("job_id", inspJobIds).eq("kind", "quotation").eq("status", "approved").eq("is_active", true) : Promise.resolve({ data: [] as { job_id: string }[] }),
  ]);
  const approvedJobs = new Set((approvedQ ?? []).map((q) => q.job_id as string));
  const advisorOf = new Map((inspJobs ?? []).map((j) => [j.id as string, (j.advisor_id as string | null) ?? null]));
  const counts = new Map<string, { inspections: number; approved: number }>();
  for (const jobId of inspJobIds) {
    const key = advisorOf.get(jobId) ?? "none";
    const c = counts.get(key) ?? { inspections: 0, approved: 0 };
    c.inspections++;
    if (approvedJobs.has(jobId)) c.approved++;
    counts.set(key, c);
  }
  const staffIds = [...counts.keys()].filter((k) => k !== "none");
  const { data: people } = staffIds.length ? await admin.from("staff").select("id, display_name").in("id", staffIds) : { data: [] as { id: string; display_name: string }[] };
  const nameOf = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]));
  const advisors = [...counts.entries()]
    .map(([k, c]) => ({ name: k === "none" ? "No advisor set" : (nameOf.get(k) ?? "Unknown"), inspections: c.inspections, approved: c.approved, percent: c.inspections ? Math.round((c.approved / c.inspections) * 100) : 0 }))
    .sort((a, b) => b.inspections - a.inspections);
  return { cars, totals, advisors };
}
