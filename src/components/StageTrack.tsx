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
export function StageTrack({ stage, timing, compact = false, skip, roadTest = null, partly = false, states = null, extra = [] }: { stage: Stage; timing: Timing; compact?: boolean; /** Steps this job never takes (loose items: inspection and wash). */ skip?: Stage[]; roadTest?: "waiting" | "done" | null; /** Kept for callers that still pass it; the states map is the source of truth now. */ partly?: boolean; /** The fact-driven state per stage (stageStates); without it the position decides. */ states?: Partial<Record<Stage, StageBoxState>> | null; /** Steps this job alone takes, slotted in after a stage (the advance payment between Approval and Parts). */ extra?: { after: Stage; key: string; label: string; state: StageBoxState }[] }) {
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
  // The stage boxes: one state per box, the same colours everywhere. A job with its own extra step
  // (the advance payment) shows it slotted in after its stage, same tokens, same rules.
  const boxes = stages.flatMap((s, i) => {
    const done = i < current;
    const now = i === current;
    const state: StageBoxState = states?.[s] ?? (done ? "done" : now ? "current" : "later");
    const own = { key: s as string, label: STAGE_LABELS[s], state, title: s === "inspection" && roadTest ? `Road test ${roadTest === "done" ? "done" : "waiting"} · inspection` : undefined };
    return [own, ...extra.filter((e) => e.after === s).map((e) => ({ key: e.key, label: e.label, state: e.state, title: undefined as string | undefined }))];
  });
  void partly; // in progress is always amber now; the shared classes carry the whole look
  return (
    <div className="overflow-x-auto" data-stage-track>
      <div className="grid gap-1 min-w-[560px]" style={{ gridTemplateColumns: `repeat(${boxes.length}, minmax(0, 1fr))` }}>
        {boxes.map((b) => (
          <div key={b.key} data-stage-box={b.key} data-state={b.state} className={`min-h-10 rounded-control px-1 py-1 flex items-center justify-center text-center text-[11px] leading-tight ${STAGE_BOX_CLASS[b.state]} ${STAGE_BOX_TITLE[b.state]} ${b.state === "current" ? "font-bold" : "font-semibold"}`} title={b.title}>
            <span>{b.state === "done" ? "✓ " : ""}{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
