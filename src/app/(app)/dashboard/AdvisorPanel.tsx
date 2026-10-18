import { Card } from "@/components/ui";
import type { AdvisorDay, AdvisorMonth } from "@/lib/profit";

/**
 * The advisors' target in ONE slim line: "Team today: AED X of AED Y", the bar, "Z% · To hit October: AED N a
 * day", and a small ⓘ holding the long explanation. One shared team figure (the profit of work customers
 * approve, never sales value, never a ranking); "My month" stays the small private link underneath.
 */
export function AdvisorPanel({ day, month }: { day: AdvisorDay; month: AdvisorMonth }) {
  const fmt = (n: number) => `AED ${Math.round(n).toLocaleString("en-GB")}`;
  const monthName = new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const pct = Math.max(0, Math.min(100, day.percent));
  const barTone = day.percent >= 100 ? "bg-green" : "bg-amber-bar";
  return (
    <Card className="flex flex-col gap-1.5 py-3" data-advisor-panel>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[15px] font-extrabold whitespace-nowrap" data-advisor-today>Team today: {fmt(day.todayProfit)} of {fmt(day.dailyTarget)}</span>
        <div className="h-2 w-32 sm:w-44 overflow-hidden rounded-full bg-chip" data-advisor-bar><div className={`h-full rounded-full ${barTone}`} style={{ width: `${pct}%` }} /></div>
        <span className="text-sm font-bold whitespace-nowrap" data-advisor-pace>{day.percent}% · To hit {monthName}: {fmt(day.perDayNeeded)} a day</span>
        <details className="relative" data-advisor-info>
          <summary className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-line-strong text-[11px] font-bold text-muted" aria-label="How is this worked out?">ⓘ</summary>
          <div className="absolute right-0 z-40 mt-1 w-80 rounded-card border border-line bg-white p-3 text-xs leading-relaxed shadow-xl">
            One shared team figure: the profit of the work customers approve today (the approved quotations, before VAT, after every job cost) against the daily target from Settings. &quot;To hit {monthName}&quot; is the month&apos;s remaining target spread over the working days left (Sundays never counted). Approving good work moves it; sales value alone does not. One figure for the whole team, never person by person.
          </div>
        </details>
        <span className="ml-auto flex items-center gap-3">
          <a href="/bonus" className="text-xs font-bold underline underline-offset-4 whitespace-nowrap" data-bonus-link>Advisor bonus</a>
        </span>
      </div>
      <details className="text-sm" data-my-month>
        <summary className="cursor-pointer min-h-9 inline-flex items-center text-xs font-bold underline underline-offset-4">My month (only you see this)</summary>
        <dl className="mt-2 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1">
          <dt className="text-muted">Quotes sent</dt><dd className="text-right font-bold" data-my-sent>{month.sent}</dd>
          <dt className="text-muted">Quotes approved</dt><dd className="text-right font-bold" data-my-approved>{month.approved} ({month.approvalPercent}%)</dd>
          <dt className="text-muted">Profit approved</dt><dd className="text-right font-bold" data-my-profit>{fmt(month.profitApproved)}</dd>
          <dt className="text-muted">Average margin</dt><dd className="text-right font-bold" data-my-margin>{month.avgMarginPercent}%</dd>
          <dt className="text-muted">Cars delivered on time</dt><dd className="text-right font-bold" data-my-ontime>{month.deliveredWithDate ? `${month.deliveredOnTime} of ${month.deliveredWithDate}` : "—"}</dd>
        </dl>
      </details>
    </Card>
  );
}
