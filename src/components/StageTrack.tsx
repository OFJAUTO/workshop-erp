import { STAGE_LABELS, STAGES, type Stage, type Timing } from "@/lib/jobs";

const BAR: Record<Timing["tone"], string> = {
  green: "bg-green",
  amber: "bg-amber-bar",
  red: "bg-red-bar",
  neutral: "bg-ink",
};

/** The nine-step track from the dashboard design. Done steps are black, the current step takes the timing colour. */
export function StageTrack({ stage, timing, compact = false }: { stage: Stage; timing: Timing; compact?: boolean }) {
  const current = STAGES.indexOf(stage);
  return (
    <div className="overflow-x-auto">
      <div className={`grid grid-cols-9 gap-1 ${compact ? "min-w-[360px]" : "min-w-[520px]"}`}>
        {STAGES.map((s, i) => {
          const done = i < current;
          const now = i === current;
          return (
            <div key={s} className="flex flex-col gap-1.5">
              <span className={`h-1.5 rounded-full ${done ? "bg-ink" : now ? BAR[timing.tone] : "bg-track"}`} />
              {!compact ? (
                <span className={`text-[11px] ${now ? "font-bold text-ink" : done ? "font-medium text-muted" : "font-medium text-faint"}`}>
                  {STAGE_LABELS[s]}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
