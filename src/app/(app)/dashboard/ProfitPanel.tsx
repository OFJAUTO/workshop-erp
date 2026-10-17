import { Card } from "@/components/ui";
import type { DailyProfit } from "@/lib/profit";

/**
 * The owner's target box. Headline: "Month to date: AED X of AED Y target (Z%)", the target being the daily figure
 * times the working days passed (Sunday never counts); green on pace, amber behind. Under it: the break-even line
 * from Settings > Monthly fixed costs, the profit sitting in approved-but-not-invoiced work, the month-end pace, and
 * a smaller line with today's invoiced profit and collections. Profit is the invoice before VAT minus every job cost;
 * it stays "(includes N provisional)" while late costs are still to come.
 */
export function ProfitPanel({ live, target, data }: { live: boolean; target: number; data: DailyProfit | null }) {
  const fmt = (n: number) => `AED ${Math.round(n).toLocaleString("en-GB")}`;
  if (!live || !data) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-dashed border-line bg-white px-4 py-2 text-sm">
        <span className="text-xs font-extrabold uppercase tracking-[0.08em]">Daily profit target</span>
        <span className="text-muted">{fmt(target)} per working day</span>
      </div>
    );
  }
  const m = data.month;
  const cls = m.tone === "green" ? "bg-green-soft text-green border-green" : "bg-amber-soft text-amber border-amber-bar";
  return (
    <Card className={`flex flex-col gap-2 border ${cls}`} data-profit-panel data-target-box>
      <span className="text-2xl sm:text-3xl font-extrabold" data-month-headline>
        Month to date: {fmt(Math.max(0, data.monthProfit))} of {fmt(m.targetSoFar)} target ({m.percent}%)
      </span>
      <div className="flex flex-wrap gap-x-10 gap-y-2 text-sm text-ink">
        <div className="flex flex-col" data-break-even>
          <span>Break-even so far: <span className="font-bold">{fmt(m.breakEvenSoFar)}</span></span>
          <span className={m.aboveBreakEven >= 0 ? "font-extrabold text-green" : "font-extrabold text-red"}>
            {m.aboveBreakEven >= 0 ? `${fmt(m.aboveBreakEven)} above break-even` : `${fmt(-m.aboveBreakEven)} below break-even`}
          </span>
        </div>
        <div className="flex flex-col" data-in-progress>
          <span>In progress (approved, not invoiced):</span>
          <span className="font-bold">{fmt(m.inProgress)} profit</span>
        </div>
        <div className="flex flex-col" data-pace>
          <span>At this pace:</span>
          <span className="font-bold">{fmt(m.pace)} by month end</span>
        </div>
      </div>
      <span className="text-xs text-ink" data-today-line>
        Today: {fmt(Math.max(0, data.invoicedProfit))} invoiced profit ({data.count} invoice{data.count === 1 ? "" : "s"}) · {fmt(data.collected)} collected
        {m.provisional ? ` · (includes ${m.provisional} provisional)` : ""}
        {data.comebacks ? ` · comebacks −${fmt(data.comebacks)}` : ""}
      </span>
    </Card>
  );
}
