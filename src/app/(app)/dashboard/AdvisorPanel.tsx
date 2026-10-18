import { Card } from "@/components/ui";
import type { AdvisorDay, AdvisorMonth } from "@/lib/profit";

/**
 * The advisors' figure: the profit of the work customers approved today (one team figure, never sales value, never a
 * ranking) against the owner's daily target, and what must be approved per working day from now to land the month.
 * "My month" shows each advisor only his own numbers. No fixed costs, break-even or projections here.
 */
export function AdvisorPanel({ day, month }: { day: AdvisorDay; month: AdvisorMonth }) {
  const fmt = (n: number) => `AED ${Math.round(n).toLocaleString("en-GB")}`;
  const monthName = new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const pct = Math.max(0, Math.min(100, day.percent));
  const barTone = day.percent >= 100 ? "bg-green" : "bg-amber";
  return (
    <Card className="flex flex-col gap-2.5" data-advisor-panel>
      <span className="text-2xl sm:text-3xl font-extrabold" data-advisor-today>
        Today: {fmt(day.todayProfit)} profit of {fmt(day.dailyTarget)}
      </span>
      <div className="flex flex-col gap-1" data-advisor-bar>
        <div className="h-2.5 w-full max-w-xl overflow-hidden rounded-full bg-chip">
          <div className={`h-full rounded-full ${barTone}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-sm font-bold">{day.percent}%</span>
      </div>
      <span className="text-sm font-extrabold" data-advisor-pace>
        To hit {monthName}: {fmt(day.perDayNeeded)} profit a day from now
      </span>
      <p className="text-xs text-muted">Counted on the profit of work customers approve, the whole team together, after every job cost. Approving good work moves it; sales value alone does not.</p>
      <details className="text-sm" data-my-month>
        <summary className="cursor-pointer min-h-9 inline-flex items-center font-bold underline underline-offset-4">My month (only you see this)</summary>
        <dl className="mt-2 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1">
          <dt className="text-muted">Quotes sent</dt><dd className="text-right font-bold" data-my-sent>{month.sent}</dd>
          <dt className="text-muted">Quotes approved</dt><dd className="text-right font-bold" data-my-approved>{month.approved} ({month.approvalPercent}%)</dd>
          <dt className="text-muted">Profit approved</dt><dd className="text-right font-bold" data-my-profit>{fmt(month.profitApproved)}</dd>
          <dt className="text-muted">Average margin</dt><dd className="text-right font-bold" data-my-margin>{month.avgMarginPercent}%</dd>
          <dt className="text-muted">Cars delivered on time</dt><dd className="text-right font-bold" data-my-ontime>{month.deliveredWithDate ? `${month.deliveredOnTime} of ${month.deliveredWithDate}` : "—"}</dd>
        </dl>
      </details>
      <a href="/bonus" className="self-start text-xs font-bold underline underline-offset-4" data-bonus-link>Advisor bonus (only you see yours)</a>
    </Card>
  );
}
