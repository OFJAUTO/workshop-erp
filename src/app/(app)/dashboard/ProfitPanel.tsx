import { Card } from "@/components/ui";

/**
 * Daily profit target panel. Green at or above target, yellow at the threshold, red below.
 * Profit is counted on the invoice date; invoiced and collected are shown apart; the shortfall or
 * surplus of earlier days this month carries into the figure and resets monthly.
 */
export function ProfitPanel({
  targetAed,
  yellowPercent,
  invoicedAed,
  collectedAed,
  carryAed,
  live,
  provisional = 0,
  count = 0,
}: {
  targetAed: number;
  yellowPercent: number;
  invoicedAed: number;
  collectedAed: number;
  carryAed: number;
  live: boolean;
  provisional?: number;
  count?: number;
}) {
  const fmt = (n: number) => `AED ${Math.round(n).toLocaleString("en-GB")}`;
  if (!live) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-dashed border-line bg-white px-4 py-2 text-sm">
        <span className="text-xs font-extrabold uppercase tracking-[0.08em]">Daily profit target</span>
        <span className="text-muted">{fmt(targetAed)} per working day</span>
      </div>
    );
  }
  const effective = invoicedAed + carryAed;
  const pct = targetAed > 0 ? (effective / targetAed) * 100 : 100;
  const tone = pct >= 100 ? "green" : pct >= yellowPercent ? "amber" : "red";
  const cls = { green: "bg-green-soft text-green border-green", amber: "bg-amber-soft text-amber border-amber-bar", red: "bg-red-soft text-red border-red-bar" }[tone];
  return (
    <Card className={`flex flex-wrap items-center gap-x-10 gap-y-3 border ${cls}`}>
      <div className="flex flex-col">
        <span className="text-xs font-bold uppercase tracking-[0.08em]">Today vs target</span>
        <span className="text-3xl font-extrabold">{Math.round(pct)}%</span>
      </div>
      <div className="flex flex-col text-sm">
        <span>Profit invoiced today {fmt(invoicedAed)}{count ? ` (${count} invoice${count === 1 ? "" : "s"}${provisional ? `, ${provisional} provisional` : ""})` : ""}</span>
        <span>Collected today {fmt(collectedAed)}</span>
      </div>
      <div className="flex flex-col text-sm">
        <span>Target {fmt(targetAed)} per working day</span>
        <span>Carried from earlier this month {carryAed >= 0 ? "+" : "−"}{fmt(Math.abs(carryAed))}</span>
      </div>
    </Card>
  );
}
