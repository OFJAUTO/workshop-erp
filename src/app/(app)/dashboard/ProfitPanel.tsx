import { Card } from "@/components/ui";
import type { DailyProfit } from "@/lib/profit";

/**
 * The owner's target box, in plain words: "October so far: AED X profit", a progress bar against the target by today,
 * the costs line (short by / above), what is coming from cars in the workshop, the month-end pace, and today's line.
 * No jargon on the face of it; "How is this worked out?" opens a short plain explanation. The sums are unchanged:
 * invoice profit after every job cost, fixed costs from Settings spread over the working days, Sundays never counted.
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
  const monthName = new Date(`${data.date}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const short = m.breakEvenSoFar - data.monthProfit;
  const cls = m.tone === "green" ? "bg-green-soft border-green" : "bg-amber-soft border-amber-bar";
  const barTone = m.tone === "green" ? "bg-green" : "bg-amber";
  const pct = Math.max(0, Math.min(100, m.percent));
  return (
    <Card className={`flex flex-col gap-2.5 border text-ink ${cls}`} data-profit-panel data-target-box>
      <span className="text-2xl sm:text-3xl font-extrabold" data-month-headline>
        {monthName} so far: {fmt(Math.max(0, data.monthProfit))} profit
      </span>
      <div className="flex flex-col gap-1" data-target-bar>
        <div className="h-2.5 w-full max-w-xl overflow-hidden rounded-full bg-white/70">
          <div className={`h-full rounded-full ${barTone}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-sm font-bold">{m.percent}% of target ({fmt(m.targetSoFar)} by today)</span>
      </div>
      <div className="flex flex-wrap gap-x-10 gap-y-2 text-sm">
        <span data-break-even>
          To cover costs so far: <span className="font-bold">{fmt(m.breakEvenSoFar)}</span>
          {" → "}
          {short > 0 ? <span className="font-extrabold text-red">short by {fmt(short)}</span> : <span className="font-extrabold text-green">{fmt(-short)} above</span>}
        </span>
        <span data-in-progress>Coming from cars in the workshop: <span className="font-bold">{fmt(m.inProgress)}</span></span>
        <span data-pace>If the month continues like this: <span className="font-bold">{fmt(m.pace)}</span></span>
      </div>
      <span className="text-xs" data-today-line>
        Today: {fmt(Math.max(0, data.invoicedProfit))} profit invoiced · {fmt(data.collected)} collected
        {m.provisional ? ` · costs still arriving on ${m.provisional} job${m.provisional === 1 ? "" : "s"}` : ""}
        {data.comebacks ? ` · lost on comebacks today ${fmt(data.comebacks)}` : ""}
      </span>
      <details className="text-xs" data-target-explain>
        <summary className="cursor-pointer font-semibold underline underline-offset-4 min-h-8 inline-flex items-center">How is this worked out?</summary>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          <li><span className="font-semibold">Profit</span> is the invoice before VAT, minus everything the job cost us: parts, technicians&apos; time at the hourly cost rate, outside work, recovery, approved commissions, bank charges, and materials and stock used. VAT is never counted as profit.</li>
          <li><span className="font-semibold">The target</span> is {fmt(data.target)} for every working day of the month so far. Sundays never count.</li>
          <li><span className="font-semibold">To cover costs</span> spreads the Monthly fixed costs from Settings ({fmt(m.fixedMonthly)}) over the month&apos;s working days: by today the jobs need to have made {fmt(m.breakEvenSoFar)} for the month to break even.</li>
          <li><span className="font-semibold">Coming from cars in the workshop</span> is the expected profit of quotations the customers have approved on cars still here, not yet invoiced.</li>
          <li><span className="font-semibold">If the month continues like this</span> takes the profit per working day so far and carries it to the end of the month.</li>
          <li><span className="font-semibold">Costs still arriving</span>: a job&apos;s profit is refined when a supplier invoice, a cheque, a bank charge or a driver&apos;s recovery price comes in later.</li>
        </ul>
      </details>
    </Card>
  );
}
