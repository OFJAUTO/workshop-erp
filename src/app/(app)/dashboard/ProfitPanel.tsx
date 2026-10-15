import { Card } from "@/components/ui";

/**
 * Daily profit target panel, for the owner only. "AED X of AED Y (Z%)" for today, never negative: the
 * percentage starts at 0 and the shortfall of earlier days is not taken off today. Green at or above target,
 * yellow at the threshold, red below. The month so far is shown as information underneath.
 */
export function ProfitPanel({
  targetAed,
  yellowPercent,
  invoicedAed,
  collectedAed,
  monthAed = 0,
  live,
  provisional = 0,
  count = 0,
  comebacksAed = 0,
}: {
  targetAed: number;
  yellowPercent: number;
  invoicedAed: number;
  collectedAed: number;
  /** Profit invoiced this month so far, today included. */
  monthAed?: number;
  live: boolean;
  provisional?: number;
  count?: number;
  comebacksAed?: number;
}) {
  const fmt = (n: number) => `AED ${Math.round(Math.max(0, n)).toLocaleString("en-GB")}`;
  if (!live) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-dashed border-line bg-white px-4 py-2 text-sm">
        <span className="text-xs font-extrabold uppercase tracking-[0.08em]">Daily profit target</span>
        <span className="text-muted">{fmt(targetAed)} per working day</span>
      </div>
    );
  }
  const today = Math.max(0, invoicedAed);
  const pct = targetAed > 0 ? Math.max(0, Math.round((today / targetAed) * 100)) : 100;
  const tone = pct >= 100 ? "green" : pct >= yellowPercent ? "amber" : "red";
  const cls = { green: "bg-green-soft text-green border-green", amber: "bg-amber-soft text-amber border-amber-bar", red: "bg-red-soft text-red border-red-bar" }[tone];
  return (
    <Card className={`flex flex-wrap items-center gap-x-10 gap-y-3 border ${cls}`} data-profit-panel>
      <div className="flex flex-col">
        <span className="text-xs font-bold uppercase tracking-[0.08em]">Today vs target</span>
        <span className="text-2xl sm:text-3xl font-extrabold" data-profit-today>{fmt(today)} of {fmt(targetAed)} ({pct}%)</span>
      </div>
      <div className="flex flex-col text-sm">
        <span>Profit invoiced today {fmt(today)}{count ? ` (${count} invoice${count === 1 ? "" : "s"}${provisional ? `, ${provisional} provisional` : ""})` : ""}</span>
        <span>Collected today {fmt(collectedAed)}</span>
      </div>
      <div className="flex flex-col text-sm">
        <span>Target {fmt(targetAed)} per working day</span>
        <span>This month so far {fmt(monthAed)}</span>
      </div>
      {comebacksAed ? <div className="flex flex-col text-sm"><span className="font-extrabold text-red">Comebacks −{fmt(comebacksAed)}</span><span className="text-xs">lost today on cars back for our fault</span></div> : null}
    </Card>
  );
}
