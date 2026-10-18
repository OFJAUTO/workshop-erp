import { STAGE_LABELS, STAGES, type Stage, type Timing } from "@/lib/jobs";
import { STAGE_BOX_CLASS, STAGE_BOX_TITLE, type StageBoxState } from "@/lib/stage-style";

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
export function StageTrack({ stage, timing, compact = false, skip, roadTest = null, partly = false, states = null }: { stage: Stage; timing: Timing; compact?: boolean; /** Steps this job never takes (loose items: inspection and wash). */ skip?: Stage[]; roadTest?: "waiting" | "done" | null; /** Kept for callers that still pass it; the states map is the source of truth now. */ partly?: boolean; /** The fact-driven state per stage (stageStates); without it the position decides. */ states?: Partial<Record<Stage, StageBoxState>> | null }) {
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
          const state: StageBoxState = states?.[s] ?? (done ? "done" : now ? "current" : "later");
          void partly; // in progress is always amber now; the shared classes carry the whole look
          return (
            <div key={s} data-stage-box={s} data-state={state} className={`min-h-10 rounded-control px-1 py-1 flex items-center justify-center text-center text-[11px] leading-tight ${STAGE_BOX_CLASS[state]} ${STAGE_BOX_TITLE[state]} ${state === "current" ? "font-bold" : "font-semibold"}`} title={s === "inspection" && roadTest ? `Road test ${roadTest === "done" ? "done" : "waiting"} · inspection` : undefined}>
              <span>{state === "done" ? "✓ " : ""}{STAGE_LABELS[s]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
