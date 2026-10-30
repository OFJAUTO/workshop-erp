import "server-only";
import { noFeeReasonLabel } from "./inspection-fee";
import { shiftMonth } from "./owner-report";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { timeSpentFor } from "./time-spent";

/**
 * The owner's "Inspection fees" report (30 October 2026), one month, per advisor: the cars gated in with a fee (and
 * the amounts), without one (and why), the fees actually charged on declined cars, and the clocked time spent on free
 * full inspections. The advisor is the job's advisor in charge, else whoever gated it in.
 */
const monthStart = (month: string) => new Date(`${month}-01T00:00:00+04:00`).toISOString();

export type FeeAdvisorRow = {
  advisorId: string | null;
  advisor: string;
  withFee: number;
  feeTotal: number;
  noFee: number;
  reasons: { label: string; count: number }[];
  quick: number;
  notChosen: number;
  declinedCharged: number;
  declinedChargedTotal: number;
  freeMinutes: number;
  freeCost: number;
};

export async function inspectionFeeReport(month: string, settings: Settings): Promise<{ rows: FeeAdvisorRow[]; totals: FeeAdvisorRow }> {
  const admin = createAdminClient();
  const from = monthStart(month);
  const to = monthStart(shiftMonth(month, 1));
  const { data: jobs } = await admin
    .from("jobs")
    .select("id, job_kind, advisor_id, gated_in_by, inspection_fee_choice, inspection_fee_aed, no_fee_reason, inspection_type, declined_charge_invoice_id")
    .gte("gated_in_at", from)
    .lt("gated_in_at", to)
    .neq("job_kind", "loose");
  const list = (jobs ?? []) as { id: string; job_kind: string; advisor_id: string | null; gated_in_by: string | null; inspection_fee_choice: string | null; inspection_fee_aed: number | string | null; no_fee_reason: string | null; inspection_type: string | null; declined_charge_invoice_id: string | null }[];
  const freeFull = list.filter((j) => j.inspection_fee_choice === "none" && j.inspection_type !== "quick" && j.job_kind !== "recheck").map((j) => j.id);
  const charged = list.map((j) => j.declined_charge_invoice_id).filter((x): x is string => !!x);
  const [times, { data: invoices }, { data: staff }] = await Promise.all([
    timeSpentFor(freeFull, settings),
    charged.length ? admin.from("invoices").select("id, taxable_aed, status").in("id", charged) : Promise.resolve({ data: [] as { id: string; taxable_aed: number; status: string }[] }),
    admin.from("staff").select("id, display_name"),
  ]);
  const nameOf = new Map((staff ?? []).map((s) => [s.id as string, s.display_name as string]));
  const chargedOf = new Map(((invoices ?? []) as { id: string; taxable_aed: number; status: string }[]).filter((i) => i.status !== "cancelled").map((i) => [i.id, Number(i.taxable_aed) || 0]));
  const blank = (advisorId: string | null): FeeAdvisorRow => ({ advisorId, advisor: advisorId ? (nameOf.get(advisorId) ?? "Someone") : "Not known", withFee: 0, feeTotal: 0, noFee: 0, reasons: [], quick: 0, notChosen: 0, declinedCharged: 0, declinedChargedTotal: 0, freeMinutes: 0, freeCost: 0 });
  const rows = new Map<string, FeeAdvisorRow>();
  const totals = blank(null);
  totals.advisor = "All advisors";
  const round2 = (n: number) => Math.round(n * 100) / 100;
  for (const j of list) {
    const who = j.advisor_id ?? j.gated_in_by ?? null;
    const key = who ?? "none";
    const r = rows.get(key) ?? blank(who);
    for (const target of [r, totals]) {
      const amount = Number(j.inspection_fee_aed) || 0;
      if (j.inspection_fee_choice === "none") {
        target.noFee += 1;
        if (j.inspection_type === "quick") target.quick += 1;
        const label = noFeeReasonLabel(j.no_fee_reason);
        const hit = target.reasons.find((x) => x.label === label);
        if (hit) hit.count += 1;
        else target.reasons.push({ label, count: 1 });
      } else if (j.inspection_fee_choice === "fee" || amount > 0) {
        target.withFee += 1;
        target.feeTotal = round2(target.feeTotal + amount);
      } else target.notChosen += 1;
      const ch = j.declined_charge_invoice_id ? chargedOf.get(j.declined_charge_invoice_id) : undefined;
      if (ch !== undefined) {
        target.declinedCharged += 1;
        target.declinedChargedTotal = round2(target.declinedChargedTotal + ch);
      }
      const t = times.get(j.id);
      if (t) {
        target.freeMinutes += t.clockedMinutes;
        target.freeCost = round2(target.freeCost + t.cost);
      }
    }
    rows.set(key, r);
  }
  return { rows: Array.from(rows.values()).sort((a, b) => a.advisor.localeCompare(b.advisor)), totals };
}
