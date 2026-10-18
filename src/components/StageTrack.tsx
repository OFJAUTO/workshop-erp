import { STAGE_LABELS, STAGES, type Stage, type Timing } from "@/lib/jobs";

const BAR: Record<Timing["tone"], string> = {
  green: "bg-green",
  amber: "bg-amber-bar",
  red: "bg-red-bar",
  neutral: "bg-ink",
};

/**
 * The nine-step track from the dashboard design. Done steps are black, the current step takes the timing colour.
 * When a road test comes before the inspection, the Inspection step shows two halves: the road test, then the inspection.
 */
export function StageTrack({ stage, timing, compact = false, skip, roadTest = null, partly = false }: { stage: Stage; timing: Timing; compact?: boolean; /** Steps this job never takes (loose items: inspection and wash). */ skip?: Stage[]; roadTest?: "waiting" | "done" | null; /** The current step is part-way (some parts received, the road test done): the box shows amber. */ partly?: boolean }) {
  const stages = skip?.length ? STAGES.filter((s) => !skip.includes(s)) : STAGES;
  const current = stages.indexOf(stage);
  if (compact) {
    return (
      <div className="overflow-x-auto">
        <div className="grid gap-1 min-w-[360px]" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
          {stages.map((s, i) => {
            const done = i < current;
            const now = i === current;
            return <span key={s} className={`h-1.5 rounded-full ${done ? "bg-green/50" : now ? BAR[timing.tone] : "bg-track"}`} />;
          })}
        </div>
      </div>
    );
  }
  // The stage boxes: one state per box, the same colours everywhere.
  return (
    <div className="overflow-x-auto" data-stage-track>
      <div className="grid gap-1 min-w-[560px]" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map((s, i) => {
          const done = i < current;
          const now = i === current;
          const halfDone = now && ((s === "inspection" && roadTest === "done") || partly);
          const state = done ? "done" : halfDone ? "partly" : now ? "current" : "later";
          const cls =
            state === "done" ? "border border-green bg-green-soft text-green"
            : state === "partly" ? "border-2 border-amber-bar bg-amber-soft text-ink font-bold"
            : state === "current" ? "border-2 border-ink bg-white text-ink font-bold"
            : "border border-line bg-chip text-muted";
          return (
            <div key={s} data-stage-box={s} data-state={state} className={`min-h-10 rounded-control px-1 py-1 flex items-center justify-center text-center text-[11px] font-semibold leading-tight ${cls}`} title={s === "inspection" && roadTest ? `Road test ${roadTest === "done" ? "done" : "waiting"} · inspection` : undefined}>
              <span>{state === "done" ? "✓ " : ""}{STAGE_LABELS[s]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
