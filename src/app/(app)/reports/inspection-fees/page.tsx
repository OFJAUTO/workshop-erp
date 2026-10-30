import { redirect } from "next/navigation";
import { Card, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { inspectionFeeReport, type FeeAdvisorRow } from "@/lib/inspection-fee-report";
import { monthLabel } from "@/lib/owner-report";
import { getSettings } from "@/lib/settings";
import { hoursAndMinutes } from "@/lib/time-spent";
import { ReportTabs, monthParam } from "../ReportTabs";

export const dynamic = "force-dynamic";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The owner's "Inspection fees" report (30 October 2026), one month, per advisor: cars with a fee and the amounts, cars
 * without one and why, the fees actually charged on declined cars, and the clocked time spent on free full inspections.
 */
export default async function InspectionFeesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") redirect("/dashboard");
  const { month: m } = await searchParams;
  const month = monthParam(m);
  const { rows, totals } = await inspectionFeeReport(month, await getSettings());
  const line = (r: FeeAdvisorRow, total = false) => (
    <tr key={r.advisorId ?? (total ? "total" : "none")} className={total ? "border-t-2 border-ink font-extrabold" : ""} data-fee-row={total ? "total" : r.advisor}>
      <td className="py-2 pr-3 align-top font-bold">{r.advisor}</td>
      <td className="py-2 pr-3 align-top text-right">{r.withFee}</td>
      <td className="py-2 pr-3 align-top text-right whitespace-nowrap">{aed(r.feeTotal)}</td>
      <td className="py-2 pr-3 align-top text-right">{r.noFee}{r.quick ? <span className="block text-xs font-normal text-muted">{r.quick} quick job{r.quick === 1 ? "" : "s"}</span> : null}</td>
      <td className="py-2 pr-3 align-top text-xs">{r.reasons.length ? r.reasons.map((x) => `${x.label} ×${x.count}`).join(" · ") : "—"}</td>
      <td className="py-2 pr-3 align-top text-right whitespace-nowrap">{r.declinedCharged ? `${r.declinedCharged} · ${aed(r.declinedChargedTotal)}` : "—"}</td>
      <td className="py-2 pr-3 align-top text-right whitespace-nowrap">{r.freeMinutes ? `${hoursAndMinutes(r.freeMinutes)} · ${aed(r.freeCost)}` : "—"}</td>
      <td className="py-2 align-top text-right">{r.notChosen || "—"}</td>
    </tr>
  );
  return (
    <>
      <PageHeader title="Inspection fees" subtitle={`${monthLabel(month)}: cars gated in, per advisor - with a fee and the amounts, without one and why, fees charged on declined cars, and the time spent on free inspections.`} />
      <ReportTabs current="/reports/inspection-fees" month={month} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-fee-totals>
        {[
          ["Cars with a fee", `${totals.withFee} · ${aed(totals.feeTotal)}`],
          ["Cars without a fee", `${totals.noFee}${totals.quick ? ` (${totals.quick} quick)` : ""}`],
          ["Charged on declined cars", `${totals.declinedCharged} · ${aed(totals.declinedChargedTotal)}`],
          ["Time on free inspections", `${hoursAndMinutes(totals.freeMinutes)} · ${aed(totals.freeCost)}`],
        ].map(([label, value]) => (
          <Card key={label} className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{label}</span>
            <span className="text-lg font-extrabold">{value}</span>
          </Card>
        ))}
      </div>
      <Card className="flex flex-col gap-2" data-fee-report>
        <SectionLabel right={`${rows.length}`}>Per advisor</SectionLabel>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No car was gated in this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.08em] text-muted">
                  <th className="py-1 pr-3">Advisor</th><th className="py-1 pr-3 text-right">With fee</th><th className="py-1 pr-3 text-right">Fees agreed (before VAT)</th><th className="py-1 pr-3 text-right">No fee</th><th className="py-1 pr-3">Why no fee</th><th className="py-1 pr-3 text-right">Charged on declined cars</th><th className="py-1 pr-3 text-right">Time on free inspections</th><th className="py-1 text-right">Not chosen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => line(r))}
                {line(totals, true)}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">Charged on declined cars: the inspection charge invoices, before VAT. Time on free inspections: the clocked time (gate-in, inspection, road test, QC) on cars with no fee and a full inspection, at the labour cost rate. Not chosen: cars gated in by the gate-in person whose approval link is not made yet, and older cars.</p>
      </Card>
    </>
  );
}
