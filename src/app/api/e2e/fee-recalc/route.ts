import { NextResponse, type NextRequest } from "next/server";
import { feesFor, roundHalfUp } from "@/lib/bank-fees";
import { recordOwnerReport } from "@/lib/owner-report";
import { approvedQuoteProfits, jobProfits } from "@/lib/profit";
import { refreshQuoteTotals } from "@/lib/quote-data";
import { bankFeesOf, expectedFeeCost, getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Row = { job: string; plate: string; open: boolean; oldFee: number; newFee: number; profitBefore: number | null; profitAfter: number | null; source: string };

/**
 * Section 2 of 29 October 2026, the one-off recalculation: open jobs and jobs gated out in the last `days` days (35 by
 * default) count the bank fee without VAT (card machine 2.15%, payment link 1.75% + AED 1.00). Unsettled card/link
 * payments get their split estimate; a settled one keeps its actual fee with the VAT taken out; draft quotations take
 * the new hidden fee line; closed jobs' frozen owner reports are rebuilt. Returns every job whose profit changed,
 * before → after. Local only, behind the e2e secret; { "dryRun": true } reports without changing anything.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || !process.env.E2E_SECRET || request.headers.get("x-e2e-secret") !== process.env.E2E_SECRET) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean; days?: number };
  const dryRun = body.dryRun !== false;
  const days = Math.max(1, Math.min(365, Number(body.days) || 35));
  const admin = createAdminClient();
  const settings = await getSettings();
  const fees = bankFeesOf(settings);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data: owner } = await admin.from("staff").select("id").eq("role_id", "owner").eq("is_active", true).order("created_at").limit(1).maybeSingle();
  const actor = (owner?.id as string | undefined) ?? "";

  const [{ data: openJobs }, { data: closedJobs }] = await Promise.all([
    admin.from("jobs").select("id, job_number, is_open, vehicle:vehicles(plate_number, plate_code, plate_emirate)").eq("is_open", true),
    admin.from("jobs").select("id, job_number, is_open, vehicle:vehicles(plate_number, plate_code, plate_emirate)").eq("is_open", false).gte("gated_out_at", since),
  ]);
  type J = { id: string; job_number: string; is_open: boolean; vehicle: { plate_number: string | null; plate_code: string | null; plate_emirate: string | null } | null };
  const jobs = ([...(openJobs ?? []), ...(closedJobs ?? [])] as unknown as J[]).filter((j) => !j.id.startsWith("22222222-0000-4000-8000-00000000e"));
  const jobIds = jobs.map((j) => j.id);
  if (!jobIds.length) return NextResponse.json({ dryRun, days, rows: [] });

  // 1. The fees before and after, job by job, from the same source each screen counts: an invoiced job's profit
  // (jobProfits) takes the payments on its tax invoices, or the invoice estimate before any; a job not invoiced yet
  // shows its approved quotations' profit (approvedQuoteProfits), whose fee was the frozen hidden line.
  const [{ data: pays }, { data: quotes }, { data: taxInvoices }] = await Promise.all([
    admin.from("payments").select("id, job_id, invoice_id, method, amount_aed, bank_charge_aed, actual_fee_aed, actual_vat_aed, settlement_id, fee_msf_aed").in("job_id", jobIds).eq("is_active", true).eq("status", "recorded"),
    admin.from("quotations").select("id, job_id, status, version, created_at, total_aed, expected_payment_method").in("job_id", jobIds).eq("kind", "quotation").eq("is_active", true),
    admin.from("invoices").select("id, job_id, total_aed").in("job_id", jobIds).eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true),
  ]);
  type P = { id: string; job_id: string; invoice_id: string | null; method: string; amount_aed: number | string; bank_charge_aed: number | string | null; actual_fee_aed: number | string | null; actual_vat_aed: number | string | null; settlement_id: string | null; fee_msf_aed: number | string | null };
  type Q = { id: string; job_id: string; status: string; version: number; created_at: string; total_aed: number | string | null; expected_payment_method: string | null };
  type I = { id: string; job_id: string; total_aed: number | string };
  const { data: feeLines } = (quotes ?? []).length ? await admin.from("quotation_lines").select("quotation_id, unit_cost, quantity").eq("fee_kind", "bank_charge").eq("is_active", true).in("quotation_id", (quotes ?? []).map((q) => q.id as string)) : { data: [] };
  const lineFee = (qid: string) => ((feeLines ?? []) as { quotation_id: string; unit_cost: number | string | null; quantity: number | string | null }[]).filter((l) => l.quotation_id === qid).reduce((a, l) => a + (Number(l.unit_cost) || 0) * (Number(l.quantity) || 1), 0);

  // Every card/link payment of these jobs takes the new figures (whatever screen counts it later).
  const paymentUpdates: { id: string; patch: Record<string, number> }[] = [];
  const newCostOf = new Map<string, { old: number; now: number }>();
  for (const p of (pays ?? []) as P[]) {
    const isClearing = p.method === "card" || p.method === "link";
    const stored = Number(p.bank_charge_aed) || 0;
    if (!isClearing) {
      newCostOf.set(p.id, { old: stored, now: stored });
      continue;
    }
    if (p.settlement_id && p.actual_fee_aed !== null) {
      // Settled before this change: the actual fee included the VAT; take it out (unless already split).
      const fee = Number(p.actual_fee_aed) || 0;
      if (p.actual_vat_aed === null) {
        const vatPct = fees[p.method]?.vatPercent ?? 0;
        const vat = roundHalfUp((fee * vatPct) / (100 + vatPct));
        paymentUpdates.push({ id: p.id, patch: { actual_fee_aed: roundHalfUp(fee - vat), actual_vat_aed: vat } });
        newCostOf.set(p.id, { old: fee, now: roundHalfUp(fee - vat) });
      } else newCostOf.set(p.id, { old: fee, now: fee });
      continue;
    }
    const f = feesFor(Number(p.amount_aed) || 0, fees[p.method]);
    if (p.fee_msf_aed === null || Math.abs(stored - f.cost) >= 0.005) paymentUpdates.push({ id: p.id, patch: { bank_charge_aed: f.cost, fee_msf_aed: f.msf, fee_txn_aed: f.txn, fee_vat_aed: f.vat } });
    newCostOf.set(p.id, { old: stored, now: f.cost });
  }

  const feeByJob = new Map<string, { oldFee: number; newFee: number; source: string }>();
  for (const j of jobs) {
    const invs = ((taxInvoices ?? []) as I[]).filter((i) => i.job_id === j.id);
    const approved = ((quotes ?? []) as Q[]).filter((q) => q.job_id === j.id && q.status === "approved").sort((a, b) => (`${String(a.version).padStart(4, "0")}${a.created_at}` < `${String(b.version).padStart(4, "0")}${b.created_at}` ? 1 : -1));
    if (invs.length) {
      const onInv = ((pays ?? []) as P[]).filter((p) => p.invoice_id && invs.some((i) => i.id === p.invoice_id));
      if (onInv.length) {
        const oldFee = onInv.reduce((a, p) => a + (newCostOf.get(p.id)?.old ?? 0), 0);
        const newFee = onInv.reduce((a, p) => a + (newCostOf.get(p.id)?.now ?? 0), 0);
        feeByJob.set(j.id, { oldFee: roundHalfUp(oldFee), newFee: roundHalfUp(newFee), source: "payments" });
      } else if (approved[0]) {
        const total = invs.reduce((a, i) => a + (Number(i.total_aed) || 0), 0);
        feeByJob.set(j.id, { oldFee: roundHalfUp(approved.reduce((a, q) => a + lineFee(q.id), 0)), newFee: expectedFeeCost(settings, approved[0].expected_payment_method, total), source: "invoice estimate" });
      }
      continue;
    }
    if (!approved.length) continue;
    const oldFee = approved.reduce((a, q) => a + lineFee(q.id), 0);
    const newFee = approved.reduce((a, q) => a + expectedFeeCost(settings, q.expected_payment_method, Number(q.total_aed) || 0), 0);
    feeByJob.set(j.id, { oldFee: roundHalfUp(oldFee), newFee: roundHalfUp(newFee), source: "approved quotation" });
  }

  // 2. The changes (skipped on a dry run).
  const refreshed: string[] = [];
  const rebuilt: string[] = [];
  if (!dryRun) {
    for (const u of paymentUpdates) await admin.from("payments").update({ ...u.patch, updated_by: actor || null }).eq("id", u.id);
    for (const q of ((quotes ?? []) as Q[]).filter((x) => x.status === "draft" || x.status === "pending_owner")) {
      if (!jobs.find((j) => j.id === q.job_id)?.is_open) continue;
      await refreshQuoteTotals(q.id, settings, actor);
      refreshed.push(q.id);
    }
    for (const j of jobs.filter((x) => !x.is_open)) {
      const f = feeByJob.get(j.id);
      if (!f || Math.abs(f.newFee - f.oldFee) < 0.005) continue;
      await recordOwnerReport(j.id, settings);
      rebuilt.push(j.job_number);
    }
  }

  // 3. Profit after (the new rule, as every screen now counts it); before = after + (new fee − old fee).
  const [invoiced, quoted] = await Promise.all([jobProfits(settings, { jobIds }), approvedQuoteProfits(settings, "2000-01-01T00:00:00Z")]);
  const rows: Row[] = [];
  for (const j of jobs) {
    const f = feeByJob.get(j.id);
    if (!f || Math.abs(f.newFee - f.oldFee) < 0.005) continue;
    const inv = invoiced.filter((p) => p.invoice.job_id === j.id);
    const qp = quoted.filter((p) => p.jobId === j.id);
    // On a dry run nothing was written yet, so the profit read now still carries the old payment figures.
    const paymentsPending = dryRun && f.source === "payments";
    const now = inv.length ? inv.reduce((a, p) => a + p.profit, 0) : qp.length ? qp.reduce((a, p) => a + p.profit, 0) : null;
    const after = now === null ? null : roundHalfUp(paymentsPending ? now - (f.newFee - f.oldFee) : now);
    const plate = [j.vehicle?.plate_emirate, j.vehicle?.plate_code, j.vehicle?.plate_number].filter(Boolean).join(" ");
    rows.push({ job: j.job_number, plate, open: j.is_open, oldFee: f.oldFee, newFee: f.newFee, profitBefore: after === null ? null : roundHalfUp(after + (f.newFee - f.oldFee)), profitAfter: after, source: f.source });
  }
  rows.sort((a, b) => a.job.localeCompare(b.job));
  return NextResponse.json({ dryRun, days, jobsChecked: jobs.length, paymentsUpdated: dryRun ? 0 : paymentUpdates.length, paymentsToUpdate: paymentUpdates.length, quotationsRefreshed: refreshed.length, ownerReportsRebuilt: rebuilt, rows });
}
