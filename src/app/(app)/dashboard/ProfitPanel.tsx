import { Card, SectionLabel } from "@/components/ui";

/**
 * Daily profit target panel. Green at or above target, yellow at the threshold,
 * red below. Until invoicing is live it shows a clear "starts with invoicing" state.
 */
export function ProfitPanel({
  targetAed,
  yellowPercent,
  invoicedAed,
  collectedAed,
  carryAed,
  live,
}: {
  targetAed: number;
  yellowPercent: number;
  invoicedAed: number;
  collectedAed: number;
  carryAed: number;
  live: boolean;
}) {
  const fmt = (n: number) => `AED ${Math.round(n).toLocaleString("en-GB")}`;
  if (!live) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-4 border-dashed">
        <div className="flex flex-col gap-1">
          <SectionLabel>Daily profit target</SectionLabel>
          <span className="text-2xl font-extrabold text-faint">Starts with invoicing</span>
          <span className="text-sm text-muted">Target {fmt(targetAed)} per working day. Figures appear once invoices are issued in the system (Phase 4).</span>
        </div>
      </Card>
    );
  }
  const effective = invoicedAed + carryAed;
  const pct = targetAed > 0 ? (effective / targetAed) * 100 : 0;
  const tone = pct >= 100 ? "green" : pct >= yellowPercent ? "amber" : "red";
  const cls = { green: "bg-green-soft text-green border-green", amber: "bg-amber-soft text-amber border-amber-bar", red: "bg-red-soft text-red border-red-bar" }[tone];
  return (
    <Card className={`flex flex-wrap items-center gap-x-10 gap-y-3 border ${cls}`}>
      <div className="flex flex-col">
        <span className="text-xs font-bold uppercase tracking-[0.08em]">Today vs target</span>
        <span className="text-3xl font-extrabold">{Math.round(pct)}%</span>
      </div>
      <div className="flex flex-col text-sm">
        <span>Invoiced {fmt(invoicedAed)}</span>
        <span>Collected {fmt(collectedAed)}</span>
      </div>
      <div className="flex flex-col text-sm">
        <span>Target {fmt(targetAed)}</span>
        <span>Carried from yesterday {carryAed >= 0 ? "+" : "−"}{fmt(Math.abs(carryAed))}</span>
      </div>
    </Card>
  );
}
